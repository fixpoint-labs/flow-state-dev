/**
 * The two resource collections a recording run writes into.
 *
 * Both are declared here rather than inside the agent block so the block and
 * the capability contribute the SAME definitions — a capability's `tools` do
 * not carry resource declarations up to the flow (see `./capability`), so the
 * capability has to declare these itself, and two separate definitions would
 * be two storage slots that look like one.
 *
 * Neither collection stores file contents. A file entry is an index into the
 * working tree: which path the run's file tools touched, how, when, and how the
 * attempt settled.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import type { DeclaredResourceEntry } from "@flow-state-dev/core/types";
import { z } from "zod";

/**
 * Accessor key AND storage prefix for the observed file operations. The two are
 * deliberately the same string: the HTTP resource route addresses a collection
 * by its accessor key in `flow.resources`, while the store keys rows by the
 * pattern prefix, so keeping them equal means one name appears in the URL, in
 * `ctx.resources`, and in the storage key.
 */
export const OBSERVED_FILE_OPS = "observed-file-ops" as const;
/** Accessor key AND storage prefix for the run's observed plan. */
export const OBSERVED_PLAN = "observed-plan" as const;
/** Accessor key AND storage prefix for the mutations the recorder could not record. */
export const OBSERVED_GAPS = "observed-gaps" as const;

/** How a file tool touched a path. */
export type ObservedFileOpKind = "created" | "edited";

/**
 * How a recorded mutation settled.
 *
 * Three-valued, not a boolean, and both extra values are load-bearing. A
 * mutation is recorded when its call is SEEN and settled when its result
 * arrives, so `pending` is a real state that a boolean would have to report as
 * either a success that has not happened or a failure that did not occur. And a
 * plan update the harness REJECTS has to be recordable without applying the
 * status it asked for — it lands as `failed` with the statuses left where the
 * harness has them.
 */
export type ObservedOutcome = "pending" | "applied" | "failed";

const outcomeSchema = z.enum(["pending", "applied", "failed"]);

/**
 * One observed file operation, keyed by `<runId>/<canonical path>`.
 *
 * Every field is nullable with a null default (BP-023) so a row written by an
 * older or newer shape still parses instead of throwing inside a recorder that
 * is required never to break the run (BP-030).
 */
export const observedFileOpStateSchema = z.object({
  /** How the path was last touched. */
  lastKind: z.enum(["created", "edited"]).nullable().default(null),
  /** How the last touch settled. */
  outcome: outcomeSchema.nullable().default(null),
  /** Epoch millis of the last touch. */
  lastTouchedAt: z.number().nullable().default(null),
});

/**
 * One observed plan item, keyed by `<runId>/<the harness's own item id>`.
 *
 * `status` and `previousStatus` are free strings, not an enum: the vocabulary
 * belongs to the harness (`pending` / `in_progress` / `completed` at the version
 * measured), and a value we have never seen must record as itself rather than
 * throw. `status` stays null until the harness reports one — a created item's
 * state is not something the create result tells us, and inventing a default
 * would be recording a guess.
 */
export const observedPlanItemStateSchema = z.object({
  /** The item's wording, as the run phrased it. */
  title: z.string().nullable().default(null),
  /** The status the harness last confirmed. */
  status: z.string().nullable().default(null),
  /** The status this row held before the last confirmed move. */
  previousStatus: z.string().nullable().default(null),
  /** How the last attempt on this item settled. */
  lastOutcome: outcomeSchema.nullable().default(null),
  /** Epoch millis of the last attempt. */
  lastTouchedAt: z.number().nullable().default(null),
});

/**
 * `**`, not `*`: a key carries the run id and then a whole file path, so it has
 * many segments. `prefetchMode: "lazy"` is the other half of that — rows are
 * namespaced per run and a workstream session is reused across runs, so an
 * eager collection would bulk-load every historical row of every previous run
 * before the current one touched a single key. The recorder only ever upserts
 * by exact key, which the lazy accessor serves with a single-key read;
 * `list()`/`count()` are what would trigger a full-prefix load, so the recorder
 * must never call them.
 */
export const observedFileOpsCollection = defineResourceCollection({
  pattern: `${OBSERVED_FILE_OPS}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: observedFileOpStateSchema,
  // Without `state.read` the list-collection-state route answers 403, so the
  // record would exist and be unreadable. `expose` names the client contract
  // explicitly: adding a field to the schema does not silently publish it.
  client: {
    state: { read: true },
    expose: ["lastKind", "outcome", "lastTouchedAt"],
  },
});

/**
 * One row per mutation the recorder RECOGNISED and then could not record
 * faithfully — whether it recorded nothing, or recorded it under a key the
 * harness disagrees with.
 *
 * Without this a skip is indistinguishable from a mutation that never happened,
 * which is the exact blindness the rest of this feature exists to remove: a
 * reader comparing the run's tool activity against the file record could see a
 * `Write` with no matching row and have no way to tell "we lost it" from "we
 * saw it and could not key it".
 *
 * **Keyed by run id and an ordinal, deliberately never by the failing value.**
 * The commonest skip is a path that cannot be normalized into a key — so keying
 * this record by the path would fail in exactly the case it exists to cover.
 * The path goes in the STATE instead, where a control character is just a
 * character. The ordinal is zero-padded so the route's lexicographic key order
 * is also chronological order.
 *
 * One row per gap rather than a count plus a capped reason list: a row per
 * event needs no cap policy, no truncation flag, and no array that grows inside
 * a single state blob — and the count is `rows.length`.
 *
 * A status note is emitted too, but it cannot be the record. `ctx.emit.status`
 * dedupes on the message string and renders into a single latest-wins slot, so
 * two identical skips collapse to one, and reading a gap back out of prose is
 * the substring-grading mistake this codebase keeps paying for.
 */
export const observedGapsCollection = defineResourceCollection({
  pattern: `${OBSERVED_GAPS}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: z.object({
    /** What could not be recorded, in framework vocabulary. */
    reason: z.string().nullable().default(null),
    /** The path as the run addressed it, when the gap concerns one. */
    rawPath: z.string().nullable().default(null),
    /** Epoch millis the gap was noticed. */
    at: z.number().nullable().default(null),
  }),
  client: {
    state: { read: true },
    expose: ["reason", "rawPath", "at"],
  },
});

/** The run's own to-do list. See {@link observedFileOpsCollection} for the pattern/prefetch note. */
export const observedPlanCollection = defineResourceCollection({
  pattern: `${OBSERVED_PLAN}/**`,
  scope: "session",
  prefetchMode: "lazy",
  stateSchema: observedPlanItemStateSchema,
  client: {
    state: { read: true },
    expose: ["title", "status", "previousStatus", "lastOutcome", "lastTouchedAt"],
  },
});

/**
 * The resource map the agent block and the capability both declare when
 * `recordWork` is on. One object so the two declaration sites cannot drift.
 *
 * Typed as the widened entry map rather than left to `const` inference on
 * purpose: a literal type here would narrow the agent block's `ctx.resources`
 * to these two accessors, and every helper that takes a plain `BlockContext`
 * would stop accepting that context. The recorder reads the two refs by name at
 * run time anyway, so the narrower type buys nothing.
 */
export const workRecorderResources: Record<string, DeclaredResourceEntry> = {
  [OBSERVED_FILE_OPS]: observedFileOpsCollection,
  [OBSERVED_PLAN]: observedPlanCollection,
  [OBSERVED_GAPS]: observedGapsCollection,
};
