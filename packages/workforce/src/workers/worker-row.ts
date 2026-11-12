// FIX-1790.
/**
 * A user's own worker, as it is stored: one row per worker in the user's
 * scope, at `workforce/workers/<id>`.
 *
 * The row is a worker's configuration and nothing that runs it. Its tools,
 * skills and packages are names, resolved against what the installation
 * registers when a session loads the worker; nothing is registered when a row
 * is written. So a hire, a fork, an edit and a fire are writes to the user's
 * data, and the next turn on any process reads them.
 *
 * User scope is per (user, organization) for every flow, so the
 * same user has a separate roster in each organization, and no other user's
 * read reaches the row.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { ROSTER_FLOW, WORKERS_PATTERN } from "./keys";
import { shownSettingsOf, type ShownSettingsOf } from "./shown-settings";

// BP-030.
/**
 * One stored worker.
 *
 * `settings` passes keys through: it belongs to the worker's flow, whose own
 * `configSchema` checks it, and it is free to grow keys this package has never
 * heard of. The envelope is this package's.
 */
export const workerResourceStateSchema = z.object({
  /** The flow the worker runs on: a registered worker flow's name. */
  flow: z.string().min(1),
  /**
   * The name a user reads it by, or `null` when it has none (a view shows its
   * id). Display only: the id stays its address. Absent on rows stored before
   * names existed, which read as `null`.
   */
  // BP-030: tolerate rows stored before this field.
  name: z.string().nullable().default(null),
  /** One line saying what the worker is for. */
  description: z.string().nullable().default(null),
  /** The worker's own instructions. `null` for a worker with none. */
  instructions: z.string().nullable().default(null),
  /**
   * The shared instructions a fork copied from the standard worker it came
   * from (its team's). `null` on a worker that wasn't forked from one that
   * had them. Copied, never followed: a later edit to the files doesn't reach
   * the fork (D3).
   */
  teamInstructions: z.string().nullable().default(null),
  /** The skills the worker can see, by name, resolved against the installation's skills per turn. */
  skills: z.array(z.string().min(1)).default([]),
  /**
   * The worker's settings: the keys a `WORKER.md` frontmatter accepts other
   * than `flow` and `description`. Tool and package names, document grants,
   * and the flow's own settings. Checked by the flow's schema when saved and
   * again on each turn.
   */
  settings: z.record(z.unknown()).default({}),
  /** The standard worker this one was forked from, or `null`. */
  forkedFrom: z.string().nullable().default(null)
});

/** One stored worker. @see workerResourceStateSchema */
export type WorkerResourceState = z.infer<typeof workerResourceStateSchema>;

/**
 * The user's worker collection: one row per worker, at user scope.
 *
 * Shared across flows (`flowIsolation: false`): every flow that declares it
 * reads the same roster, so a worker hired through one flow runs on another.
 * A browser may read the user's own rows through a session of a flow that
 * declares it, and sees each worker's `flow`, `name`, `description` and `forkedFrom`,
 * and as `settings` only the ones its flow shows; its other settings and its
 * instructions stay on the server.
 *
 * Write a new worker with `create()`: it throws when the id is taken, and
 * that throw is the refusal of a second hire under one id, racing ones
 * included.
 *
 * @param shown Which settings each flow shows (`showSettings`). Omitted, none.
 */
export function defineWorkerCollection(shown: ShownSettingsOf = () => []) {
  return defineResourceCollection({
    pattern: WORKERS_PATTERN,
    scope: "user",
    flowIsolation: false,
    // A client hires, forks, edits, resets and fires through the roster flow's actions (FIX-2624).
    runBy: { flow: ROSTER_FLOW },
    stateSchema: workerResourceStateSchema.passthrough(),
    client: {
      state: { read: true },
      // A computed field, so `data` rather than `expose` (BP-015).
      data: (row) => ({
        flow: row.flow,
        name: row.name ?? null,
        description: row.description ?? null,
        forkedFrom: row.forkedFrom ?? null,
        settings: shownSettingsOf(shown(row.flow), row.settings ?? {}) as never
      })
    }
  });
}

/**
 * Parse one stored value as a worker, or say why it can't be read.
 * Never throws and never writes.
 */
export function parseWorkerResourceState(value: unknown): { worker: WorkerResourceState } | { problem: string } {
  const parsed = workerResourceStateSchema.safeParse(value);
  if (parsed.success) return { worker: parsed.data };
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { problem: `the stored worker could not be read: ${issues}` };
}
