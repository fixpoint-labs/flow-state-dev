/**
 * Stopping a parked turn, the re-drive of a resolved gate, and the
 * deadline-aware sweep (FIX-1816 P2c, engine half).
 *
 * The orchestration half (an asked row cancelled by the stopped call, and the
 * SQLite cold restarts) lives with the ask's own tests in orchestration.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler, parkOnAsk, sequencer } from "@flow-state-dev/core";
import type { AskOutcome, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { continueRequest, createFlowRegistry, createFlowState, createInMemoryStores, inMemoryStores, runAction } from "../src";
import { createCheckpointDurabilityProvider } from "../src/durability/checkpoint-durability-provider";
import { createDurabilitySweeper, runTick } from "../src/durability/durability-sweeper";
import { resumeAskGate } from "../src/durability/resume-ask-gate";
import { handleAbortRequest } from "../src/routes/abort-routes";
import { handleResumeSuspension } from "../src/routes/resume-routes";
import type { RuntimeConfig } from "../src/runtime-config";
import type { ExecutionResult } from "../src/execution/types";

const USER = "u1";
const SESSION = "s1";

/** A flow whose `approve` turn parks on a person's approval, and whose `ask` turn parks on an ask. */
function parkingFlow(seen: string[], options: { askDeadline?: () => number } = {}): FlowInstance {
  const approve = handler({
    name: "approve-step",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_i, ctx) => {
      const answer = await ctx.suspend!({ reason: "human_approval", message: "Approve?" });
      seen.push("after-approval");
      return answer;
    }
  });
  const ask = handler({
    name: "ask-step",
    inputSchema: z.any(),
    outputSchema: z.any(),
    execute: async (_i, ctx) => {
      try {
        const answer = await parkOnAsk(ctx, {
          gateId: "gate_ask",
          binding: { board: "b", taskId: "t1" },
          ...(options.askDeadline !== undefined ? { deadline: options.askDeadline() } : {})
        });
        seen.push(`answer:${String(answer)}`);
        return { answer };
      } catch (error) {
        // The park itself propagates; only an ending is the call's to handle.
        if ((error as Error).name !== "AskStoppedError" && (error as Error).name !== "AskEndedError") throw error;
        seen.push(`ended:${(error as Error).name}:${(error as Error).message}`);
        return { ended: (error as Error).message };
      }
    }
  });
  return defineFlow({
    kind: "parking",
    actions: {
      approve: { block: sequencer({ name: "a" }).step(approve) },
      ask: { block: sequencer({ name: "k" }).step(ask) }
    }
  })({ id: "parking" });
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
  const parked = { provider, stores, continueRequest: cont };
  runtimeConfig.requestHost!.parkedStop = parked;
  return { stores, provider, registry, runtimeConfig, finished, parked, cont };
}

async function park(h: ReturnType<typeof harness>, flow: FlowInstance, action: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: action,
    input: {},
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

function stop(h: ReturnType<typeof harness>, requestId: string, withParked = true) {
  return handleAbortRequest(
    new Request(`https://x/api/flows/parking/requests/${requestId}/abort`, { method: "POST" }),
    { kind: "abort_request", flowKind: "parking", requestId },
    { stores: h.stores, ...(withParked ? { parked: h.parked } : {}) }
  );
}

function tickArgs(h: ReturnType<typeof harness>) {
  return {
    provider: h.provider,
    stores: h.stores,
    holder: "sweeper-test",
    sweepIntervalMs: 600_000,
    checkpointMaxAgeMs: 86_400_000,
    suspensionTerminalMaxAgeMs: 604_800_000,
    orphanCheckpointThresholdMs: 86_400_000,
    batchLimit: 1000,
    continueRequest: h.cont
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("stop a parked turn", () => {
  it("a turn parked on an approval ends aborted, and a later approve is refused (BR-16a)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "approve");

    const res = await stop(h, requestId);
    expect(res.status).toBe(204);
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("stopped");
    expect(h.finished).toHaveLength(0); // nothing continued
    expect(seen).toEqual([]);

    const approve = await handleResumeSuspension(
      new Request(`https://x/api/flows/parking/requests/${requestId}/resume`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspensionId: gate.suspensionId, action: "approve" })
      }),
      { kind: "resume_suspension", flowKind: "parking", requestId },
      {
        host: {} as never,
        registry: h.registry,
        stores: h.stores,
        durabilityProvider: h.provider,
        seams: {} as never,
        requestContext: {} as never
      }
    );
    expect(approve.status).toBe(409);
  });

  it("a turn stopped at an approval records its terminal event, so a stream following it ends (BR-16a)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, "approve");
    const before = await h.stores.request.getEvents(requestId);

    expect((await stop(h, requestId)).status).toBe(204);
    const events = await h.stores.request.getEvents(requestId);
    const last = events.at(-1)!;
    expect(last).toMatchObject({ type: "request.aborted", status: "aborted", requestId });
    // After the stop's two item events, continuing the log.
    expect(last.sequence_number).toBe(Math.max(...before.map((e) => e.sequence_number)) + 3);
  });

  it("a turn stopped at an approval records the stop on its log, so the approval no longer reads as open", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "approve");

    expect((await stop(h, requestId)).status).toBe(204);
    const items = (await h.stores.request.get(requestId))?.items ?? [];
    const resumed = items.filter((item) => (item as { type?: string }).type === "suspension_resume");
    expect(resumed).toEqual([
      expect.objectContaining({ suspensionId: gate.suspensionId, resolution: "stopped", resolvedBy: "stop" })
    ]);
    // Streamed before the terminal event, as a run that resumes streams it.
    const types = (await h.stores.request.getEvents(requestId)).map((e) => e.type);
    expect(types.slice(-3)).toEqual(["item.added", "item.done", "request.aborted"]);
  });

  it("a turn parked on an ask continues with the stop, so the parked call ends it (BR-16)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, "ask");

    expect((await stop(h, requestId)).status).toBe(204);
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    // The parked call read a stop, not an answer and not a tool error.
    expect(seen).toEqual(["ended:AskStoppedError:The asking turn was stopped."]);
    // Ending the turn is the parked call's (the ask's own tests show it
    // aborted); this bare handler simply returns.
    expect((await h.stores.request.get(requestId))?.status).not.toBe("suspended");
  });

  it("a stop that finds the gate already resolved reports it, and changes nothing (BR-16b, the answer first)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    // The answer resolved the gate; the turn has not moved on yet.
    await h.provider.suspend({ ...gate, status: "submitted", resumeData: { answered: true, answer: "yes" } });

    const res = await stop(h, requestId);
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("stop it again");
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("submitted");
  });

  it("a stop whose continued run fails before it starts stays a stop, and the sweep finishes it (BR-16)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    // The continued run fails setup after the stop was reported.
    vi.spyOn(h.stores.checkpoints, "latest").mockRejectedValueOnce(new Error("checkpoint boom"));

    expect((await stop(h, requestId)).status).toBe(204);
    await expect(h.finished[0]).rejects.toThrow("checkpoint boom");
    // Told it stopped: the gate is not reopened for a later answer.
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("stopped");

    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(2);
    await h.finished[1];
    expect(seen).toEqual(["ended:AskStoppedError:The asking turn was stopped."]);
  });

  it("a stop whose fenced abort finds another request under the id does not report it stopped", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, "approve");
    // The id was taken by another request between the check and the write.
    const setFieldsIfStatus = h.stores.request.setFieldsIfStatus.bind(h.stores.request);
    vi.spyOn(h.stores.request, "setFieldsIfStatus").mockImplementation(async (id, fields, ...rest) =>
      fields.status === "aborted" ? ({ applied: false } as never) : setFieldsIfStatus(id, fields, ...rest)
    );

    const res = await stop(h, requestId);
    expect(res.status).toBe(409);
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
  });

  it("a stop recorded while an ask turn is parking is carried onto the gate: the call ends it (BR-16)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    // The stop lands after the gate is written and before the turn is
    // written `suspended`: the running-request stop applies, nothing else runs.
    const set = h.stores.request.set.bind(h.stores.request);
    let stopped = false;
    vi.spyOn(h.stores.request, "set").mockImplementation(async (id, value, version) => {
      if (!stopped && value.status === "suspended") {
        stopped = true;
        const accepted = await h.stores.request.setFieldsIfStatus(id, { abortRequested: true }, ["in_progress"], Date.now());
        expect(accepted.applied).toBe(true);
      }
      return set(id, value, version);
    });

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "ask",
      input: {},
      userId: USER,
      sessionId: SESSION,
      stores: h.stores,
      runtimeConfig: h.runtimeConfig
    });
    expect(stopped).toBe(true);
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    expect(seen).toEqual(["ended:AskStoppedError:The asking turn was stopped."]);
    expect((await h.stores.request.get(result.requestId!))?.status).not.toBe("suspended");
    // The sweep sees the same recorded stop and finds it already carried.
    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(1);
    expect(seen).toHaveLength(1);
  });

  it("a stopped ask's continuation records the stop, not a submission, on its audit item", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, "ask");
    expect((await stop(h, requestId)).status).toBe(204);
    await h.finished[0];
    const resumed = ((await h.stores.request.get(requestId))?.items ?? []).find(
      (item) => (item as { type?: string }).type === "suspension_resume"
    ) as { resolution?: string } | undefined;
    expect(resumed?.resolution).toBe("stopped");
  });

  it("OFF STATE: without durable execution a parked turn answers as finished, as before", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, "approve");
    expect((await stop(h, requestId, false)).status).toBe(409);
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
  });
});

describe("the sweep re-drives a request left parked behind a resolved gate (BR-11a)", () => {
  it("an answered ask whose turn never continued is driven on with the answer, once", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    // The process died after the gate's write and before the turn continued.
    const answer: AskOutcome = { answered: true, answer: "renewed" };
    await h.provider.suspend({ ...gate, status: "submitted", resolvedAt: Date.now(), resumeData: answer });

    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual(["answer:renewed"]);

    // A second sweep has nothing left to do.
    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(1);
  });

  it("a stopped approval whose turn was never written aborted ends aborted (BR-16c, non-ask)", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "approve");
    await h.provider.suspend({ ...gate, status: "stopped", resolvedAt: Date.now() });

    await runTick(tickArgs(h));
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect(h.finished).toHaveLength(0);
  });

  it("a request stopped at a later gate is driven on, though an earlier gate of it was answered", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { gate } = await park(h, flow, "ask");
    // An ask the turn asked and had answered before it parked again.
    await h.provider.suspend({
      ...gate,
      suspensionId: "susp_earlier",
      createdAt: gate.createdAt - 60_000,
      status: "submitted",
      resolvedAt: gate.createdAt - 30_000,
      resumeData: { answered: true, answer: "earlier" }
    });
    // Stopped at the latest gate; the process died before the turn moved on.
    await h.provider.suspend({
      ...gate,
      status: "stopped",
      resolvedAt: Date.now(),
      resumeData: { answered: false, stopped: true }
    });

    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    expect(seen).toEqual(["ended:AskStoppedError:The asking turn was stopped."]);
  });

  it("a stranded request older than a full batch of handled gates is still reached", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    await h.provider.suspend({
      ...gate,
      status: "submitted",
      resolvedAt: Date.now(),
      resumeData: { answered: true, answer: "renewed" }
    });
    // Newer resolved gates whose turns are long finished, and a newer
    // submitted approval, each fill a batch ahead of the stranded one.
    for (let i = 0; i < 3; i += 1) {
      await h.provider.suspend({
        ...gate,
        requestId: `req_done_${i}`,
        suspensionId: `susp_done_${i}`,
        createdAt: gate.createdAt + 1_000 + i,
        status: "submitted",
        resolvedAt: Date.now(),
        resumeData: { answered: true, answer: "done" }
      });
    }
    await h.provider.suspend({
      ...gate,
      requestId: "req_approval",
      suspensionId: "susp_approval",
      reason: "human_approval",
      data: undefined,
      createdAt: gate.createdAt + 2_000,
      status: "submitted",
      resolvedAt: Date.now()
    });

    await runTick({ ...tickArgs(h), batchLimit: 2 });
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual(["answer:renewed"]);
  });

  it("a re-drive of an answered ask whose run fails before it starts keeps the answer for the next sweep", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    const answer: AskOutcome = { answered: true, answer: "renewed" };
    await h.provider.suspend({ ...gate, status: "submitted", resolvedAt: Date.now(), resumeData: answer });
    vi.spyOn(h.stores.checkpoints, "latest").mockRejectedValueOnce(new Error("checkpoint boom"));

    await runTick(tickArgs(h));
    await expect(h.finished[0]).rejects.toThrow("checkpoint boom");
    // Nobody sends an ask's answer twice: rolled back to pending, it would be lost.
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("submitted");

    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(2);
    await h.finished[1];
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual(["answer:renewed"]);
  });

  it("a stranded request is reached though more gates than a batch share its gate's millisecond", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    // Stored after the tied gates, so a store breaking the tie by insertion
    // order lists it past the first batch.
    await h.stores.suspensions.deleteForRequest(requestId);
    for (let i = 0; i < 5; i += 1) {
      await h.provider.suspend({
        ...gate,
        requestId: `req_tied_${i}`,
        suspensionId: `susp_tied_${i}`,
        status: "submitted",
        resolvedAt: Date.now(),
        resumeData: { answered: true, answer: "done" }
      });
    }
    await h.provider.suspend({
      ...gate,
      status: "submitted",
      resolvedAt: Date.now(),
      resumeData: { answered: true, answer: "renewed" }
    });

    await runTick({ ...tickArgs(h), batchLimit: 2 });
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    expect(seen).toEqual(["answer:renewed"]);
  });

  it("a stop recorded while parking that the parking run failed to carry is carried by the sweep", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const set = h.stores.request.set.bind(h.stores.request);
    const get = h.stores.request.get.bind(h.stores.request);
    let stopped = false;
    let failNextGet = false;
    vi.spyOn(h.stores.request, "set").mockImplementation(async (id, value, version) => {
      if (!stopped && value.status === "suspended") {
        stopped = true;
        await h.stores.request.setFieldsIfStatus(id, { abortRequested: true }, ["in_progress"], Date.now());
        const written = await set(id, value, version);
        failNextGet = true; // the parking run's read for the stop fails once
        return written;
      }
      return set(id, value, version);
    });
    vi.spyOn(h.stores.request, "get").mockImplementation(async (id) => {
      if (failNextGet) {
        failNextGet = false;
        throw new Error("store unavailable");
      }
      return get(id);
    });

    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "approve",
      input: {},
      userId: USER,
      sessionId: SESSION,
      stores: h.stores,
      runtimeConfig: h.runtimeConfig
    });
    const requestId = result.requestId!;
    expect(stopped).toBe(true);
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");

    await runTick(tickArgs(h));
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    const [gate] = await h.provider.listSuspended({});
    expect(gate?.status).toBe("stopped");
    // A second sweep, or the parking run's own carry racing it, changes nothing.
    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(0);
  });

  it("a stop recorded before a crash left the turn interrupted at its gate is carried by the sweep: approval", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "approve");
    // The process died after the stop was recorded and before `suspended`
    // was written; recovery marked the turn interrupted.
    await h.stores.request.setFieldsIfStatus(requestId, { status: "interrupted", abortRequested: true }, ["suspended"], Date.now());

    await runTick(tickArgs(h));
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("stopped");
  });

  it("a stop recorded before a crash left the turn interrupted at its gate is carried by the sweep: ask", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    await h.stores.request.setFieldsIfStatus(requestId, { status: "interrupted", abortRequested: true }, ["suspended"], Date.now());

    await runTick(tickArgs(h));
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("stopped");
    expect(h.finished).toHaveLength(1);
    await h.finished[0];
    expect(seen).toEqual(["ended:AskStoppedError:The asking turn was stopped."]);
  });

  it("the re-drive of a stopped approval waits for a live stop holding the turn's lease", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "approve");
    // A live stop holds the lease and has written the gate; it has not yet
    // written the turn aborted.
    await h.provider.acquireLease(requestId, { holder: "stop", durationMs: 60_000 });
    await h.provider.suspend({ ...gate, status: "stopped", resolvedAt: Date.now(), resolvedBy: "stop" });

    await runTick(tickArgs(h));
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
  });

  it("an interrupted turn whose log never got its ask's gate is not continued: an answer waits, a stop ends it", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId, gate } = await park(h, flow, "ask");
    // The process died after the gate was written and before its log item was:
    // recovery marked the turn interrupted.
    const record = (await h.stores.request.get(requestId))!;
    await h.stores.request.set(
      requestId,
      {
        ...record,
        status: "interrupted",
        items: (record.items ?? []).filter((item) => (item as { type?: string }).type !== "suspension")
      },
      "any"
    );

    // An answer can't be replayed onto a gate the log does not hold: refused
    // as retryable, so its sender keeps it for when the turn parks again.
    const answered = await resumeAskGate(h.parked, gate, { answered: true, answer: "late" }, "ask:s1");
    expect(answered).toMatchObject({ ok: false, refused: "busy" });
    expect(h.finished).toHaveLength(0);
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("pending");

    // A stop ends it where it stands.
    await h.stores.request.setFieldsIfStatus(requestId, { abortRequested: true }, ["interrupted"], Date.now());
    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(0);
    expect((await h.stores.request.get(requestId))?.status).toBe("aborted");
    expect((await h.provider.loadSuspension(requestId, gate.suspensionId))?.status).toBe("stopped");
  });

  it("a pending gate is not re-driven", async () => {
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const h = harness(flow);
    const { requestId } = await park(h, flow, "ask");
    await runTick(tickArgs(h));
    expect(h.finished).toHaveLength(0);
    expect((await h.stores.request.get(requestId))?.status).toBe("suspended");
  });
});

describe("the sweep's next tick is the earliest pending ask deadline (BR-14)", () => {
  it("a 30 s ask parked just after a tick times out within a few seconds of 30 s on a ten-minute interval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 30_000 });
    const h = harness(flow);
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      const { requestId } = await park(h, flow, "ask");
      await vi.advanceTimersByTimeAsync(29_000);
      expect(h.finished).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(h.finished).toHaveLength(1);
      await h.finished[0];
      expect(seen[0]).toContain("wait_timed_out");
      expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    } finally {
      sweeper.dispose();
    }
  });

  it("an ask parked while a tick runs keeps its deadline: the tick's re-arm does not push it back", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 30_000 });
    const h = harness(flow);
    // The tick's pending listing is read before the ask parks, and returns late.
    let releaseListing!: () => void;
    const listed = new Promise<void>((resolve) => {
      releaseListing = resolve;
    });
    vi.spyOn(h.provider, "listSuspended").mockImplementationOnce(async () => {
      await listed;
      return [];
    });
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      await vi.advanceTimersByTimeAsync(600_000); // the tick starts, and waits on its listing
      const { requestId } = await park(h, flow, "ask");
      releaseListing();
      await vi.advanceTimersByTimeAsync(29_000);
      expect(h.finished).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(h.finished).toHaveLength(1);
      await h.finished[0];
      expect(seen[0]).toContain("wait_timed_out");
      expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    } finally {
      sweeper.dispose();
    }
  });

  it("an overdue ask whose resume finds the turn busy is retried within seconds, not at the interval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 30_000 });
    const h = harness(flow);
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      const { requestId } = await park(h, flow, "ask");
      // Another resume holds the turn's lease across the deadline.
      await h.provider.acquireLease(requestId, { holder: "other", durationMs: 40_000 });
      await vi.advanceTimersByTimeAsync(32_000);
      expect(h.finished).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(20_000); // the lease lapses at 40 s
      expect(h.finished).toHaveLength(1);
      await h.finished[0];
      expect(seen[0]).toContain("wait_timed_out");
    } finally {
      sweeper.dispose();
    }
  });

  it("a deadline tick that loses the sweep lease to another host retries soon, not at the interval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 30_000 });
    const h = harness(flow);
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      // Another host holds the sweep until 35 s, and never times the ask out.
      await h.provider.acquireLease("__durability_sweeper__", { holder: "other-host", durationMs: 35_000 });
      const { requestId } = await park(h, flow, "ask");
      await vi.advanceTimersByTimeAsync(31_000);
      expect(h.finished).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.finished).toHaveLength(1);
      await h.finished[0];
      expect(seen[0]).toContain("wait_timed_out");
      expect((await h.stores.request.get(requestId))?.status).toBe("completed");
    } finally {
      sweeper.dispose();
    }
  });

  it("an overdue ask whose turn is still being written parked is retried soon, not at the interval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 30_000 });
    const h = harness(flow);
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      const { requestId } = await park(h, flow, "ask");
      // The gate is pending, but the turn still reads `in_progress` at the deadline.
      let publishing = true;
      const get = h.stores.request.get.bind(h.stores.request);
      vi.spyOn(h.stores.request, "get").mockImplementation(async (id) => {
        const record = await get(id);
        return publishing && id === requestId && record !== undefined ? { ...record, status: "in_progress" } : record;
      });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(h.finished).toHaveLength(0);
      publishing = false;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(h.finished).toHaveLength(1);
      await h.finished[0];
      expect(seen[0]).toContain("wait_timed_out");
    } finally {
      sweeper.dispose();
    }
  });

  it("a tick that ran reads the pending gates once, and schedules the next tick from that read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 900_000 });
    const h = harness(flow);
    await park(h, flow, "ask");
    const listSpy = vi.spyOn(h.provider, "listSuspended");
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      await vi.advanceTimersByTimeAsync(601_000);
      const pendingReads = listSpy.mock.calls.filter(([filter]) => filter?.status === "pending");
      expect(pendingReads).toHaveLength(1);
      // The ask, due at 900 s, is what the next tick is armed for.
      await vi.advanceTimersByTimeAsync(298_000);
      expect(h.finished).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(h.finished).toHaveLength(1);
      await h.finished[0];
    } finally {
      sweeper.dispose();
    }
  });

  it("with no pending ask the next tick stays at the interval", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const h = harness(parkingFlow([]));
    const listSpy = vi.spyOn(h.provider, "listSuspended");
    const sweeper = createDurabilitySweeper({
      provider: h.provider,
      stores: h.stores,
      retention: { sweepIntervalMs: 600_000 },
      continueRequest: h.cont
    });
    try {
      await vi.advanceTimersByTimeAsync(599_000);
      expect(listSpy).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(listSpy).toHaveBeenCalled();
      const calls = listSpy.mock.calls.length;
      await vi.advanceTimersByTimeAsync(500_000);
      expect(listSpy.mock.calls.length).toBe(calls);
    } finally {
      sweeper.dispose();
    }
  });
});

describe("a durable host with no retention policy still keeps its gates (BR-11a, BR-14)", () => {
  function durableHost(flow: FlowInstance) {
    return createFlowState({
      flows: { parking: flow },
      stores: { default: { primary: inMemoryStores() } },
      durable: true
    });
  }

  async function parkOn(state: ReturnType<typeof durableHost>, flow: FlowInstance) {
    const runtime = await state.getRuntime();
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow,
      actionName: "ask",
      input: {},
      userId: USER,
      sessionId: SESSION,
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig
    });
    return { runtime, requestId: result.requestId! };
  }

  async function settled(runtime: { stores: ReturnType<typeof createInMemoryStores> }, requestId: string) {
    for (let i = 0; i < 50; i += 1) {
      const status = (await runtime.stores.request.get(requestId))?.status;
      if (status !== "suspended" && status !== "in_progress") return status;
      await vi.advanceTimersByTimeAsync(100);
    }
    return (await runtime.stores.request.get(requestId))?.status;
  }

  it("an overdue ask times out", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen, { askDeadline: () => Date.now() + 30_000 });
    const state = durableHost(flow);
    try {
      await state.getRouter();
      const { runtime, requestId } = await parkOn(state, flow);
      await vi.advanceTimersByTimeAsync(32_000);
      expect(await settled(runtime as never, requestId)).toBe("completed");
      expect(seen[0]).toContain("wait_timed_out");
    } finally {
      await state.dispose();
    }
  });

  it("prunes nothing: the retention steps stay off without a policy", async () => {
    const h = harness(parkingFlow([]));
    const prune = vi.spyOn(h.provider, "pruneSuspensions");
    const leases = vi.spyOn(h.stores.leases, "pruneExpired");
    const checkpoints = vi.spyOn(h.provider, "cleanupCheckpoints");
    await runTick({ ...tickArgs(h), prune: false });
    expect(prune).not.toHaveBeenCalled();
    expect(leases).not.toHaveBeenCalled();
    expect(checkpoints).not.toHaveBeenCalled();
    await runTick(tickArgs(h));
    expect(prune).toHaveBeenCalled();
    expect(leases).toHaveBeenCalled();
  });

  it("a resolved gate is re-driven", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    const seen: string[] = [];
    const flow = parkingFlow(seen);
    const state = durableHost(flow);
    try {
      await state.getRouter();
      const { runtime, requestId } = await parkOn(state, flow);
      const provider = runtime.runtimeConfig.durabilityProvider!;
      const [gate] = (await provider.listSuspended({ status: "pending" })).filter((g) => g.requestId === requestId);
      await provider.suspend({
        ...gate!,
        status: "submitted",
        resolvedAt: Date.now(),
        resumeData: { answered: true, answer: "renewed" }
      });
      await vi.advanceTimersByTimeAsync(601_000);
      expect(await settled(runtime as never, requestId)).toBe("completed");
      expect(seen).toEqual(["answer:renewed"]);
    } finally {
      await state.dispose();
    }
  });
});
