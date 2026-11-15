/**
 * The one read migration for `component` items a store kept from before
 * structured content became `data` items.
 *
 * A request record stored then can hold `{ type: "component", component,
 * data, key? }`. Nothing reads that shape any more, so the request store's
 * reads hand it back as `{ type: "data", dataType, value, key? }`: same id,
 * same status, same key. The same holds for the item an `item.added` or
 * `item.done` event carries, so a stream replayed or resumed from the event
 * log carries data items too. Applied once, where `createFlowState` resolves
 * the stores, so every reader above the store (session items, history,
 * snapshots, stream replay, the devtool) sees only data items. Nothing is
 * rewritten in the store.
 */
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RequestRecord, RequestStore, StoreRegistry } from "./types";

const MIGRATING = new WeakSet<object>();
const MIGRATING_READS = ["get", "list", "getEvents", "subscribeToEvents"] as const;
type MigratingRead = (typeof MIGRATING_READS)[number];

/** A stored `component` item as a `data` item; any other item unchanged. */
function migrateLegacyComponentItem(item: RuntimeItem): RuntimeItem {
  const raw = item as unknown as { type: string; component?: unknown; data?: unknown };
  if (raw.type !== "component") return item;
  const { component, data, ...rest } = raw;
  return {
    ...rest,
    type: "data",
    dataType: typeof component === "string" ? component : "",
    value: data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {},
  } as unknown as RuntimeItem;
}

/** An event carrying a stored `component` item, with that item as a `data` item. */
function migrateEvent(event: RequestStreamEvent): RequestStreamEvent {
  if (event.type !== "item.added" && event.type !== "item.done") return event;
  const item = migrateLegacyComponentItem(event.item as unknown as RuntimeItem);
  return item === (event.item as unknown) ? event : ({ ...event, item } as RequestStreamEvent);
}

async function* migrateEvents(events: AsyncIterableIterator<RequestStreamEvent>): AsyncIterableIterator<RequestStreamEvent> {
  for await (const event of events) yield migrateEvent(event);
}

function migrateRecord<R extends RequestRecord | undefined>(record: R): R {
  if (record?.items === undefined || !record.items.some((i) => (i as { type: string }).type === "component")) {
    return record;
  }
  return { ...record, items: record.items.map(migrateLegacyComponentItem) };
}

/**
 * The registry with a request store whose reads (`get`, `list`, `getEvents`,
 * `subscribeToEvents`) migrate stored component items. Every other method
 * reaches the store itself, and so does any other method assigned on the
 * wrapper. One of those reads assigned on the wrapper replaces the wrapper's
 * own: forwarded to the store, a replacement that calls the migrating method
 * it replaced would call itself.
 */
export function withLegacyComponentItems<T extends StoreRegistry>(stores: T): T {
  const store = stores.request;
  if (MIGRATING.has(store)) return stores;
  const own: Pick<RequestStore, MigratingRead> = {
    get: async (id) => migrateRecord(await store.get(id)),
    list: async (options) => (await store.list(options)).map((r) => migrateRecord(r)),
    getEvents: async (id, fromSequence) => (await store.getEvents(id, fromSequence)).map(migrateEvent),
    subscribeToEvents: (id, options) => migrateEvents(store.subscribeToEvents(id, options)),
  };
  const isOwn = (key: string | symbol): key is MigratingRead => (MIGRATING_READS as readonly (string | symbol)[]).includes(key);
  const wrapper = new Proxy(store, {
    get(target, key) {
      if (isOwn(key)) return own[key];
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set(target, key, value) {
      if (isOwn(key)) {
        own[key] = value as never;
        return true;
      }
      return Reflect.set(target, key, value, target);
    },
  });
  MIGRATING.add(wrapper);
  return { ...stores, request: wrapper };
}
