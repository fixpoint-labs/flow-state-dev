/**
 * Deterministic JSON serialization with sorted object keys at every nesting level.
 *
 * Matches `JSON.stringify` value semantics (undefined object fields omitted, array
 * holes become `null`, etc.) while making plain-object key order irrelevant.
 */
export function stableStringify(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(val as Record<string, unknown>).sort()) {
        sorted[k] = (val as Record<string, unknown>)[k];
      }
      return sorted;
    }
    return val;
  });
}
