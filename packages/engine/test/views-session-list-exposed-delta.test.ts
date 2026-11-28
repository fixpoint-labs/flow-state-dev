// FIX-2754.
/**
 * A view's `sessions.list` shows each session's exposed state, so it must
 * hear an exposed field change while a turn still runs, and only that.
 *
 * Why it matters: a tool that sets a conversation's work project mid-turn
 * writes one state field, as a delta. A sidebar listing the conversations
 * must show the new project then, not when the turn ends. A busy turn writes
 * many internal fields the list doesn't show; those must not wake it, or the
 * list runs again per write.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_ORG_ID, defineFlow, defineView, handler } from "@flow-state-dev/core";
import { requestHostOf } from "@flow-state-dev/core/internal";
import { hearsNotice } from "@flow-state-dev/contracts/types/view-hearing";
import type { WireNotice } from "@flow-state-dev/contracts/types/push-delivery";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { runAction } from "../src";
import { createInMemoryBus, createInMemoryStores, type ChangeNotice } from "../src/host";
import { runView } from "../src/execution/runView";
import type { SessionRecord } from "../src/stores/types";

const ORG = DEFAULT_ORG_ID;

/** `store` with each write waiting out a macrotask first, as a networked store's round trip does. */
function slowWrites<S extends object>(store: S): S {
  const writes = new Set(["set", "patchField", "incField", "pushToArray", "deleteField"]);
  return new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key, target) as unknown;
      if (typeof value !== "function") return value;
      const method = (value as (...args: unknown[]) => unknown).bind(target);
      if (typeof key !== "string" || !writes.has(key)) return method;
      return async (...args: unknown[]) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return method(...args);
      };
    }
  });
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Two gates a turn waits on: before its one write, and after it. */
function gates() {
  let open!: () => void;
  let close!: () => void;
  return {
    beforeWrite: new Promise<void>((resolve) => (open = resolve)),
    afterWrite: new Promise<void>((resolve) => (close = resolve)),
    write: () => open(),
    end: () => close()
  };
}

function app(turn: ReturnType<typeof gates>): FlowInstance {
  return defineFlow({
    kind: "desk",
    session: {
      stateSchema: z.object({
        workerId: z.string().readonly().optional(),
        project: z.string().optional(),
        notes: z.string().optional(),
        count: z.number().optional(),
        tags: z.array(z.string()).optional()
      }),
      client: { expose: ["project", "count", "tags"] }
    },
    actions: {
      write: {
        block: handler({
          name: "write",
          inputSchema: z.object({ field: z.enum(["project", "notes"]), value: z.string() }),
          execute: async (input, ctx) => {
            await turn.beforeWrite;
            await ctx.session.patchState({ [input.field]: input.value } as never);
            await turn.afterWrite;
            return { ok: true };
          }
        })
      },
      // A busy turn: increments and pushes on exposed fields at once, among
      // many writes to an internal field, each moving the session's version.
      busy: {
        block: handler({
          name: "busy",
          inputSchema: z.object({}),
          execute: async (_input, ctx) => {
            await Promise.all([
              ...Array.from({ length: 10 }, () => ctx.session.incState({ count: 1 } as never)),
              ...Array.from({ length: 5 }, (_, at) => ctx.session.pushState("tags" as never, `t${at}` as never)),
              ...Array.from({ length: 30 }, (_, at) => ctx.session.patchState({ notes: `n${at}` } as never))
            ]);
            return { ok: true };
          }
        })
      }
    },
    views: {
      list: defineView({
        scope: "user",
        block: handler({
          name: "list",
          inputSchema: z.object({}),
          outputSchema: z.any().nullable().describe("answer"),
          execute: async (_input, ctx) => requestHostOf(ctx)!.sessions!.list({ flowKind: "desk" })
        })
      })
    }
  })() as unknown as FlowInstance;
}

/**
 * Runs a turn that writes `field` once, mid-turn, and answers what the list
 * heard of that write alone (not of the turn's start or end), and the list
 * read again while the turn still runs.
 */
async function midTurnWrite(field: "project" | "notes", value: string) {
  const turn = gates();
  const flow = app(turn);
  const bus = createInMemoryBus();
  const stores = { ...createInMemoryStores(), bus };
  await stores.session.set(
    "conv",
    { id: "conv", orgId: ORG, flowKind: "desk", flowId: "desk", userId: "alice", state: { workerId: "otto", project: "apollo", notes: "a" }, version: 0, createdAt: 1, updatedAt: 1, journal: [], lineageId: "lin_conv" } as SessionRecord,
    "any"
  );
  const list = () => runView({ flow, viewName: "list", input: {}, userId: "alice", orgId: ORG, stores });
  const before = await list();
  const running = runAction({ orgId: ORG, flow, actionName: "write" as never, input: { field, value } as never, userId: "alice", sessionId: "conv", stores, runtimeConfig: {} });
  // Wait for the turn to start, so its start is not counted as the write's.
  for (let at = 0; at < 200 && (await stores.request.list({ sessionId: "conv" })).length === 0; at += 1) await tick();
  await tick();
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const heard: ChangeNotice[] = [];
  bus.subscribe({ scope: "user", id: "alice", tenantId: "" }, (notice) => heard.push(notice));
  turn.write();
  for (let at = 0; at < 200 && (await stores.session.get("conv"))?.state?.[field] !== value; at += 1) await tick();
  await tick();
  await tick();
  // What the write alone woke: the turn's end, which publishes its status, is not counted.
  const woke = heard.filter((notice) => hearsNotice(before.hears, notice as WireNotice));
  const during = await list();
  turn.end();
  const result = await running;
  expect(result.error).toBeUndefined();
  return { woke, during };
}

describe("a view listing sessions hears an exposed field's delta mid-turn", () => {
  it("wakes when a turn changes an exposed field, and shows the new value before the turn ends", async () => {
    const { woke, during } = await midTurnWrite("project", "beta");
    expect(woke, "the list heard the exposed field's write, once").toHaveLength(1);
    expect((during.output as { sessions: Array<{ state: unknown }> }).sessions[0]!.state).toEqual({ workerId: "otto", project: "beta" });
  });

  it("lands every increment and push on an exposed field during a busy turn, on a store whose writes take time", async () => {
    // Why it matters: a write to an exposed field must stay atomic. Written
    // whole, at a version, it would conflict with each of the turn's own
    // internal writes, and on a store with real latency run out of retries.
    const flow = app(gates());
    const memory = createInMemoryStores();
    const stores = { ...memory, session: slowWrites(memory.session) };
    await stores.session.set(
      "conv",
      { id: "conv", orgId: ORG, flowKind: "desk", flowId: "desk", userId: "alice", state: { workerId: "otto", count: 0, tags: [] }, version: 0, createdAt: 1, updatedAt: 1, journal: [], lineageId: "lin_conv" } as SessionRecord,
      "any"
    );
    const result = await runAction({ orgId: ORG, flow, actionName: "busy" as never, input: {} as never, userId: "alice", sessionId: "conv", stores, runtimeConfig: {} });
    expect(result.error?.message).toBeUndefined();
    const stored = (await stores.session.get("conv"))!.state as { count: number; tags: string[] };
    expect(stored.count).toBe(10);
    expect([...stored.tags].sort()).toEqual(["t0", "t1", "t2", "t3", "t4"]);
  });

  it("stays quiet when a turn changes a field the client isn't shown", async () => {
    const { woke } = await midTurnWrite("notes", "b");
    expect(woke).toEqual([]);
  });
});
