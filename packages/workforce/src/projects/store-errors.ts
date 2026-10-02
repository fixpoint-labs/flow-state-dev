/**
 * Reading the engine's store refusals without depending on the engine.
 */

/**
 * Whether `error` is a `create` that found its key already held. Read by its
 * code rather than its class, because this package does not depend on the
 * engine.
 */
export function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "resource_already_exists" ||
      (error as { name?: unknown }).name === "ResourceAlreadyExistsError")
  );
}
