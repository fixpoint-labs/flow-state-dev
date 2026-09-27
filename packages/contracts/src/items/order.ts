/**
 * The one order items are shown in, on the server and the client alike.
 *
 * A session's items come from many requests, and two requests' items can share
 * a time and a request-local index. The server sorts a session snapshot with
 * this comparator and a client that merges streamed items sorts with it too,
 * so a live view and a reload show the same order.
 */
import type { OutputItem } from "./types";

/**
 * Compare two items for display order: `ts`, then `itemIndex`, then
 * `requestId`, then `id`. Total, so no two distinct items compare equal and
 * the order never depends on arrival or on how a store lists requests.
 * Strings compare by code unit, not locale, so every runtime agrees.
 */
export function compareItemOrder(a: OutputItem, b: OutputItem): number {
  if (a.ts !== b.ts) return a.ts - b.ts;
  if (a.itemIndex !== b.itemIndex) return a.itemIndex - b.itemIndex;
  if (a.requestId !== b.requestId) return a.requestId < b.requestId ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}
