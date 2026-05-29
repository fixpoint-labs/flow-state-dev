/**
 * routedSpecialists pattern — controller-orchestrated multi-specialist loop.
 *
 * Multi-agent coordination via a shared workspace resource. An LLM
 * controller reads the workspace state and decides which specialist to
 * invoke next, iteration after iteration, until convergence. Specialists
 * read from and write to the workspace without direct coupling.
 *
 * Per-iteration records live in a `TaskCollection` (substrate); the
 * shared workspace stays as a sibling writable resource. Each iteration
 * is one `Task` whose `assignee` is the picked specialist and whose
 * `output` is the specialist's return value.
 *
 * Pipeline:
 *   sequencer
 *     .tap(initWorkspace)
 *     .step(controller)              // → { specialist, done, reasoning }
 *     .step(recordIteration)         // creates a Task, patches control state
 *     .stepIf(!done, dispatch)       // routes to specialist by name
 *     .tap(recordCompletion)         // collection.complete(taskId, output)
 *     .tap(emitSnapshot)
 *     .step(checkLoop)
 *     .loopBack(controller)
 *     .map(toSynthesizerInput)
 *     [.step(synthesizer)]
 */
import { sequencer, handler, generator } from "@flow-state-dev/core";
import type {
  BlockContext,
  BlockDefinition,
  DefinedResource,
} from "@flow-state-dev/core/types";
import type {
  AgentType,
  GeneratorSlot,
  InstructionsSlot,
  UsesSlot,
} from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";
import {
  getOrCreateTaskCollection,
  type Task,
  type TaskCollectionRef,
} from "@flow-state-dev/tasks";
import {
  routedSpecialistsControlSchema,
  controllerOutputSchema,
  type ControllerOutput,
  type RoutedSpecialistsControlState,
} from "./schemas";
import { createDispatchSpecialist } from "./blocks/dispatch-specialist";
import { createCheckLoop } from "./blocks/check-loop";

export {
  createWorkspace,
  routedSpecialistsControlSchema,
  controllerOutputSchema,
} from "./schemas";
export type {
  RoutedSpecialistsControlState,
  ControllerOutput,
} from "./schemas";
export { createDispatchSpecialist } from "./blocks/dispatch-specialist";
export { createCheckLoop } from "./blocks/check-loop";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface RoutedSpecialistsConfig<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
> {
  /** Pattern instance name. Used as block-name prefix and the TaskCollection id. */
  name: string;

  /**
   * Shared workspace resource — created via `createWorkspace(stateSchema)`.
   * Specialists read state via `ctx.resources.workspace.state` and contribute
   * by patching it.
   */
  workspace: DefinedResource;

  /**
   * Specialist blocks keyed by name. Must have at least one entry. Each
   * specialist should declare `resources: { workspace }` to read/write the
   * shared resource; the dispatcher routes by `task.assignee` matching.
   */
  specialists: Record<string, BlockDefinition<any, any>>;

  /**
   * Overall instructions injected into the default controller and
   * synthesizer prompts. Ignored when `controller` or `synthesizer`
   * are overridden.
   */
  instructions?: InstructionsSlot;

  /**
   * Controller block — reads workspace, returns
   * `{ specialist, done, reasoning }` (`controllerOutputSchema`).
   * Default: an LLM generator that knows about the registered
   * specialists and the iteration history (read from the collection).
   */
  controller?: BlockDefinition<any, any>;

  /** Hard cap on controller iterations before the loop terminates. Default: 10. */
  maxIterations?: number;

  /**
   * Soft cap on the history window the default controller sees. When the
   * collection has more than `maxHistory` completed iterations, the
   * controller prompt only shows the most-recent N. The full collection
   * is preserved.
   */
  maxHistory?: number;

  /**
   * Initial workspace state — static value or a function of the pattern
   * input. Applied via `ctx.resources.workspace.setState` once at start.
   */
  initialState?:
    | Record<string, unknown>
    | ((
        input: unknown
      ) => Record<string, unknown> | Promise<Record<string, unknown>>);

  /** Model id for the default controller and synthesizer. Default: `"openai/gpt-5.4-mini"`. */
  model?: string;

  /** Context slot for the default controller and synthesizer. */
  context?: GeneratorSlot<any, any>;

  /** Capabilities to install on the default blocks (controller, synthesizer). */
  uses?: UsesSlot;

  /** Agent type for the default controller. Default: `"sub"`. */
  controllerAgentType?: AgentType;

  /** Agent type for the default synthesizer. Default: `"primary"`. */
  synthesizerAgentType?: AgentType;

  /**
   * Final synthesis block — receives `{ workspace, iterations, history }`
   * and returns the pattern's output. Pass `false` to skip synthesis and
   * return the raw `{ workspace, iterations, history }` object.
   */
  synthesizer?: BlockDefinition<any, any> | false;

  /** Output schema for the default synthesizer. */
  outputSchema?: TOutputSchema;

  /**
   * Override the TaskCollection id. Defaults to `name`. Useful when two
   * pattern instances share a flow and you want stable, predictable ids.
   */
  collectionId?: string;
}

// ---------------------------------------------------------------------------
// Default Controller
// ---------------------------------------------------------------------------

function buildDefaultController(config: {
  name: string;
  workspace: DefinedResource;
  specialists: string[];
  collectionId: string;
  maxHistory?: number;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  instructions?: InstructionsSlot;
  agentType?: AgentType;
}) {
  return generator({
    name: `${config.name}-controller`,
    model: config.model ?? "openai/gpt-5.4-mini",
    outputSchema: controllerOutputSchema,
    resources: { workspace: config.workspace },
    sequencerStateSchema: routedSpecialistsControlSchema,
    agentType: config.agentType ?? "sub",
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    prompt: async (_input, ctx) => {
      const resolved = config.instructions
        ? typeof config.instructions === "function"
          ? await config.instructions(_input, ctx)
          : config.instructions
        : null;

      const instructionsBlock = resolved
        ? `\n## Overall Instructions\n${resolved}\n`
        : "";

      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "sequencer",
        collectionId: config.collectionId,
        sequencer: ctx.sequencer!,
      });
      const completed = collection.list({ status: "completed" });
      const ordered = [...completed].sort(
        (a, b) => (a.completedAt ?? 0) - (b.completedAt ?? 0)
      );
      const window =
        config.maxHistory !== undefined && ordered.length > config.maxHistory
          ? ordered.slice(ordered.length - config.maxHistory)
          : ordered;

      const historyBlock =
        window.length > 0
          ? `\nPrevious decisions:\n${window
              .map(
                (t, idx) =>
                  `- Iteration ${idx + 1}: invoked "${
                    t.assignee ?? "(none)"
                  }" — ${(t.metadata as { reasoning?: string } | undefined)
                    ?.reasoning ?? ""}`
              )
              .join("\n")}`
          : "";

      const iteration = ctx.sequencer?.state?.iteration ?? 0;

      return [
        "You are a controller coordinating specialist agents over a shared workspace.",
        `Available specialists: ${config.specialists.join(", ")}`,
        `Current iteration: ${iteration + 1}`,
        "",
        "Read the current workspace state and decide:",
        "1. Which specialist to invoke next (set specialist to the name)",
        "2. Whether the problem is fully solved (set done to true, specialist to null)",
        "",
        "Provide clear reasoning for your decision.",
        "Do not invoke the same specialist repeatedly unless their prior contribution was incomplete.",
        instructionsBlock,
        historyBlock,
      ]
        .filter(Boolean)
        .join("\n");
    },
    user: (_input, ctx) => {
      const state = ctx.resources.workspace?.state;
      return `Current workspace state:\n${JSON.stringify(state, null, 2)}`;
    },
  });
}

// ---------------------------------------------------------------------------
// Default Synthesizer
// ---------------------------------------------------------------------------

function buildDefaultSynthesizer(config: {
  name: string;
  workspace: DefinedResource;
  model?: string;
  context?: GeneratorSlot<any, any>;
  uses?: UsesSlot;
  outputSchema?: ZodTypeAny;
  instructions?: InstructionsSlot;
  agentType?: AgentType;
}) {
  const basePrompt = [
    "You are a synthesis assistant.",
    "The workspace contains contributions from multiple specialist agents.",
    "Synthesize the workspace state into a coherent, unified result.",
    "Include key findings from each specialist's contribution.",
  ].join("\n");

  return generator({
    name: `${config.name}-synthesizer`,
    model: config.model ?? "openai/gpt-5.4-mini",
    resources: { workspace: config.workspace },
    agentType: config.agentType ?? "primary",
    ...(config.outputSchema ? { outputSchema: config.outputSchema } : {}),
    ...(config.context !== undefined ? { context: config.context } : {}),
    ...(config.uses ? { uses: config.uses as any } : {}),
    prompt: [config.instructions, basePrompt],
    user: (input) => {
      const data = input as {
        workspace: unknown;
        iterations: number;
        history: unknown[];
      };
      return [
        `Workspace state:\n${JSON.stringify(data.workspace, null, 2)}`,
        `\nCompleted in ${data.iterations} iterations.`,
      ].join("\n");
    },
  });
}

// ---------------------------------------------------------------------------
// Internal: per-iteration helpers (closures over the collection factory)
// ---------------------------------------------------------------------------

async function getCollection(
  ctx: BlockContext,
  collectionId: string
): Promise<TaskCollectionRef> {
  return getOrCreateTaskCollection({
    ctx,
    backing: "sequencer",
    collectionId,
    sequencer: ctx.sequencer!,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a routedSpecialists block — a sequencer that loops:
 * controller picks specialist, specialist contributes to workspace,
 * controller picks again, repeat until convergence (or `maxIterations`).
 *
 * Per-iteration records are stored in a sequencer-backed `TaskCollection`
 * so renderings (`<Plan />`, devtool) and post-hoc queries see the
 * decision sequence as first-class data.
 */
export function routedSpecialists<
  TOutputSchema extends ZodTypeAny = ZodTypeAny
>(config: RoutedSpecialistsConfig<TOutputSchema>) {
  const { name, maxIterations = 10, maxHistory } = config;
  const workspaceResource = config.workspace;
  const collectionId = config.collectionId ?? name;

  if (Object.keys(config.specialists).length === 0) {
    throw new Error(
      `[routedSpecialists] At least one specialist is required in "${name}"`
    );
  }

  // 1. Init: seed workspace.
  const initWorkspace = handler({
    name: `${name}-init`,
    inputSchema: z.any(),
    resources: { workspace: workspaceResource },
    execute: async (input, ctx) => {
      if (config.initialState) {
        const initial =
          typeof config.initialState === "function"
            ? await config.initialState(input)
            : config.initialState;
        await ctx.resources.workspace.setState(
          initial as Parameters<typeof ctx.resources.workspace.setState>[0]
        );
      }
    },
  });

  // 2. Controller: reads workspace, decides next specialist (or done).
  const controller =
    config.controller ??
    buildDefaultController({
      name,
      workspace: workspaceResource,
      specialists: Object.keys(config.specialists),
      collectionId,
      maxHistory,
      model: config.model,
      context: config.context,
      uses: config.uses,
      instructions: config.instructions,
      agentType: config.controllerAgentType,
    });

  // 3. RecordIteration: creates a Task in the collection capturing this
  //    iteration's decision. The task's id is stashed in sequencer state
  //    so `recordCompletion` can mark it complete when the specialist
  //    returns (or fail it on rescue).
  const recordIteration = handler({
    name: `${name}-record-iteration`,
    inputSchema: controllerOutputSchema,
    sequencerStateSchema: routedSpecialistsControlSchema,
    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      const nextIteration = state.iteration + 1;

      let currentTaskId: string | undefined;
      if (!input.done && input.specialist) {
        const collection = await getCollection(ctx, collectionId);
        const task = await collection.addTask({
          goal: input.reasoning || `iteration ${nextIteration}`,
          assignee: input.specialist,
          metadata: {
            iteration: nextIteration,
            reasoning: input.reasoning,
          },
        });
        // Claim immediately so recordCompletion can transition to completed —
        // the substrate enforces pending → in_progress → completed.
        await collection.claim(`routedSpecialists:${name}`, {
          eligibility: (t) => t.id === task.id,
        });
        currentTaskId = task.id;
      }

      // Always overwrite `currentTaskId` (including clearing it when no task
      // was created this iteration) so `recordCompletion` doesn't re-complete
      // a previous iteration's task with this iteration's controller output.
      await ctx.sequencer!.patchState({
        iteration: nextIteration,
        currentSpecialist: input.specialist ?? undefined,
        done: input.done,
        currentTaskId,
      });

      if (input.done) {
        ctx.emitStatus(
          `[routedSpecialists:${name}] converged after ${state.iteration} iterations`
        );
      } else if (input.specialist) {
        ctx.emitStatus(
          `[routedSpecialists:${name}] invoking specialist: ${input.specialist}`
        );
      }
    },
  });

  // 4. Dispatch: routes to the named specialist. Wrapped in rescue so a
  //    failing specialist doesn't kill the loop.
  const dispatchRouter = createDispatchSpecialist(name, config.specialists);

  const recordError = handler({
    name: `${name}-dispatch-rescue`,
    sequencerStateSchema: routedSpecialistsControlSchema,
    execute: async (error, ctx) => {
      const state = ctx.sequencer!.state;
      const message = (error as Error).message;
      ctx.emitStatus(
        `[routedSpecialists:${name}] specialist failed: ${message}`
      );
      if (state.currentTaskId) {
        const collection = await getCollection(ctx, collectionId);
        await collection.fail(state.currentTaskId, message);
      }
      // Recovery is signalled out-of-band via `ctx.wasRescued(dispatch)`, so
      // the value threaded downstream carries no rescue marker.
      return undefined;
    },
  });

  const dispatch = sequencer({
    name: `${name}-dispatch-safe`,
    inputSchema: z.any(),
    stateSchema: routedSpecialistsControlSchema,
  })
    .step(dispatchRouter)
    .rescue([{ block: recordError }]);

  // 5. RecordCompletion: writes the specialist's output back as the task
  //    output. Skipped when the iteration was marked `done` (no task was
  //    created) or when the dispatch was rescued.
  const recordCompletion = handler({
    name: `${name}-record-completion`,
    inputSchema: z.any(),
    sequencerStateSchema: routedSpecialistsControlSchema,
    execute: async (input, ctx) => {
      const state = ctx.sequencer!.state;
      if (state.currentTaskId !== undefined && !ctx.wasRescued(dispatch)) {
        const collection = await getCollection(ctx, collectionId);
        await collection.complete(state.currentTaskId, input);
      }
    },
  });

  // 6. EmitSnapshot: stable-key component snapshot for live rendering.
  const emitSnapshot = handler({
    name: `${name}-snapshot`,
    inputSchema: z.any(),
    resources: { workspace: workspaceResource },
    sequencerStateSchema: routedSpecialistsControlSchema,
    execute: async (_input, ctx) => {
      const workspaceState = ctx.resources.workspace.state;
      const controlState = ctx.sequencer!.state;
      ctx.emitComponent(
        "routedSpecialists",
        {
          state: workspaceState,
          iteration: controlState.iteration,
          specialist: controlState.currentSpecialist ?? null,
          done: controlState.done,
        } as unknown as Record<string, unknown>,
        { key: name }
      );
    },
  });

  // 7. Check + loop predicate.
  const checkLoop = createCheckLoop(name);

  // 8. Synthesizer (optional).
  const finalSynthesizer =
    config.synthesizer === false
      ? null
      : config.synthesizer ??
        buildDefaultSynthesizer({
          name,
          workspace: workspaceResource,
          model: config.model,
          context: config.context,
          uses: config.uses,
          outputSchema: config.outputSchema,
          instructions: config.instructions,
          agentType: config.synthesizerAgentType,
        });

  // 9. Pipeline.
  const base = sequencer({
    name,
    stateSchema: routedSpecialistsControlSchema,
    container: { component: "routedSpecialists" },
  })
    .tap(initWorkspace)
    .step(controller)
    .tap(recordIteration)
    .stepIf((r: ControllerOutput) => !r.done, dispatch)
    .tap(recordCompletion)
    .tap(emitSnapshot)
    .step(checkLoop)
    .loopBack(controller.name, {
      when: (v: { continue: boolean }) => v.continue,
      maxIterations,
    })
    .map(async (_value: unknown, ctx: any) => {
      const workspaceState = ctx.resources.workspace.state;
      const controlState = ctx.sequencer!.state;
      const collection = await getCollection(ctx, collectionId);
      const completed = collection.list({ status: "completed" });
      const history = completed
        .slice()
        .sort((a: Task, b: Task) => (a.completedAt ?? 0) - (b.completedAt ?? 0))
        .map((t: Task) => ({
          iteration:
            (t.metadata as { iteration?: number } | undefined)?.iteration ?? 0,
          specialist: t.assignee ?? "(none)",
          reasoning:
            (t.metadata as { reasoning?: string } | undefined)?.reasoning ?? "",
          output: t.output,
        }));
      return {
        workspace: workspaceState,
        iterations: controlState.iteration,
        history,
      };
    });

  return finalSynthesizer
    ? base.step(finalSynthesizer)
    : base;
}
