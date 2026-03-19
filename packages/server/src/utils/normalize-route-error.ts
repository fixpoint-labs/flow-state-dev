/**
 * Lightweight error normalization for HTTP route handlers.
 * Unlike the full normalizeError in errors/normalize-error.ts (which produces
 * FlowError), this simply coerces unknown values to plain Error instances.
 */
export function normalizeRouteError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.length > 0) {
    return new Error(error);
  }

  return new Error("Unknown route error");
}
