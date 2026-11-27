// FIX-2274.
/**
 * One task of a follow-up chain runs at a time.
 *
 * A follow-up continues its root's run: the same checkout, branch, run record
 * and coding session. Two tasks of one chain running at once would share all
 * four, so a task of a chain starts only once no other task of it runs.
 *
 * - {@link chainTaskRunning} is the test, read against the board's tasks.
 * - {@link followUpChainClaimOrder} applies it at the claim, so a task that
 *   must wait is never claimed and never charged an attempt.
 */
import type { ClaimOrder, Task } from "@flow-state-dev/orchestration/tasks";
import { followUpRootId } from "./workspace";

type ChainTask = Pick<Task, "id" | "followUpOf" | "status">;

/**
 * Another task of `task`'s follow-up chain (its root and the root's
 * follow-ups) that is running now, or `undefined` when none is.
 *
 * @param tasks The board's tasks, as the claim write reads them.
 */
export function chainTaskRunning(task: Pick<Task, "id" | "followUpOf">, tasks: readonly ChainTask[]): ChainTask | undefined {
  const byId = new Map(tasks.map((other) => [other.id, other]));
  const lookup = (id: string) => byId.get(id);
  const root = followUpRootId(task, lookup);
  return tasks.find(
    (other) => other.id !== task.id && other.status === "in_progress" && followUpRootId(other, lookup) === root,
  );
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
