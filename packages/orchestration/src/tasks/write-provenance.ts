/**
 * Durable write provenance — how a caller finds out whether its own task write
 * committed, after a call that threw (FIX-989).
 *
 * ## The gap this closes
 *
 * A task write can commit and *then* throw. Both backings announce the change
 * as a tail call, strictly after the durable write resolves, so a failure in
 * the announcement rejects a call whose write already landed. The caller sees
 * only a rejection, and a rejected promise carries no value — so the write
 * verdict FIX-976 added (`TaskWriteOutcome`) cannot reach it.
 *
 * Reading the task back does not close the gap either. Two histories read
 * identically:
 *
 *   1. my write committed, then another worker claimed the task;
 *   2. my write never landed, the lease expired, a reclaim re-queued it, then
 *      another worker claimed it.
 *
 * Both leave the task `in_progress` on one more attempt. Anything inferring
 * from current state calls the first "displaced" and never reports it.
 *
 * ## The record
 *
 * Four optional fields on the task, all written **inside** the same atomic
 * write that changed it, so provenance is exactly as durable as the task and
 * needs no second storage to stay consistent with:
 *
 * - `revision` — bumped on *every* committed write, whoever made it.
 * - `writeLog` — a bounded, newest-last log of receipts, appended only when a
 *   caller handed in a token.
 * - `writeLogTruncated` — whether the log has ever dropped a receipt.
 * - `incarnationId` — a per-incarnation identity nonce, stamped once at
 *   creation and never touched again.
 *
 * The third exists because the read has to tell *eviction* from *absence*, and
 * a bounded log makes those look identical. The fourth exists because
 * `revision` resets to 1 on a delete-then-recreate under the same id, and a
 * millisecond-clock alternative (`createdAt`) collides on that path often
 * enough to reopen the gap it was meant to close (measured 198/200 pairs). See
 * {@link didWriteLand}.
 *
 * ## What it does not cover
 *
 * Correlation rides `TaskTransitionOptions`, so it is available on the seven
 * methods that accept one. `addTask`, `addTasks`, `claim`, `reclaim` and the
 * five field mutators bump the revision and mint no receipt — a caller of
 * those cannot correlate its own write. That is stated rather than implied,
 * because claiming coverage we do not have is the defect class this exists to
 * remove.
 *
 * A ref written by hand maintains none of this. Absence of a record is
 * therefore the *"cannot tell"* signal, not evidence a write did not land —
 * which is why {@link didWriteLand} is three-valued and never a boolean.
 */
import type { Task, TaskWriteReceipt } from "./schema/task";

/**
 * How many receipts a task retains.
 *
 * Only the seven options-carrying methods mint receipts, so a task accrues at
 * most one per attempt and four covers a full retry budget with margin. It is a
 * **size knob, not a correctness parameter** — {@link didWriteLand} reads no cap
 * constant, so raising or lowering this cannot make an already-written record
 * misread.
 */
const WRITE_LOG_CAP = 4;

/**
 * A caller's claim on one write it is about to make.
 *
 * Minted by {@link beginTaskWrite} **before** the write, from the task the
 * caller holds; presented on `TaskTransitionOptions.write`. It cannot be minted
 * after the fact — `sinceRevision` has to be the revision observed *before* the
 * write for {@link didWriteLand}'s coverage proofs to mean anything.
 *
 * Tokens are minted by first-party callers from a task they already hold, and
 * are never accepted from model or tool input (BP-031): a model naming a write
 * id would be asserting authorship of a write nobody checked.
 */
export interface TaskWriteToken {
  /** Fresh id, recorded on the task if — and only if — the write commits a change. */
  readonly id: string;
  /**
   * `task.revision` as observed before the write, or `undefined` for a task
   * that carries none (persisted before this shipped, or written by a ref that
   * maintains no provenance). Absent means the read can only answer from
   * receipt membership.
   */
  readonly sinceRevision: number | undefined;
  /**
   * `task.incarnationId` as observed before the write, or `undefined` for a
   * task that was not there at mint time, or one that carries no nonce
   * (persisted before this shipped, or written by a ref that maintains no
   * provenance) — task identity across delete/recreate.
   *
   * A task removed (explicit `delete()`, or capacity eviction on the
   * resource-backed collection) and recreated under the same id resets
   * `revision`, so a stale token could otherwise satisfy the coverage arms
   * against a row it never wrote to (the ABA case; `ticketNamesTask` in
   * `claim-ticket.ts` guards the identical case on the claim side, keyed on
   * `createdAt` there rather than a nonce — a pre-existing weakness of its
   * own, out of scope here).
   *
   * A millisecond clock (`createdAt`) was tried here first and rejected: a
   * delete-then-recreate under the same id lands in the same millisecond
   * often enough (measured 198/200 pairs) that two different rows share it,
   * which reopens exactly the gap this field exists to close. `incarnationId`
   * is a fresh id minted per row, not a timestamp, so it does not collide on
   * a fast clock. It remains `number | undefined`-shaped in spirit — required
   * key, optional value — because a legitimate mint against no task, or
   * against a task that predates this field, has no nonce to record; forcing
   * the value non-optional would mean fabricating one, which would make every
   * correlated write against an already-live legacy task compare a synthetic
   * value against `undefined` forever and read as a permanent incarnation
   * mismatch, never firming up into a real answer. See `didWriteLand`'s
   * incarnation arm for how a mismatched *presence* (one side has a nonce,
   * the other does not) is handled: it withholds rather than skipping the
   * check the way a merely-absent value used to.
   */
  readonly incarnationId: string | undefined;
}

/**
 * Open a correlated write against `task`.
 *
 * Call it before the write, pass the result on the write's options, and hand
 * the same token to {@link didWriteLand} afterwards:
 *
 * ```ts
 * const write = beginTaskWrite(tasks.get(taskId));
 * try {
 *   await tasks.complete(taskId, output, { ifAllowed: true, claim, write });
 * } catch (err) {
 *   // The write may already have committed — the throw came from the change
 *   // announcement, which runs after the durable write resolves.
 *   switch (didWriteLand(tasks.get(taskId), write)) {
 *     case true: throw new PostCommitFailure(err);   // real: report it
 *     case false: return;                            // never landed: routine
 *     case undefined: throw new UndeterminedWrite(err); // say so; never guess
 *   }
 * }
 * ```
 *
 * `task` is allowed to be `undefined` — a caller reading a task that is not
 * there still gets a usable token, which then answers *"cannot tell"* rather
 * than forcing a null check at every call site.
 */
export function beginTaskWrite(task: Task | undefined): TaskWriteToken {
  return {
    // crypto.randomUUID(), not generateId(): the receipt id is persisted (in
    // task.writeLog) and compared across processes by didWriteLand's
    // membership arm, the same basis on which incarnationId was hardened.
    // generateId's own header says nothing about it compares across
    // machines — its counter is per-process and its random tail is only 24
    // bits, so two processes can mint the same value, and a collision here
    // makes membership return a confident `true` for a write that never
    // landed.
    id: `tw_${crypto.randomUUID()}`,
    sinceRevision: task?.revision,
    incarnationId: task?.incarnationId,
  };
}

/**
 * Did the write this token was minted for commit a change to `task`?
 *
 * - `true` — it committed. The receipt is in the record.
 * - `false` — it committed nothing. Either it never landed, or it was a no-op
 *   (provenance is stamped only on a write that changed a field, so those two
 *   are deliberately one answer — see the note below).
 * - `undefined` — **cannot tell.** No provenance on this record, no baseline on
 *   the token, the token was minted for a different incarnation of this id, or
 *   the receipt may have been evicted.
 *
 * `undefined` is a first-class result, not a shrug, and a consumer must surface
 * it as its own condition rather than collapsing it into either boolean.
 * Collapsing it back into `false` reintroduces exactly the confident wrong
 * answer this primitive exists to remove.
 *
 * ## The rule, and why the order is load-bearing
 *
 * A bounded log evicts, so a receipt that was never written and one that was
 * written and later dropped both present as *"a log without my id"*. Answering
 * `false` to both would be a confident lie to a delayed caller. Two independent
 * proofs rescue it, and neither subsumes the other:
 *
 * - **A retained receipt at or below my baseline** proves the window still
 *   reaches back past the moment I started, because eviction is oldest-first
 *   and revisions only ever increase. Covers a busy task.
 * - **The log has never dropped anything** proves the window covers everything
 *   by construction. Covers a fresh task, whose log is usually *empty* — on a
 *   first attempt nothing has minted a receipt yet, so the first proof cannot
 *   fire and this is the only one that can.
 *
 * Membership is tested **first**, ahead of the baseline guard: a present
 * receipt proves the write landed whatever the token knows, and a legacy task's
 * first upgraded write has a receipt but no baseline.
 *
 * The **incarnation check runs second**, ahead of every arm below it that
 * reasons about `revision`. A task removed (explicit `delete()`, or capacity
 * eviction on the resource-backed collection) and recreated under the same id
 * resets `revision` — a replacement can restart at the token's own baseline,
 * which would otherwise satisfy "nothing committed since the baseline" for a
 * write that landed on the row that no longer exists (the ABA case;
 * `ticketNamesTask` in `claim-ticket.ts` guards the identical case on the claim
 * side). It cannot run ahead of membership: a receipt actually present in the
 * *current* row's log proves that row committed this exact write, whatever the
 * token's stale `incarnationId` says.
 *
 * The check withholds whenever either side lacks a nonce, and only compares
 * for inequality once both are present — deliberately not the plain
 * `token.incarnationId !== task.incarnationId` this arm used to read for
 * `createdAt`. `createdAt` could compare directly because it is a required
 * field on `Task` — the token's copy of it was `undefined` only when the task
 * itself was `undefined` at mint time, a case the baseline guard below already
 * catches on its own. `incarnationId` has no such guarantee: a task can be
 * `undefined` on either side independently (not there yet at mint time, or
 * there but predating this field) — and a plain inequality on `undefined`
 * values is `false` when *both* sides are absent, which would let a
 * both-legacy pair (a task that predates this field, correlated by a token
 * that read it before the write) fall straight through to the revision arms.
 * That reopens the exact ABA gap this field exists to close: a legacy task
 * deleted and recreated under the same id resets `revision` without minting a
 * nonce on the replacement unless the replacement went through
 * `buildInitialTask`, and during a rolling deploy the old code that deletes
 * and recreates it may not. Requiring presence on both sides before comparing
 * treats "one side has a nonce and the other doesn't" — and "neither does" —
 * as its own mismatch and withholds — never a confident `false` — which also
 * closes a token assembled by hand rather than minted by
 * {@link beginTaskWrite}: leaving `incarnationId` off (or `undefined`) no
 * longer buys a free pass through this arm the way an omitted `createdAt`
 * once did.
 *
 * ## Sound, deliberately not complete
 *
 * It never returns a wrong answer, but it can withhold one: a write that never
 * landed, on a task whose later receipts then evicted everything at or below
 * the baseline, answers `undefined` where an unbounded log would have said
 * `false`. Closing that would mean retaining evicted ids, which defeats
 * bounding. Withholding an answer is the only direction this can afford to err
 * in.
 *
 * ## What `false` means, precisely
 *
 * *"My write changed nothing on this task"* — which subsumes both "it never
 * landed" and "the task was already in the state I asked for". That is the
 * question this answers. It is **not** on its own enough to decide whether to
 * contain or rethrow an error; a caller that needs to know *why* a write
 * changed nothing reads the `declined` verdict on `TaskWriteOutcome`.
 */
export function didWriteLand(
  task: Task | undefined,
  token: TaskWriteToken
): boolean | undefined {
  if (task == null) return undefined;
  const log = task.writeLog ?? [];

  // 1. Membership — the only arm that needs nothing from the token.
  if (log.some((receipt) => receipt.id === token.id)) return true;

  // 2. Incarnation — is this even the task the token was minted for? A
  //    recycled id (delete/recreate, or capacity eviction) resets `revision`,
  //    so every arm below reasons about a basis that never applied to this
  //    row. Withhold whenever EITHER side lacks a nonce — including when
  //    BOTH do — and only compare for inequality once both are present; see
  //    the doc comment above for why a plain inequality (unsound here, unlike
  //    the `createdAt` arm this replaced) would let a both-absent legacy pair
  //    fall through to the revision arms and reopen the ABA gap.
  if (token.incarnationId === undefined || task.incarnationId === undefined) {
    return undefined;
  }
  if (token.incarnationId !== task.incarnationId) return undefined;

  // 3. Nothing to reason from: no record on the task, or no baseline on the token.
  const { revision } = task;
  const baseline = token.sinceRevision;
  if (revision == null || baseline == null) return undefined;

  // A record whose revision went BACKWARDS is incoherent — the substrate's own
  // writers only ever increase it. It means something else wrote this task from
  // a stale snapshot (the documented mixed-writer precondition: a hand-written
  // ref sharing the storage). Both coverage proofs below assume a monotonic
  // revision, so on a record that broke that assumption they prove nothing.
  //
  // This is genuinely a mixed-writer-only arm now that arm 2 sits ahead of it:
  // a same-id delete/recreate mints a fresh `incarnationId` on the replacement
  // (`buildInitialTask`), so arm 2 catches that case and this one never sees
  // it — unless the recreate happened through a path that predates or bypasses
  // incarnation stamping (a hand-written ref, which is the same mixed-writer
  // precondition this comment already names, not a new one).
  if (revision < baseline) return undefined;

  // 4. Nothing committed at all since the baseline.
  if (revision === baseline) return false;

  // 5. A retained receipt older than my baseline — oldest-first eviction cannot
  //    have dropped mine while keeping that one.
  if (log.some((receipt) => receipt.revision <= baseline)) return false;

  // 6. The log has never dropped a receipt, so the retained window covers
  //    everything. `=== false` rather than `!== true`: an ABSENT marker is a
  //    legacy or non-provenance record, which must fall through to cannot-tell.
  if (task.writeLogTruncated === false) return false;

  // 7. My receipt may have been evicted. Say so.
  return undefined;
}

/**
 * The provenance a freshly built task starts life with.
 *
 * Creation is a committed write, so it is revision 1. The log starts absent
 * rather than empty — absent and empty read the same, and omitting the key
 * keeps a task record that never correlates a write from carrying an array
 * nothing will ever read. The marker is written from the start, because
 * {@link didWriteLand}'s arm 5 depends on it being present on every record the
 * substrate wrote.
 */
export function initialWriteProvenance(): Pick<
  Task,
  "revision" | "writeLogTruncated"
> {
  return { revision: 1, writeLogTruncated: false };
}

/**
 * Record what this write did, on the task it is about to commit.
 *
 * **Must be called from inside the backing's atomic section**, against the
 * `prev` that section read. That is the whole design: a stamp computed outside
 * the write describes a basis the write may not have used, and both backings
 * re-run their mutator against refreshed state on a version conflict. Deriving
 * the stamp from `prev` on every invocation is what makes a replay correct with
 * nothing to reset — the same discipline `withOutcome` gives the write verdict.
 *
 * Call it only on a path that **commits a change**. A declined or no-op write
 * leaves no trace and does not advance the revision, which is what keeps
 * `unchanged` honest and makes "my receipt is absent" mean "my write changed
 * nothing".
 *
 * @param prev The task as the atomic section read it — the revision baseline
 *   and the log being appended to.
 * @param next The task this write is committing, with its own fields already
 *   applied.
 * @param token The caller's write token, when it supplied one. Omitted for the
 *   writes that carry no options argument, which still bump the revision.
 */
export function stampWrite<TInput, TOutput>(
  prev: Task<TInput, TOutput>,
  next: Task<TInput, TOutput>,
  token?: TaskWriteToken
): Task<TInput, TOutput> {
  const revision = (prev.revision ?? 0) + 1;

  if (token === undefined) {
    return {
      ...next,
      revision,
      // Carried from `prev`, not from `next`: a patch has no business editing
      // the log, and reading it from the committed basis is what keeps the
      // marker's monotonicity true across a replay.
      ...(prev.writeLog === undefined ? {} : { writeLog: prev.writeLog }),
      writeLogTruncated: prev.writeLogTruncated === true,
    };
  }

  const appended: TaskWriteReceipt[] = [
    ...(prev.writeLog ?? []),
    { id: token.id, revision },
  ];
  const dropped = appended.length - WRITE_LOG_CAP;

  return {
    ...next,
    revision,
    // Oldest-first, which is the property both of `didWriteLand`'s coverage
    // proofs rest on.
    writeLog: dropped > 0 ? appended.slice(dropped) : appended,
    // Monotonic: once true it never goes back to false.
    writeLogTruncated: prev.writeLogTruncated === true || dropped > 0,
  };
}
