/**
 * Build and query the per-mount chat subscription index.
 *
 * Chat events carry no flow kind in their payload, so the adapter cannot
 * resolve a single flow per request the way the MCP and Scheduled adapters
 * do (`host.registry.get(kind)` by URL param). Instead it walks every
 * registered flow once at mount via the `start()` hook and groups each
 * flow's `chat.on` bindings by event key. Dispatch then looks up the bucket
 * for the inbound event's `kind` in O(matched-entries).
 *
 * The index is a snapshot: built once, frozen for the adapter's lifetime.
 * Hot reload of subscriptions after mount is out of scope (FIX-667).
 */
import type { FlowInstance, ChatEventBinding } from "@flow-state-dev/core";

/** One flow's binding for one event key. */
export type ChatSubscriptionEntry = {
  flowKind: string;
  /** Key from the flow's `chat.on` map — the matched subscription's name. */
  eventKey: string;
  binding: ChatEventBinding;
};

/** Subscription index, pre-grouped by event key for cheap dispatch lookup. */
export type ChatSubscriptionIndex = {
  /** Entries grouped by `chat.on` key. Empty when no flow declared `chat.on`. */
  byEventKey: Map<string, ChatSubscriptionEntry[]>;
};

/**
 * Walk the registered flows and group their `chat.on` bindings by event key.
 * Flows without a `chat.on` map contribute nothing. Binding references are
 * preserved (not cloned) so the dispatch path evaluates the author's own
 * `when`/`input`/`sessionId` closures.
 */
export function buildChatSubscriptionIndex(
  flows: ReadonlyArray<FlowInstance>
): ChatSubscriptionIndex {
  const byEventKey = new Map<string, ChatSubscriptionEntry[]>();

  for (const flow of flows) {
    const on = flow.chat?.on;
    if (on === undefined) continue;

    for (const [eventKey, binding] of Object.entries(on)) {
      const entry: ChatSubscriptionEntry = {
        flowKind: flow.kind,
        eventKey,
        binding
      };
      const bucket = byEventKey.get(eventKey);
      if (bucket === undefined) {
        byEventKey.set(eventKey, [entry]);
      } else {
        bucket.push(entry);
      }
    }
  }

  return { byEventKey };
}

/**
 * True when at least one flow declares a non-empty `chat.on` map. Used by
 * the adapter's `start()` hook to fail fast when no declarative routing is
 * configured anywhere — routing is purely declarative (FIX-838), so an adapter
 * with no subscriptions can never dispatch.
 */
export function hasChatSubscriptions(index: ChatSubscriptionIndex): boolean {
  return index.byEventKey.size > 0;
}
