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
 * - **Bare topic** — `<epic>/<issue>/<phase>`. Every collection call takes this.
 * - **Storage key** — `runs/<epic>/<issue>/<phase>`. What the collection
 *   produces, what `ref.path` returns, what a route's `topicPrefix=` carries.
 *
 * `**` and not `*`: a single wildcard matches exactly one segment, so a
 * multi-segment topic would resolve nothing on every read and every write.
 *
 * ## `user`-scoped, same principal as the board
 *
 * This was session-scoped with lineage sharing, on the reasoning that the run
 * record has no need to outlive the session that wrote it. That reasoning was
 * wrong, and the way it was wrong is worth keeping written down.
 *
 * `sharedToLineage` gives one identity across *a* session's lineage, and a
 * new coordinator session is a different lineage root. So a `status` call from
 * a new session returned the board row and `run: null` — measured, not
 * theorised — losing the failure reason, the harness session, the cost and the
 * checkout. The board row said the job was done and the record of what it did
 * was simply absent. **A silent partial answer**, which is the same family of
 * defect this whole lab exists to remove.
 *
 * It reached ordinary use, too: the CLI mints a fresh session per invocation
 * unless one is named, so the documented `seed` / `wake` / `status` sequence
 * was three lineages.
 *
 * The board is `user`-scoped so a later coordinator session still sees the job
 * (D-4). This issue's success criterion is that what the run DID is readable
 * afterwards without opening a transcript. A companion ledger at a different
 * scope cannot satisfy that, so it sits at the same scope as the board.
 *
 * **Retention is a named limit.** Nothing prunes these rows, and at
 * `user` scope they outlive every session. Acceptable while a conductor runs
 * one issue at a time; a board driving many issues over a long life needs a
 * retention policy, which is deliberately not built here.
 *
 * ## The session id IS read back, and the rules that make that safe
 *
 * **This ledger is where an attempt's harness session lives, and the next
 * attempt resumes from it** (LAB-154). It was observability-only before that,
 * and the note here said so; the note is gone rather than softened, because a
 * contract that describes the opposite of the code instructs the next
 * maintainer to preserve the wrong thing.
 *
 * Three rules make the read safe, and all three are load-bearing:
 *
 * - **`sessionId` means the session the harness CONFIRMED it was in.** The
 *   harness's own session hook is its sole writer, firing when the vendor names
 *   the session. Nothing writes back the id that was *sent* — not the verdict,
 *   not a failure path.
 * - **Every attempt's opening write clears it** (see `ATTEMPT_SCOPED_CLEAR`).
 *   So an attempt whose harness never named a session leaves it `null`.
 * - **There is no fallback.** An empty field is never backfilled from a run
 *   handle. A resume the vendor refused can return a handle still carrying the
 *   dead id, and recording that is what made a dead session resume forever.
 *
 * Together those make a lost session self-heal: it is asked for once, and the
 * attempt after that starts fresh.
 *
 * **This is still not the task-owned resume association.** That is a typed
 * top-level field on the task and belongs to FIX-1179 / FIX-1246; nothing here
 * stands in for it, and LAB-139 stays gated on FIX-1246 rather than draining
 * this. What this row carries is the manager's own record of its own runs.
 *
 * The checkout path is still **derived** from the durable task rather than read
 * back from here (see `./workspace`). This row records a copy. That has not
 * changed and does not change with the scope: a copy, never a source.
 */
import { defineResourceCollection } from "@flow-state-dev/core";
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
   * The session THIS attempt's harness confirmed it was in.
   *
   * Written by the harness's session hook and by nothing else, cleared by every
   * attempt's opening write, and never backfilled from a run handle. The next
   * attempt resumes from it, so those three rules are the contract rather than
   * incidental — see the module header.
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
  // Same principal as the board, so a `status` call from any coordinator
  // session answers with the run row rather than `null`. `sharedToLineage`
  // is not passed and would be rejected here — `user` scope already spans every
  // session the principal touches, which is a superset of what lineage sharing
  // gave and is what the child session needs too.
  scope: "user",
  prefetchMode: "lazy",
  stateSchema: runRecordStateSchema,
});

/**
 * The bare topic for one run. Never carries the `runs/` prefix.
 *
 * **Led by the epic**, for the reason D-4 partitions the board: `runs/**` is one
 * collection every epic writes, and a later coordinator session of *this* epic
 * must read *this* epic's row. Without the discriminator, two epics driving one
 * issue-phase resolve the same topic and either manager overwrites the other's
 * checkout, session, cost and outcome — `run:` present and belonging to someone
 * else, which is a silent WRONG answer rather than the missing one the scope
 * fold closed.
 *
 * The rule this applies: a key two boards write, whose reader is a JOB, needs
 * the board's discriminator. A key whose reader is a PERSON does not — which is
 * why the inbox's key does not move.
 *
 * Three segments, which `runs/**` matches and `runs/*` would not.
 */
export function runTopic(epic: string, issue: string, phase: string): string {
  return `${epic}/${issue}/${phase}`;
}

/** The bare prefix listing every phase of one issue, within one epic. */
export function runTopicPrefix(epic: string, issue: string): string {
  return `${epic}/${issue}/`;
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
  /** The bare topic — `<epic>/<issue>/<phase>`. See {@link runTopic}. */
  topic: string;
  /** The board's ledger collection id, resolved from `ctx.resources`. */
  boardCollectionId: string;
}

/**
 * A task row as this module reads it. Structural: only the three fields the
 * fence consults, so nothing here depends on the substrate's `Task` type.
 */
interface ClaimView {
  status?: string;
  attempts?: number;
  leaseUntil?: number | null;
}

/**
 * The statuses in which an attempt still owns its task.
 *
 * The counter alone is not ownership: `reclaim()` returns a task to `pending`
 * without touching `attempts`, so in the window between a reclaim and the next
 * claim a displaced worker matches the counter by construction. This mirrors
 * the substrate's own `ATTEMPT_OWNED_STATUSES` rather than guessing at it.
 */
const ATTEMPT_OWNED_STATUSES = new Set(["in_progress", "parked"]);

/**
 * The status `parked` replaced. A row persisted before that rename still
 * carries it. The substrate maps it forward at its own read boundary, but the
 * fence reads the board as a plain resource collection and never passes that
 * boundary — so it maps the value forward itself, or a parked attempt from
 * before the rename has every write refused and its run record freezes.
 */
const LEGACY_PARKED_STATUS = "awaiting_review";

/** The board row as the fence reads it, with the legacy status mapped forward. */
function readClaim(state: unknown): ClaimView | undefined {
  if (state === undefined) return undefined;
  const claim = state as ClaimView;
  return claim.status === LEGACY_PARKED_STATUS ? { ...claim, status: "parked" } : claim;
}

/**
 * The substrate's lease rule, mirrored here for the same reason
 * {@link ATTEMPT_OWNED_STATUSES} is: this file reads the board through a
 * structural interface and does not import the `Task` type.
 *
 * **Why the fence needs it as well as the status.** The substrate refuses a
 * settlement on a lapsed lease exactly as it refuses one on a lost claim —
 * both return `"lost-claim"`. A fence that mirrors only the status half admits
 * the write the substrate would reject, and the two then disagree in the one
 * direction that matters: the board row stays open while the run record reads
 * `succeeded`. That disagreement is the lying status row this lab exists to
 * remove, so the conjunct is taken from the same rule rather than reasoned
 * about separately.
 *
 * Only `in_progress` rows can lapse. A `parked` row is
 * waiting on a person, not on a lease, so its writes still apply — which is the
 * behaviour the substrate has too.
 *
 * **The clock is the wall clock, and that is a limit.** A lease is a
 * comparison, and a comparison needs one clock; the board collection's own is
 * the right one. It is not reachable here — the fence reads the board as a
 * plain resource collection, which exposes no `now()`. The board's clock
 * defaults to `Date.now` and this lab injects no other, so today the two agree.
 * If one is ever injected, this comparison is what breaks: a live attempt would
 * read as lapsed and a lapsed one as live.
 */
function leaseHasLapsed(claim: ClaimView, now: number): boolean {
  if (claim.status !== "in_progress") return false;
  return claim.leaseUntil != null && claim.leaseUntil <= now;
}

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
 * status an attempt owns AND its lease has not lapsed — the same three the
 * substrate settles on. Same-attempt progress is permitted by equality, so the
 * live attempt writes freely.
 *
 * The row-local check is kept underneath as a monotonic backstop for the window
 * where the board read itself could be stale. Neither is sufficient alone.
 *
 * ## What this does not close — two limits, and they are different
 *
 * **ABA.** A task deleted and recreated under the same issue-phase while a
 * displaced worker is still alive resets the counter, so an attempt-aware or
 * monotonic fence can accept a stale write from the old incarnation. Closing
 * that would need the task board to pass claim identity (`incarnationId`)
 * through to the worker, which it does not — `TaskWorkerInput` carries neither
 * that nor `createdAt`. Framework work, outside this lab's boundary.
 *
 * **The read-then-write window.** The reads above and the upsert below are not
 * one atomic operation. A replacement claim landing between them lets the
 * displaced attempt's write through: it read `attempts === N`, the board moved
 * to `N + 1`, and the write applies anyway. Closing *that* needs a conditional
 * resource write — a compare-and-swap the collection API does not offer — so it
 * is also framework surface rather than something ordering inside this file can
 * fix.
 *
 * **What bounds it**, and why it is a narrow stale field rather than a lost
 * run: the board row is untouched (the substrate fences settlement itself, so
 * completion is never affected), the monotonic check makes the damage
 * non-repeating once the replacement has written, and the replacement's own
 * opening upsert overwrites every attempt-scoped field on the way in. So the
 * observable worst case is a run-record field that is briefly the displaced
 * attempt's, corrected when the live attempt opens the row.
 *
 * Both are named here so neither is mistaken for a bug or for a task.
 */
export async function writeRunRow(
  ctx: CollectionHoldingContext,
  identity: AttemptIdentity,
  update: Partial<RunRecordState>,
): Promise<RunRowWrite> {
  const runs = collectionRef(ctx, RUNS);
  const board = collectionRef(ctx, identity.boardCollectionId);

  const claim = readClaim((await board.getOptional(identity.taskId))?.state);
  if (claim === undefined) return "refused";
  if (claim.attempts !== identity.attempt) return "refused";
  if (!ATTEMPT_OWNED_STATUSES.has(String(claim.status))) return "refused";
  if (leaseHasLapsed(claim, Date.now())) return "refused";

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
 * Ordering it before the prompt is safe **only because nothing reads this row
 * for previous-attempt data.** That was not true when the claim was first
 * written: the implement prompt read `sessionId` off the row to name the last
 * attempt's harness session, and the clear meant it always saw `null`. The
 * carry-forward a phase needs now arrives on `PhaseRunContext` — the failure
 * reason from the board's own `feedback`, the previous session captured by the
 * manager before this write. A phase reading this row for anything the clear
 * touches is the same defect returning.
 */
export async function openRunRow(
  ctx: CollectionHoldingContext,
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
  ctx: CollectionHoldingContext,
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

/**
 * What resolving a collection actually READS off a context: the resource
 * registry, and nothing else.
 *
 * Typed by that rather than as a whole `BlockContext`, which is the same move
 * `RequestIdentityContext` and `harnessCtxState` make in `./manager` and for the
 * same reason — a helper declared against the entire context forces a cast on
 * every caller holding a narrower one. That is not hypothetical here: a harness
 * feed is handed the deliberately-tightened `HarnessCallbackContext`, which is
 * not structurally assignable to the wide `BlockContext`, so the manager's
 * session hook needed an `as unknown as` to reach `writeRunRow` — an unchecked
 * claim, at a board-state write, which is the worst place to make one.
 *
 * Widening what callers may pass, so every existing one keeps compiling.
 * `resources` is `unknown` rather than a record because `ResourceRegistry` is a
 * mapped type carrying its own methods; the read below casts it exactly as it
 * always did, and pinning a shape here would only move the cast.
 */
export interface CollectionHoldingContext {
  resources?: unknown;
}

/** Resolve a declared collection, failing loudly rather than writing nowhere. */
export function collectionRef(
  ctx: CollectionHoldingContext,
  accessor: string,
): ReadableCollection {
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
