/**
 * Per-item TTL helpers for lazy eviction of expired items.
 * Items with a `ttl` field are eligible for eviction after `ts + ttl` milliseconds.
 * Eviction is lazy — expired items are stripped on read, not via a background process.
 */
import type { OutputItem, OutputItemBase } from "@flow-state-dev/core/items";

/** Minimal shape needed for TTL checks — works with both OutputItem and SessionItem. */
type TTLCheckable = { ts?: number; ttl?: number };

/**
 * Returns true if the item has a TTL and that TTL has expired.
 * Items without a `ttl` field or without a `ts` are never considered expired.
 */
export function isItemExpired(item: TTLCheckable, now?: number): boolean {
  if (item.ttl === undefined || item.ts === undefined) return false;
  return item.ts + item.ttl < (now ?? Date.now());
}

/**
 * Filters out items whose TTL has expired. Items without a `ttl` field
 * pass through unchanged.
 */
export function stripExpiredItems<T extends OutputItemBase>(items: T[], now?: number): T[] {
  const timestamp = now ?? Date.now();
  return items.filter(item => !isItemExpired(item, timestamp));
}

/**
 * Strips expired items from a request record's items array.
 * Returns the record unchanged if it has no items or none are expired.
 */
export function stripExpiredFromRecord<T extends { items?: OutputItem[] }>(record: T, now?: number): T {
  if (record.items === undefined) return record;
  const filtered = stripExpiredItems(record.items, now);
  if (filtered.length === record.items.length) return record;
  return { ...record, items: filtered };
}
