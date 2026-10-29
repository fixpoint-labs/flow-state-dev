/**
 * Stopping a turn parked on a wait (FIX-1816 P2c: BR-16, BR-16b, BR-16c, BR-11a).
 *
 * The person's stop arrives through the abort route. The parked call cancels
 * its waited-on row and ends the turn `aborted`, with no model call after the
 * stop. A stop or an answer recorded on the gate survives a process death: the
 * next durability sweep drives the turn on (proved on a SQLite cold restart).
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GeneratorModelCallOptions } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import {
  act,
  waitCall,
  waitFlow,
  finalAnswer,
  rows,
  runtimeFor,
  SESSION,
  statusOf,
  stepModel,
  toolResults,
  until,
  USER
} from "./wait-fixture";

type State = ReturnType<typeof runtimeFor>;

let dir: string | undefined;
const live: State[] = [];

afterEach(async () => {
  vi.useRealTimers();
  for (const state of live.splice(0)) await state.dispose();
  if (dir !== undefined) await rm(dir, { recursive: true, force: true });
  dir = undefined;
});

function track(state: State): State {
  live.push(state);
  return state;
}

async function stop(state: State, requestId: string): Promise<Response> {
  const router = await state.getRouter();
  return router.POST(
    new Request(`http://localhost/api/flows/wait-board/requests/${requestId}/abort`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: USER })
    }),
    { params: { path: ["wait-board", "requests", requestId, "abort"] } }
  );
}

async function untilStatus(state: State, requestId: string, status: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const record = await (await state.getRuntime()).stores.request.get(requestId);
    if (record?.status === status) return;
    if (Date.now() > deadline) throw new Error(`request is "${record?.status}", never "${status}"`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("stop a turn parked on a wait", () => {
  it("cancels the waited-on row and ends the turn aborted, with no model call after the stop (BR-16)", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = track(runtimeFor(flow));
    const parked = await act(state, flow, "run");
    expect(await statusOf(state, parked.requestId!)).toBe("suspended");

    expect((await stop(state, parked.requestId!)).status).toBe(204);
    await untilStatus(state, parked.requestId!, "aborted");

    expect(seen).toHaveLength(1);
    expect(await rows(state, flow)).toEqual([
      expect.objectContaining({ status: "cancelled", resumeOwed: false })
    ]);
    // The colleague's later ending is dropped, and nothing is owed.
    await expect(act(state, flow, "settle", { outcome: { kind: "complete", output: "late" } })).rejects.toThrow();
    expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
  });

  it("a stop that wins over an ending already on the row leaves the row as it is and still ends the turn (BR-16b, BR-16c)", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = track(runtimeFor(flow));
    const parked = await act(state, flow, "run");
    // The colleague finished, but nothing has resumed the turn yet.
    await act(state, flow, "settle", { outcome: { kind: "complete", output: "too late" } });

    expect((await stop(state, parked.requestId!)).status).toBe(204);
    await untilStatus(state, parked.requestId!, "aborted");

    expect(seen).toHaveLength(1);
    expect(await rows(state, flow)).toEqual([
      expect.objectContaining({ status: "completed", resumeOwed: false })
    ]);
    // The answer's resume finds the gate already resolved, and owes nothing.
    expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
  });

  it("a stop whose row cancel fails still ends the turn aborted, and the next touch cancels the row (FIX-1844)", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model, { failCancelOnce: true });
    const state = track(runtimeFor(flow));
    const parked = await act(state, flow, "run");

    expect((await stop(state, parked.requestId!)).status).toBe(204);
    await untilStatus(state, parked.requestId!, "aborted");
    expect(seen).toHaveLength(1);
    // The cancel failed, so the row is still open, and owes its cancel.
    expect(await rows(state, flow)).toEqual([expect.objectContaining({ status: "pending" })]);

    // The next touch pays it. The stopped turn is owed nothing.
    expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
    expect(await rows(state, flow)).toEqual([expect.objectContaining({ status: "cancelled", resumeOwed: false })]);
    // The colleague's later ending is dropped.
    await expect(act(state, flow, "settle", { outcome: { kind: "complete", output: "late" } })).rejects.toThrow();
  });

  it("a touch long past a wait's deadline leaves a row whose turn still waits on it alone", async () => {
    const { model } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = track(runtimeFor(flow));
    const parked = await act(state, flow, "run");
    const [row] = await rows(state, flow);

    // No sweep has timed the wait out (a cron host between runs): it still waits.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(row!.wait!.deadline + 10 * 60_000);
    expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
    expect(await rows(state, flow)).toEqual([expect.objectContaining({ status: "pending" })]);
    expect(await statusOf(state, parked.requestId!)).toBe("suspended");
  });

  it("an answer refused while the turn is interrupted before its log holds the gate stays owed, and arrives once it parks again", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = track(runtimeFor(flow));
    const parked = await act(state, flow, "run");
    const requestId = parked.requestId!;
    const stores = (await state.getRuntime()).stores;
    const parkedRecord = (await stores.request.get(requestId))!;
    // The process died after the gate was written and before its log item
    // was; recovery marked the turn interrupted.
    await stores.request.set(
      requestId,
      {
        ...parkedRecord,
        status: "interrupted",
        items: (parkedRecord.items ?? []).filter((item) => (item as { type?: string }).type !== "suspension")
      },
      "any"
    );

    await act(state, flow, "settle", { outcome: { kind: "complete", output: "the answer" } });
    const [row] = await rows(state, flow);
    const first = (await act(state, flow, "touch")).output;
    expect(first).toEqual({ resumed: [], stillOwed: [row!.id] });
    expect(await rows(state, flow)).toEqual([expect.objectContaining({ status: "completed", resumeOwed: true })]);

    // The turn parks on its gate again (as crash recovery's replay does).
    const current = (await stores.request.get(requestId))!;
    await stores.request.set(requestId, { ...current, status: "suspended", items: parkedRecord.items }, "any");
    expect((await act(state, flow, "touch")).output).toEqual({ resumed: [row!.id], stillOwed: [] });
    await until(state, requestId, "completed");
    expect(toolResults(seen[1]!.messages)).toContain("the answer");
  });

  it("an answer that wins leaves the stop to a finished turn (BR-16b, the answer first)", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = track(runtimeFor(flow));
    const parked = await act(state, flow, "run");
    await act(state, flow, "settle", { outcome: { kind: "complete", output: "the answer" } });
    await act(state, flow, "touch");
    await until(state, parked.requestId!, "completed");

    expect((await stop(state, parked.requestId!)).status).toBe(409);
    expect(await statusOf(state, parked.requestId!)).toBe("completed");
    expect(toolResults(seen[1]!.messages)).toContain("the answer");
  });
});

describe("a resolved wait survives a SQLite cold restart (BR-16c, BR-11a)", () => {
  async function parkOnSqlite(seen: GeneratorModelCallOptions[]) {
    dir = await mkdtemp(join(tmpdir(), "fsd-wait-stop-"));
    const filename = join(dir, "store.db");
    const flow = waitFlow(stepModel([waitCall("c1"), finalAnswer], seen).model);
    const before = runtimeFor(flow, sqliteStores({ filename }));
    const parked = await act(before, flow, "run");
    const runtime = await before.getRuntime();
    const [gate] = (await runtime.runtimeConfig.durabilityProvider!.listSuspended({ status: "pending" })).filter(
      (s) => s.requestId === parked.requestId
    );
    return { filename, flow, before, requestId: parked.requestId!, gate: gate!, provider: runtime.runtimeConfig.durabilityProvider! };
  }

  async function restart(filename: string, seen: GeneratorModelCallOptions[]) {
    const flow = waitFlow(stepModel([waitCall("c1"), finalAnswer], seen).model);
    // A long-lived host: the router runs the durability sweep.
    const after = track(runtimeFor(flow, sqliteStores({ filename }), true, 50));
    await after.getRouter();
    return { flow, after };
  }

  it("killed between the stop and the row's cancel: after a restart and a sweep the row is cancelled and the turn aborted (V8)", async () => {
    const seen: GeneratorModelCallOptions[] = [];
    const { filename, before, requestId, gate, provider } = await parkOnSqlite(seen);
    // The stop resolved the gate; the process died before the turn moved on.
    await provider.suspend({
      ...gate,
      status: "stopped",
      resolvedAt: Date.now(),
      resolvedBy: "stop",
      resumeData: { answered: false, stopped: true }
    });
    await before.dispose();

    const { flow, after } = await restart(filename, seen);
    await untilStatus(after, requestId, "aborted");
    expect(seen).toHaveLength(1);
    expect(await rows(after, flow)).toEqual([expect.objectContaining({ status: "cancelled", resumeOwed: false })]);
  });

  it("a wait resumed at its deadline, killed before its request moved on, is driven on with the task as it stands, nothing cancelled", async () => {
    const seen: GeneratorModelCallOptions[] = [];
    const { filename, before, requestId, gate, provider } = await parkOnSqlite(seen);
    // The sweep resumed the wait at its deadline; the process died before the request moved on.
    await provider.suspend({
      ...gate,
      status: "submitted",
      resolvedAt: Date.now(),
      resolvedBy: "sweep",
      resumeData: { answered: false, deadline: true }
    });
    await before.dispose();

    const { flow, after } = await restart(filename, seen);
    await until(after, requestId, "completed");
    expect(seen).toHaveLength(2);
    expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');
    // Nothing cancelled: the task runs on, and its slot was released as the request ended.
    const [row] = await rows(after, flow);
    expect(row).toMatchObject({ status: "pending", resumeOwed: false });
    expect(row!.wait).toBeUndefined();
  });

  it("a task someone else cancelled is driven on as the cancel the gate recorded", async () => {
    const seen: GeneratorModelCallOptions[] = [];
    const { filename, flow: flowBefore, before, requestId, gate, provider } = await parkOnSqlite(seen);
    // A colleague cancelled the task; the touch resolved the gate with that
    // cancel; the process died before the request moved on.
    await act(before, flowBefore, "settle", { outcome: { kind: "cancel", reason: "no longer needed" } });
    await provider.suspend({
      ...gate,
      status: "submitted",
      resolvedAt: Date.now(),
      resolvedBy: `wait:${SESSION}`,
      resumeData: { answered: false, error: { code: "wait_task_cancelled", message: "The waited-on task was cancelled." } }
    });
    await before.dispose();

    const { after } = await restart(filename, seen);
    await until(after, requestId, "completed");
    expect(toolResults(seen[1]!.messages)).toContain('"status":"cancelled"');
  });

  for (const [label, settle, status] of [
    ["completed", { kind: "complete", output: "the late answer" }, "completed"],
    ["was cancelled by someone else", { kind: "cancel", reason: "no longer needed" }, "cancelled"]
  ] as const) {
    it(`a wait resumed at its deadline whose row then ${label}, before the request moved on, reads that ending after a re-drive`, async () => {
      const seen: GeneratorModelCallOptions[] = [];
      const { filename, flow: flowBefore, before, requestId, gate, provider } = await parkOnSqlite(seen);
      // The sweep resumed the wait at its deadline; the row then ended; the process died.
      await provider.suspend({
        ...gate,
        status: "submitted",
        resolvedAt: Date.now(),
        resolvedBy: "sweep",
        resumeData: { answered: false, deadline: true }
      });
      await act(before, flowBefore, "settle", { outcome: settle });
      await before.dispose();

      const { flow, after } = await restart(filename, seen);
      await until(after, requestId, "completed");
      // The lapse lost to the ending already written: the request reads it.
      expect(toolResults(seen[1]!.messages)).toContain(`"status":"${status}"`);
      expect((await rows(after, flow))[0]).toMatchObject({ status, resumeOwed: false });
    });
  }

  it("an answered wait killed before its turn continued is driven on to completion, once (V9)", async () => {
    const seen: GeneratorModelCallOptions[] = [];
    const { filename, flow: flowBefore, before, requestId, gate, provider } = await parkOnSqlite(seen);
    await act(before, flowBefore, "settle", { outcome: { kind: "complete", output: "Yes, renewed 2026-08" } });
    // The touch resolved the gate with the answer; the process died before the turn continued.
    await provider.suspend({
      ...gate,
      status: "submitted",
      resolvedAt: Date.now(),
      resolvedBy: `wait:${SESSION}`,
      resumeData: { answered: true, answer: "Yes, renewed 2026-08" }
    });
    await before.dispose();

    const { flow, after } = await restart(filename, seen);
    await until(after, requestId, "completed");
    expect(seen).toHaveLength(2);
    expect(toolResults(seen[1]!.messages)).toContain("Yes, renewed 2026-08");
    const board = await rows(after, flow);
    expect(board).toHaveLength(1);
    expect(board[0]).toMatchObject({ status: "completed", resumeOwed: false });
  });
});

it("OFF STATE: a store without durable execution still refuses to stop a parked turn", async () => {
  // Nothing parks without durable execution, so there is nothing to stop.
  const { model } = stepModel([waitCall("c1"), finalAnswer]);
  const flow = waitFlow(model);
  const state = track(runtimeFor(flow, inMemoryStores(), false));
  const run = await act(state, flow, "run");
  expect(await statusOf(state, run.requestId!)).toBe("completed");
});
