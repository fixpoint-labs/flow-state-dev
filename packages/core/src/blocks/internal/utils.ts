import type { BlockDefinition } from "../../types/block";

export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return new Error(value);
  }

  return new Error("Unknown block execution error");
}

export function withTimeout<TValue>(
  promise: Promise<TValue>,
  timeoutMs: number | undefined,
  label: string
): Promise<TValue> {
  if (timeoutMs === undefined || timeoutMs <= 0) {
    return promise;
  }

  return new Promise<TValue>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timeout);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeout);
        reject(error);
      });
  });
}

/**
 * Returns the number of items already emitted on the given response object,
 * by duck-typing the `getItems()` method. Used by block code in this package
 * to assign sequential `itemIndex` values without importing server types.
 */
export function getEmitterItemCount(response: unknown): number {
  if (
    typeof response === "object" &&
    response !== null &&
    "getItems" in response &&
    typeof (response as { getItems?: unknown }).getItems === "function"
  ) {
    const items = (response as { getItems: () => unknown[] }).getItems();
    return Array.isArray(items) ? items.length : 0;
  }
  return 0;
}

export function isBlockDefinition(value: unknown): value is BlockDefinition<any, any> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.kind === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.config === "object" &&
    candidate.config !== null
  );
}
