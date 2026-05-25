/**
 * Recursively merges `override` into `base`. Returns a new object.
 * - Scalar values in `override` replace `base` values.
 * - Nested plain objects are merged recursively.
 * - Arrays in `override` replace (not concat) arrays in `base`.
 * - `base` is not mutated.
 */
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>
): T {
  const result = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(override)) {
    const baseVal = result[key];
    const overVal = override[key];
    if (
      typeof overVal === "object" &&
      overVal !== null &&
      !Array.isArray(overVal) &&
      typeof baseVal === "object" &&
      baseVal !== null &&
      !Array.isArray(baseVal)
    ) {
      result[key] = deepMerge(
        baseVal as Record<string, unknown>,
        overVal as Record<string, unknown>
      );
    } else {
      result[key] = overVal;
    }
  }
  return result as T;
}
