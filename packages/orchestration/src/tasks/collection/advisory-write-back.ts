/**
 * The advisory write-back seam — where a worker's result meets the store
 * (FIX-964).
 *
 * ## Why this exists
 *
 * FIX-951 made a late write-back safe by making it *advisory*: pass
 * `{ ifAllowed, claim }` and a result that arrives after its task was settled
 * by someone else is declined instead of throwing. That containment is what
 * keeps one worker's bad luck from abandoning every sibling on the board.
 *
 * It made containment a property the **store** supplies. Both built-in backings
 * supply it. But `taskBoard({ collection: (ctx) => ... })` is a documented
 * extension point, and a store written before FIX-951 — or written from
 * {@link TaskCollectionRef} without reading the prose around it — takes
 * `(id, output)` and JavaScript discards the third argument in silence. It
 * typechecks, it runs, and the first time a result arrives late it throws, the
 * throw escapes the board's per-worker rescue, and every other task on that
 * board is left `pending` forever.
 *
 * Certifying the store cannot fix that. A brand, an arity probe, a mandatory
 * parameter — each verifies what the author *declared*, and a declaration is
 * precisely what a non-conforming author gets wrong. Worse, they only work
 * where the framework constructs the store through a boundary it owns, and
 * `dispatchAndExecuteBlock` is handed a ref directly as a plain option. So
 * containment moves here instead, to the two places the substrate actually asks
 * for an advisory write, where it can be held without the store's cooperation.
 *
 * ## The rule
 *
 * Snapshot the task. Attempt the write with the caller's options passed through
 * unchanged. If it **throws**, ask one question: is this throw attributable to a
 * decline a conforming store would have made **before committing anything**?
 *
 * - **(a)** {@link transitionDeclineReason} was already true of the snapshot —
 *   the task was settled or displaced before this call ever ran, so a
 *   conforming store would have declined it. A throw means it did not.
 * - **(b)** a re-read shows a state this call could not have produced, and the
 *   predicate declines the write against it. Something moved the task inside
 *   the snapshot→write window — settled it, or merely displaced it, which is
 *   why this is not restricted to terminal states.
 *
 * Contain either. **Rethrow everything else, unchanged.**
 *
 * ## What "everything else" is, and why the rethrow matters more
 *
 * Two things travel the rethrow path, and losing either would be worse than the
 * bug this file fixes.
 *
 * A **store failure on a task the worker still holds** — an outage, CAS
 * exhaustion, an ordinary bug — has nothing to do with the guards. FIX-951's
 * own contract draws this line: a containment guard for task-state conflicts,
 * not a blanket error suppressor.
 *
 * A **write that committed and then threw** is the harder one, and it is why
 * the snapshot is taken before the write rather than inferred after it. In both
 * backings `emit` runs after the commit and outside the write's `try`, so a
 * failing `onChange` rejects `complete()` with the task already durably
 * terminal at the expected attempt. Read *after* the error, that is
 * indistinguishable from "someone else had already settled it" — so an earlier
 * design of this seam contained it, silently eating the signal FIX-963 exists
 * to raise. The split point between the two specs is the commit: this seam
 * contains only what was declinable before it, and everything at or after it is
 * FIX-963's to classify. Neither consumes the other's predicate.
 *
 * ## What this does and does not guarantee
 *
 * It fires on a **throw**. So the guarantee is *the board survives a
 * non-conforming store*, not *a non-conforming store behaves like a conforming
 * one*. A store that silently applies a stale write without throwing is still
 * wrong and still uncaught: it corrupts one task's data, which is bad, but it
 * does not abandon the other workers, which is the filed defect. Reproducing
 * FIX-951's full advisory semantics on the store's behalf is not possible from
 * outside its atomic section and is not attempted.
 *
 * Nor is the attribution exact, and it cannot be made exact from here. Two
 * histories are misread, both because the write never reports what it did:
 * a snapshot that was already displaced followed by an unrelated outage is
 * contained by (a) when it should propagate, and a legacy write that committed
 * after another worker advanced the attempt is contained by (b) when it should
 * reach FIX-963. Where the two errors are not symmetric, the bias is
 * deliberate: rethrowing something containable costs one board, while
 * containing something loud costs a sibling issue its entire signal — so the
 * clauses are written narrow.
 *
 * (FIX-989's write provenance does not close that gap either, though it looks
 * like it should. `didWriteLand` answers "cannot tell" for a ref that maintains
 * no provenance — which is every hand-written store, i.e. exactly the case
 * here.)
 *
 * ## Cost on a conforming store
 *
 * One synchronous `get(id)` per write-back, and nothing else. Both built-in
 * backings honour the options and never throw on the enumerated cases, so the
 * attribution branch is unreachable on the built-in path and no behaviour
 * changes for a caller who was already correct.
 */
import type { TaskChangeKind } from "./change-event";
import type { Task, TaskStatus } from "../schema/task";
import { routeFailure, sumGrantedRetries, transitionDeclineReason } from "./internal";
import type {
  TaskCollectionRef,
  TaskTransitionOptions,
  TaskWriteOutcome,
} from "./types";

/**
 * What a write-back was aiming at, resolved from the verb and the task.
 *
 * `status` is a **prediction**, not a fact: the store picks the route inside its
 * own atomic write, and the seam is outside it. `alternate` names the other
 * status the write could have produced when that prediction was overtakeable,
 * so clause (b) can decline to call such a row somebody else's work.
 */
interface WriteTarget {
  status: TaskStatus;
  kind: TaskChangeKind;
  alternate?: TaskStatus;
}

/**
 * Complete a task, containing the throw a non-conforming store raises where a
 * conforming one would have declined.
 *
 * A drop-in for `ref.complete(id, output, options)` — same arguments, same
 * return value, same behaviour on every store that honours the guards.
 */
export async function advisoryComplete(
  ref: TaskCollectionRef,
  taskId: string,
  output: unknown,
  options: TaskTransitionOptions
): Promise<TaskWriteOutcome> {
  const before = observe(ref, taskId, "complete");
  try {
    return await ref.complete(taskId, output, options);
  } catch (err) {
    return containOrRethrow(ref, taskId, "complete", before, options, err);
  }
}

/**
 * Fail a task, containing the throw a non-conforming store raises where a
 * conforming one would have declined.
 *
 * A drop-in for `ref.fail(id, error, options)`, on both the terminal and the
 * retrying route — which is why the target status is resolved rather than
 * assumed. See {@link resolveTarget}.
 */
export async function advisoryFail(
  ref: TaskCollectionRef,
  taskId: string,
  error: string,
  options: TaskTransitionOptions
): Promise<TaskWriteOutcome> {
  const before = observe(ref, taskId, "fail");
  try {
    return await ref.fail(taskId, error, options);
  } catch (err) {
    return containOrRethrow(ref, taskId, "fail", before, options, err);
  }
}

/**
 * Everything about the call that has to be known BEFORE the write.
 *
 * Every field answers the same question — *what was true when this call ran* —
 * and every one has to be captured up front for the same reason: read
 * afterwards, they describe the world the failure left behind rather than the
 * one the call started in. Each has already been a bug read late.
 *
 * - `task` — the snapshot clause (a) judges. Read late, a committed write looks
 *   like somebody else's settlement.
 * - `at` — the clock the lease arm compares against. Read late, a store that
 *   hangs past the lease turns a plain outage into a lost claim.
 * - `grantedRetries` — the collection's spent retry budget, which decides which
 *   route a `fail` took. Read late, a write that spent the *last* retry makes
 *   its own route look unreachable, and the post-commit failure it then raised
 *   gets contained as though somebody else had displaced the task.
 */
interface CallBasis {
  task: Task | undefined;
  at: number;
  grantedRetries: number | undefined;
}

function observe(
  ref: TaskCollectionRef,
  taskId: string,
  verb: "complete" | "fail"
): CallBasis {
  return {
    task: readQuietly(ref, taskId),
    at: readClock(ref),
    grantedRetries: readGrantedRetries(ref, verb),
  };
}

/**
 * The retry budget as it stood before the write, or `undefined` when it cannot
 * change the answer.
 *
 * Deliberately narrow, because this is the one input that costs a scan.
 * {@link routeFailure} consults the total only on a `fail` against a collection
 * that actually enforces a budget — every other call short-circuits before the
 * thunk — so those are the only calls that pay for it, and a `complete` or an
 * unbudgeted board pays nothing. A budgeted board pays one O(tasks) sum per
 * *failed* task, which is the same sum its own backing already runs inside the
 * write that failed.
 */
function readGrantedRetries(
  ref: TaskCollectionRef,
  verb: "complete" | "fail"
): number | undefined {
  if (verb !== "fail" || ref.maxTotalRetries == null) return undefined;
  try {
    return sumGrantedRetries(ref.list());
  } catch {
    return undefined;
  }
}

/**
 * Read a task, detached from the store, without letting the read displace the
 * write's own error.
 *
 * **Detached, because a snapshot that a store can still edit is not a
 * snapshot.** `get` is free to hand back the same object the write then mutates
 * in place, and this seam runs against stores it does not control, so it cannot
 * assume otherwise — a live object would let a post-commit failure read as a
 * task that was already settled when the call began, which is precisely the
 * confusion taking the snapshot early exists to prevent. A shallow copy is
 * enough: every field the attribution reads is a scalar. Both built-in backings
 * already return a fresh object per call, so this costs them one allocation and
 * changes nothing.
 *
 * The `TaskHandle` shed by the copy (its `items()`) is not read here.
 *
 * A custom store's `get` may also throw, and on the post-error path that would
 * replace the failure the caller needs to see with a bookkeeping one. An
 * unreadable task simply removes an input: clause (a) goes unavailable when the
 * snapshot is missing, clause (b) when the re-read is, and with neither the
 * original error propagates.
 */
function readQuietly(ref: TaskCollectionRef, taskId: string): Task | undefined {
  try {
    const task = ref.get(taskId);
    return task === undefined ? undefined : { ...task };
  } catch {
    return undefined;
  }
}

/**
 * The clock the lease arm of the predicate compares against, sampled with the
 * snapshot rather than after the write. See {@link CallBasis}.
 *
 * `now` was added to `TaskCollectionRef` with leases and is therefore the field
 * a hand-written store is most likely to be missing — and a store missing it is
 * exactly the population this seam exists for, so its absence must not cost the
 * board its containment. `Date.now()` is what the interface documents as the
 * right answer for an implementer with no reason to pick another, so it is the
 * right answer here too (BP-030).
 */
function readClock(ref: TaskCollectionRef): number {
  try {
    return typeof ref.now === "function" ? ref.now() : Date.now();
  } catch {
    return Date.now();
  }
}

/**
 * Where a write-back was headed, resolved the way the backings resolve it.
 *
 * `complete` is fixed. `fail` is not: with attempts left it is a *soft* fail
 * that re-pends the task, and only {@link routeFailure} — the same function
 * both backings call inside their atomic write, against the same budget the ref
 * reports — knows which. Resolving it here rather than at the call sites is
 * what keeps two callers from carrying two copies of that decision.
 *
 * Runs only on the error path, so the retry-budget sum it may walk is never
 * paid by a write that succeeded.
 */
function resolveTarget(
  ref: TaskCollectionRef,
  verb: "complete" | "fail",
  basis: Task,
  grantedRetries: number | undefined
): WriteTarget {
  if (verb === "complete") return { status: "completed", kind: "completed" };
  const routing = routeFailure(
    basis,
    () => grantedRetries ?? sumGrantedRetries(ref.list()),
    ref.maxTotalRetries ?? undefined
  );
  if (routing.action !== "retry") return { status: "errored", kind: "errored" };
  // A predicted retry is the one answer a concurrent write can overtake. The
  // budget decides it, grants only ever push the total UP, and the total is
  // sampled before the write — so between the sample and the store's atomic
  // section a sibling can spend the last retry and flip this write to terminal.
  // The reverse cannot happen: a total never shrinks, so a predicted terminal
  // stays terminal.
  const overtakeable = ref.maxTotalRetries != null && routing.countsAgainstBudget;
  return {
    status: "pending",
    kind: "retried",
    ...(overtakeable ? { alternate: "errored" as TaskStatus } : {}),
  };
}

/**
 * Contain the throw, or let it through. The one place that decides.
 *
 * **Nothing here may displace the caller's error.** This runs against a ref the
 * substrate did not write and cannot inspect, so every input the attribution
 * reads is one a hand-written store may not supply: `now` postdates the original
 * interface, and the fail route reads `list` and the task's own retry fields.
 * So evidence-gathering that *fails* means the same thing as evidence that shows
 * nothing — the throw is the caller's, and the caller gets it back unchanged
 * rather than a bookkeeping failure in its place.
 */
function containOrRethrow(
  ref: TaskCollectionRef,
  taskId: string,
  verb: "complete" | "fail",
  before: CallBasis,
  options: TaskTransitionOptions,
  err: unknown
): TaskWriteOutcome {
  let contained: TaskWriteOutcome | undefined;
  try {
    contained = attribute(ref, taskId, verb, before, options);
  } catch {
    contained = undefined;
  }
  if (contained !== undefined) return contained;
  throw err;
}

/**
 * The attribution rule. Returns a decline when the throw is attributable to a
 * pre-commit decline, and `undefined` when it is not.
 *
 * The predicate is never re-derived here. `transitionDeclineReason` is exactly
 * what both backings evaluate inside their atomic write, and calling it is what
 * keeps this seam from drifting as the transition table changes — a hand-rolled
 * equivalent would stay green through the change that made it wrong.
 */
function attribute(
  ref: TaskCollectionRef,
  taskId: string,
  verb: "complete" | "fail",
  before: CallBasis,
  options: TaskTransitionOptions
): TaskWriteOutcome | undefined {
  const snapshot = before.task;
  const current = readQuietly(ref, taskId);
  const basis = snapshot ?? current;
  // Neither a before nor an after. Nothing to attribute the throw to, so it is
  // the caller's — including the genuinely-missing-task case, which is not an
  // advisory decline at all.
  if (basis === undefined) return undefined;

  const target = resolveTarget(ref, verb, basis, before.grantedRetries);

  // (a) The task was already declinable when this call ran.
  //
  // Judged against the clock as it read WHEN THE CALL RAN, not as it reads now.
  // The predicate's lease arm is a comparison against `leaseUntil`, so a clock
  // sampled after the failure asks whether the lease has run out *by the time
  // the store gave up* — and a store that hangs past the lease and then throws
  // would answer yes. That reads a plain outage as a lost claim and drops the
  // worker's result in silence, which is the exact conversion this seam must
  // never make. The question is whether a conforming store would have declined
  // this call, so it is asked as of the call.
  if (snapshot !== undefined) {
    const reason = transitionDeclineReason(
      snapshot,
      target.status,
      options,
      ref.collectionId,
      before.at,
      undefined,
      target.kind
    );
    if (reason !== undefined) {
      return { outcome: "declined", reason, status: snapshot.status };
    }
  }

  // (b) Something moved the task inside the snapshot→write window, leaving it in
  //     a state this call could not have produced — and a conforming store would
  //     have declined the write against it.
  //
  // Two questions, in this order, and the split is what makes the clause safe.
  // "Could this be our own write?" is only a GATE: it excludes the state our
  // write would have left behind, because that is a post-commit failure and
  // FIX-963's to report rather than ours to swallow. What actually decides
  // containment is the predicate, asked against the state the store saw.
  //
  // Leaning on the gate alone would be wrong in the other direction: a store
  // that is simply down leaves the task exactly where we found it, which is
  // *also* "not what our write would have produced". The predicate is what tells
  // those apart — it declines a displaced task and says nothing about a healthy
  // one — so an outage still reaches the caller.
  //
  // Deliberately NOT restricted to terminal states. Review found the gap: a
  // lease reclaim re-pends the task mid-write, the legacy store then attempts
  // `pending → errored`, and the state machine refuses it. Nothing settled the
  // task, so a terminal-only test never fires, and a throw a conforming store
  // would have declined escapes and abandons the siblings — this change's own
  // defect, reached through its own seam.
  if (current !== undefined) {
    // Either status this write could have produced counts as "ours". Where the
    // route was overtakeable the seam genuinely does not know which one the
    // store committed, and the bias under that uncertainty is the one this file
    // takes everywhere: rethrowing something containable costs this board, while
    // containing something loud costs FIX-963 its entire signal.
    const couldBeOurs =
      (current.status === target.status || current.status === target.alternate) &&
      (options.claim === undefined || current.attempts === options.claim.attempt);
    if (!couldBeOurs) {
      const reason = transitionDeclineReason(
        current,
        target.status,
        options,
        ref.collectionId,
        before.at,
        undefined,
        target.kind
      );
      if (reason !== undefined) {
        return { outcome: "declined", reason, status: current.status };
      }
    }
  }

  return undefined;
}
