/**
 * The collection a projected run writes its unresolved outcomes into.
 *
 * Declared here rather than inside a block for the same reason the work
 * recorder's collections are: a capability's `tools` do not carry resource
 * declarations up to the flow, so the capability declares this itself, and two
 * definitions would be two storage slots that look like one.
 *
 * Only the outcomes nobody can act on without being told land here. A clean
 * write is the file being where it should be; a conflict is a file that is not,
 * and an orphan is a file that went nowhere. Recording the clean ones too would
 * make the interesting rows the ones you have to filter for.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * Accessor key AND storage prefix. One string deliberately: the resource route
 * addresses a collection by its accessor key while the store keys rows by the
 * pattern prefix, so the same name appears in the URL, in `ctx.resources`, and
 * in storage.
 */
export const WORKSPACE_OUTCOMES = "workspace-outcomes" as const;

/**
 * One outcome a flush could not settle, keyed by `<runId>/<path>`.
 *
 * Every field nullable with a null default (BP-023) so a row written by an
 * older or newer shape parses rather than throwing inside a flush that must not
 * break the run (BP-030).
 */
export const workspaceOutcomeStateSchema = z.object({
  /**
   * Why the path is here.
   *
   * `orphan` — written outside every writable mount, so nothing owns it.
   * `conflict` — two writers touched it and neither won.
   * `contested` — another run was writing it at the same moment, so this one
   * stood off. Distinct from `conflict` because nothing has been written yet:
   * there are no hashes to disagree about, only a claim held elsewhere.
   */
  kind: z.enum(["orphan", "conflict", "contested"]).nullable().default(null),
  /** The path as the workspace holds it, e.g. `artifacts/notes.md`. */
  path: z.string().nullable().default(null),
  /**
   * The three hashes a conflict carries. All null on an orphan, which has no
   * disagreement to describe. On a conflict, `ours: null` is its own statement:
   * the run deleted the path while somebody else changed it.
   */
  base: z.string().nullable().default(null),
  theirs: z.string().nullable().default(null),
  ours: z.string().nullable().default(null),
  /** Epoch millis the flush decided this. */
  at: z.number().nullable().default(null),
});

/** See {@link WORKSPACE_OUTCOMES} for why the key and prefix are one string. */
export const workspaceOutcomesCollection = defineResourceCollection({
  pattern: `${WORKSPACE_OUTCOMES}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: workspaceOutcomeStateSchema,
  client: {
    state: { read: true },
    expose: ["kind", "path", "base", "theirs", "ours", "at"],
  },
});

/**
 * The resource map the capability declares. One object so a second declaration
 * site cannot drift from this one.
 *
 * Typed as the widened entry map rather than left to `const` inference, for the
 * same reason `workRecorderResources` is: a literal type would narrow
 * `ctx.resources` on the blocks carrying it, and every helper taking a plain
 * `BlockContext` would stop accepting that context.
 */
export const workspaceResources: Record<string, DeclaredResourceEntry> = {
  [WORKSPACE_OUTCOMES]: workspaceOutcomesCollection,
};
