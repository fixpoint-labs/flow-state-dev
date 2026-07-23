/**
 * Middleware composition: builds a chain from an array of middleware and a
 * terminal execution function. The chain runs outer-to-inner (first middleware
 * in the array wraps outermost).
 */
import type { BlockKind } from "@flow-state-dev/core/types";
import type { Middleware, MiddlewareContext } from "./types";

/**
 * Compose an array of middleware into a single function that wraps `execute`.
 *
 * Middleware is filtered against the block identity, then chained so that each
 * middleware's `next()` calls the next middleware or the terminal `execute`.
 *
 * @param middlewares - The block-execution middleware stack, in outer-to-inner
 *   order. Fed from the single internal source (`RuntimeConfig.middleware`).
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

    const dispatch = (i: number): Promise<unknown> => {
      if (i >= applicable.length) {
        return execute();
      }
      const mw = applicable[i];
      let called = false;
      return mw.execute(context, () => {
        if (called) {
          throw new Error(
            `Middleware "${mw.name}" called next() multiple times`
          );
        }
        called = true;
        return dispatch(i + 1);
      });
    };

    return dispatch(0);
  };
}
