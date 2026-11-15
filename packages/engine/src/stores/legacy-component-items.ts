/**
 * The one read migration for `component` items a store kept from before
 * structured content became `data` items.
 *
 * A request record stored then can hold `{ type: "component", component,
 * data, key? }`. Nothing reads that shape any more, so the request store's
 * reads hand it back as `{ type: "data", dataType, value, key? }`: same id,
 * same status, same key. Applied once, where `createFlowState` resolves the
 * stores, so every reader above the store (session items, history, snapshots,
 * the devtool) sees only data items. Nothing is rewritten in the store.
 */
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import type { RequestRecord, RequestStore, StoreRegistry } from "./types";

const MIGRATING = new WeakSet<object>();

/** A stored `component` item as a `data` item; any other item unchanged. */
export function migrateLegacyComponentItem(item: RuntimeItem): RuntimeItem {
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

function migrateRecord<R extends RequestRecord | undefined>(record: R): R {
  if (record?.items === undefined || !record.items.some((i) => (i as { type: string }).type === "component")) {
    return record;
  }
  return { ...record, items: record.items.map(migrateLegacyComponentItem) };
}

/**
 * The registry with a request store whose `get` and `list` migrate stored
 * component items. Every other method reaches the store itself, and so does
 * any other method assigned on the wrapper. A `get` or `list` assigned on the
 * wrapper replaces the wrapper's own: forwarded to the store, a replacement
 * that calls the migrating method it replaced would call itself.
 */
export function withLegacyComponentItems<T extends StoreRegistry>(stores: T): T {
  const store = stores.request;
  if (MIGRATING.has(store)) return stores;
  const own: Pick<RequestStore, "get" | "list"> = {
    get: async (id) => migrateRecord(await store.get(id)),
    list: async (options) => (await store.list(options)).map((r) => migrateRecord(r)),
  };
  const wrapper = new Proxy(store, {
    get(target, key) {
      if (key === "get" || key === "list") return own[key];
      const value = Reflect.get(target, key, target) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
    set(target, key, value) {
      if (key === "get" || key === "list") {
        own[key] = value as never;
        return true;
      }
      return Reflect.set(target, key, value, target);
    },
  });
  MIGRATING.add(wrapper);
  return { ...stores, request: wrapper };
}
