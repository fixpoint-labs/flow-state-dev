/**
 * The one read migration for stored `component` items.
 *
 * A request stored before structured content became `data` items can hold
 * `{ type: "component", component, data, key? }`. Nothing reads that shape
 * any more, so the request store `createFlowState` hands out reads it back
 * as `{ type: "data", dataType, value, key? }`. What these pin, and why:
 *  - the migrated item keeps its status and key, and a keyed item's id is the
 *    one a keyed data emit of that key gets, so a resumed request's next
 *    snapshot upserts onto the same entry instead of adding a second;
 *  - `get` and `list` both migrate, and a block reading session items sees
 *    a data item on every entry (`createFlowState` and a bare `runAction`, as
 *    `fsdev run` calls it), so no reader above the store needs a second branch;
 *  - the stored record is not rewritten (a read never writes).
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createFlowState, runAction } from "../src";
import { createInMemoryStores } from "../src/host";
import { inMemoryStores } from "../src/stores";
import type { StoreRegistry } from "../src/stores/types";
import { withChangeBus } from "../src/bus/publish-writes";

const legacy = {
  id: "item_component_keyed:plan",
  type: "component",
  status: "completed",
  key: "plan",
  component: "plan-view",
  data: { steps: ["one"] }
};

function readerFlow(seen: unknown[][]) {
  return defineFlow({
    kind: "legacy-component",
    actions: {
      run: handler({
        name: "reader",
        inputSchema: z.object({}),
        outputSchema: z.null(),
        execute: async (_input, ctx) => {
          seen.push(await ctx.session.items.all({ itemTypes: ["data"] }));
          return null;
        }
      })
    }
  })();
}

/** Run once on `stores`, then put a legacy component item on that request. */
async function seedLegacy(stores: StoreRegistry, seen: unknown[][]) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: readerFlow(seen),
    actionName: "run",
    input: {},
    userId: "u",
    sessionId: "s",
    stores,
    runtimeConfig: {}
  });
  const requestId = result.items[0]?.requestId ?? "";
  const record = (await stores.request.get(requestId))!;
  const stamped = { ...legacy, requestId, itemIndex: 99, ts: 0, provenance: { blockName: "b", blockInstanceId: "b#1", phase: "main" } };
  await stores.request.set(requestId, { ...record, items: [...(record.items ?? []), stamped as unknown as RuntimeItem] }, "any");
  return requestId;
}

const isPlan = (item: unknown): boolean => (item as { key?: unknown }).key === "plan";

const migrated = { id: "item_data_keyed:plan", type: "data", status: "completed", key: "plan", dataType: "plan-view", value: { steps: ["one"] } };

describe("legacy component items read back as data items", () => {
  it("get and list return the data item; the stored record is left as it was", async () => {
    const raw = createInMemoryStores();
    const requestId = await seedLegacy(raw, []);
    const stores = withChangeBus(raw);

    const got = (await stores.request.get(requestId))!.items!.find(isPlan) as Record<string, unknown>;
    expect(got).toMatchObject(migrated);
    expect(got).not.toHaveProperty("component");
    expect(got).not.toHaveProperty("data");

    const listed = (await stores.request.list()).flatMap((r) => r.items ?? []).find(isPlan);
    expect(listed).toMatchObject(migrated);

    const stored = (await raw.request.get(requestId))!.items!.find(isPlan);
    expect(stored).toMatchObject({ type: "component", component: "plan-view" });
  });

  it("a run on the stores createFlowState hands out migrates, so a block reading session items sees a data item", async () => {
    const seen: unknown[][] = [];
    const state = createFlowState({ flows: [readerFlow(seen)], stores: { default: { primary: inMemoryStores() } } });
    try {
      const { stores } = await state.getRuntime();
      await seedLegacy(stores, seen);
      await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: readerFlow(seen),
        actionName: "run",
        input: {},
        userId: "u",
        sessionId: "s",
        stores,
        runtimeConfig: {}
      });
      expect(seen.at(-1)).toEqual([expect.objectContaining({ type: "data", payload: expect.objectContaining(migrated) })]);
    } finally {
      await state.dispose();
    }
  });

  it("a bare runAction on raw stores, as `fsdev run` and `fsdev dev` with no config call it, migrates too", async () => {
    const seen: unknown[][] = [];
    const raw = createInMemoryStores();
    await seedLegacy(raw, seen);
    await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: readerFlow(seen),
      actionName: "run",
      input: {},
      userId: "u",
      sessionId: "s",
      stores: raw,
      runtimeConfig: {}
    });
    expect(seen.at(-1)).toEqual([expect.objectContaining({ type: "data", payload: expect.objectContaining(migrated) })]);
  });

  it("a keyed item takes the id a keyed data emit of its key gets, so a later snapshot replaces it", async () => {
    const flow = defineFlow({
      kind: "legacy-keyed",
      actions: {
        run: handler({
          name: "emitter",
          inputSchema: z.object({}),
          outputSchema: z.null(),
          execute: async (_input, ctx) => {
            ctx.emit.data("plan-view", { steps: ["two"] }, { key: "plan" });
            return null;
          }
        })
      }
    })();
    const raw = createInMemoryStores();
    const requestId = await seedLegacy(raw, []);
    const read = (await withChangeBus(raw).request.get(requestId))!.items!.find(isPlan);
    const result = await runAction({
      orgId: DEFAULT_ORG_ID, flow, actionName: "run", input: {}, userId: "u", sessionId: "s2",
      stores: raw, runtimeConfig: {}
    });
    const emitted = result.items.find((i) => (i as { type: string }).type === "data");
    expect(emitted?.id).toBe(read?.id);
  });
});

describe("a resumed legacy request that emits its key again", () => {
  it("reads back one entry for the key, holding the later snapshot", async () => {
    const raw = createInMemoryStores();
    const requestId = await seedLegacy(raw, []);
    const stores = withChangeBus(raw);
    // What a continuation persists: the record's items as read, with the new
    // snapshot merged on by id.
    const prior = (await stores.request.get(requestId))!.items!;
    const next = { ...prior.find(isPlan)!, value: { steps: ["two"] } } as unknown as RuntimeItem;
    stores.request.persistItems(requestId, [...prior.filter((i) => !isPlan(i)), next]);
    await stores.request.flushItems(requestId);

    const plans = (await stores.request.get(requestId))!.items!.filter(isPlan);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ id: "item_data_keyed:plan", value: { steps: ["two"] } });
  });
});

describe("a get assigned on the wrapped request store", () => {
  it("runs, migrated, and one that calls the get it replaced does not call itself", async () => {
    const raw = createInMemoryStores();
    const requestId = await seedLegacy(raw, []);
    const store = withChangeBus(raw).request;
    const get = store.get.bind(store);
    store.get = (async (id: string) => {
      const record = await get(id);
      return record === undefined ? record : { ...record, status: "failed" };
    }) as typeof store.get;
    const got = await store.get(requestId);
    expect(got?.status).toBe("failed");
    expect(got?.items?.find(isPlan)).toMatchObject(migrated);
    expect(raw.request.get).not.toBe(store.get);
  });
});

describe("legacy component items in a stored event log", () => {
  /** A request whose event log carries the legacy item, as one stored before data items did. */
  async function seedEvents() {
    const raw = createInMemoryStores();
    const requestId = "req_legacy";
    const item = { ...legacy, requestId, itemIndex: 0, ts: 0, provenance: { blockName: "b", blockInstanceId: "b#1", phase: "main" } };
    const base = { stream: "request" as const, requestId, ts: 0 };
    const events = [
      { ...base, type: "item.added", sequence_number: 1, item },
      { ...base, type: "item.done", sequence_number: 2, item },
      { ...base, type: "request.completed", status: "completed", sequence_number: 3 },
    ] as unknown as RequestStreamEvent[];
    raw.request.persistEvents(requestId, events);
    return { raw, requestId };
  }
  const itemsOf = (events: readonly RequestStreamEvent[]) =>
    events.flatMap((e) => (e.type === "item.added" || e.type === "item.done" ? [e.item as unknown as Record<string, unknown>] : [])).filter(isPlan);

  it("getEvents replays the item as a data item, as a resumed stream reads it", async () => {
    const { raw, requestId } = await seedEvents();
    const stores = withChangeBus(raw);
    const replayed = itemsOf(await stores.request.getEvents(requestId));
    expect(replayed).toHaveLength(2);
    for (const item of replayed) expect(item).toMatchObject(migrated);
    expect(itemsOf(await raw.request.getEvents(requestId))[0]).toMatchObject({ type: "component" });
  });

  it("subscribeToEvents catches up with the item as a data item", async () => {
    const { raw, requestId } = await seedEvents();
    const stores = withChangeBus(raw);
    const seen: RequestStreamEvent[] = [];
    for await (const event of stores.request.subscribeToEvents(requestId, { fromSequence: 0 })) seen.push(event);
    expect(itemsOf(seen)).toHaveLength(2);
    for (const item of itemsOf(seen)) expect(item).toMatchObject(migrated);
  });
});
