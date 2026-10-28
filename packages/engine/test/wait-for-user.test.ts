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
import { DEFAULT_ORG_ID, defineFlow, handler, sequencer, SuspensionTimeoutError } from "@flow-state-dev/core";
import type { FlowInstance, SuspensionRecord, WaitForUserOptions } from "@flow-state-dev/core/types";
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
    execute: async (input: { options: WaitForUserOptions; twice?: boolean; catchDeadline?: boolean }, ctx) => {
      try {
        const first = await ctx.waitForUser(input.options as never);
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
    execute: async (input: { again?: WaitForUserOptions }, ctx) => {
      if (input?.again === undefined) return input;
      const second = await ctx.waitForUser(input.again as never);
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

describe("waitForUser: what the stop records", () => {
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

describe("waitForUser: a deadline", () => {
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

describe("waitForUser: a cancel (the board's debt payment)", () => {
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

describe("waitForUser: a crash after the stop's resolution was logged replays it as that ending, never as an answer", () => {
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

describe("waitForUser in a nested sequencer", () => {
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
      execute: async (_input, ctx) => ctx.waitForUser({ kind: "input", prompt: "?" } as never)
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
