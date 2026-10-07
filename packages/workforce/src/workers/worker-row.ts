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
 * User scope is per (user, organization) for every flow (FIX-1790), so the
 * same user has a separate roster in each organization, and no other user's
 * read reaches the row.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";
import { WORKERS_PATTERN } from "./keys";

/**
 * One stored worker.
 *
 * `settings` passes keys through: it belongs to the worker's flow, whose own
 * `configSchema` checks it, and it is free to grow keys this package has never
 * heard of (BP-030). The envelope is this package's.
 */
export const workerRowSchema = z.object({
  /** The flow the worker runs on: a registered worker flow's kind. */
  flow: z.string().min(1),
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

/** One stored worker. @see workerRowSchema */
export type WorkerRow = z.infer<typeof workerRowSchema>;

/**
 * The user's worker collection: one row per worker, at user scope.
 *
 * Shared across flows (`flowIsolation: false`): every flow that declares it
 * reads the same roster, so a worker hired through one flow runs on another.
 * A browser may read the user's own rows through a session of a flow that
 * declares it, and sees each worker's `flow`, `description` and `forkedFrom`;
 * its settings and instructions stay on the server.
 *
 * Write a new worker with `create()`: it throws when the id is taken, and
 * that throw is the refusal of a second hire under one id, racing ones
 * included.
 */
export function defineWorkerCollection() {
  return defineResourceCollection({
    pattern: WORKERS_PATTERN,
    scope: "user",
    flowIsolation: false,
    stateSchema: workerRowSchema.passthrough(),
    client: {
      state: { read: true },
      expose: ["flow", "description", "forkedFrom"]
    }
  });
}

/**
 * Parse one stored value as a worker row, or say why it can't be read.
 * Never throws and never writes.
 */
export function parseWorkerRow(value: unknown): { row: WorkerRow } | { problem: string } {
  const parsed = workerRowSchema.safeParse(value);
  if (parsed.success) return { row: parsed.data };
  const issues = parsed.error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
  return { problem: `the stored worker could not be read: ${issues}` };
}
