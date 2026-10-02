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

/** Whether `error` is a write that found its row deleted under it. */
export function isResourceDeleted(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "resource_deleted" ||
      (error as { name?: unknown }).name === "ResourceDeletedError")
  );
}

/** Whether `error` is a write or delete that lost a compare-and-swap race. */
export function isConcurrentModification(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    ((error as { code?: unknown }).code === "concurrent_modification" ||
      (error as { name?: unknown }).name === "ConcurrentModificationError")
  );
}
