/**
 * `cascadingRouter` — a decision tree of evaluator choice questions that
 * fails closed.
 *
 * Each level asks an evaluator block the author built, and routes on one of
 * its choice questions. An edge opens only when the model chose an option
 * that has a branch and reported confidence at or above the edge's optional
 * `minConfidence`. Every other outcome, at every level, runs the one
 * `ambiguous` block. A failed or cancelled evaluation is not an answer: it
 * propagates, and never reaches `ambiguous`.
 *
 * The tree compiles, once, into ordinary composition. Each level is a
 * sequencer of three steps:
 *
 *   1. the level's evaluator, its own traced step (so resume replays its
 *      answer instead of asking the model again);
 *   2. a gate handler that runs {@link cascadeGate} on the answer and returns
 *      `{ input, verdict }`, where `input` is the level's own input read from
 *      `ctx.parent.input` (the evaluator returns only its answers);
 *   3. a `router` whose selector reads only the verdict.
 *
 * Leaves and `ambiguous` are wrapped with `connectInput` to receive `input`.
 * A nested level takes the parent's envelope and unwraps it on its evaluator
 * step and in its gate: a sequencer's `connectInput` runs as its first step,
 * so `ctx.parent.input` would be the pre-connector value anyway. The returned
 * block is a sequencer around the root level, because the steps of the block
 * a run starts at see no `ctx.parent.input`.
 */
import { z, type ZodTypeAny } from "zod";
import { handler, router, sequencer } from "../blocks";
import type { BlockDefinition, BlockOutput } from "../types/block";
import type { ChoiceAnswer, EvaluatorAnswer } from "../types/evaluation";
import { cascadeGate, type CascadeAmbiguousReason } from "./cascading-router-gate";

export type { CascadeAmbiguousReason } from "./cascading-router-gate";

/** Any evaluator block: its output carries `answers`. */
type AnyEvaluatorBlock = BlockDefinition<any, any, any, { answers: Record<string, EvaluatorAnswer> }>;

/**
 * One branch of a level: run a `block`, or ask the `next` level. An optional
 * `minConfidence` in [0, 1] is the edge's floor, compared inclusively.
 */
export type CascadeBranch =
  | { minConfidence?: number; block: BlockDefinition<any, any>; next?: never }
  | { minConfidence?: number; next: CascadeLevel; block?: never };

/**
 * One level of the tree: the evaluator to `ask`, the id of the choice
 * question to route `on`, and one branch per option to route.
 */
export interface CascadeLevel {
  ask: AnyEvaluatorBlock;
  on: string;
  branches: Readonly<Record<string, CascadeBranch>>;
}

/** The answers type of an evaluator block. */
type AnswersOf<TAsk> = BlockOutput<TAsk> extends { answers: infer A } ? A : never;

/** The ids of an evaluator's choice questions. */
type ChoiceIdsOf<TAsk> = {
  [K in keyof AnswersOf<TAsk> & string]: AnswersOf<TAsk>[K] extends ChoiceAnswer<any> ? K : never;
}[keyof AnswersOf<TAsk> & string];

/** The option keys of one choice question on an evaluator. */
type OptionsOf<TAsk, TOn> = TOn extends keyof AnswersOf<TAsk>
  ? AnswersOf<TAsk>[TOn] extends ChoiceAnswer<infer O>
    ? O
    : never
  : never;

/**
 * Type-level checks for one level, intersected with what the author wrote:
 * `on` must name a choice question of `ask`, and every branch key must be one
 * of that question's options. Nested levels are checked the same way.
 */
type CheckedLevel<L> = L extends { ask: infer A; on: infer On; branches: infer B }
  ? {
      on: ChoiceIdsOf<A>;
      branches: {
        [K in keyof B]: K extends OptionsOf<A, On>
          ? B[K] extends { next: infer N }
            ? { next: CheckedLevel<N> }
            : unknown
          : never;
      };
    }
  : never;

/** Config for {@link cascadingRouter}. */
export interface CascadingRouterConfig<TRoot extends CascadeLevel, TInput = any, TOutput = any> {
  /** The router's name. Levels, gates and routes are named under it. */
  name: string;
  /**
   * Where every edge that doesn't open goes, at any level: no confidence
   * reported, confidence below the edge's floor, or an option with no branch.
   * Receives the router's own input; its output is the router's.
   */
  ambiguous: BlockDefinition<any, any, TInput, TOutput>;
  /** The first level of the tree. */
  root: TRoot & CheckedLevel<TRoot>;
}

/** What the gate step decided at one level, as it appears in the trace. */
export type CascadeVerdict =
  | { level: string; on: string; edge: string; confidence: number }
  | { level: string; on: string; ambiguous: CascadeAmbiguousReason; choice?: string };

/** The gate step's output: the level's own input, carried past the evaluator, and the verdict. */
type CascadeEnvelope = { input: unknown; verdict: CascadeVerdict };

function refuse(name: string, message: string): never {
  throw new Error(`cascadingRouter "${name}": ${message}`);
}

function isBlock(value: unknown): value is BlockDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    typeof (value as { connectInput?: unknown }).connectInput === "function"
  );
}

/**
 * Refuse, when the router is built, a tree that can't be walked: a branch
 * with both `block` and `next` or neither, a floor outside [0, 1], an `on` or
 * a branch key the evaluator's static questions don't have, or a level
 * reached from inside itself.
 */
function validateLevel(name: string, level: CascadeLevel, path: string, ancestors: Set<CascadeLevel>): void {
  if (ancestors.has(level)) refuse(name, `the level at "${path}" is already inside itself; a tree can't loop.`);
  if (typeof level !== "object" || level === null) refuse(name, `the level at "${path}" is missing.`);
  if (!isBlock(level.ask) || level.ask.kind !== "evaluator") {
    refuse(name, `the level at "${path}" must ask an evaluator block.`);
  }
  const questions = (level.ask.config as { questions?: unknown }).questions;
  if (typeof questions === "object" && questions !== null) {
    const question = (questions as Record<string, { type?: string; criteria?: object } | undefined>)[level.on];
    if (!Object.prototype.hasOwnProperty.call(questions, level.on) || question === undefined) {
      refuse(name, `the level at "${path}" routes on "${level.on}", which evaluator "${level.ask.name}" doesn't ask.`);
    }
    if (question.type !== "choice") {
      refuse(name, `the level at "${path}" routes on "${level.on}", which is a ${question.type} question, not a choice.`);
    }
    for (const key of Object.keys(level.branches)) {
      if (!Object.prototype.hasOwnProperty.call(question.criteria ?? {}, key)) {
        refuse(name, `branch "${path}/${key}": "${key}" is not an option of "${level.on}".`);
      }
    }
  }
  ancestors.add(level);
  for (const [key, branch] of Object.entries(level.branches)) {
    const at = `${path}/${key}`;
    const hasBlock = branch.block !== undefined;
    const hasNext = branch.next !== undefined;
    if (hasBlock === hasNext) refuse(name, `branch "${at}" needs exactly one of block or next.`);
    if (hasBlock && !isBlock(branch.block)) refuse(name, `branch "${at}": block is not a block.`);
    const floor = branch.minConfidence;
    if (floor !== undefined && !(typeof floor === "number" && floor >= 0 && floor <= 1)) {
      refuse(name, `branch "${at}": minConfidence must be between 0 and 1 (got ${String(floor)}).`);
    }
    if (hasNext) validateLevel(name, branch.next!, at, ancestors);
  }
  ancestors.delete(level);
}

/**
 * Build a sequencer that walks a tree of evaluator choice questions. An edge
 * opens only when the model chose its option and reported confidence at or
 * above the edge's optional `minConfidence`; every other outcome, at any
 * level, runs `ambiguous`. On evaluation models that report no confidence,
 * every edge goes to `ambiguous`. A failed evaluation fails the router.
 *
 * Every leaf and `ambiguous` receive the router's own input, and the router
 * returns whatever the chosen block returns.
 *
 * @example
 * const triage = utility.cascadingRouter({
 *   name: "triage",
 *   ambiguous: review,
 *   root: {
 *     ask: department,
 *     on: "team",
 *     branches: {
 *       billing: { minConfidence: 0.6, next: { ask: urgency, on: "urgency", branches: {
 *         high: { minConfidence: 0.7, block: escalate },
 *         low: { block: billingQueue },
 *       } } },
 *       technical: { minConfidence: 0.6, block: techQueue },
 *     },
 *   },
 * });
 */
export function cascadingRouter<const TRoot extends CascadeLevel, TInput = any, TOutput = any>(
  config: CascadingRouterConfig<TRoot, TInput, TOutput>
): BlockDefinition<ZodTypeAny, ZodTypeAny, TInput, TOutput> {
  const { name } = config;
  if (!isBlock(config.ambiguous)) refuse(name, "ambiguous is required: the block every edge that doesn't open runs.");
  validateLevel(name, config.root, "root", new Set());

  // One unwrapping wrapper per distinct block across the whole tree, so a
  // block under two edges (or also used as `ambiguous`) is one route
  // definition: `router()` refuses two different definitions sharing a name.
  const unwrapped = new Map<BlockDefinition, BlockDefinition>();
  const unwrap = (block: BlockDefinition): BlockDefinition => {
    let wrapped = unwrapped.get(block);
    if (wrapped === undefined) {
      wrapped = block.connectInput((env: CascadeEnvelope) => env.input);
      unwrapped.set(block, wrapped);
    }
    return wrapped;
  };
  const ambiguous = unwrap(config.ambiguous);

  const compiled = new Map<CascadeLevel, BlockDefinition>();
  const compileLevel = (level: CascadeLevel, path: string, nested: boolean): BlockDefinition => {
    const existing = compiled.get(level);
    if (existing !== undefined) return existing;

    // Below the root, a level's input is its parent level's envelope.
    const own = (raw: unknown): unknown => (nested ? (raw as CascadeEnvelope).input : raw);

    const routes = new Map<string, BlockDefinition>();
    for (const [key, branch] of Object.entries(level.branches)) {
      routes.set(
        key,
        branch.next !== undefined ? compileLevel(branch.next, `${path}/${key}`, true) : unwrap(branch.block!)
      );
    }

    const gate = handler({
      name: `${name}/${path}/gate`,
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: (output: { answers: Record<string, EvaluatorAnswer> }, ctx): CascadeEnvelope => {
        const answer = output.answers[level.on];
        const decision = cascadeGate(answer, level.branches);
        const verdict: CascadeVerdict =
          "edge" in decision
            ? { level: path, on: level.on, edge: decision.edge, confidence: decision.confidence }
            : {
                level: path,
                on: level.on,
                ambiguous: decision.ambiguous,
                ...(answer?.type === "choice" && typeof answer.choice === "string" ? { choice: answer.choice } : {}),
              };
        // Every level runs inside a sequencer, so its gate always has a
        // parent. A context without one would hand every leaf `undefined`.
        if (ctx.parent === undefined) refuse(name, `the gate at "${path}" ran without its level's input.`);
        return { input: own(ctx.parent.input), verdict };
      },
    });

    // The selector reads only the gate's verdict: resume re-runs it on the
    // replayed answer and must reach the same route.
    const candidates = [...new Set([...routes.values(), ambiguous])];
    const pick = router({
      name: `${name}/${path}/route`,
      routes: candidates,
      execute: (env: CascadeEnvelope) =>
        "edge" in env.verdict ? routes.get(env.verdict.edge)! : ambiguous,
    });

    const levelName = `${name}/${path}`;
    const ask = level.ask as BlockDefinition;
    const block = (
      nested
        ? sequencer({ name: levelName, inputSchema: z.any() }).step((raw: unknown) => own(raw), ask)
        : sequencer({ name: levelName, inputSchema: z.any() }).step(ask)
    )
      .step(gate)
      .step(pick) as unknown as BlockDefinition;
    compiled.set(level, block);
    return block;
  };

  return sequencer({ name, inputSchema: z.any() }).step(
    compileLevel(config.root, "root", false)
  ) as unknown as BlockDefinition<ZodTypeAny, ZodTypeAny, TInput, TOutput>;
}

