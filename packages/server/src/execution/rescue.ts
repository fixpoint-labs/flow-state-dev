/**
 * Rescue resolution utilities used by sequencer/runtime error recovery.
 */
import type { BlockDefinition, RescueHandlerSpec } from "@flow-state-dev/core/types";

/**
 * Returns true when a rescue handler is eligible for the provided error.
 */
export function isErrorTypeMatch(
  error: Error,
  handler: RescueHandlerSpec
): boolean {
  if (handler.when === undefined || handler.when.length === 0) {
    return true;
  }

  return handler.when.some((ErrorType) => error instanceof ErrorType);
}

/**
 * Resolves the first matching rescue block for an error, preserving handler order.
 */
export function resolveRescueHandler(
  error: Error,
  handlers: RescueHandlerSpec[]
): BlockDefinition<any, any> | undefined {
  for (const handler of handlers) {
    if (isErrorTypeMatch(error, handler)) {
      return handler.block;
    }
  }

  return undefined;
}
