// FIX-2274.
/**
 * One task of a follow-up chain runs at a time.
 *
 * A follow-up continues its root's run: the same checkout, branch, run record
 * and coding session. Two tasks of one chain running at once would share all
 * four, so a task of a chain starts only once no other task of it runs.
 *
 * - {@link chainTaskRunning} is the test, read against the board's tasks.
 *   A follow-up in another mode has a run of its own, so it is not held.
 * - {@link followUpChainClaimOrder} applies it at the claim, so a task that
 *   must wait is never claimed and never charged an attempt.
 */
import { leaseLapsed, type ClaimOrder, type Task } from "@flow-state-dev/orchestration/tasks";
import { HARNESS_FEATURE_KEY } from "./manager";
import { canonicalSegment, followUpRootId } from "./workspace";

type ChainTask = Pick<Task, "id" | "followUpOf" | "status" | "input">;

/**
 * The mode a task's run is keyed by, as the task names it: a fixed board's
 * `phase`, a legacy `harnessFeature.phase`, or the coding kit's checked
 * `mode`, canonical. `undefined` when it names none, so it runs as the
 * manager's own mode, which may be any task's.
 */
function namedRunMode(task: Pick<Task, "input">): string | undefined {
  const input = typeof task.input === "object" && task.input !== null ? (task.input as Record<string, unknown>) : {};
  const feature = input[HARNESS_FEATURE_KEY];
  const featurePhase = typeof feature === "object" && feature !== null ? (feature as Record<string, unknown>).phase : undefined;
  const named = [input.phase, featurePhase, input.mode].find((value) => typeof value === "string");
  return named === undefined ? undefined : canonicalSegment(named as string);
}

/**
 * Another task of `task`'s run (its follow-up chain: its root and the root's
 * follow-ups, in its mode) that is running now, or `undefined` when none is.
 *
 * A task in another mode has a run of its own, so it never waits on this one.
 * A task naming no mode may share any mode's run, so it waits on all of them.
 * A running task whose lease lapsed is the substrate's to reclaim: it keeps a
 * task that has not started waiting, but not another running task being
 * reclaimed, so two lapsed tasks of one run never keep each other from it.
 * The first one reclaimed holds a live lease again, and the other waits on it.
 *
 * @param tasks The board's tasks, as the claim write reads them.
 * @param now The time a lease is lapsed at.
 */
export function chainTaskRunning(task: ChainTask, tasks: readonly Task[], now = Date.now()): Task | undefined {
  const byId = new Map(tasks.map((other) => [other.id, other]));
  const lookup = (id: string) => byId.get(id);
  const root = followUpRootId(task, lookup);
  const mode = namedRunMode(task);
  return tasks.find((other) => {
    if (other.id === task.id || other.status !== "in_progress") return false;
    if (task.status === "in_progress" && leaseLapsed(other, now)) return false;
    if (followUpRootId(other, lookup) !== root) return false;
    const otherMode = namedRunMode(other);
    return mode === undefined || otherMode === undefined || otherMode === mode;
  });
}

/**
 * A board claim order that never claims a task while another task of its
 * follow-up chain runs. The claim is what spends an attempt, so a task it
 * passes over stays exactly as it was, and is claimed once the running task
 * of its chain ends. Readiness and order stay the collection's: the test is
 * an `eligibility` narrow, decided inside the claim write against the tasks
 * as that write reads them, so two claims at once never both start a chain.
 *
 * Wire it on a board whose tasks a manager runs: `taskBoard({ claimOrder:
 * followUpChainClaimOrder() })`. `runOwnerClaimOrder` applies the same test.
 *
 * @returns A claim order to pass as `taskBoard({ claimOrder })`.
 */
export function followUpChainClaimOrder(): ClaimOrder {
  return {
    async claim(collection, workerId) {
      return collection.claim(workerId, { eligibility: (task, tasks) => chainTaskRunning(task, tasks) === undefined });
    },
  };
}
