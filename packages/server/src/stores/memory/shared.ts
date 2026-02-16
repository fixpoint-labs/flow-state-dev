export function cloneValue<TValue>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}

export function applyOffsetLimit<TValue>(
  values: TValue[],
  options: { offset?: number; limit?: number } | undefined
): TValue[] {
  const offset = Math.max(0, options?.offset ?? 0);
  const limit = options?.limit;
  const sliced = values.slice(offset);

  if (limit === undefined) {
    return sliced;
  }

  return sliced.slice(0, Math.max(0, limit));
}
