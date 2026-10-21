/**
 * The two cascades, and how a board pays one (FIX-2080 D2).
 *
 * When a task fails for good or is cancelled, nothing may wait on it for
 * good, and when a task fails, retries or is cancelled, nothing it filed may
 * keep running. So a board owes, for such an ending:
 *
 * - **its dependents**: every open row on this board whose `deps` name the
 *   ended row is cancelled, labelled `skipped` (the label a pattern's output
 *   reads), with `causedBy` naming the row. Each such cancel is itself an
 *   ending, so a chain is cancelled to its end.
 * - **its filed tasks**: the open tasks the task filed, on whatever boards
 *   those are, cancelled by the board's `cascadeFiled` payer. A plain board
 *   has none.
 *
 * The debt is `Task.cascadeOwed`, written in the ending's own write
 * (`recordCascadeOwed`), so a crash between the ending and the cascade leaves
 * it owed. The ending's own pass pays it at once ({@link payCascade}); a
 * touch of the board pays every one past due ({@link payOwedCascades}). Every
 * write that ends a row passes through a backing's transition, whoever wrote
 * it (the claim gate, a cancel, a refused hand-over, an abandoned row's
 * settle), so every board cascades with no step to wire. A lapsed lease's
 * reclaim writes no ending and cascades nothing: the re-run adopts the work.
 */
import type { Task } from "../schema/task";
import { isTerminalStatus } from "../schema/task-status";
import type { TaskEnding } from "./ending";

/** The label a cascade's cancel carries, which pattern outputs read as `"skipped"`. */
export const SKIPPED_LABEL = "skipped";

/**
 * A board's payer for the tasks a task filed (FIX-2080 D2): which endings owe
 * it, and how it pays. Declared on the board (`defineTaskCollection({
 * cascadeFiled })`), and bound to the running context when the board is
 * resolved.
 */
export interface TaskFiledCascade {
  /**
   * Whether this ending owes the filed half: a pure function of the row as
   * the ending writes it, run inside that write. Only a failure, a cancel or
   * a retry can owe it.
   */
  readonly owes: (row: Task, ending: TaskEnding) => boolean;
  /**
   * Cancel the open tasks `row` filed. `true` once paid (nothing left to
   * cancel included); `false` leaves the cascade owed for a later touch.
   */
  readonly pay: (row: Task) => Promise<boolean>;
}

/** The endings whose row's dependents are cancelled: a failure for good, and a cancel. */
export function endsDependents(ending: TaskEnding): boolean {
  return ending.kind === "errored" || ending.kind === "cancelled";
}

/** The endings that cancel what a task filed: a failure, a retry, and a cancel. */
export function endsFiledWork(ending: TaskEnding): boolean {
  return ending.kind === "errored" || ending.kind === "retried" || ending.kind === "cancelled";
}

/** The open rows on a board that depend on `id`. */
export function openDependentsOf<T extends Pick<Task, "deps" | "status">>(rows: Iterable<T>, id: string): T[] {
  const found: T[] = [];
  for (const row of rows) {
    if (!isTerminalStatus(row.status) && row.deps?.includes(id) === true) found.push(row);
  }
  return found;
}

/**
 * The fields a cascade's cancel writes besides the status: why, its cause,
 * and the `skipped` label.
 */
export function cascadeCancelPatch(dependent: Task, cause: Task, now: number): Partial<Task> {
  const labels = dependent.labels ?? [];
  return {
    error: `dep ${cause.id} ${cause.status === "cancelled" ? "was cancelled" : "failed"}`,
    causedBy: cause.id,
    labels: labels.includes(SKIPPED_LABEL) ? labels : [...labels, SKIPPED_LABEL],
    completedAt: now,
    leaseUntil: undefined,
    claimedBy: undefined,
  };
}

/** What a backing hands {@link payCascade}: its committed reads and its own writes. */
export interface CascadeWrites {
  get(id: string): Task | undefined;
  list(): readonly Task[];
  /** Cancel an open dependent as a cascade (an advisory write: a settled row declines). */
  cancelDependent(id: string, cause: Task): Promise<void>;
  /** Clear the debt, if it is still the one with this due time. */
  settle(id: string, due: number): Promise<void>;
  /** The board's payer for filed tasks, bound to the running context; none on a plain board. */
  readonly filed?: TaskFiledCascade;
}

/**
 * Pay the cascade `id`'s ending owes, if it owes one: cancel its open
 * dependents (for a failure or a cancel), then the tasks it filed, then clear
 * the debt. A half that throws, or a filed half not yet paid, leaves the debt
 * for a touch; the dependents' cancels are advisory, so paying twice cancels
 * nothing twice.
 *
 * @returns `true` once the debt is cleared.
 */
export async function payCascade(writes: CascadeWrites, id: string): Promise<boolean> {
  const row = writes.get(id);
  const owed = row?.cascadeOwed;
  if (row === undefined || owed == null) return false;
  if (row.status === "errored" || row.status === "cancelled") {
    for (const dependent of openDependentsOf(writes.list(), row.id)) {
      await writes.cancelDependent(dependent.id, row);
    }
  }
  if (writes.filed !== undefined && !(await writes.filed.pay(row))) return false;
  await writes.settle(id, owed.due);
  return true;
}

/**
 * The ending's own pass: pay what the row just written owes, and never fail
 * the write that already committed. A cascade it couldn't pay stays owed, for
 * a touch.
 */
export async function payCascadeAfterWrite(writes: CascadeWrites, row: Task | undefined): Promise<void> {
  if (row?.cascadeOwed == null) return;
  try {
    await payCascade(writes, row.id);
  } catch {
    // Owed still: the next touch past its due time pays it.
  }
}

/**
 * A touch of the board: pay every cascade past its due time. Called by
 * whatever touches the board (a board's drain, an action on it), so a cascade
 * a crash left owed is paid on the next touch.
 *
 * @returns How many debts were cleared.
 */
export async function payOwedCascades(writes: CascadeWrites, now: number): Promise<number> {
  let paid = 0;
  for (const row of writes.list()) {
    if (row.cascadeOwed == null || row.cascadeOwed.due > now) continue;
    try {
      if (await payCascade(writes, row.id)) paid += 1;
    } catch {
      // Left owed for the next touch.
    }
  }
  return paid;
}
