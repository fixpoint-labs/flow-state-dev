/**
 * Shared planning-entry factories for the plan→seed idiom.
 *
 * Three patterns (plan-and-execute, supervisor, parallelTasks) previously
 * hand-rolled the same `setInitialState → emitPlanningMeta → planner →
 * seedTasksFromPlan` sub-sequencer. This file extracts the canonical
 * shape, parameterized only on what actually varies across callers:
 *
 * - `idPrefix`: P&E uses `"step"`, others use `"task"` (default).
 * - `inputDefault`: parallelTasks always maps `input: t.goal`.
 *
 * Planner `title`/`context` map to the first-class `TaskInit.title` /
 * `TaskInit.context` fields (FIX-827). `input` is reserved for the generic
 * typed worker payload — planner `context` is no longer folded into it.
 *
 * `createSeedTasksFromPlan` is also consumed standalone by parallelTasks
 * (which has no `setInitialState` / `emitPlanningMeta` steps).
 */
import { sequencer, handler, generator } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskInit,
} from "@flow-state-dev/tasks";
import { TASK_BOARD_META_COMPONENT_TYPE } from "../task-board/blocks/board-meta";

export interface PlanningEntryStateShape {
  goal?: string;
  status?: string;
  iteration?: number;
}

/**
 * How each task's `context` is populated when the planner didn't supply one
 * (FIX-827). `"goal"` (default) copies the (synthesized) goal into every
 * gap-task — free, deterministic, and the fix for the dropped-data bug; in
 * this mode a planner-emitted `context` always wins and only the gaps are
 * filled. `false` leaves context empty (pre-FIX-827 behavior).
 *
 * A `BlockDefinition` runs once over `{ goal, tasks }` (the tasks include any
 * planner-emitted `context`) and returns `{ tasks }`, so a cheap model or a
 * deterministic step can differentiate per task in a single call. The custom
 * block owns the returned contexts — it is not post-filtered, so it should
 * preserve planner-emitted `context` itself if that's the desired behavior.
 */
export type TaskContextSupply = "goal" | false | BlockDefinition<any, any>;

/**
 * Whether to synthesize a self-contained goal from conversation before
 * planning (FIX-827). `false` (default) uses the input goal verbatim.
 * `true` runs a built-in history-aware synthesizer. A `BlockDefinition`
 * supplies a custom synthesizer; it must honor the `{ ...input, goal }`
 * return contract and handle its own failures.
 */
export type GoalSynthesisConfig = boolean | BlockDefinition<any, any>;

export interface SeedTasksFromPlanOptions<TState = unknown> {
  name: string;
  collectionId: string;
  /** Per-task retry budget. Omit to fall back to substrate default. */
  maxAttemptsPerTask?: number;
  /** `"goal"` replicates parallelTasks behavior (always `input: t.goal`). */
  inputDefault?: "goal" | "none";
  /** Auto-id prefix. Default `"task"`; P&E passes `"step"`. */
  idPrefix?: string;
  /** When present, `patchState({ status: "executing" })` after seeding. */
  stateSchema?: z.ZodType<TState>;
}

const seedTaskInputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().optional(),
      goal: z.string(),
      title: z.string().nullable().optional(),
      assignee: z.string().optional(),
      deps: z.array(z.string()).optional(),
      dependencies: z.array(z.string()).optional(),
      priority: z.union([z.number(), z.string()]).optional(),
      input: z.unknown().optional(),
      context: z.string().nullable().optional(),
      maxAttempts: z.number().optional(),
    }).passthrough(),
  ),
});

/**
 * Build a `.tap()`-shaped handler that seeds tasks from planner output
 * into the request-backed TaskCollection. Resolves the three divergences
 * (id prefix, input mapping, maxAttempts) behind options.
 */
export function createSeedTasksFromPlan<TState>(
  options: SeedTasksFromPlanOptions<TState>,
) {
  const {
    name,
    collectionId,
    maxAttemptsPerTask,
    inputDefault = "none",
    idPrefix = "task",
    stateSchema,
  } = options;

  return handler({
    name: `${name}-seed-tasks`,
    inputSchema: seedTaskInputSchema,
    ...(stateSchema ? { sequencerStateSchema: stateSchema } : {}),
    execute: async (planOutput, ctx) => {
      const collection = await getOrCreateTaskCollection({
        ctx,
        backing: "request",
        collectionId,
      });

      const tasks: TaskInit[] = planOutput.tasks.map((t, i) => {
        // FIX-827 (D1): planner `context` is first-class now — it no longer
        // collapses into `input`. `input` stays the generic typed payload
        // (parallelTasks maps `t.goal` into it; everyone else leaves it unset).
        const resolvedInput = t.input ?? (inputDefault === "goal" ? t.goal : undefined);

        return {
          id: t.id ?? `${idPrefix}-${i + 1}`,
          goal: t.goal,
          // Treat `null` as absent (decomposer emits nullable title/context).
          ...(typeof t.title === "string" ? { title: t.title } : {}),
          ...(typeof t.context === "string" ? { context: t.context } : {}),
          deps: t.deps ?? t.dependencies ?? [],
          ...(t.assignee !== undefined ? { assignee: t.assignee } : {}),
          ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
          ...(resolvedInput !== undefined ? { input: resolvedInput } : {}),
          ...(maxAttemptsPerTask !== undefined
            ? { maxAttempts: t.maxAttempts ?? maxAttemptsPerTask }
            : t.maxAttempts !== undefined
              ? { maxAttempts: t.maxAttempts }
              : {}),
        };
      });

      if (tasks.length > 0) {
        await collection.addTasks(tasks);
      }

      if (stateSchema && ctx.sequencer) {
        await ctx.sequencer.patchState({ status: "executing" } as any);
      }
    },
  });
}

export interface PlanningEntryOptions<
  TInput extends { goal: string },
  TState extends PlanningEntryStateShape,
> {
  name: string;
  inputSchema: z.ZodType<TInput>;
  stateSchema: z.ZodType<TState>;
  planner: BlockDefinition<any, any>;
  maxAttemptsPerTask: number;
  activeStatusMessage?: string;
  /** Auto-id prefix forwarded to `createSeedTasksFromPlan`. Default `"task"`; P&E passes `"step"`. */
  idPrefix?: string;
  /**
   * Per-task context supply (FIX-827). Default `"goal"` — copy the
   * (synthesized) goal into every task the planner left without context.
   *
   * Note: goal synthesis is composed at the pattern *pipeline* level (see
   * `resolveGoalSynthesisStep`), not here — the entry's inner state is
   * isolated from the outer state the replanner/synthesizer read.
   */
  taskContext?: TaskContextSupply;
}

/**
 * Build the default `"goal"` context enricher — a `.step()` that fills
 * `task.context` from the sequencer's stored goal for every task the
 * planner left without one. Planner-emitted context wins (we only fill
 * gaps). Returns the rewritten `{ tasks }` for `seedTasksFromPlan`.
 */
function createGoalContextEnricher<TState>(
  name: string,
  stateSchema: z.ZodType<TState>,
) {
  return handler({
    name: `${name}-task-context`,
    inputSchema: seedTaskInputSchema,
    outputSchema: seedTaskInputSchema,
    sequencerStateSchema: stateSchema,
    execute: async (planOutput, ctx) => {
      const goal = (ctx.sequencer?.state as { goal?: string } | undefined)?.goal ?? "";
      return {
        tasks: planOutput.tasks.map((t) => {
          const hasContext = typeof t.context === "string" && t.context.length > 0;
          // Only fill from a non-empty goal — mirrors the applyReplan guard so
          // a gap-task never gets a literal empty-string `context` key.
          if (hasContext || goal.length === 0) return t;
          return { ...t, context: goal };
        }),
      };
    },
  });
}

/**
 * Pre-connect a custom `taskContext` block so it receives `{ goal, tasks }`
 * (the contract from D4) and returns `{ tasks }`. The goal comes from the
 * sequencer state set by `setInitialState`.
 */
function connectCustomContextEnricher(block: BlockDefinition<any, any>) {
  return block.connectInput<{ tasks: unknown[] }>((planOutput, ctx) => ({
    goal: (ctx.sequencer?.state as { goal?: string } | undefined)?.goal ?? "",
    tasks: planOutput.tasks,
  }));
}

/**
 * Build the default goal synthesizer — a self-contained sub-sequencer that
 * rewrites a possibly context-dependent goal into a self-contained one
 * before planning (FIX-827).
 *
 * Composed at the *pattern pipeline* top (before `stampOuterGoal`), not
 * inside `createPlanningEntry`. The spec (D5) placed it inside the entry on
 * the assumption that `setInitialState`'s state write reaches the replanner
 * and synthesizer — but P&E and supervisor keep a separate *outer* pipeline
 * state (mirrored by `stampOuterGoal`), isolated from the entry's inner
 * state. Rewriting the chain value at the pipeline top makes the synthesized
 * goal flow to BOTH the outer state (replanner/synthesizer) and the planner,
 * which is what the issue intends ("plan, replan, and synthesize against a
 * coherent objective").
 *
 * Failure handling: synthesis is an enhancement, not a correctness gate, so
 * a model failure must never abort planning. The fallback lives inside this
 * block (its own `.rescue()`, scoped to synthesis only — it never broadens
 * to catch a planner failure) and returns the original goal stashed in the
 * sub-sequencer's state. The model call stays inside a real `generator()`
 * (history-aware, schema-validated) rather than being reimplemented in a
 * handler, which keeps it BP-011-clean.
 *
 * Output is `{ goal }` — equal to `{ ...input, goal }` for the `{ goal }`
 * pattern inputs in use today.
 */
function createDefaultGoalSynthesizer<TInput extends { goal: string }>(
  name: string,
  inputSchema: z.ZodType<TInput>,
  model?: string,
) {
  const goalGen = generator({
    name: `${name}-synthesize-goal`,
    inputSchema,
    outputSchema: z.object({ goal: z.string() }),
    model: model ?? "openai/gpt-5.4-mini",
    history: { limit: 8 },
    itemVisibility: { client: false, history: false },
    prompt: [
      "You rewrite a possibly context-dependent request into a single, self-contained goal.",
      "Use the conversation history to resolve references like 'that', 'those', or 'all of them' into concrete terms.",
      "Preserve every concrete fact, value, and constraint from the original request — do not drop or summarize specifics.",
      "If the request is already self-contained, return it unchanged.",
      "Return only the rewritten goal.",
    ].join("\n"),
    user: (input: { goal: string }) => `Original request: ${input.goal}`,
  });

  // On model failure, recover the original goal via `ctx.parent.input` — the
  // rescue runs as a sibling step of `goalGen` under this sub-sequencer, so
  // `parent.input` is this block's `{ goal }` input (the recall-tool idiom).
  const fallback = handler({
    name: `${name}-synthesize-goal-fallback`,
    inputSchema: z.unknown(),
    outputSchema: z.object({ goal: z.string() }),
    execute: async (_error, ctx) => ({
      goal: (ctx.parent?.input as { goal?: string } | undefined)?.goal ?? "",
    }),
  });

  return sequencer({
    name: `${name}-synthesize`,
    inputSchema,
  })
    .step(goalGen)
    .rescue([{ block: fallback }]);
}

/**
 * Resolve the optional goal-synthesis step for a plan-shaped pattern
 * pipeline (FIX-827). Returns `undefined` when synthesis is disabled (the
 * default), the built-in synthesizer for `true`, or the caller's custom
 * `BlockDefinition`. The returned block is meant to be composed as the
 * first `.step()` of the pattern pipeline, before the outer goal is stamped.
 */
export function resolveGoalSynthesisStep<TInput extends { goal: string }>(
  synthesizeGoal: GoalSynthesisConfig | undefined,
  opts: { name: string; inputSchema: z.ZodType<TInput>; model?: string },
): BlockDefinition<any, any> | undefined {
  if (synthesizeGoal === undefined || synthesizeGoal === false) return undefined;
  if (synthesizeGoal === true) {
    return createDefaultGoalSynthesizer(opts.name, opts.inputSchema, opts.model);
  }
  return synthesizeGoal;
}

/**
 * Build the entry sequencer:
 * `setInitialState → emitPlanningMeta → planner →
 *  [taskContext enricher?] → seedTasksFromPlan`.
 *
 * Used by plan-and-execute and supervisor. The context enricher (default
 * on) runs after the planner so it can read the goal from state and fill
 * any task the planner left without context. Goal synthesis is composed
 * upstream at the pattern pipeline level (`resolveGoalSynthesisStep`).
 */
export function createPlanningEntry<
  TInput extends { goal: string },
  TState extends PlanningEntryStateShape,
>(options: PlanningEntryOptions<TInput, TState>): BlockDefinition<any, any> {
  const {
    name,
    inputSchema,
    stateSchema,
    planner,
    maxAttemptsPerTask,
    activeStatusMessage,
    idPrefix,
    taskContext = "goal",
  } = options;
  const collectionId = name;

  const setInitialState = handler({
    name: `${name}-set-initial-state`,
    inputSchema,
    sequencerStateSchema: stateSchema,
    execute: async (input, ctx) => {
      await ctx.sequencer!.patchState({
        goal: input.goal,
        status: "planning",
        iteration: 0,
      } as any);
    },
  });

  const emitPlanningMeta = handler({
    name: `${name}-meta-planning`,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      ctx.emitComponent(
        TASK_BOARD_META_COMPONENT_TYPE,
        { collectionId, status: "planning" },
        { key: collectionId },
      );
    },
  });

  const seedTasks = createSeedTasksFromPlan({
    name,
    collectionId,
    maxAttemptsPerTask,
    stateSchema,
    ...(idPrefix ? { idPrefix } : {}),
  });

  // The (default-on) per-task context enricher.
  const enricherBlock =
    taskContext === false
      ? undefined
      : taskContext === "goal"
        ? createGoalContextEnricher(name, stateSchema)
        : connectCustomContextEnricher(taskContext);

  // Build conditionally — loosely typed because each fluent step returns a
  // distinct sequencer type and the optional enricher changes the chain shape.
  let chain: any = sequencer({
    name: `${name}-capture-and-plan`,
    inputSchema,
    stateSchema,
    ...(activeStatusMessage ? { activeStatusMessage } : {}),
  })
    .tap(setInitialState)
    .tap(emitPlanningMeta)
    .step(planner);
  if (enricherBlock !== undefined) chain = chain.step(enricherBlock);
  chain = chain.tap(seedTasks);
  return chain as BlockDefinition<any, any>;
}
