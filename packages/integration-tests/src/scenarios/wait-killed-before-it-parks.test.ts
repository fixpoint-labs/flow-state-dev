/**
 * A wait whose process dies before it parks is continued by the next host.
 *
 * A turn starts its work (a send kept under `runOnce`) and then waits on a
 * gate, inside `RequestWaits.owingPark`. Its host dies right after the send is
 * recorded and before the gate is written: every store call hangs from then
 * on, as a dead process's would. A second host on the same stores marks the
 * request `interrupted` (the stale-request sweep), and the durability sweep
 * continues it because it owes its park. The replay finds the send already
 * made, parks on the gate, and a later answer finishes the same request.
 *
 * Why it matters: without the owe the request stays `interrupted` behind no
 * gate, nothing continues it, and the answer never reaches the user waiting.
 * The control drops the owe and shows exactly that.
 */
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, parkOnWait, requireRequestHost, sequencer, type FlowInstance } from "@flow-state-dev/core";
import type { WaitOutcome } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, type FlowState, type StoreAdapter, type StoreRegistry } from "@flow-state-dev/engine";

const USER = "u_waiter";
const SESSION = "s_owed_park";
const GATE_ID = "gate_owed_park";
const SEND_KEY = "owed-park-send";

type Script = { owe: boolean; sends: number };

function waitingFlow(script: Script): FlowInstance {
  const turn = handler({
    name: "send_and_wait",
    inputSchema: z.object({}).passthrough(),
    outputSchema: z.object({ answer: z.unknown() }),
    execute: async (_input, ctx) => {
      const sendThenWait = async () => {
        await ctx.runOnce!(SEND_KEY, async () => {
          script.sends += 1;
          return { sent: true };
        });
        return parkOnWait(ctx, {
          gateId: GATE_ID,
          binding: { board: "conversation", taskId: "task_owed_park" },
          deadline: Date.now() + 3_600_000
        });
      };
      const waits = ctx.requestHost?.waits;
      const outcome = script.owe && waits?.owingPark !== undefined ? await waits.owingPark(sendThenWait) : await sendThenWait();
      return { answer: outcome.answered ? outcome.answer : outcome };
    }
  });
  const touch = handler({
    name: "touch",
    inputSchema: z.object({ gateId: z.string(), outcome: z.any() }),
    outputSchema: z.any(),
    execute: async (input, ctx) =>
      requireRequestHost(ctx).resumeWait!({ gateId: input.gateId, outcome: input.outcome as WaitOutcome })
  });
  return defineFlow({
    kind: "owed-park",
    actions: {
      send: { block: sequencer({ name: "turn" }).step(turn), inputSchema: z.object({}).passthrough() },
      touch: { block: touch }
    }
  })({ id: "owed-park" });
}

/** Stores whose every call hangs once the send's record lands, as a dead process's do. */
function dyingAfterTheSend(stores: StoreAdapter) {
  let dead = false;
  const never = new Promise<never>(() => {});
  const wrap = <T extends object>(store: T): T =>
    new Proxy(store, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          if (dead) return never;
          const result = value.apply(target, args);
          if (!String(prop).match(/^(set|patch|append|upsert)/) || !JSON.stringify(args).includes(SEND_KEY)) return result;
          dead = true;
          return Promise.resolve(result).then(() => never);
        };
      }
    });
  let registry: Promise<Partial<StoreRegistry>> | undefined;
  const resolve = (slots: Parameters<StoreAdapter["resolve"]>[0]) =>
    (registry ??= stores.resolve(slots).then(
      (inner) =>
        Object.fromEntries(
          Object.entries(inner).map(([name, store]) => [name, store === undefined ? store : wrap(store as object)])
        ) as Partial<StoreRegistry>
    ));
  return { stores: { ...stores, resolve } as StoreAdapter, dead: () => dead };
}

const states: FlowState[] = [];

afterEach(async () => {
  // The dead host is never disposed: its store calls hang.
  for (const state of states.splice(0)) await state.dispose();
});

function host(stores: StoreAdapter, script: Script): FlowState {
  return createFlowState({
    flows: { "owed-park": waitingFlow(script) },
    stores: { default: { primary: stores } },
    durable: true,
    staleSweepIntervalMs: 100,
    staleSweepThresholdMs: 500
  } as never);
}

async function post(state: FlowState, action: string, input: unknown): Promise<void> {
  const router = await state.getRouter();
  const res = await router.POST(
    new Request(`http://localhost/api/flows/owed-park/actions/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: USER, sessionId: SESSION, input })
    }),
    { params: { path: ["owed-park", "actions", action] } }
  );
  expect(res.status).toBeLessThan(300);
}

async function until(check: () => Promise<boolean> | boolean, ms: number): Promise<boolean> {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

/** Start the turn on a host that dies after its send, then boot the next host on the same stores. */
async function sendThenDie(script: Script) {
  const shared = inMemoryStores();
  const dying = dyingAfterTheSend(shared);
  const first = host(dying.stores, script);
  void post(first, "send", {});
  expect(await until(dying.dead, 10_000)).toBe(true);

  const next = host(shared, script);
  states.push(next);
  await next.getRouter();
  const requests = (await shared.resolve(shared.capabilities)).request!;
  let requestId: string | undefined;
  await until(async () => {
    requestId = (await requests.list({ sessionId: SESSION }))[0]?.id;
    return requestId !== undefined;
  }, 5_000);
  const status = async () => (await requests.get(requestId!))?.status;
  return { next, requestId: requestId!, status };
}

describe("a wait killed before it parks", { timeout: 60_000 }, () => {
  it("is continued by the next host, parks on the send it already made, and is answered in the same request", async () => {
    const script: Script = { owe: true, sends: 0 };
    const { next, requestId, status } = await sendThenDie(script);

    expect(await until(async () => (await status()) === "suspended", 30_000)).toBe(true);
    await post(next, "touch", { gateId: GATE_ID, outcome: { answered: true, answer: "Bluebird" } });
    expect(await until(async () => (await status()) === "completed", 10_000)).toBe(true);

    const record = (await (await next.getRuntime()).stores.request.get(requestId))!;
    expect(record.id).toBe(requestId);
    expect(JSON.stringify(record.result?.output)).toContain("Bluebird");
    expect(script.sends).toBe(1);
  });

  it("CONTROL: without the owe it is left interrupted, and nothing continues it", async () => {
    const script: Script = { owe: false, sends: 0 };
    const { status } = await sendThenDie(script);

    expect(await until(async () => (await status()) === "interrupted", 10_000)).toBe(true);
    // Well past the stale threshold and several sweeps: still interrupted.
    await new Promise((r) => setTimeout(r, 3_000));
    expect(await status()).toBe("interrupted");
    expect(script.sends).toBe(1);
  });
});
