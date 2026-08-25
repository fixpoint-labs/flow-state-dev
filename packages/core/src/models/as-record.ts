/**
 * Narrow an unknown value to a plain object. Arrays, null, and primitives
 * return `undefined`. Shared by the AI SDK adapter and the caching
 * translator so they don't each keep a copy.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
