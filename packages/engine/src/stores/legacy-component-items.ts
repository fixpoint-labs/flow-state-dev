/**
 * The one read migration for `component` items a store kept from before
 * structured content became `data` items.
 *
 * A request record stored then can hold `{ type: "component", component,
 * data, key? }`. Nothing reads that shape any more, so the request store's
 * reads hand it back as `{ type: "data", dataType, value, key? }`, with the
 * same status and key. A keyed item's id moves with it, from
 * `item_component_keyed:<key>` to `item_data_keyed:<key>`, so a request
 * resumed after the change reads back one entry for that key, holding its
 * latest snapshot, though the store keeps the legacy row beside the new one.
 * The same holds for the item an `item.added` or `item.done` event carries,
 * so a stream replayed or resumed from the event log carries data items too.
 * Nothing is rewritten in the store.
 *
 * Applied by the change-bus wrapper (`bus/publish-writes.ts`), the one
 * wrapper every entry that hands the engine a registry applies
 * (`resolveStores`, `runAction`, `fsdev run` and `chat`, BullMQ's job
 * processor), so every reader above the store sees only data items.
 */
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import type { RequestRecord, RequestStore } from "./types";
import { mergeItemsById } from "./shared";

const LEGACY_KEYED_ID = "item_component_keyed:";
const DATA_KEYED_ID = "item_data_keyed:";

/** A stored `component` item as a `data` item; any other item unchanged. */
function migrateLegacyComponentItem(item: RuntimeItem): RuntimeItem {
  const raw = item as unknown as { type: string; id?: unknown; component?: unknown; data?: unknown };
  if (raw.type !== "component") return item;
  const { component, data, ...rest } = raw;
  const id = typeof rest.id === "string" && rest.id.startsWith(LEGACY_KEYED_ID)
    ? DATA_KEYED_ID + rest.id.slice(LEGACY_KEYED_ID.length)
    : rest.id;
  return {
    ...rest,
    id,
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
  // A request resumed after the change wrote its next snapshot of a key
  // under the new id, next to the stored legacy row: the two are one entry,
  // in the first one's place, holding the later one's snapshot.
  return { ...record, items: mergeItemsById(record.items.map(migrateLegacyComponentItem), []) };
}

type AnyMethod = (...args: any[]) => any;

/**
 * The request store's reads that migrate (`get`, `list`, `getEvents`,
 * `subscribeToEvents`), each built over the store's own method as a wrapper
 * hands it in.
 */
export const legacyComponentItemReads: Record<string, (original: AnyMethod) => AnyMethod> = {
  get: (original: RequestStore["get"]) => async (id: string) => migrateRecord(await original(id)),
  list: (original: RequestStore["list"]) => async (options?: Parameters<RequestStore["list"]>[0]) =>
    (await original(options)).map((r) => migrateRecord(r)),
  getEvents: (original: RequestStore["getEvents"]) => async (id: string, fromSequence?: number) =>
    (await original(id, fromSequence)).map(migrateEvent),
  subscribeToEvents: (original: RequestStore["subscribeToEvents"]) =>
    (id: string, options: Parameters<RequestStore["subscribeToEvents"]>[1]) => migrateEvents(original(id, options)),
};
