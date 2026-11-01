/**
 * A stop that waits for a user (FIX-2129), engine half: how each ending reaches
 * the block (an answer, a deadline, a cancel, a stop), the answer route's
 * checks, and the cancel's fence.
 *
 * The board half (the row's mark, the cancel's debt, the claim gate's reads)
 * lives with orchestration's tests; the whole path, on a durable SQLite host,
 * is the goal check `goals/task-board/holds-a-task-waiting-on-a-person/`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer, SuspensionTimeoutError, transientSlot } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord, SuspendForUserOptions } from "@flow-state-dev/core/types";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createInMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { cancelUserSuspension } from "../src/durability/cancel-user-suspension";
import { redriveResolvedGate, stopsAtItsGate, stopSuspendedRequest } from "../src/durability/stop-suspended";
import { expireUnderLease } from "../src/durability/resume-under-lease";
import { handleAbortRequest } from "../src/routes/abort-routes";
import { handleAnswerSuspension } from "../src/routes/answer-routes";
import type { RuntimeConfig } from "../src/runtime-config";
import type { ExecutionResult } from "../src/execution/types";

const USER = "u1";
const SESSION = "s1";
const OWNER = { userId: USER, tenantId: undefined, orgId: DEFAULT_ORG_ID };

/**
 * A flow whose `ask` action does its work (a step that completes), then waits
 * for the user as its input says, and returns what came back. `twice` asks a
 * second time, in a later step, after the first comes back.
 */
function askingFlow(seen: string[]): FlowInstance {
  const work = handler({
    name: "work",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input) => {
      seen.push("work");
      return input;
    }
  });
  const ask = handler({
    name: "ask",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { options: SuspendForUserOptions; twice?: boolean; catchDeadline?: boolean }, ctx) => {
      try {
        const first = await ctx.suspendForUser(input.options as never);
        seen.push(`first:${JSON.stringify(first)}`);
        return input.twice === true ? { again: input.options } : first;
      } catch (error) {
        if (error instanceof SuspensionTimeoutError) {
          seen.push("deadline");
          if (input.catchDeadline === true) return { wentAhead: true };
        }
        throw error;
      }
    }
  });
  const again = handler({
    name: "again",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (input: { again?: SuspendForUserOptions }, ctx) => {
      if (input?.again === undefined) return input;
      const second = await ctx.suspendForUser(input.again as never);
      seen.push(`second:${JSON.stringify(second)}`);
      return second;
    }
  });
  return defineFlow({ kind: "asking", actions: { run: { block: sequencer({ name: "s" }).step(work).step(ask).step(again) } } })({
    id: "asking"
  });
}

function harness(flow: FlowInstance) {
  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider(stores);
  const registry = createFlowRegistry();
  registry.register(flow as never);
  const finished: Promise<ExecutionResult>[] = [];
  const runtimeConfig: RuntimeConfig = { durabilityProvider: provider, requestHost: {} };
  const cont = async (opts: Parameters<typeof continueRequest>[0]) => {
    const result = await continueRequest({ ...opts, stores, flowRegistry: registry, runtimeConfig });
    finished.push(result.finished);
    return result;
  };
  const deps = { provider, stores, continueRequest: cont };
  runtimeConfig.requestHost!.parkedStop = deps;
  const drain = async () => {
    for (let i = 0; i < finished.length; i += 1) await finished[i]!.catch(() => undefined);
  };
  return { stores, provider, registry, runtimeConfig, deps, finished, drain };
}

async function park(h: ReturnType<typeof harness>, flow: FlowInstance, input: unknown) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input,
    userId: USER,
    sessionId: SESSION,
    stores: h.stores,
    runtimeConfig: h.runtimeConfig
  });
  const requestId = result.requestId!;
  expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
  const [gate] = (await h.provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
  return { requestId, gate: gate! };
}

/** The answer route, as a screen calls it, as `principal` (the stop's user by default). */
function answerRoute(
  h: ReturnType<typeof harness>,
  requestId: string,
  body: Record<string, unknown>,
  options: { tenantId?: string; principal?: { userId: string; orgId: string } } = {}
) {
  return handleAnswerSuspension(
    new Request(`https://x/api/flows/asking/requests/${requestId}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    }),
    { kind: "answer_suspension", flowKind: "asking", requestId },
    {
      host: { continueRequest: (options: never) => h.deps.continueRequest(options) } as never,
      registry: h.registry,
      stores: h.stores,
      durabilityProvider: h.provider,
      ...(options.tenantId !== undefined ? { tenantId: options.tenantId } : {}),
      principal: (options.principal ?? { userId: USER, orgId: DEFAULT_ORG_ID }) as never
    }
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("suspendForUser: what the stop records", () => {
  it("records its kind beside the reason it maps to, and a deadline only when one is set (D3)", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const none = await park(h, flow, { options: { kind: "review", prompt: "Look at this." } });
    expect(none.gate).toMatchObject({ reason: "user_input", kind: "review", message: "Look at this.", allow: ["submit"] });
    expect(none.gate.expiresAt).toBeUndefined();

    const host = harness(flow);
    host.runtimeConfig.userDeadlineMs = 60_000;
    // The host's setting reaches the request through its request host.
    const set = await park(host, flow, { options: { kind: "approval", prompt: "Ship?" } });
    expect(set.gate).toMatchObject({ reason: "user_approval", kind: "approval" });
    expect(set.gate.expiresAt! - set.gate.createdAt).toBeGreaterThanOrEqual(59_000);

    // A caller that runs the action directly, with no request host wired, keeps the deadline it set.
    const direct = harness(flow);
    delete (direct.runtimeConfig as { requestHost?: unknown }).requestHost;
    direct.runtimeConfig.userDeadlineMs = 60_000;
    const bare = await park(direct, flow, { options: { kind: "input", prompt: "Which region?" } });
    expect(bare.gate.expiresAt! - bare.gate.createdAt).toBeGreaterThanOrEqual(59_000);
  });
});

describe("suspendForUser: a deadline", () => {
  it("an input's deadline throws SuspensionTimeoutError into the block, which may catch it; its work isn't run again", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "Which region?", deadline: 60_000 }, catchDeadline: true });

    expect(await expireUnderLease(h.provider, gate, "durability-sweeper")).toBe("expired");
    // The sweep's re-drive continues it: an input's expiry now resumes its block too.
    expect(await redriveResolvedGate(h.deps, (await h.provider.loadSuspension(requestId, gate.suspensionId))!)).toBe("redriven");
    await h.drain();

    expect(seen).toEqual(["work", "deadline"]);
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
  });

  it("an approval's deadline reads as a no marked with its deadline", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "approval", prompt: "Ship?", deadline: 60_000 } });
    await expireUnderLease(h.provider, gate, "durability-sweeper");
    await redriveResolvedGate(h.deps, (await h.provider.loadSuspension(requestId, gate.suspensionId))!);
    await h.drain();
    expect(seen).toEqual(["work", 'first:{"cancelled":false,"approved":false,"deadline":true}']);
  });
});

describe("suspendForUser: a cancel (the board's debt payment)", () => {
  it("a task's cancel resolves the stop cancelled and continues it: the block reads { cancelled: true }, and a later wait in the run is cancelled at once", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "Which region?" }, twice: true });

    expect(await cancelUserSuspension(h.deps, gate, OWNER, undefined, { taskCancelled: true })).toEqual({ ok: true });
    await h.drain();

    expect(seen).toEqual(["work", 'first:{"cancelled":true}', 'second:{"cancelled":true}']);
    const log = (await h.stores.request.get(requestId))?.items ?? [];
    expect(log.filter((item) => (item as { type?: string }).type === "suspension_resume")).toMatchObject([{ resolution: "cancelled" }]);
    // The second wait opened no stop of its own.
    expect((await h.provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId)).toEqual([]);
    // A second payment, and an answer after it, find it resolved.
    expect(await cancelUserSuspension(h.deps, gate, OWNER)).toMatchObject({ ok: false, refused: "already-resolved" });
  });

  it("cancelling one stop of a task that goes on leaves the run's next wait for a user to suspend as usual (FIX-2133's entry point)", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "Which region?" }, twice: true });

    expect(await cancelUserSuspension(h.deps, gate, OWNER)).toEqual({ ok: true });
    await h.drain();

    expect(seen).toEqual(["work", 'first:{"cancelled":true}']);
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
    const [second] = (await h.provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId);
    expect(second).toMatchObject({ kind: "input", status: "pending" });
    expect(second!.suspensionId).not.toBe(gate.suspensionId);
  });

  it("is refused as not found for another principal's stop, and for a stop that isn't a user's", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });
    expect(await cancelUserSuspension(h.deps, gate, { ...OWNER, userId: "u2" })).toMatchObject({ refused: "gate-not-found" });
    expect(await cancelUserSuspension(h.deps, gate, { ...OWNER, orgId: "org_other" })).toMatchObject({ refused: "gate-not-found" });
    expect(await cancelUserSuspension(h.deps, gate, { ...OWNER, tenantId: "t2" })).toMatchObject({ refused: "gate-not-found" });
    expect((await h.provider.loadSuspension(gate.requestId, gate.suspensionId))?.status).toBe("pending");
  });

  it("runs the cancel's write under the stop's fence: an answer that lands meanwhile is told the stop is resolved, and the block reads cancelled", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    let wrote!: () => void;
    const writing = new Promise<void>((resolve) => {
      wrote = resolve;
    });
    const cancel = cancelUserSuspension(h.deps, gate, OWNER, async () => {
      wrote();
      await held;
    });
    await writing;
    const answer = answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "eu-west" });
    // The answer waits on the held fence; the cancel then resolves the stop first.
    setTimeout(release, 100);
    expect(await cancel).toEqual({ ok: true });
    const answered = await answer;
    expect(answered.status).toBe(409);
    expect(await answered.json()).toMatchObject({ refused: "already-resolved" });
    await h.drain();
    expect(seen).toEqual(["work", 'first:{"cancelled":true}']);
  });

  it("a fence write that throws resolves nothing", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });
    await expect(cancelUserSuspension(h.deps, gate, OWNER, async () => Promise.reject(new Error("store down")))).rejects.toThrow("store down");
    expect((await h.provider.loadSuspension(gate.requestId, gate.suspensionId))?.status).toBe("pending");
  });

  it("continues a stop already recorded cancelled whose run never resumed (a crash after the write)", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });
    await h.provider.suspend({ ...gate, status: "cancelled", resolvedAt: Date.now(), resolvedBy: "cancel" });
    expect(await cancelUserSuspension(h.deps, gate, OWNER)).toEqual({ ok: true });
    await h.drain();
    expect(seen).toEqual(["work", 'first:{"cancelled":true}']);
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
  });
});

/**
 * The state a host leaves when it dies after a continuation logged the stop's
 * resolution (`suspension_resume`) and before the run acted on it: the stop
 * resolved, the request interrupted with the resolution on its log.
 */
async function crashAfterAudit(
  h: ReturnType<typeof harness>,
  requestId: string,
  gate: SuspensionRecord,
  ending: { status: SuspensionRecord["status"]; resolution: string; resolvedBy: string; resumeData?: unknown }
) {
  const resolvedAt = Date.now();
  await h.provider.suspend({
    ...gate,
    status: ending.status,
    resolvedAt,
    resolvedBy: ending.resolvedBy,
    ...(ending.resumeData !== undefined ? { resumeData: ending.resumeData } : {})
  });
  const record = (await h.stores.request.get(requestId))!;
  const items = record.items ?? [];
  const next = Math.max(...items.map((item) => (item as { itemIndex?: number }).itemIndex ?? 0)) + 1;
  const audit = {
    id: `item_suspension_resume_crash_${next}`,
    type: "suspension_resume",
    status: "completed",
    suspensionId: gate.suspensionId,
    resolution: ending.resolution,
    resolvedBy: ending.resolvedBy,
    ...(ending.resumeData !== undefined ? { resumeData: ending.resumeData } : {}),
    resolvedAt,
    requestId,
    itemIndex: next
  };
  await h.stores.request.set(
    requestId,
    { ...record, status: "interrupted", result: undefined, items: [...items, audit as never] },
    "any"
  );
}

describe("suspendForUser: a crash after the stop's resolution was logged replays it as that ending, never as an answer", () => {
  const routes = {
    // The sweep's re-drive of a resolved stop.
    sweep: async (h: ReturnType<typeof harness>, requestId: string, gate: SuspensionRecord) =>
      redriveResolvedGate(h.deps, (await h.provider.loadSuspension(requestId, gate.suspensionId))!),
    // A crash's plain continuation, which names no resolution of its own.
    continue: async (h: ReturnType<typeof harness>, requestId: string) => h.deps.continueRequest({ requestId } as never)
  };
  const endings = [
    {
      ending: "a stop",
      options: { kind: "approval", prompt: "Ship?" },
      twice: false,
      crash: { status: "stopped", resolution: "stopped", resolvedBy: "stop" },
      ends: "aborted",
      seen: ["work"]
    },
    {
      ending: "a cancel of the task, whose later waits cancel at once",
      options: { kind: "input", prompt: "Which region?" },
      twice: true,
      crash: { status: "cancelled", resolution: "cancelled", resolvedBy: "cancel", resumeData: { taskCancelled: true } },
      ends: "completed",
      seen: ["work", 'first:{"cancelled":true}', 'second:{"cancelled":true}']
    },
    {
      ending: "an approval's deadline",
      options: { kind: "approval", prompt: "Ship?" },
      twice: false,
      crash: { status: "expired", resolution: "expired", resolvedBy: "durability-sweeper" },
      ends: "completed",
      seen: ["work", 'first:{"cancelled":false,"approved":false,"deadline":true}']
    }
  ];

  for (const route of ["sweep", "continue"] as const) {
    it.each(endings)(`replays $ending as itself (${route})`, async ({ options, twice, crash, ends, seen: expected }) => {
      const seen: string[] = [];
      const flow = askingFlow(seen);
      const h = harness(flow);
      const { requestId, gate } = await park(h, flow, { options, twice });
      await crashAfterAudit(h, requestId, gate, crash as never);

      await routes[route](h, requestId, gate);
      await h.drain();

      expect(seen).toEqual(expected);
      expect((await h.stores.request.get(requestId))?.status).toBe(ends);
      expect((await h.provider.listSuspended({ status: "pending" })).filter((s) => s.requestId === requestId)).toEqual([]);
    });
  }
});

describe("suspendForUser in a nested sequencer", () => {
  it("restores the nested sequencer's own state on the answer, so its later steps read what earlier ones wrote", async () => {
    const seen: string[] = [];
    const mark = handler({
      name: "mark",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        await ctx.sequencer!.patchState({ mark: "written before the wait" });
        return input;
      }
    });
    const ask = handler({
      name: "ask",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => ctx.suspendForUser({ kind: "input", prompt: "?" } as never)
    });
    const read = handler({
      name: "read",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input, ctx) => {
        seen.push(String((ctx.sequencer!.state as { mark: string | null }).mark));
        return input;
      }
    });
    const inner = sequencer({ name: "inner", stateSchema: z.object({ mark: z.string().nullable().default(null) }) })
      .step(mark)
      .step(ask)
      .step(read);
    const flow = defineFlow({ kind: "asking", actions: { run: { block: sequencer({ name: "s" }).step(inner) } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});

    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual(["written before the wait"]);
  });
});

describe("suspendForUser after a state write in the same step", () => {
  // A step that records what it asks about and then waits for the user must
  // find that record when the run comes back. The resume runs the waiting
  // step's code again from the saved state, and what the step recorded from
  // is often gone by then (an in-memory map a restart empties), so the
  // state is the only place the record lives.
  function recordThenWait(inbox: string[], seen: string[]): FlowInstance {
    const recordAndWait = handler({
      name: "record-and-wait",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        const fresh = inbox.shift();
        if (fresh !== undefined) await ctx.sequencer!.patchState({ asking: fresh });
        const asking = (ctx.sequencer!.state as { asking: string | null }).asking;
        seen.push(`asking: ${String(asking)}`);
        if (asking === null) return { asked: null };
        const answer = await ctx.suspendForUser({ kind: "input", prompt: `About ${asking}?` } as never);
        return { asked: asking, answer };
      }
    });
    const read = handler({
      name: "read",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (input: { asked: string | null; answer?: unknown }, ctx) => {
        seen.push(`after: ${JSON.stringify(input)} with ${String((ctx.sequencer!.state as { asking: string | null }).asking)}`);
        return input;
      }
    });
    const block = sequencer({ name: "s", stateSchema: z.object({ asking: z.string().nullable().default(null) }) })
      .step(recordAndWait)
      .step(read);
    return defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
  }

  it("keeps the write through a restart: the resumed step asks about what it recorded and takes the answer", async () => {
    const seen: string[] = [];
    const first = recordThenWait(["deploy"], seen);
    const before = harness(first);
    const { requestId, gate } = await park(before, first, {});

    // A restart: a new engine (flow instance, registry, provider) over the
    // same durable stores. The new process starts with an empty map.
    const after = harness(recordThenWait([], seen));
    const provider = createCheckpointDurabilityProvider(before.stores);
    after.runtimeConfig.durabilityProvider = provider;
    const answered = await handleAnswerSuspension(
      new Request(`https://x/api/flows/asking/requests/${requestId}/answer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate.suspensionId, action: "submit", data: "yes" })
      }),
      { kind: "answer_suspension", flowKind: "asking", requestId },
      {
        host: {
          continueRequest: async (options: Parameters<typeof continueRequest>[0]) => {
            const result = await continueRequest({
              ...options,
              stores: before.stores,
              flowRegistry: after.registry,
              runtimeConfig: after.runtimeConfig
            });
            after.finished.push(result.finished);
            return result;
          }
        } as never,
        registry: after.registry,
        stores: before.stores,
        durabilityProvider: provider,
        principal: { userId: USER, orgId: DEFAULT_ORG_ID } as never
      }
    );
    expect(answered.status).toBe(202);
    await after.drain();

    expect((await before.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual([
      "asking: deploy",
      "asking: deploy",
      'after: {"asked":"deploy","answer":{"cancelled":false,"answer":"yes"}} with deploy'
    ]);
  });
});

describe("a state write before the wait applies once", () => {
  // The resume runs the waiting step's code again, and the state it starts
  // from already holds what that code wrote before it stopped. A write made
  // again on top of it would count twice: a counter of how often the step
  // asked would read 2 after one question.
  it("an increment and a push made before the wait read once after the answer, through a restart", async () => {
    const seen: string[] = [];
    const flowFor = () => {
      const countAndWait = handler({
        name: "count-and-wait",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (_input, ctx) => {
          await ctx.sequencer!.incState({ asked: 1 });
          await ctx.sequencer!.pushState("log", "asked");
          const answer = await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
          // After the answer, writes are live again.
          await ctx.sequencer!.pushState("log", "answered");
          return answer;
        }
      });
      const read = handler({
        name: "read",
        inputSchema: z.any(),
        outputSchema: z.any(),
        execute: async (input, ctx) => {
          seen.push(JSON.stringify(ctx.sequencer!.state));
          return input;
        }
      });
      const block = sequencer({
        name: "s",
        stateSchema: z.object({ asked: z.number().default(0), log: z.array(z.string()).default([]) })
      })
        .step(countAndWait)
        .step(read);
      return defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    };
    const first = flowFor();
    const h = harness(first);
    const { requestId, gate } = await park(h, first, {});

    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual([JSON.stringify({ asked: 1, log: ["asked", "answered"] })]);
  });
});

describe("a state write before the second wait in one step applies once", () => {
  it("counts each wait once when one step waits twice", async () => {
    const seen: string[] = [];
    const twoWaits = handler({
      name: "two-waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "first?" } as never);
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "second?" } as never);
        seen.push(JSON.stringify(ctx.sequencer!.state));
        return null;
      }
    });
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) }).step(twoWaits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "a" })).status).toBe(202);
    await h.drain();
    const [second] = (await h.provider.listSuspended({ status: "pending" })).filter((g) => g.requestId === requestId);
    expect(second!.message).toBe("second?");
    expect((await answerRoute(h, requestId, { suspensionId: second!.suspensionId, action: "submit", data: "b" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([JSON.stringify({ asked: 2 })]);
  });
});

describe("a state write before the wait that no checkpoint holds", () => {
  // Only the sequencer whose checkpoint the resume restores already holds
  // the waiting block's earlier writes. Any other state (a handler's own
  // container, rebuilt from its defaults) needs the re-run's writes.
  it("a handler's own state, written before the wait, reads its write after the answer", async () => {
    const seen: unknown[] = [];
    const counted = handler({
      name: "counted",
      inputSchema: z.any(),
      outputSchema: z.any(),
      stateSchema: z.object({ asked: z.number().default(0) }),
      execute: async (_input, ctx) => {
        await ctx.self!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push((ctx.self!.state as { asked: number }).asked);
        return null;
      }
    });
    const flow = defineFlow({ kind: "asking", actions: { run: { block: sequencer({ name: "s" }).step(counted) } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "a" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([1]);
  });

  it("a sequencer's own .map that writes and waits restores its checkpoint and counts once", async () => {
    const seen: unknown[] = [];
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) })
      .map(async (_input, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push((ctx.sequencer!.state as { asked: number }).asked);
        return null;
      });
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "a" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([1]);
  });
});

describe("a state write before the wait, from code around the waiting block", () => {
  const counter = () =>
    handler({
      name: "wait",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => ctx.suspendForUser({ kind: "input", prompt: "?" } as never)
    });

  it("a connector's write before its block waits applies once", async () => {
    const seen: unknown[] = [];
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) })
      .step(async (input: unknown, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        return input;
      }, counter())
      .map((_input, ctx) => {
        seen.push((ctx.sequencer!.state as { asked: number }).asked);
        return null;
      });
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "a" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([1]);
  });

  it("a transient field written before the wait is written again, since no checkpoint holds it", async () => {
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.patchState({ ephemeral: "rebuilt", asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({
      name: "s",
      stateSchema: z.object({ asked: z.number().default(0), ephemeral: transientSlot(z.string().default("empty")) })
    }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "a" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([{ asked: 1, ephemeral: "rebuilt" }]);
  });

  it("a crash after the answer was logged replays the step's increment once", async () => {
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        const answer = await ctx.suspendForUser({ kind: "approval", prompt: "Ship?" } as never);
        seen.push([(ctx.sequencer!.state as { asked: number }).asked, answer]);
        return null;
      }
    });
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    await crashAfterAudit(h, requestId, gate, { status: "approved", resolution: "approved", resolvedBy: USER } as never);
    await h.deps.continueRequest({ requestId } as never);
    await h.drain();
    expect(seen).toEqual([[1, { cancelled: false, approved: true }]]);
  });
});

describe("writes after the resume, on a restored sequencer, are live", () => {
  // The resume settles the restored state once the re-run reaches the wait it
  // stopped at. Every write after that point is new and must apply, whatever
  // form it takes.
  it("a keyed update after the answer applies", async () => {
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        await ctx.sequencer!.patchState("count", (current: number) => current + 1);
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({
      name: "s",
      stateSchema: z.object({ asked: z.number().default(0), count: z.number().default(0) })
    }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([{ asked: 1, count: 1 }]);
  });

  it("a step that reads the restored state and skips its wait still writes after it", async () => {
    const seen: unknown[] = [];
    const waitsOnce = handler({
      name: "waits-once",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        const state = ctx.sequencer!.state as { prompted: boolean };
        if (!state.prompted) {
          await ctx.sequencer!.patchState({ prompted: true });
          await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        }
        await ctx.sequencer!.incState({ finished: 1 });
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({
      name: "s",
      stateSchema: z.object({ prompted: z.boolean().default(false), finished: z.number().default(0) })
    }).step(waitsOnce);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual([{ prompted: true, finished: 1 }]);
  });

  it("a field the re-run adds before the wait, which the saved state lacks, is gone after the answer", async () => {
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        const state = ctx.sequencer!.state as { last?: string };
        if (state.last !== undefined) await ctx.sequencer!.patchState({ previous: state.last });
        await ctx.sequencer!.patchState({ last: "new" });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({
      name: "s",
      stateSchema: z.object({ last: z.string().optional(), previous: z.string().optional() })
    }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([{ last: "new" }]);
  });

  it("a request parked before checkpoints were taken at the wait keeps the re-run's write", async () => {
    // Such a request's checkpoint is the one written when the step before the
    // wait ended: it lacks the waiting step's write, so the re-run's is the
    // only copy and no reset may drop it.
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    const saved = await h.stores.checkpoints.latest(requestId, gate.blockInstanceId);
    expect(saved?.atSuspension).toBe(true);
    const { atSuspension: _taken, ...legacy } = saved!;
    await h.stores.checkpoints.write({ ...legacy, stepIndex: -1, state: { asked: 0 } });
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([{ asked: 1 }]);
  });

  it("a field removed before the wait stays removed though its schema has a default", async () => {
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.setState({ asked: 1 } as never);
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({
      name: "s",
      stateSchema: z.object({ asked: z.number(), optional: z.string().optional() }).default({ asked: 0, optional: "empty" })
    }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([{ asked: 1 }]);
  });

  it("saves the checkpoint taken at the wait only after the wait is in the log", async () => {
    // Saved before it, a crash in between would leave a checkpoint holding
    // the step's writes with no logged gate to settle them at, and the
    // re-run would count them twice.
    const order: string[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        return null;
      }
    });
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const write = h.stores.checkpoints.write.bind(h.stores.checkpoints);
    h.stores.checkpoints.write = async (checkpoint) => {
      if (checkpoint.atSuspension === true) order.push("checkpoint at the wait");
      return write(checkpoint);
    };
    const flushItems = h.stores.request.flushItems.bind(h.stores.request);
    h.stores.request.flushItems = async (id) => {
      const record = await h.stores.request.get(id);
      if (record?.items?.some((item) => item.type === "suspension") === true) order.push("wait logged");
      return flushItems(id);
    };
    await park(h, flow, {});
    expect(order[0]).toBe("wait logged");
    expect(order).toContain("checkpoint at the wait");
  });

  it("replaying a completed step before the wait leaves the checkpoint taken at the wait in place", async () => {
    // A crash between the replay of an earlier step and the gate restores
    // from whatever checkpoint is latest. If the replay overwrote the one
    // taken at the wait with an unmarked one, that restore would skip the
    // reset and count the waiting step's write twice.
    let h: ReturnType<typeof harness> | undefined;
    let requestId = "";
    let key = "";
    let runs = 0;
    const midReplay: unknown[] = [];
    const done = handler({ name: "done", inputSchema: z.any(), outputSchema: z.any(), execute: (input) => input });
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        runs += 1;
        if (runs === 2) {
          await new Promise((settle) => setTimeout(settle, 20));
          const latest = await h!.stores.checkpoints.latest(requestId, key);
          midReplay.push({ atSuspension: latest?.atSuspension, state: latest?.state });
        }
        await ctx.sequencer!.incState({ asked: 1 });
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        return null;
      }
    });
    const block = sequencer({ name: "s", stateSchema: z.object({ asked: z.number().default(0) }) }).step(done).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    h = harness(flow);
    const parked = await park(h, flow, {});
    requestId = parked.requestId;
    key = parked.gate.blockInstanceId;
    expect((await answerRoute(h, requestId, { suspensionId: parked.gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(midReplay).toEqual([{ atSuspension: true, state: { asked: 1 } }]);
  });

  it("a transient field the re-run removed before the wait stays removed", async () => {
    const seen: unknown[] = [];
    const waits = handler({
      name: "waits",
      inputSchema: z.any(),
      outputSchema: z.any(),
      execute: async (_input, ctx) => {
        await ctx.sequencer!.setState({ asked: 1 } as never);
        await ctx.suspendForUser({ kind: "input", prompt: "?" } as never);
        seen.push(ctx.sequencer!.state);
        return null;
      }
    });
    const block = sequencer({
      name: "s",
      stateSchema: z.object({ asked: z.number().default(0), ephemeral: transientSlot(z.string().default("empty")) })
    }).step(waits);
    const flow = defineFlow({ kind: "asking", actions: { run: { block } } })({ id: "asking" });
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, {});
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "ok" })).status).toBe(202);
    await h.drain();
    expect(seen).toEqual([{ asked: 1 }]);
  });
});

describe("the answer route (D2)", () => {
  it("answers the stop once, as the signed-in caller; a second answer is told it is resolved", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });

    const answered = await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "eu-west", resumedBy: "someone-else" });
    expect(answered.status).toBe(202);
    await h.drain();
    expect(seen).toEqual(["work", 'first:{"cancelled":false,"answer":"eu-west"}']);
    // Who answered is the signed-in caller, never the body's.
    const log = (await h.stores.request.get(requestId))?.items ?? [];
    expect(log.find((item) => (item as { type?: string }).type === "suspension_resume")).toMatchObject({ resolvedBy: USER });

    // The request finished and its stop's record is gone; its log still says it was asked, so: resolved.
    const again = await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit", data: "us-east" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ refused: "already-resolved" });
  });

  it("tells another tenant, another user and a non-user stop that the stop doesn't exist, before it reads it", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });
    const load = vi.spyOn(h.provider, "loadSuspension");
    const body = { suspensionId: gate.suspensionId, action: "submit", data: "x" };
    expect((await answerRoute(h, requestId, body, { tenantId: "t_other" })).status).toBe(404);
    expect((await answerRoute(h, requestId, body, { principal: { userId: "u2", orgId: DEFAULT_ORG_ID } })).status).toBe(404);
    expect((await answerRoute(h, requestId, body, { principal: { userId: USER, orgId: "org_other" } })).status).toBe(404);
    // None of the three read the stop.
    expect(load).not.toHaveBeenCalled();
    load.mockRestore();
    // A stop that names no user's suspension is not found, as a missing one is.
    expect((await answerRoute(h, requestId, { ...body, suspensionId: "susp_missing" })).status).toBe(404);
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("pending");
  });

  it("refuses an answer that waited past the stop's deadline for another resume to finish (410), recording nothing", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "approval", prompt: "Ship?", deadline: 300 } });
    // Another resume holds the request's lease when the answer arrives, until past the deadline.
    const lease = await h.provider.acquireLease(requestId, { holder: "other", durationMs: 10_000 });
    const answer = answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "approve" });
    await new Promise((resolve) => setTimeout(resolve, 600));
    await h.provider.releaseLease(requestId, lease!.leaseId);
    expect((await answer).status).toBe(410);
    await h.drain();
    expect(seen).toEqual(["work"]);
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("expired");
  });

  it("checks the answer against the stop's own actions and schema", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "approval", prompt: "?", resumeSchema: { type: "object", properties: { note: { type: "string" } }, required: ["note"] } } });
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "submit" })).status).toBe(409);
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "approve", data: { note: 1 } })).status).toBe(400);
    expect((await answerRoute(h, requestId, { suspensionId: gate.suspensionId, action: "approve", data: { note: "yes" } })).status).toBe(202);
  });
});

describe("a stop of a task's run waiting on a user", () => {
  it("ends at the stop (stopsAtItsGate): the run re-enters what precedes it, and ends aborted there with nothing after it run", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, { options: { kind: "input", prompt: "?" } });
    // As the abort route stops a run a board started: the record it checked names the task source.
    const record = (await h.stores.request.get(requestId))!;
    expect(await stopSuspendedRequest(h.deps, { ...record, source: "task" })).toBe("stopped");
    await h.drain();
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    // The completed work replayed, and nothing ran past the stop.
    expect(seen).toEqual(["work"]);
    const log = (await h.stores.request.get(requestId))?.items ?? [];
    expect(log.find((item) => (item as { type?: string }).type === "suspension_resume")).toMatchObject({ suspensionId: gate.suspensionId, resolution: "stopped" });
  });

  it("any other parked run is stopped before anything runs, as before (BR-16)", async () => {
    const seen: string[] = [];
    const flow = askingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, { options: { kind: "input", prompt: "?" } });
    const stopped = await handleAbortRequest(
      new Request(`https://x/api/flows/asking/requests/${requestId}/abort`, { method: "POST" }),
      { kind: "abort_request", flowKind: "asking", requestId },
      { stores: h.stores, parked: h.deps }
    );
    expect(stopped.status).toBe(204);
    await h.drain();
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect(seen).toEqual(["work"]);
    expect(stopsAtItsGate({ source: "http" }, { reason: "user_input" })).toBe(false);
    expect(stopsAtItsGate({ source: "task" }, { reason: "external_event" })).toBe(false);
    expect(stopsAtItsGate({ source: "task" }, { reason: "user_approval" })).toBe(true);
  });
});
