/**
 * `runs/**` — one row per issue-phase, and the fence that keeps it honest.
 *
 * The row is conductor's own bookkeeping: which checkout a run was given, which
 * harness session it was, how the last attempt ended and why. It is **not** the
 * association a resume reads from — that is a typed top-level field on the task
 * and belongs to FIX-1179 / FIX-1246. Nothing here stands in for it.
 *
 * ## Two vocabularies, never interchangeable
 *
 * The collection's pattern prefix is prepended for you, so a call that already
 * spells `runs/` writes `runs/runs/…` that no prefix filter then matches.
 *
 * - **Bare topic** — `<issue>/<phase>`. Every collection call takes this.
 * - **Storage key** — `runs/<issue>/<phase>`. What the collection produces, what
 *   `ref.path` returns, what a route's `topicPrefix=` carries.
 *
 * `**` and not `*`: a single wildcard matches exactly one segment, so a
 * two-segment topic would resolve nothing on every read and every write.
 *
 * ## Session-scoped, lineage-shared — and why that is safe
 *
 * The board is `user`-scoped because a parked row must outlive the coordinator
 * session. This has no such requirement: it is written by the run and read
 * while the lineage is alive, and lineage sharing is exactly what lets the
 * child workstream write what the conductor session reads.
 *
 * The lifetime difference used to have a sharp edge — a task woken in a NEW
 * coordinator session sees the board row and not this one. That edge is gone
 * because the checkout path is **derived** from the durable task rather than
 * read back from here (see `./workspace`); this row records the path, and is
 * never the authority for it.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";

/** Accessor key and storage prefix for the run record. */
export const RUNS = "runs" as const;

/** How the last attempt on an issue-phase ended. */
export const runOutcomeSchema = z.enum(["running", "succeeded", "failed"]);
export type RunOutcome = z.infer<typeof runOutcomeSchema>;

/**
 * One issue-phase's run record.
 *
 * Every field is `.nullable().default(null)` (BP-023) so a row written by an
 * older shape still parses, and so the **attempt-scoped** half can be cleared
 * to `null` rather than merely omitted — `upsert` patch-merges, so an omitted
 * field survives from the previous attempt's write.
 */
export const runRecordStateSchema = z.object({
  /**
   * The board row's `attempts` at the moment this attempt opened the row.
   *
   * A monotonic backstop under the board-claim fence below, not the fence
   * itself. See {@link writeRunRow}.
   */
  attempt: z.number().nullable().default(null),
  /** The board task this row describes. */
  taskId: z.string().nullable().default(null),

  // ── Authoritative: nothing else holds these ────────────────────────────────
  /** Where the run's checkout is. A record of the derivation, never its source. */
  workspacePath: z.string().nullable().default(null),
  /** The branch that checkout is on. */
  branch: z.string().nullable().default(null),
  /** How the last attempt ended. */
  outcome: runOutcomeSchema.nullable().default(null),
  /** Why, in the harness's own words or the throw's message. */
  reason: z.string().nullable().default(null),
  /**
   * The harness session this attempt was — a COPY, kept so conductor can say
   * which session a run was. Nothing reads it back to continue anything.
   */
  sessionId: z.string().nullable().default(null),
  /** The run's closing text, when it got far enough to produce one. */
  finalMessage: z.string().nullable().default(null),
  /**
   * What the run spent, when the harness reported it. No decision reads this —
   * the SDK omits usage and cost often enough that anything load-bearing on
   * either would be load-bearing on `null`.
   */
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .nullable()
    .default(null),
  /** What the run cost, when the harness reported it. No decision reads this. */
  costUsd: z.number().nullable().default(null),

  // ── Denormalized: read from here for convenience, owned elsewhere ──────────
  /** The child session the run executed in (the runtime's). */
  childSessionId: z.string().nullable().default(null),
  /** The request that ran it (the runtime's). */
  requestId: z.string().nullable().default(null),
  /** When this row was last written. */
  updatedAt: z.number().nullable().default(null),
});

export type RunRecordState = z.infer<typeof runRecordStateSchema>;

/**
 * The collection. Not client-readable, deliberately: the read surface is the
 * flow's zero-model `status` action, which reads the board row beside these
 * fields server-side. A second read surface would be a second answer, and this
 * one could not carry the half that decides completion.
 */
export const runRecordCollection = defineResourceCollection({
  pattern: `${RUNS}/**`,
  scope: "session",
  // The child workstream writes what the conductor session reads. Without this
  // the child resolves an empty ledger and the row is written where nobody
  // looks.
  sharedToWorkstream: true,
  prefetchMode: "lazy",
  stateSchema: runRecordStateSchema,
});

/** The bare topic for one issue-phase. Never carries the `runs/` prefix. */
export function runTopic(issue: string, phase: string): string {
  return `${issue}/${phase}`;
}

/** The bare prefix listing every phase of one issue. */
export function runTopicPrefix(issue: string): string {
  return `${issue}/`;
}

/**
 * The fields an attempt can only fill in once the run has reported something.
 *
 * Cleared to `null` by the opening upsert — **unconditionally, at the open**
 * rather than on each exit. One convergence point instead of an obligation
 * every exit path has to remember, and the exit that most needs it (a throw,
 * which carries no session id at all) is exactly the one with no tidy handler
 * to put it in. Without this, a debugger following the row's session id after a
 * thrown attempt lands in the PREVIOUS attempt's session, with nothing on the
 * row saying so.
 *
 * **The list is derived from what the verdict can carry, not maintained beside
 * it.** Everything the run reports when it gets far enough — session id,
 * terminal text, usage, cost — belongs here, plus the two runtime ids and the
 * reason. A field that is attempt-scoped and missing from this object is a row
 * that lies about that field alone, silently, and only on the attempts that
 * could not report it. Add to the verdict, add here.
 */
const ATTEMPT_SCOPED_CLEAR = {
  sessionId: null,
  finalMessage: null,
  usage: null,
  costUsd: null,
  reason: null,
  childSessionId: null,
  requestId: null,
} as const;

/** What {@link writeRunRow} did. */
export type RunRowWrite = "applied" | "refused";

/** The identity a write is fenced against. */
export interface AttemptIdentity {
  /** The board task this attempt holds. */
  taskId: string;
  /** `attempts` as the board packed it into this worker's input at claim time. */
  attempt: number;
  /** The bare topic — `<issue>/<phase>`. */
  topic: string;
  /** The board's ledger collection id, resolved from `ctx.resources`. */
  boardCollectionId: string;
}

/**
 * A task row as this module reads it. Structural: only the two fields the fence
 * consults, so nothing here depends on the substrate's `Task` type.
 */
interface ClaimView {
  status?: string;
  attempts?: number;
}

/**
 * The statuses in which an attempt still owns its task.
 *
 * The counter alone is not ownership: `reclaim()` returns a task to `pending`
 * without touching `attempts`, so in the window between a reclaim and the next
 * claim a displaced worker matches the counter by construction. This mirrors
 * the substrate's own `ATTEMPT_OWNED_STATUSES` rather than guessing at it.
 */
const ATTEMPT_OWNED_STATUSES = new Set(["in_progress", "awaiting_review"]);

/**
 * Write one attempt's fields onto its issue-phase row — or refuse, if this
 * attempt is no longer the live one (obligation A).
 *
 * ## The fence reads the BOARD, not this row
 *
 * A lapsed lease does not terminate the attempt that held it, so two attempts
 * can be alive at once and the board's own write fence covers task settlement
 * only — it reaches neither this record nor the working tree.
 *
 * The obvious fence is row-local: stamp the attempt on the row and refuse a
 * write from a lower one. **It does not hold, and the reason is an ordering
 * rather than a bug in the idea.** A row-local fence has to permit
 * same-attempt progress, or the live attempt could never write at all — so a
 * displaced attempt writing while the row still carries *its own* marker is
 * permitted, and there is a real window in which that is the state of the
 * world: the replacement attempt spends it waiting for ownership of the
 * checkout, so it has not reached this row yet.
 *
 * So the authority is the board row, which has carried the replacement's claim
 * since the moment it was made — `attempts` was incremented inside the claim
 * write, before anything was dispatched. An attempt is live exactly when the
 * board's counter still matches the one it was handed AND the row is in a
 * status an attempt owns. Same-attempt progress is permitted by equality, so
 * the live attempt writes freely.
 *
 * The row-local check is kept underneath as a monotonic backstop for the window
 * where the board read itself could be stale. Neither is sufficient alone.
 *
 * ## What this does not close
 *
 * A task deleted and recreated under the same issue-phase while a displaced
 * worker is still alive resets the counter, so an attempt-aware or monotonic
 * fence can accept a stale write from the old incarnation. Closing that would
 * need the task board to pass claim identity (`incarnationId`) through to the
 * worker, which it does not — `TaskWorkerInput` carries neither that nor
 * `createdAt`. That is framework work and outside this lab's boundary; it is
 * named here so nobody mistakes it for either a bug or a task.
 */
export async function writeRunRow(
  ctx: BlockContext,
  identity: AttemptIdentity,
  update: Partial<RunRecordState>,
): Promise<RunRowWrite> {
  const runs = collectionRef(ctx, RUNS);
  const board = collectionRef(ctx, identity.boardCollectionId);

  const claim = (await board.getOptional(identity.taskId))?.state as ClaimView | undefined;
  if (claim === undefined) return "refused";
  if (claim.attempts !== identity.attempt) return "refused";
  if (!ATTEMPT_OWNED_STATUSES.has(String(claim.status))) return "refused";

  const existing = (await runs.getOptional(identity.topic))?.state as
    | RunRecordState
    | undefined;
  if (existing?.attempt != null && existing.attempt > identity.attempt) return "refused";

  await runs.upsert(identity.topic, {
    ...update,
    attempt: identity.attempt,
    taskId: identity.taskId,
    updatedAt: Date.now(),
  });
  return "applied";
}

/**
 * Open the row for a new attempt: record what this attempt already knows, and
 * clear everything it cannot yet report.
 *
 * **Called before the attempt waits for anything.** Two defects live in the
 * gap between a claim and this write, and both close by moving it first:
 *
 * - the replacement attempt's marker reaches the row before it blocks on
 *   checkout ownership, so the row never sits describing the attempt that was
 *   displaced; and
 * - an attempt that dies during provisioning or prompt construction has
 *   already cleared the previous attempt's session, cost and reason, so the
 *   board's new failure count and this row cannot disagree about which run
 *   they describe.
 *
 * Ordering it before the prompt is safe: the previous failure's reason reaches
 * the next attempt through the board's own `feedback` field, never through this
 * row.
 */
export async function openRunRow(
  ctx: BlockContext,
  identity: AttemptIdentity,
  opened: { workspacePath: string; branch: string },
): Promise<RunRowWrite> {
  return writeRunRow(ctx, identity, {
    ...ATTEMPT_SCOPED_CLEAR,
    workspacePath: opened.workspacePath,
    branch: opened.branch,
    outcome: "running",
  });
}

/** Read one issue-phase's row, or `undefined` when nothing has opened it. */
export async function readRunRow(
  ctx: BlockContext,
  topic: string,
): Promise<RunRecordState | undefined> {
  const ref = await collectionRef(ctx, RUNS).getOptional(topic);
  return ref?.state as RunRecordState | undefined;
}

/**
 * The slice of a collection ref this module uses, resolved by accessor key.
 *
 * Structural rather than typed against `ResourceCollectionRef` so the board's
 * ledger — whose row shape is the substrate's `Task`, not ours — resolves
 * through the same helper.
 */
interface ReadableCollection {
  getOptional(key: string): Promise<{ state: unknown; path: string } | undefined>;
  upsert(key: string, update: Record<string, unknown>): Promise<unknown>;
  list(prefix?: string): Promise<Array<{ state: unknown; path: string }>>;
}

/** Resolve a declared collection, failing loudly rather than writing nowhere. */
export function collectionRef(ctx: BlockContext, accessor: string): ReadableCollection {
  const ref = (ctx.resources as Record<string, unknown> | undefined)?.[accessor];
  if (ref === undefined || typeof (ref as ReadableCollection).upsert !== "function") {
    throw new Error(
      `[conductor] the "${accessor}" collection is not registered on this flow — ` +
        `the run record cannot be written, and a silent miss here is the lying ` +
        `status row this lab exists to remove.`,
    );
  }
  return ref as ReadableCollection;
}
