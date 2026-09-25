/**
 * The `evaluator` block kind: ask an evaluation model typed questions about
 * one state and return typed answers.
 *
 * A generator asks a model to write. An evaluator asks questions whose
 * possible answers the author already knows (which option, where on a scale,
 * yes or no) and returns `{ answers }` typed by the questions.
 *
 * What this module owns:
 * - the question builders (`choice`, `score`, `boolean`) and their checks;
 * - the model fence: an evaluation model instance is used as given, a model
 *   that can only generate is refused when the block is built, and a model
 *   string resolves at first execution through the flow's model resolver's
 *   `resolveEvaluationModel` hook, refused (before any provider call) when the
 *   resolver has none. Nothing falls back to another resolver, another model,
 *   or a generate call;
 * - the trace: the requested model and questions on the `block_trace` row,
 *   and usage and model identity reported through the same runtime hook a
 *   generator uses.
 *
 * The provider call and the mapping into FSD's answer type live in the
 * evaluation seam (`models/evaluate.ts`).
 */
import { z, type ZodTypeAny } from "zod";
import type {
  BlockConfig,
  BlockContext,
  BlockDefinition,
  ConnectorFn,
  DeclaredResourceEntry,
  InferBlockResources,
  InferFlowConfigFromSchema,
  InferStateFromSchema
} from "../types/block";
import type { AnyResourceRef } from "../types/resource";
import type {
  BooleanQuestion,
  ChoiceQuestion,
  EvaluationInput,
  EvaluationModel,
  EvaluatorOutput,
  EvaluatorQuestions,
  ScoreQuestion
} from "../types/evaluation";
import type {
  InferCapabilities,
  InferCapabilityOwnState,
  InferCapabilityResources,
  InferCapabilitySequencerState,
  InferCapabilitySessionState,
  MergeTargetSchemas,
  Prettify,
  UsesEntry,
} from "../capability/types";
import { parseModelString } from "../models/providerDetection";
import { runEvaluation } from "../models/evaluate";
import { buildBlock } from "./internal/build-block";
import { resolveCapabilities } from "./internal/resolve-capabilities";

// ---------------------------------------------------------------------------
// Question builders
// ---------------------------------------------------------------------------

/**
 * A multiple-choice question. The option keys become the answer's type:
 * `choice("Which team?", { billing: "…", technical: "…" })` answers with
 * `choice: "billing" | "technical"`.
 *
 * @param instructions - What to decide.
 * @param options - Option key → description (`null` for none). At least one.
 */
export function choice<const TOptions extends Record<string, EvaluationInput | null>>(
  instructions: EvaluationInput,
  options: TOptions
): ChoiceQuestion<Extract<keyof TOptions, string>> {
  return { type: "choice", instructions, criteria: options };
}

/**
 * An ordered-scale question. The answer's `score` is a position between the
 * first level (0) and the last.
 *
 * @param instructions - What to rate.
 * @param levels - At least two ordered level descriptions (`null` for none).
 */
export function score(
  instructions: EvaluationInput,
  levels: readonly (EvaluationInput | null)[]
): ScoreQuestion {
  return { type: "score", instructions, criteria: levels };
}

/**
 * A yes/no question. The answer's `probability` is the model's estimate that
 * the answer is yes.
 *
 * @param instructions - What to decide.
 * @param criteria - Optional descriptions of what true and false mean.
 */
export function boolean(
  instructions: EvaluationInput,
  criteria?: BooleanQuestion["criteria"]
): BooleanQuestion {
  return criteria === undefined
    ? { type: "boolean", instructions }
    : { type: "boolean", instructions, criteria };
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** True for an AI SDK evaluation model (what `provider.evaluationModel(id)` returns). */
function isEvaluationModel(value: unknown): value is EvaluationModel {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { doEvaluate?: unknown }).doEvaluate === "function" &&
    Array.isArray((value as { supportedQuestionTypes?: unknown }).supportedQuestionTypes)
  );
}

/** True for a model that can generate: an AI SDK language model or an FSD generator model. */
function isGenerateOnlyModel(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.doGenerate === "function" ||
    typeof candidate.doStream === "function" ||
    typeof candidate.generate === "function"
  );
}

function refuse(blockName: string, message: string): never {
  throw new Error(`Evaluator "${blockName}": ${message}`);
}

/**
 * Refuse, when the block is built, a `model` that cannot be an evaluator's
 * one model: a text model, an intent, a fallback array or a `selectModel`
 * function.
 */
function checkModelConfig(blockName: string, model: unknown): void {
  if (typeof model === "string") {
    if (parseModelString(model).type === "intent") {
      refuse(
        blockName,
        `"${model}" is an intent. An evaluator takes one model, not an intent, a fallback list or selectModel.`
      );
    }
    return;
  }
  if (Array.isArray(model) || typeof model === "function") {
    refuse(
      blockName,
      "an evaluator takes one model, not an intent, a fallback list or selectModel."
    );
  }
  if (isEvaluationModel(model)) return;
  if (isGenerateOnlyModel(model)) {
    refuse(
      blockName,
      "the model can generate but not evaluate.\n" +
        'Pass an evaluation model, e.g. openai.evaluationModel("gpt-5.4-mini"), or a model string.'
    );
  }
  refuse(
    blockName,
    'model must be a model string or an evaluation model, e.g. openai.evaluationModel("gpt-5.4-mini").'
  );
}

/** Refuse an empty question set, a choice with no options, or a score with fewer than two levels. */
function checkQuestions(blockName: string, questions: unknown): asserts questions is EvaluatorQuestions {
  if (typeof questions !== "object" || questions === null || Object.keys(questions).length === 0) {
    refuse(blockName, "questions must contain at least one question.");
  }
  for (const [id, question] of Object.entries(questions as Record<string, unknown>)) {
    const q = question as { type?: unknown; criteria?: unknown } | null;
    switch (q?.type) {
      case "choice":
        if (typeof q.criteria !== "object" || q.criteria === null || Object.keys(q.criteria).length === 0) {
          refuse(blockName, `question "${id}" is a choice with no options.`);
        }
        break;
      case "score":
        if (!Array.isArray(q.criteria) || q.criteria.length < 2) {
          refuse(blockName, `question "${id}" is a score with fewer than two levels.`);
        }
        break;
      case "boolean":
        break;
      default:
        refuse(blockName, `question "${id}" must be built with choice(), score() or boolean().`);
    }
  }
}

function isPlainObject(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Refuse a state the model cannot read: anything but a string, an array or a plain object. */
function checkState(blockName: string, state: unknown): asserts state is EvaluationInput {
  if (typeof state === "string" || Array.isArray(state) || isPlainObject(state)) return;
  refuse(
    blockName,
    `the evaluated state must be a string, an array or a plain object (got ${state === null ? "null" : typeof state}).`
  );
}

/**
 * Resolve a model string through the flow's model resolver. A resolver with
 * no `resolveEvaluationModel` hook refuses the string: FSD never substitutes
 * its default resolver, which would read keys and gateways the app did not
 * configure.
 */
async function resolveModelString(
  blockName: string,
  modelId: string,
  ctx: BlockContext
): Promise<EvaluationModel> {
  const resolve = ctx.resolveModel?.resolveEvaluationModel;
  if (resolve === undefined) {
    refuse(
      blockName,
      `cannot resolve model string "${modelId}": the app's model resolver has no resolveEvaluationModel hook. ` +
        "Add resolveEvaluationModel to the resolver, or pass an evaluation model instance."
    );
  }
  const model = await resolve.call(ctx.resolveModel, modelId, blockName);
  if (!isEvaluationModel(model)) {
    refuse(blockName, `the model resolver returned a model for "${modelId}" that cannot evaluate.`);
  }
  return model;
}

// ---------------------------------------------------------------------------
// Evaluator slots
// ---------------------------------------------------------------------------

/** How a slot that takes an evaluator block names itself and its two fixes. */
export type EvaluatorSlotNames = {
  /** The slot, as its refusal starts: e.g. `createSkillActivator: "evaluator"`. */
  slot: string;
  /** The helper that builds a fitting block: e.g. `skillEvaluator(model)`. */
  helper: string;
  /** The question set to build one by hand with: e.g. `skillQuestions`. */
  questions: string;
};

/**
 * Refuse, when a consumer is built, a value in an evaluator slot that is not
 * an evaluator block. Every package that takes an evaluator in an option
 * (memory's capture, the skill activator) refuses the same way, with one
 * message shape:
 *
 *   `<slot> must be an evaluator block (got <kind> "<name>"). Build one with
 *   <helper>, or core's evaluator() with <questions>.`
 *
 * The `(got …)` clause appears only when the value has a string `kind`.
 */
export function assertEvaluatorBlock(block: unknown, names: EvaluatorSlotNames): void {
  const kind = (block as { kind?: unknown } | null)?.kind;
  if (kind === "evaluator") return;
  const name = (block as { name?: unknown } | null)?.name;
  throw new Error(
    `${names.slot} must be an evaluator block` +
      (typeof kind === "string" ? ` (got ${kind} "${String(name)}")` : "") +
      `. Build one with ${names.helper}, or core's evaluator() with ${names.questions}.`
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** A static question set, or one computed per execution from the input and context. */
export type EvaluatorQuestionsSlot<
  TInput,
  TQuestions extends EvaluatorQuestions,
  TContext = BlockContext,
> =
  | TQuestions
  | ((input: TInput, ctx: TContext) => TQuestions | Promise<TQuestions>);

/**
 * Config for {@link evaluator}. Scope schemas, `resources`, `uses`,
 * `connectInput` and the shared block fields work as on a handler, and they
 * type the `ctx` the `questions` and `state` callbacks receive the way they
 * type a handler's `execute`. There is no `retry`: an evaluator makes one
 * call per run.
 *
 * The type parameters after `TQuestions` mirror `HandlerConfig`'s; they are
 * inferred from the declarations, not written by hand.
 */
export interface EvaluatorConfig<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TQuestions extends EvaluatorQuestions = EvaluatorQuestions,
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TParentInputSchema extends ZodTypeAny | undefined = undefined,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  TStateSchema extends ZodTypeAny | undefined = undefined,
  TParentStateSchema extends ZodTypeAny | undefined = undefined,
  TSelfState extends object = Prettify<InferStateFromSchema<TStateSchema> & InferCapabilityOwnState<TUses>>,
  TParentState extends object = InferStateFromSchema<TParentStateSchema>,
  TFlowConfigSchema extends ZodTypeAny | undefined = undefined,
  TFlowConfig extends object = InferFlowConfigFromSchema<TFlowConfigSchema>,
> extends Omit<
  BlockConfig<TInputSchema, ZodTypeAny, TInput, EvaluatorOutput<TQuestions>>,
  "execute" | "outputSchema" | "retry" | "validateChunk" | "cacheable" | "stateSchema" | "flowConfigSchema"
> {
  /**
   * Which model answers: a model string (resolved through the app's model
   * setup) or an evaluation model instance, e.g.
   * `openai.evaluationModel("gpt-5.4-mini")`. Intents, fallback arrays and
   * `selectModel` are refused.
   */
  model: string | EvaluationModel;
  /** The questions. Ids become the keys of `answers`. */
  questions: EvaluatorQuestionsSlot<
    TInput,
    TQuestions,
    BlockContext<
      TRequestState, TSessionState, TUserState, TOrgState,
      TResources, TSequencerState, TParentInput, TMergedTargetSchemas,
      TCapabilities, TSelfState, TParentState, TFlowConfig
    >
  >;
  /**
   * What the model evaluates: a string, an array or a plain object. Defaults
   * to the block's input.
   */
  state?: (
    input: TInput,
    ctx: BlockContext<
      TRequestState, TSessionState, TUserState, TOrgState,
      TResources, TSequencerState, TParentInput, TMergedTargetSchemas,
      TCapabilities, TSelfState, TParentState, TFlowConfig
    >
  ) => EvaluationInput | Promise<EvaluationInput>;
  /** What this block requires of the flow that installs it; types `ctx.flow.config`. */
  flowConfigSchema?: TFlowConfigSchema;
  requestStateSchema?: TRequestStateSchema;
  sessionStateSchema?: TSessionStateSchema;
  userStateSchema?: TUserStateSchema;
  orgStateSchema?: TOrgStateSchema;
  sequencerStateSchema?: TSequencerStateSchema;
  parentInputSchema?: TParentInputSchema;
  /** This block's own request-scoped state, exposed via `ctx.self`. */
  stateSchema?: TStateSchema;
  /** Expected shape of the immediate parent's own state. */
  parentStateSchema?: TParentStateSchema;
  resources?: TResourceDefs;
  connectInput?: ConnectorFn<unknown, TInput>;
  targetStateSchemas?: TTargetSchemas;
  /**
   * Capabilities to install: resources, state and helpers. Capabilities
   * cannot supply an evaluator's model, tools or context.
   */
  uses?: TUses;
}

/**
 * The output schema type an evaluator carries, so `BlockOutput<typeof block>`
 * and sequencer steps see typed answers. At runtime the output is not
 * re-validated: the SDK has already checked every answer against its question.
 */
export type EvaluatorOutputSchema<TQuestions extends EvaluatorQuestions = EvaluatorQuestions> =
  z.ZodType<EvaluatorOutput<TQuestions>>;

/** The block an {@link evaluator} call returns. */
export type EvaluatorDefinition<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  TQuestions extends EvaluatorQuestions = EvaluatorQuestions,
> = BlockDefinition<TInputSchema, EvaluatorOutputSchema<TQuestions>, TInput, EvaluatorOutput<TQuestions>>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build an `evaluator` block: it asks an evaluation model typed questions
 * about one state and returns `{ answers }`, one answer per question id,
 * typed by its question. An answer carries `confidence` only when the model
 * reported one.
 *
 * One provider call per run. No retry, no fallback, no gating: branch on the
 * answers in a router or a sequencer step. A failed call fails the block like
 * any other; `.rescue` in a sequencer recovers with a substitute block.
 *
 * @example
 * const triage = evaluator({
 *   name: "triage",
 *   model: "typesafe-ai/jev",
 *   state: (input: { message: string }) => input.message,
 *   questions: {
 *     team: choice("Which team should handle this?", {
 *       billing: "Payments and refunds",
 *       technical: "Bugs and outages",
 *     }),
 *     urgent: boolean("Does this need someone now?"),
 *   },
 * });
 */
export function evaluator<
  TInputSchema extends ZodTypeAny = ZodTypeAny,
  TInput = z.infer<TInputSchema>,
  const TQuestions extends EvaluatorQuestions = EvaluatorQuestions,
  TRequestStateSchema extends ZodTypeAny | undefined = undefined,
  TSessionStateSchema extends ZodTypeAny | undefined = undefined,
  TUserStateSchema extends ZodTypeAny | undefined = undefined,
  TOrgStateSchema extends ZodTypeAny | undefined = undefined,
  TSequencerStateSchema extends ZodTypeAny | undefined = undefined,
  TParentInputSchema extends ZodTypeAny | undefined = undefined,
  TResourceDefs extends Record<string, DeclaredResourceEntry> | undefined = undefined,
  TTargetSchemas extends Record<string, ZodTypeAny> | undefined = undefined,
  TUses extends readonly UsesEntry[] = readonly [],
  TRequestState extends object = InferStateFromSchema<TRequestStateSchema>,
  TSessionState extends object = Prettify<InferStateFromSchema<TSessionStateSchema> & InferCapabilitySessionState<TUses>>,
  TUserState extends object = InferStateFromSchema<TUserStateSchema>,
  TOrgState extends object = InferStateFromSchema<TOrgStateSchema>,
  TSequencerState extends object = Prettify<InferStateFromSchema<TSequencerStateSchema> & InferCapabilitySequencerState<TUses>>,
  TParentInput = TParentInputSchema extends ZodTypeAny ? z.infer<TParentInputSchema> : unknown,
  TResources extends Record<string, AnyResourceRef> = Prettify<InferBlockResources<undefined, TResourceDefs> & InferCapabilityResources<TUses>>,
  TMergedTargetSchemas extends Record<string, ZodTypeAny> | undefined = MergeTargetSchemas<TTargetSchemas, TUses>,
  TCapabilities extends Record<string, Record<string, (...args: any[]) => any>> = InferCapabilities<TUses>,
  TStateSchema extends ZodTypeAny | undefined = undefined,
  TParentStateSchema extends ZodTypeAny | undefined = undefined,
  TSelfState extends object = Prettify<InferStateFromSchema<TStateSchema> & InferCapabilityOwnState<TUses>>,
  TParentState extends object = InferStateFromSchema<TParentStateSchema>,
  TFlowConfigSchema extends ZodTypeAny | undefined = undefined,
  TFlowConfig extends object = InferFlowConfigFromSchema<TFlowConfigSchema>,
>(
  config: EvaluatorConfig<
    TInputSchema, TInput, TQuestions,
    TRequestStateSchema, TSessionStateSchema, TUserStateSchema, TOrgStateSchema, TSequencerStateSchema, TParentInputSchema,
    TResourceDefs, TTargetSchemas, TUses,
    TRequestState, TSessionState, TUserState, TOrgState, TSequencerState, TParentInput,
    TResources, TMergedTargetSchemas, TCapabilities, TStateSchema, TParentStateSchema, TSelfState, TParentState,
    TFlowConfigSchema, TFlowConfig
  >
): EvaluatorDefinition<TInputSchema, TInput, TQuestions> {
  const blockName = config.name;
  checkModelConfig(blockName, config.model);
  if (typeof config.questions !== "function") {
    checkQuestions(blockName, config.questions);
  }

  const { declaredResources, resolvedCapabilities, stateSchema } = resolveCapabilities(config, "evaluator");

  // The callbacks are typed by the block's declarations; at runtime they
  // receive the block's ctx, as a handler's `execute` does.
  const questionsSlot = config.questions as EvaluatorQuestionsSlot<TInput, TQuestions>;
  const stateFn = config.state as
    | ((input: TInput, ctx: BlockContext) => EvaluationInput | Promise<EvaluationInput>)
    | undefined;

  const execute = async (input: TInput, ctx: BlockContext): Promise<EvaluatorOutput<TQuestions>> => {
    const questions =
      typeof questionsSlot === "function" ? await questionsSlot(input, ctx) : questionsSlot;
    checkQuestions(blockName, questions);

    const state = stateFn !== undefined ? await stateFn(input, ctx) : input;
    checkState(blockName, state);

    const requestedModel =
      typeof config.model === "string"
        ? config.model
        : `${config.model.provider}/${config.model.modelId}`;
    ctx._runtimeHooks?.onBlockTraceCapture?.(
      { phase: "evaluator", data: { evaluator: { model: requestedModel, questions } } },
      ctx
    );

    const model =
      typeof config.model === "string"
        ? await resolveModelString(blockName, config.model, ctx)
        : config.model;

    const result = await runEvaluation({
      model,
      state,
      questions,
      signal: ctx.signal,
      requested: requestedModel,
    });

    ctx._runtimeHooks?.onGeneratorModelResult?.({
      model: requestedModel,
      usage: result.usage,
      identity: result.identity,
    });

    return { answers: result.answers } as EvaluatorOutput<TQuestions>;
  };

  return buildBlock<TInputSchema, EvaluatorOutputSchema<TQuestions>, TInput, EvaluatorOutput<TQuestions>>({
    kind: "evaluator",
    config: { ...config, stateSchema } as unknown as BlockConfig<TInputSchema, EvaluatorOutputSchema<TQuestions>, TInput, EvaluatorOutput<TQuestions>>,
    execute,
    declaredResources,
    ownDeclaredResources: declaredResources,
    resolvedCapabilities,
  });
}
