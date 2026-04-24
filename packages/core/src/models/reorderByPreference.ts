// reorderByPreference.ts
// Pure reorder pass that applies a provider-preference axis to an ordered
// model list. Keeps the preset's candidate pool intact and only changes
// the order: preferred buckets first (in the order given), rest after.
// Isolated here so it can be unit-tested without provider infrastructure.

import type { ProviderPreference } from "./types";

/**
 * Minimal shape the reorder pass cares about. Works for both
 * `FallbackModelEntry` and plain `{ modelId, providerName }` tuples used by
 * introspection.
 */
export interface ProviderTagged {
  providerName: string;
}

/**
 * Normalize a `ProviderPreference` to a deduplicated array of provider names.
 * Returns `null` when preference is absent or empty — callers should treat
 * `null` as "no reorder".
 */
export function normalizePreference(
  prefer: ProviderPreference | undefined | null
): string[] | null {
  if (prefer === undefined || prefer === null) return null;
  const list = Array.isArray(prefer) ? prefer : [prefer];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of list) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out.length === 0 ? null : out;
}

/**
 * Stable reorder: bucket items by `prefer[i]` provider match, then the rest
 * (in original order). Relative order within each bucket is preserved.
 *
 * - `prefer` absent / empty → returns `items` unchanged (by identity).
 * - Unknown provider names in `prefer` silently produce empty buckets.
 * - Duplicates in `prefer` are deduplicated (first occurrence wins).
 */
export function reorderByPreference<T extends ProviderTagged>(
  items: readonly T[],
  prefer: ProviderPreference | undefined | null
): T[] {
  const preference = normalizePreference(prefer);
  if (preference === null) return items.slice();

  const buckets = new Map<string, T[]>();
  for (const name of preference) buckets.set(name, []);
  const rest: T[] = [];

  for (const item of items) {
    const bucket = buckets.get(item.providerName);
    if (bucket) bucket.push(item);
    else rest.push(item);
  }

  const out: T[] = [];
  for (const name of preference) {
    const bucket = buckets.get(name);
    if (bucket) out.push(...bucket);
  }
  out.push(...rest);
  return out;
}

/**
 * Returns true when any item in `items` has a providerName matching an entry
 * in `prefer`. Used by strict-mode checks to decide whether the preference
 * could be honored at all.
 */
export function hasPreferredProvider<T extends ProviderTagged>(
  items: readonly T[],
  prefer: ProviderPreference | undefined | null
): boolean {
  const preference = normalizePreference(prefer);
  if (preference === null) return true;
  const wanted = new Set(preference);
  for (const item of items) {
    if (wanted.has(item.providerName)) return true;
  }
  return false;
}
