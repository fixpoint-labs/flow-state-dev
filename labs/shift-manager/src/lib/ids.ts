/**
 * Session ids Shift Manager names itself, for a session the Lab creates on
 * the first request sent into it.
 */

/**
 * A fresh session id, `<prefix><separator><32 hex digits>`, the separator
 * `-` unless given (`cos_…` passes `_`). Built from
 * `getRandomValues`, which a page served over plain HTTP has, unlike
 * `randomUUID`.
 */
export function newSessionId(prefix: string, separator = "-"): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return `${prefix}${separator}${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
