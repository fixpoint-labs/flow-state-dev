// FIX-2623.
/**
 * A board's task list as a session view: the rows the board's `listTasks`
 * action lists, keyed by task id.
 *
 * Its own module, apart from the task tools: a view is what a screen watches,
 * never a tool a turn is offered, and the task surface's checks read the
 * tools' files for what a turn may be offered.
 */
import { defineView, FlowError, handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { listTasksBlockFor, type TaskCollectionResolver } from "../task-tools-capability";
import { listedTaskSchema } from "../task-listing";

/** One board's task list as a session view: its rows, keyed by task id. See {@link taskToolViews}. */
function taskListView(collectionId: string, resolve: TaskCollectionResolver) {
  const listTasks = listTasksBlockFor(collectionId, resolve);
  const listedTasks = z.array(listedTaskSchema);
  const block = sequencer({ name: listTasks.name, inputSchema: listTasks.inputSchema, outputSchema: listedTasks })
    .step(listTasks)
    .step(handler, {
      name: `${listTasks.name}-rows`,
      outputSchema: listedTasks,
      // The list's refusal (no board this session can file on) is the view's, by its own name.
      execute: (listed) => {
        if (!listed.ok) throw new FlowError(`The task list can't be read here: ${listed.error}`, { code: listed.error, retryable: false });
        return listed.tasks;
      },
    });
  block.validate();
  // Core types a sequencer as `BlockDefinition<any, any>`; this one declares `listedTasks` as its output
  // schema (checked by `validate` above and on every exit), so the view is typed by it, never `any`.
  // FIX-2684
  const typed = block as unknown as BlockDefinition<typeof listTasks.inputSchema, typeof listedTasks>;
  return defineView({ scope: "session", block: typed, key: (task) => task.id, description: listTasks.description });
}

/** A board's task-list view, as {@link taskToolViews} builds it: for a client's `viewRef<TaskListView>`. */
export type TaskListView = ReturnType<typeof taskListView>;

/**
 * A durable ledger's task list as a flow `views` map: `listTasks_<suffix>`, a
 * session view answering the rows the `listTasks_<suffix>` action lists for
 * the same board, from the same list code, keyed by task id. Spread it into
 * `defineFlow`'s `views`; a screen watches it with `useView` through
 * `taskListViewRef` and names no topic. A session with no board to list
 * is refused by the list's own reason (`no_delegation_board`).
 *
 * `resolve` is the view's own resolver: it must reach the board the action's
 * does and write nothing on the way, since a view's context refuses every
 * write. A resolver that repairs or starts rows as it goes (a board's touch)
 * is the action's, not this one's.
 */
export function taskToolViews(collectionId: string, resolve: TaskCollectionResolver): Record<string, TaskListView> {
  const view = taskListView(collectionId, resolve);
  return { [view.block.name]: view };
}
