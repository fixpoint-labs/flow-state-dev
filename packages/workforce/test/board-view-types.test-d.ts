// FIX-2623.
/**
 * Compile-time half of the board's task-list view: a screen that watches it
 * gets the rows typed by the view, never `any` or `unknown` (the spec's "a
 * view's answer is never unknown on the client").
 *
 * The view's block is a sequencer, which core types as `BlockDefinition<any,
 * any>`, so without care its answer would be `any` and every field would
 * pass. The `@ts-expect-error` below is the negative control: widen the row to
 * `any` and the suppression has nothing to suppress (TS2578), so `pnpm
 * typecheck` goes red; make it `unknown` and the field reads fail instead.
 */
import type { ViewValueOf } from "@flow-state-dev/client";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";

const board = taskListViewRef("coordinator", "tasks");
type Tasks = ViewValueOf<typeof board>;
declare const tasks: Tasks;

const first = tasks[0]!;
const id: string = first.id;
const status: string = first.status;
const attempts: number = first.attempts;
// @ts-expect-error a listed row carries no output: read one task whole with getTask.
first.output;

export { id, status, attempts };
