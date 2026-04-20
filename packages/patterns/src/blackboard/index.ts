/**
 * Blackboard Pattern
 *
 * Multi-agent coordination via a shared resource workspace. Specialist blocks
 * read from and write to the blackboard without direct coupling. A controller
 * reads the blackboard state and decides which specialist to invoke next.
 *
 * Pipeline: [init] → [controller] → [recordDecision] → thenIf(!done, [dispatch])
 *           → tap([snapshot]) → [checkBlackboard] → loopBack(controller) → [synthesizer?]
 *
 * The blackboard is a session resource (not sequencer state) — enabling
 * cross-request inspection and demonstrating the resource system for patterns.
 */
import { sequencer, handler, generator } from "@flow-state-dev/core";
import type { BlockDefinition, DefinedResource } from "@flow-state-dev/core/types";
import type { GeneratorSlot, UsesSlot } from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";
import {
  blackboardControlSchema,
  controllerOutputSchema,
  type BlackboardControlState,
  type ControllerOutput,
} from "./schemas";
import { createDispatchSpecialist } from "./blocks/dispatch-specialist";
import { createCheckBlackboard } from "./blocks/check-blackboard";

export {
  createBlackboard,
  blackboardControlSchema,
  controllerOutputSchema,
} from "./schemas";
export type { BlackboardControlState, ControllerOutput } from "./schemas";
export { createDispatchSpecialist } from "./blocks/dispatch-specialist";
export { createCheckBlackboard } from "./blocks/check-blackboard";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface BlackboardConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Name for this blackboard instance. Used as block name prefix. Required. */
  name: string;

  /** Blackboard resource — created via `createBlackboard(stateSchema)`. Required. */
  blackboard: DefinedResource;

  /**
   * Specialist blocks keyed by name. Required. Must have at least 1 entry.
   * Each specialist should declare `sessionResources: { blackboard }` and
   * read/write the blackboard resource internally.
   */
  specialists: Record<string, BlockDefinition<any, any>>;

  /**
   * Controller block — reads blackboard, returns `{ specialist, done, reasoning }`.
   * Must output `controllerOutputSchema`. Should declare
   * `sessionResources: { blackboard }` for typed access.
   * Default: LLM generator that reads blackboard state and specialist names.
   */
  controller?: BlockDefinition<any, any>;

  /** Maximum controller iterations before forced termination. Default: 10. */
  maxIterations?: number;

  /**
   * Maximum number of history entries to retain. When exceeded, oldest entries
   * are dropped (FIFO). Prevents unbounded growth in long-running sessions.
   * Default: no limit (undefined).
   */
  maxHistory?: number;

  /**
   * Initial state to seed the blackboard with.
   * Can be a static object or a function receiving the pipeline input.
   */
  initialState?:
    | Record<string, unknown>
    | ((input: unknown) => Record<string, unknown> | Promise<Record<string, unknown>>);

  /** Model ID for the default controller and synthesizer. Default: "openai/gpt-5.4-mini". */
  model?: string;

  /** Context slot for the default controller and synthesizer generators. */
  context?: GeneratorSlot<any, any>;

  /** Capabilities to install on default blocks (controller, synthesizer). */
  uses?: UsesSlot;

  /**
   * Final synthesis step — receives `{ blackboard, iterations, history }`.
   * Default: generator that reads the blackboard and produces a coherent result.
   * Pass `false` to disable and return raw blackboard state + metadata.
   */
  synthesizer?: BlockDefinition<any, any> | false;

  /** Output schema for the default synthesizer. */
  outputSchema?: TOutputSchema;
}

// ---------------------------------------------------------------------------
// Default Controller
// ---------------------------------------------------------------------------

function buildDefaultController(config: {
  name: string;
  blackboardResource: DefinedResource;
  specialists: string[];
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
}) {
  return generator({
    name: `${config.name}-controller`,
    model: config.model ?? "openai/gpt-5.4-mini",
    outputSchema: controllerOutputSchema,
    sessionResources: { blackboard: config.blackboardResource },
    sequencerStateSchema: blackboardControlSchema,
    emit: { messages: false, reasoning: false },
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    prompt: (_input, ctx) => {
      const state = ctx.sequencer?.state as BlackboardControlState | undefined;
      const iteration = state?.iteration ?? 0;
      const history = state?.history ?? [];

      const historyBlock = history.length > 0
        ? `\nPrevious decisions:\n${history.map((h) => `- Iteration ${h.iteration}: invoked "${h.specialist}" — ${h.reasoning}`).join("\n")}`
        : "";

      return [
        "You are a blackboard controller coordinating specialist agents.",
        `Available specialists: ${config.specialists.join(", ")}`,
        `Current iteration: ${iteration + 1}`,
        "",
        "Read the current blackboard state and decide:",
        "1. Which specialist to invoke next (set specialist to the name)",
        "2. Whether the problem is fully solved (set done to true, specialist to null)",
        "",
        "Provide clear reasoning for your decision.",
        "Do not invoke the same specialist repeatedly unless their prior contribution was incomplete.",
        historyBlock,
      ].filter(Boolean).join("\n");
    },
    user: (_input, ctx) => {
      const boardState = ctx.session.resources.blackboard?.state;
      return `Current blackboard state:\n${JSON.stringify(boardState, null, 2)}`;
    },
  });
}

// ---------------------------------------------------------------------------
// Default Synthesizer
// ---------------------------------------------------------------------------

function buildDefaultSynthesizer(config: {
  name: string;
  blackboardResource: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  outputSchema?: ZodTypeAny;
}) {
  return generator({
    name: `${config.name}-synthesizer`,
    model: config.model ?? "openai/gpt-5.4-mini",
    sessionResources: { blackboard: config.blackboardResource },
    emit: { messages: true, reasoning: false },
    ...(config.outputSchema ? { outputSchema: config.outputSchema } : {}),
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    prompt: [
      "You are a synthesis assistant.",
      "The blackboard contains contributions from multiple specialist agents.",
      "Synthesize the blackboard state into a coherent, unified result.",
      "Include key findings from each specialist's contribution.",
    ].join("\n"),
    user: (input) => {
      const data = input as { blackboard: unknown; iterations: number; history: unknown[] };
      return [
        `Blackboard state:\n${JSON.stringify(data.blackboard, null, 2)}`,
        `\nCompleted in ${data.iterations} iterations.`,
      ].join("\n");
    },
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a blackboard block — a sequencer that coordinates specialist agents
 * through a shared workspace resource, controlled by an LLM controller that
 * decides which specialist to invoke next.
 */
export function blackboard<TOutputSchema extends ZodTypeAny = ZodTypeAny>(
  config: BlackboardConfig<TOutputSchema>
) {
  const { name, maxIterations = 10, maxHistory } = config;
  const blackboardResource = config.blackboard;

  if (Object.keys(config.specialists).length === 0) {
    throw new Error(
      `[blackboard] At least one specialist is required in "${name}"`
    );
  }

  // 1. Init: seeds blackboard resource with initial state (if provided)
  const initBlackboard = handler({
    name: `${name}-init`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { blackboard: blackboardResource },
    execute: async (input, ctx) => {
      if (config.initialState) {
        const initial =
          typeof config.initialState === "function"
            ? await config.initialState(input)
            : config.initialState;
        await ctx.session.resources.blackboard.setState(
          initial as Parameters<typeof ctx.session.resources.blackboard.setState>[0]
        );
      }
      return input;
    },
  });

  // 2. Controller: reads blackboard, decides next specialist
  const controller =
    config.controller ??
    buildDefaultController({
      name,
      blackboardResource,
      specialists: Object.keys(config.specialists),
      model: config.model,
      context: config.context,
      uses: config.uses,
    });

  // 3. Record decision: stores controller output in sequencer state and
  //    emits a status message so the user knows which specialist is running.
  const recordDecision = handler({
    name: `${name}-record`,
    inputSchema: controllerOutputSchema,
    outputSchema: controllerOutputSchema,
    sequencerStateSchema: blackboardControlSchema,
    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      let history = [
        ...state.history,
        {
          iteration: state.iteration + 1,
          specialist: input.specialist ?? "(none)",
          reasoning: input.reasoning,
        },
      ];
      // FIFO truncation: drop oldest entries when maxHistory is exceeded
      if (maxHistory !== undefined && history.length > maxHistory) {
        history = history.slice(history.length - maxHistory);
      }
      await ctx.sequencer!.patchState({
        iteration: state.iteration + 1,
        currentSpecialist: input.specialist ?? undefined,
        done: input.done,
        history,
      });

      // Emit status so the user sees what's happening without noise
      if (input.done) {
        ctx.emitStatus(`[blackboard:${name}] converged after ${state.iteration + 1} iterations`);
      } else if (input.specialist) {
        ctx.emitStatus(`[blackboard:${name}] invoking specialist: ${input.specialist}`);
      }

      return input;
    },
  });

  // 4. Dispatch: routes to the correct specialist, wrapped in rescue so a
  //    failing specialist doesn't kill the entire blackboard loop.
  const dispatchRouter = createDispatchSpecialist(name, config.specialists);
  const dispatch = sequencer({
    name: `${name}-dispatch-safe`,
    inputSchema: z.any(),
  })
    .then(dispatchRouter)
    .rescue([{
      block: handler({
        name: `${name}-dispatch-rescue`,
        execute: (error, ctx) => {
          ctx.emitStatus(
            `[blackboard:${name}] specialist failed: ${(error as Error).message}`
          );
          return { __rescued: true };
        },
      }),
    }]);

  // 5. Snapshot: emits the current blackboard state as a structured component
  //    after each specialist runs. Uses a stable key so clients replace
  //    prior snapshots in-place (same pattern as supervisor plan snapshots).
  const emitSnapshot = handler({
    name: `${name}-snapshot`,
    inputSchema: z.any(),
    outputSchema: z.any(),
    sessionResources: { blackboard: blackboardResource },
    sequencerStateSchema: blackboardControlSchema,
    execute: async (input, ctx) => {
      const boardState = ctx.session.resources.blackboard.state;
      const controlState = ctx.sequencer!.state;
      ctx.emitComponent("blackboard", {
        state: boardState,
        iteration: controlState.iteration,
        specialist: controlState.currentSpecialist ?? null,
        done: controlState.done,
      } as unknown as Record<string, unknown>, { key: name });
      return input;
    },
  });

  // 6. Check: materializes loop condition
  const checkBlackboard = createCheckBlackboard(name);

  // 7. Synthesizer (optional)
  const finalSynthesizer =
    config.synthesizer === false
      ? null
      : config.synthesizer ??
        buildDefaultSynthesizer({
          name,
          blackboardResource,
          model: config.model,
          context: config.context,
          uses: config.uses,
          outputSchema: config.outputSchema,
        });

  // 8. Assemble pipeline
  const base = sequencer({
    name,
    stateSchema: blackboardControlSchema,
    container: { component: "blackboard" },
  })
    .then(initBlackboard)
    .then(controller)
    .then(recordDecision)
    .thenIf(
      (r: ControllerOutput) => !r.done,
      dispatch
    )
    .tap(emitSnapshot)
    .then(checkBlackboard)
    .loopBack(controller.name, {
      when: (v: { continue: boolean }) => v.continue,
      maxIterations,
    })
    .map((_value: unknown, ctx: any) => {
      const boardState = ctx.session.resources.blackboard.state;
      const controlState = ctx.sequencer!.state as BlackboardControlState;
      return {
        blackboard: boardState,
        iterations: controlState.iteration,
        history: controlState.history,
      };
    });

  return finalSynthesizer
    ? base.then(finalSynthesizer as BlockDefinition<any, any>)
    : base;
}
