/**
 * A collection lifecycle hook is told the storage cell its row was written in.
 *
 * A hook that mirrors rows somewhere else (a schedule index) has to identify
 * each row the way storage does, or two rows in two cells collapse onto one
 * mirror entry. The engine already derives the cell for every write; the hook
 * reads it from `ctx.cell` instead of deriving it again. Each case reads the
 * stored row back at the reported cell, so the check is "the hook's cell is
 * where the row actually is", not a restatement of the derivation.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type {
  CollectionHookContext,
  FlowInstance,
  InstanceOwnerPin,
  ResourceCollectionRef,
} from "@flow-state-dev/core/types";
import { createFlowRegistry, createInMemoryStores, runAction } from "../src";

function boot(options: { flowIsolation?: boolean } = {}) {
  const seen: CollectionHookContext[] = [];
  const notes = defineResourceCollection({
    pattern: "notes/*",
    scope: "user",
    ...(options.flowIsolation === undefined ? {} : { flowIsolation: options.flowIsolation }),
    stateSchema: z.object({ text: z.string() }),
    onInstanceCreated: (_key, _state, ctx) => {
      seen.push(ctx);
    },
  });
  const write = handler({
    name: "write",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    resources: { notes },
    execute: async (_input, ctx) => {
      await (ctx.resources.notes as unknown as ResourceCollectionRef).create("n1", { text: "hi" });
      return { ok: true };
    },
  });
  const kind = defineFlow({
    kind: "notes",
    cardinality: "collection",
    resources: { notes },
    actions: { write: { inputSchema: z.object({}), block: write } },
  });

  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const run = async (userId: string, orgId: string, pin?: InstanceOwnerPin) => {
    const flow = kind({ id: pin === undefined ? "notes.app" : `${orgId}.~${userId}.notes` }) as FlowInstance;
    registry.register(flow, pin === undefined ? undefined : { pin });
    const result = await runAction({
      flow,
      actionName: "write",
      input: {},
      userId,
      orgId,
      stores,
      runtimeConfig: {},
    });
    expect(result.error).toBeUndefined();
    const ctx = seen.at(-1)!;
    const stored = await stores.resourceState.get("user", ctx.cell, "notes/n1");
    return { ctx, stored };
  };
  return { run };
}

describe("CollectionHookContext.cell", () => {
  it("is the person's own cell for an unpinned flow", async () => {
    const { ctx, stored } = await boot().run("alice", "acme");
    expect(ctx.cell).toBe("alice");
    expect(ctx.scopeId).toBe("alice");
    expect(stored?.state).toEqual({ text: "hi" });
  });

  it("is the (org, person) cell for a hired seat, while scopeId stays the person", async () => {
    const { ctx, stored } = await boot().run("alice", "acme", { orgId: "acme", userId: "alice" });
    expect(ctx.cell).toBe("alice:~org:acme");
    expect(ctx.scopeId).toBe("alice");
    expect(stored?.state).toEqual({ text: "hi" });
  });

  it("is the escaped key when the person's id needs escaping", async () => {
    const { ctx, stored } = await boot().run("a:b", "acme");
    expect(ctx.cell).toBe("a\\:b");
    expect(stored?.state).toEqual({ text: "hi" });
  });

  it("is the flow-isolated cell for a flow-isolated collection", async () => {
    const { ctx, stored } = await boot({ flowIsolation: true }).run("alice", "acme");
    expect(ctx.cell).toBe("alice:notes.app");
    expect(stored?.state).toEqual({ text: "hi" });
  });
});

/**
 * Storage decides a key's cell by the longest declared prefix that owns it, not
 * by which handle wrote it. A broad shared collection writing a key that a
 * narrower isolated one owns stores the row in the isolated cell, so the hook
 * has to report that cell too — or a mirror files the row under the wrong
 * (cell, key) and can never find it again to remove.
 */
describe("CollectionHookContext.cell with overlapping collections", () => {
  it("is the cell the concrete key is stored in, not the writing collection's", async () => {
    const seen: Array<{ key: string; cell: string }> = [];
    const onInstanceCreated = (key: string, _state: unknown, ctx: CollectionHookContext) => {
      seen.push({ key, cell: ctx.cell });
    };
    const all = defineResourceCollection({
      pattern: "sched/**",
      scope: "user",
      stateSchema: z.object({ text: z.string() }),
      onInstanceCreated,
    });
    const priv = defineResourceCollection({
      pattern: "sched/private/*",
      scope: "user",
      flowIsolation: true,
      stateSchema: z.object({ text: z.string() }),
      onInstanceCreated,
    });
    const write = handler({
      name: "write",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      resources: { all, priv },
      execute: async (_input, ctx) => {
        const broad = ctx.resources.all as unknown as ResourceCollectionRef;
        await broad.create("private/x", { text: "hi" });
        await broad.create("public", { text: "hi" });
        return { ok: true };
      },
    });
    const flow = defineFlow({
      kind: "sched",
      resources: { all, priv },
      actions: { write: { inputSchema: z.object({}), block: write } },
    })() as FlowInstance;
    const stores = createInMemoryStores();
    const result = await runAction({
      flow,
      actionName: "write",
      input: {},
      userId: "alice",
      orgId: "acme",
      stores,
      runtimeConfig: {},
    });
    expect(result.error).toBeUndefined();

    expect(seen).toEqual([
      { key: "sched/private/x", cell: "alice:sched" },
      { key: "sched/public", cell: "alice" },
    ]);
    for (const { key, cell } of seen) {
      expect((await stores.resourceState.get("user", cell, key))?.state).toEqual({ text: "hi" });
    }
  });
});
