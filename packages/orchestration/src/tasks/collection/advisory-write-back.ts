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
 * for an advisory write, where it can be held whatever the store does.
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
 * - **(b)** a re-read shows a state this call could not have produced: terminal
 *   at a status other than the one it was attempting, or terminal under a
 *   different attempt. That is a third party settling the task inside the
 *   snapshot→write window.
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
import type { TaskStatus } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";
import { routeFailure, sumGrantedRetries, transitionDeclineReason } from "./internal";
import type {
  TaskCollectionRef,
  TaskHandle,
  TaskTransitionOptions,
  TaskWriteOutcome,
} from "./types";

/** What a write-back was aiming at, resolved from the verb and the task. */
interface WriteTarget {
  status: TaskStatus;
  kind: TaskChangeKind;
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
  const snapshot = readQuietly(ref, taskId);
  try {
    return await ref.complete(taskId, output, options);
  } catch (err) {
    return containOrRethrow(ref, taskId, "complete", snapshot, options, err);
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
  const snapshot = readQuietly(ref, taskId);
  try {
    return await ref.fail(taskId, error, options);
  } catch (err) {
    return containOrRethrow(ref, taskId, "fail", snapshot, options, err);
  }
}

/**
 * Read a task without letting the read displace the write's own error.
 *
 * A custom store's `get` may throw, and on the post-error path that would
 * replace the failure the caller needs to see with a bookkeeping one. An
 * unreadable task simply removes an input: clause (a) goes unavailable when the
 * snapshot is missing, clause (b) when the re-read is, and with neither the
 * original error propagates.
 */
function readQuietly(ref: TaskCollectionRef, taskId: string): TaskHandle | undefined {
  try {
    return ref.get(taskId);
  } catch {
    return undefined;
  }
}

/**
 * The clock the lease arm of the predicate compares against.
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
  basis: TaskHandle
): WriteTarget {
  if (verb === "complete") return { status: "completed", kind: "completed" };
  const routing = routeFailure(
    basis,
    () => sumGrantedRetries(ref.list()),
    ref.maxTotalRetries ?? undefined
  );
  return routing.action === "retry"
    ? { status: "pending", kind: "retried" }
    : { status: "errored", kind: "errored" };
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
  snapshot: TaskHandle | undefined,
  options: TaskTransitionOptions,
  err: unknown
): TaskWriteOutcome {
  let contained: TaskWriteOutcome | undefined;
  try {
    contained = attribute(ref, taskId, verb, snapshot, options);
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
  snapshot: TaskHandle | undefined,
  options: TaskTransitionOptions
): TaskWriteOutcome | undefined {
  const current = readQuietly(ref, taskId);
  const basis = snapshot ?? current;
  // Neither a before nor an after. Nothing to attribute the throw to, so it is
  // the caller's — including the genuinely-missing-task case, which is not an
  // advisory decline at all.
  if (basis === undefined) return undefined;

  const target = resolveTarget(ref, verb, basis);
  const now = readClock(ref);

  // (a) The task was already declinable when this call ran.
  if (snapshot !== undefined) {
    const reason = transitionDeclineReason(
      snapshot,
      target.status,
      options,
      ref.collectionId,
      now,
      undefined,
      target.kind
    );
    if (reason !== undefined) {
      return { outcome: "declined", reason, status: snapshot.status };
    }
  }

  // (b) Someone settled the task inside the snapshot→write window, to a state
  //     this call could not have produced. Terminal at OUR target under OUR
  //     attempt is deliberately excluded: that is consistent with our own write
  //     having committed, which makes the throw a post-commit failure and
  //     FIX-963's to report.
  if (current !== undefined && isTerminalStatus(current.status)) {
    const couldNotBeOurs =
      current.status !== target.status ||
      (options.claim !== undefined && current.attempts !== options.claim.attempt);
    if (couldNotBeOurs) {
      const reason =
        transitionDeclineReason(
          current,
          target.status,
          options,
          ref.collectionId,
          now,
          undefined,
          target.kind
        ) ?? "terminal";
      return { outcome: "declined", reason, status: current.status };
    }
  }

  return undefined;
}
