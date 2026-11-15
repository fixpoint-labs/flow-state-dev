/**
 * `ctx.emit.data` / `ctx._emitDataAwaited`: the `data` item, the one item
 * kind for structured content (records code reads back, and generative UI a
 * client draws through a renderer).
 *
 * What these pin, and why each matters:
 *  - the item carries `dataType` + `value` (not `data`, which would read
 *    `item.data.data`);
 *  - a keyed item upserts, so a snapshot record
 *    (`task-change`) holds one entry per key, latest value;
 *  - it is persisted by default — a record that vanished on reload would not
 *    be a record;
 *  - by default it reaches a client (whose renderer registry decides whether
 *    it is drawn) and never model history; `itemVisibility` overrides both;
 *  - the awaited emitter rejects when the emission fails, which is the whole
 *    reason a routing decision or a failure report uses it.
 */
import { defineFlow, handler, DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { DataItem } from "@flow-state-dev/core/items";
import type { RuntimeItem } from "@flow-state-dev/core/internal";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import { createExecutionContext, runAction } from "../src";
import { createInMemoryStores, createResponseEmitter } from "../src/host";
import { snapshotItemsOf } from "../src/routes/route-utils";
import { itemToLLMMessages } from "../src/context/history";

async function run(execute: (ctx: Parameters<Parameters<typeof handler>[0]["execute"]>[1]) => Promise<void> | void) {
  const stores = createInMemoryStores();
  const flow = defineFlow({
    kind: "emit-data",
    actions: {
      run: handler({
        name: "emit-data-block",
        inputSchema: z.object({}),
        outputSchema: z.null(),
        execute: async (_input, ctx) => {
          await execute(ctx);
          return null;
        }
      })
    }
  })();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: {},
    userId: "u",
    sessionId: "s",
    stores,
    runtimeConfig: {}
  });
  const requestId = result.items[0]?.requestId ?? "";
  const stored = ((await stores.request.get(requestId))?.items ?? []) as RuntimeItem[];
  return { result, stored };
}

const dataItems = (items: readonly RuntimeItem[]) => items.filter((item): item is DataItem & RuntimeItem => item.type === "data");

describe("ctx.emit.data", () => {
  it("emits a persisted data item carrying dataType and value", async () => {
    const { result, stored } = await run((ctx) => {
      ctx.emit.data("routing", { to: "billing" });
    });
    expect(result.error).toBeUndefined();
    const [item] = dataItems(stored);
    expect(item).toMatchObject({ type: "data", dataType: "routing", value: { to: "billing" }, status: "completed" });
    expect(item!.transient).toBeUndefined();
    expect(dataItems(stored)).toHaveLength(1);
  });

  it("upserts on a key: one entry per key, the latest value replacing (not merging) the first", async () => {
    const { stored } = await run((ctx) => {
      ctx.emit.data("task-change", { a: 1, b: 2 }, { key: "k" });
      ctx.emit.data("task-change", { a: 99 }, { key: "k" });
      ctx.emit.data("task-change", { a: 3 }, { key: "other" });
    });
    const items = dataItems(stored);
    expect(items).toHaveLength(2);
    const keyed = items.find((i) => i.key === "k");
    expect(keyed?.id).toBe("item_data_keyed:k");
    expect(keyed?.value).toEqual({ a: 99 });
  });

  it("keeps two un-keyed records apart", async () => {
    const { stored } = await run((ctx) => {
      ctx.emit.data("turn", { n: 1 });
      ctx.emit.data("turn", { n: 2 });
    });
    expect(dataItems(stored).map((i) => i.value)).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("is stream-only when asked: `transient: true` keeps it out of the stored record", async () => {
    const { result, stored } = await run((ctx) => {
      ctx.emit.data("progress", { at: 1 }, { transient: true });
    });
    expect(dataItems(result.items as RuntimeItem[])).toHaveLength(1);
    expect(dataItems(stored)).toHaveLength(0);
  });

  it("reaches a client snapshot by default, and not when it opts out", async () => {
    const { stored } = await run((ctx) => {
      ctx.emit.data("shown", { ok: true });
      ctx.emit.data("private", { secret: true }, { itemVisibility: { client: false, history: false } });
    });
    const snapshot = snapshotItemsOf(stored) as RuntimeItem[];
    expect(dataItems(snapshot).map((i) => i.dataType)).toEqual(["shown"]);
    // An explicit type filter is a reader asking for records by type, and sees both.
    expect(dataItems(snapshotItemsOf(stored, new Set(["data"])) as RuntimeItem[])).toHaveLength(2);
  });

  it("reaches model history only when its itemVisibility says so", async () => {
    const { stored } = await run((ctx) => {
      ctx.emit.data("hidden", { n: 1 });
      ctx.emit.data("remembered", { n: 2 }, { itemVisibility: { client: false, history: true } });
    });
    const [hidden, remembered] = dataItems(stored);
    expect(itemToLLMMessages(hidden!, stored)).toEqual([]);
    expect(itemToLLMMessages(remembered!, stored)).toEqual([{ role: "assistant", content: '[remembered] {"n":2}' }]);
  });
});

describe("ctx._emitDataAwaited", () => {
  it("resolves once the record is emitted", async () => {
    const { result, stored } = await run(async (ctx) => {
      await ctx._emitDataAwaited!("route", { to: "a" }, { key: "r" });
    });
    expect(result.error).toBeUndefined();
    expect(dataItems(stored)).toMatchObject([{ dataType: "route", value: { to: "a" }, key: "r" }]);
  });

  it("rejects when the emission fails, instead of swallowing it", async () => {
    const flow = defineFlow({
      kind: "emit-data-reject",
      actions: { run: { inputSchema: z.object({}), block: handler({ name: "b", inputSchema: z.object({}), outputSchema: z.null(), execute: () => null }) } }
    })();
    const response = createResponseEmitter({ requestId: "req_reject", now: () => 1 });
    const ctx = await createExecutionContext({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "run",
      requestId: "req_reject",
      sessionId: "s",
      userId: "u",
      stores: createInMemoryStores(),
      response
    });
    response.emitItemAdded = async () => {
      throw new Error("store unavailable");
    };
    await expect(ctx._emitDataAwaited!("route", { to: "a" })).rejects.toThrow("store unavailable");
  });
});
