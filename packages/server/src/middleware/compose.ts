/**
 * Middleware composition: builds a chain from an array of middleware and a
 * terminal execution function. The chain runs outer-to-inner (first middleware
 * in the array wraps outermost).
 */
import type { BlockKind, Middleware, MiddlewareContext } from "@flow-state-dev/core/types";

/**
 * Compose an array of middleware into a single function that wraps `execute`.
 *
 * Middleware is filtered against the block identity, then chained so that each
 * middleware's `next()` calls the next middleware or the terminal `execute`.
 *
 * @param middlewares - Ordered array: global first, then flow, then block.
 * @param blockInfo  - Identity of the block being executed (for filter matching).
 * @returns A function that accepts a context and terminal executor, returns the output.
 */
export function composeMiddleware(
  middlewares: Middleware[],
  blockInfo: { name: string; kind: BlockKind }
): (
  context: MiddlewareContext,
  execute: () => Promise<unknown>
) => Promise<unknown> {
  const applicable = middlewares.filter(
    (m) => m.filter === undefined || m.filter(blockInfo)
  );

  return (context: MiddlewareContext, execute: () => Promise<unknown>) => {
    if (applicable.length === 0) {
      return execute();
    }

    let index = 0;

    const dispatch = (): Promise<unknown> => {
      if (index >= applicable.length) {
        return execute();
      }
      const mw = applicable[index++];
      return mw.execute(context, dispatch);
    };

    return dispatch();
  };
}

/**
 * Merge middleware arrays from multiple sources (global, flow, block) in
 * precedence order. Undefined/empty arrays are skipped.
 */
export function mergeMiddlewareStacks(
  ...stacks: (Middleware[] | undefined)[]
): Middleware[] {
  const result: Middleware[] = [];
  for (const stack of stacks) {
    if (stack !== undefined && stack.length > 0) {
      result.push(...stack);
    }
  }
  return result;
}
