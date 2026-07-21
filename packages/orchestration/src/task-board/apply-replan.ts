/**
 * `applyReplan` — adds replanner-produced tasks to a board's collection
 * during a replan iteration.
 *
 * Lifted from `@flow-state-dev/patterns/plan-and-execute` (FIX-910) so the
 * `goalSeekLoop` primitive — which lives below patterns in the layering — can
 * execute it directly. Patterns re-export it to preserve their public surface.
 *
 * Runs after either:
 *   - the replanner block (when the judge/evaluator returned `decision:
 *     "replan"` without pre-baked `tasks`), or
 *   - the judge/evaluator itself (when it returned `tasks` inline, skipping
 *     the replanner step).
 *
 * Returns `{ decision: "continue" }` so a loop predicate keyed on
 * `decision !== "done"`/`"complete"` keeps the board re-entry alive for one
 * more iteration.
 *
 * Id-collision handling: an LLM replanner naturally re-emits ids that
 * already exist in the collection (e.g. it asks to "redo task-1"). The
 * substrate's `addTasks` rejects duplicates, so we auto-suffix the
 * conflicting ids with `-replan-N` and remap any within-batch deps that
 * referenced the original id. The replanner's intent — adding fresh work — is
 * preserved without breaking referential integrity inside the batch.
 *
 * Backing-aware collection resolution (FIX-910): when a board `capability` is
 * supplied, tasks are read/written through the board's OWN accessor
 * (`ctx.cap.<name>.tasks()`), so a resource-backed board or a custom
 * `stateKey` resolves correctly. When omitted, the block falls back to the
 * legacy name-based request reconstruction — preserving the pre-lift signature
 * for existing callers (BP-030).
 */
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition, DefinedCapability } from "@flow-state-dev/core";
import { z, type ZodTypeAny } from "zod";
import {
  getOrCreateTaskCollection,
  type TaskCollectionRef,
  type TaskInit,
} from "../tasks";

/**
 * How each task's `context` is populated when the planner/replanner didn't
 * supply one (FIX-827). `"goal"` (default) copies the (synthesized) goal into
 * every gap-task — free, deterministic. `false` leaves context empty. A
 * `BlockDefinition` runs a custom enricher (used on the seed path only; the
 * replan path always uses the deterministic goal-fill — see below).
 *
 * The canonical home for this type (BP-034): it moves here with the lifted
 * `createApplyReplan`; `@flow-state-dev/patterns` re-exports it so callers that
 * import it from `planning-entry` keep working.
 */
export type TaskContextSupply = "goal" | false | BlockDefinition<any, any>;

export interface ApplyReplanOptions {
  /** Pattern/board name (also the default request collection id). */
  name: string;
  /** Default `maxAttempts` to stamp on tasks that don't carry one. */
  maxAttemptsPerTask: number;
  /**
   * Per-task context supply for replanned tasks (FIX-827). The replan loop
   * re-enters the board directly, bypassing the planning-entry enricher, so
   * this applies the same gap-fill here: unless `false`, a replanned task
   * without context gets the goal copied in. A custom-block `taskContext`
   * also uses the deterministic goal-fill on the replan path (re-running a
   * custom enricher mid-loop is a documented fast-follow). Default `"goal"`.
   */
  taskContext?: TaskContextSupply;
  /**
   * Board capability for backing-aware collection resolution (FIX-910). When
   * provided, the block declares it in `uses` and reads/writes the board's
   * tasks through `ctx.cap.<capability.name>.tasks()` — correct for request,
   * resource, or custom-`stateKey` backings. Omit for the legacy name-based
   * request reconstruction (`== null`-guarded, BP-030).
   */
  capability?: DefinedCapability<any, any>;
  /**
   * Sequencer state schema the block declares so its `ctx.sequencer.state.goal`
   * read is typed against the caller's real container (FIX-910: decoupled from
   * the patterns-owned `planAndExecuteStateSchema`). Defaults to a permissive
   * passthrough carrying an optional `goal` — enough for the gap-fill read;
   * consumers with richer state (goalSeekLoop's merged container, P&E's own
   * schema) pass it so no state field is stripped.
   */
  sequencerStateSchema?: ZodTypeAny;
}

/** Minimal state shape the block reads: the outer goal for context gap-fill. */
const defaultApplyReplanStateSchema = z
  .object({ goal: z.string().nullable().default(null) })
  .passthrough();

/**
 * Build the apply-replan handler. The input may carry the evaluator's
 * pre-baked tasks OR the replanner's output; either way we expect a
 * `tasks: TaskInit[]` array.
 */
export function createApplyReplan(options: ApplyReplanOptions) {
  const {
    name,
    maxAttemptsPerTask,
    taskContext = "goal",
    capability,
    sequencerStateSchema = defaultApplyReplanStateSchema,
  } = options;
  const collectionId = name;

  return handler({
    name: `${name}-apply-replan`,
    ...(capability ? { uses: [capability] } : {}),
    inputSchema: z
      .object({
        tasks: z.array(
          z
            .object({
              id: z.string().optional(),
              goal: z.string(),
              deps: z.array(z.string()).optional(),
              dependencies: z.array(z.string()).optional(),
              priority: z.union([z.number(), z.string()]).optional(),
              maxAttempts: z.number().optional(),
              input: z.unknown().optional(),
            })
            .passthrough(),
        ),
      })
      .passthrough(),
    outputSchema: z.object({
      decision: z.enum(["continue", "replan", "complete"]).default("continue"),
    }),
    sequencerStateSchema,

    execute: async (input, ctx) => {
      // Backing-aware resolution: route through the board's own accessor when a
      // capability is supplied, else reconstruct the request-backed ref by name.
      const collection: TaskCollectionRef =
        capability !== undefined
          ? await (
              ctx.cap as Record<
                string,
                { tasks: () => Promise<TaskCollectionRef> }
              >
            )[capability.name].tasks()
          : await getOrCreateTaskCollection({
              ctx,
              backing: "request",
              collectionId,
            });

      const taken = new Set(collection.list().map((t) => t.id));

      // Build a remap from the replanner's chosen id (if any) to the id
      // we'll actually use. Suffix duplicates so the LLM's natural
      // "redo task-1" output doesn't collide with the original.
      const idRemap = new Map<string, string>();
      for (const t of input.tasks) {
        if (t.id === undefined) continue;
        let candidate = t.id;
        let suffix = 1;
        while (taken.has(candidate)) {
          candidate = `${t.id}-replan-${suffix}`;
          suffix++;
        }
        idRemap.set(t.id, candidate);
        taken.add(candidate);
      }

      // Mirror the planning-entry context enricher on the replan path: unless
      // disabled, a replanned task without context gets the goal copied in, so
      // its worker isn't blind to the request the way initial tasks aren't.
      const goal =
        (ctx.sequencer?.state as { goal?: string } | undefined)?.goal ?? "";

      const tasks: TaskInit[] = input.tasks.map((t) => {
        const remappedId =
          t.id !== undefined ? idRemap.get(t.id) : undefined;
        const rawDeps = t.deps ?? t.dependencies ?? [];
        const remappedDeps = rawDeps.map((d) => idRemap.get(d) ?? d);
        const emittedContext = (t as { context?: unknown }).context;
        const context =
          typeof emittedContext === "string" && emittedContext.length > 0
            ? emittedContext
            : taskContext !== false && goal.length > 0
              ? goal
              : undefined;
        // Preserve a passthrough `title` the same way createSeedTasksFromPlan
        // does, so a custom replanner/evaluator emitting one doesn't silently
        // lose it (the default replanner schema still omits title — Non-Goal).
        const emittedTitle = (t as { title?: unknown }).title;
        return {
          ...(remappedId !== undefined ? { id: remappedId } : {}),
          goal: t.goal,
          ...(typeof emittedTitle === "string" ? { title: emittedTitle } : {}),
          deps: remappedDeps,
          ...(typeof t.priority === "number" ? { priority: t.priority } : {}),
          ...(context !== undefined ? { context } : {}),
          ...(t.input !== undefined ? { input: t.input } : {}),
          maxAttempts: t.maxAttempts ?? maxAttemptsPerTask,
        };
      });

      if (tasks.length > 0) {
        await collection.addTasks(tasks);
      }

      return { decision: "continue" as const };
    },
  });
}
