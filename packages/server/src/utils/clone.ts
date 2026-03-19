/**
 * Canonical deep-clone utility for the server package.
 * All server-side code should import cloneValue from here.
 */
export function cloneValue<TValue>(value: TValue): TValue {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value) as TValue;
  }

  return JSON.parse(JSON.stringify(value)) as TValue;
}
