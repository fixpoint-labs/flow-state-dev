/**
 * `classifierDispatcher({ classify })` — LLM picks among ready `pending`
 * tasks.
 *
 * The factory takes a user-supplied `classify` callback that, given
 * the claimable candidate set and the runtime context, returns the id of
 * the task to claim (or `null` to back off). The dispatcher then narrows
 * `eligibility` to that id alone.
 *
 * **Narrowing by id is safe here since FIX-1005**, and it was not before. The
 * substrate now composes its own admission rule with a caller's narrowing
 * rather than letting the narrowing replace it, so the claim's re-check inside
 * the conditional write still arbitrates when a parallel worker won the task
 * during the model call — which is the wide window this dispatcher has by
 * construction. Restating that rule here as an `isReady` conjunct would only
 * pin a second copy of it, and the copy is what would exclude an abandoned row.
 *
 * The classifier sees the tasks a worker could actually run: `pending` ones with
 * deps satisfied, plus any whose worker died and still has recovery allowance
 * left. Review-gated tasks are filtered before the callback runs.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { Task } from "../schema/task";
import type { TaskCollectionRef } from "../collection/types";
import {
  claimDisposition,
  isClaimable,
  DEFAULT_MAX_ABANDONMENTS,
} from "../collection/internal";
import type { TaskDispatcher } from "./types";

export type ClassifyFn = (
  candidates: ReadonlyArray<Task>,
  ctx: BlockContext,
  collection: TaskCollectionRef
) => Promise<string | null>;

export interface ClassifierDispatcherOptions {
  classify: ClassifyFn;
}

export function classifierDispatcher(
  options: ClassifierDispatcherOptions
): TaskDispatcher {
  return {
    async claim(collection, workerId, ctx) {
      const lookup = (id: string) => collection.get(id);
      const now = collection.now();
      // Only the two live statuses: admission can never hold for a terminal row,
      // and a board that keeps a long history should not pay to re-derive that
      // (same narrowing as `hasClaimableTask` and `select-next-ready-task`).
      const admitted = collection
        .list({ status: ["pending", "in_progress"] })
        .filter((t) => isClaimable(t, lookup, now));

      // Admission and disposition answer different questions, and this
      // dispatcher is the one place that has to keep them apart.
      //
      // A row whose abandonment allowance is spent is still *admitted* — that is
      // deliberate, because claiming it is what settles it `errored`, and that
      // settlement is how a board with a dead task ever reaches `drained`. The
      // substrate's own claim scan relies on it: it walks its candidates,
      // settles the exhausted ones in passing, and claims the first runnable one
      // behind them.
      //
      // That scan is exactly what this dispatcher destroys. `classify` returns
      // ONE id, so the claim below is narrowed to a single row and has nothing
      // to scan on to. Handing the model an exhausted row therefore buys a model
      // call whose only outcome is a settlement and a `null` return, while
      // runnable work sits behind it — and enough of those burn a board's
      // `maxIterations` before it dispatches anything real.
      //
      // So the two concerns are separated rather than merged. The model chooses
      // only among rows a worker could actually run, and exhausted rows are
      // settled directly, with no model call, once nothing runnable is left.
      //
      // **Do not "simplify" this by filtering exhausted rows out and stopping
      // there.** `claim()` is the only thing in the substrate that settles one
      // (`applyAbandonmentSettlement` has no other caller), so a dispatcher that
      // filters them and never claims them leaves rows that `isClaimable`
      // forever admits: the board's wake probe keeps reporting work, this
      // dispatcher keeps returning `null`, and the board never drains. That is
      // also why the wake probe itself does not filter — see
      // `task-board/blocks/select-next-ready-task.ts`.
      const runnable: typeof admitted = [];
      const exhausted: typeof admitted = [];
      for (const task of admitted) {
        if (claimDisposition(task, now, DEFAULT_MAX_ABANDONMENTS) === "claim") {
          runnable.push(task);
        } else {
          exhausted.push(task);
        }
      }

      if (runnable.length === 0) {
        if (exhausted.length === 0) return null;
        // Housekeeping, not dispatch: claiming settles the row and returns
        // `null`. Real work is always preferred, so this only runs once there
        // is none.
        return collection.claim(workerId, {
          eligibility: (task) => task.id === exhausted[0].id,
        });
      }

      const pickedId = await options.classify(runnable, ctx, collection);
      if (pickedId === null) return null;

      return collection.claim(workerId, {
        eligibility: (task) => task.id === pickedId,
      });
    },
  };
}
