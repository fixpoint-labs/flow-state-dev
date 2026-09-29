/**
 * The ledger resolver a built task board uses, keyed by its handle.
 *
 * `taskToolActions(board)` needs to reach the same rows the board's drain and
 * capability reach, and `TaskBoardHandle` deliberately carries no resolver of
 * its own. Recording it here, off the handle's public type, lets that one
 * consumer find it without widening the handle for everybody.
 *
 * A module of its own so `skills/task-tools-capability.ts` can read it without
 * importing the task-board barrel (which would close an import cycle).
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import type { TaskCollectionRef } from "../tasks";

type BoardResolver = (ctx: BlockContext) => Promise<TaskCollectionRef<any, any>>;

const resolvers = new WeakMap<object, BoardResolver>();

/** Record the resolver `taskBoard()` built for the handle it returns. */
export function recordBoardResolver(handle: object, resolve: BoardResolver): void {
  resolvers.set(handle, resolve);
}

/** The resolver recorded for a handle, or `undefined` for one `taskBoard()` did not build. */
export function boardResolverOf(handle: object): BoardResolver | undefined {
  return resolvers.get(handle);
}
