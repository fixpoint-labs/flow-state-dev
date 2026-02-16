import type { BlockDefinition, RescueHandlerSpec } from "@flow-state-dev/core/types";

export function isErrorTypeMatch(
  error: Error,
  handler: RescueHandlerSpec
): boolean {
  if (handler.when === undefined || handler.when.length === 0) {
    return true;
  }

  return handler.when.some((ErrorType) => error instanceof ErrorType);
}

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
