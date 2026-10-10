/**
 * Ask on the board: `addTaskAndWait` files a task, the turn parks, and the
 * row's ending resumes it with the answer (FIX-1816 P2, V3 V4 and BR-12a).
 *
 * The asking turn is a generator in a plain sequencer, the shape a Workforce
 * turn has. "The colleague" is a later request in the same conversation that
 * claims and settles the row, and the board touch is a request that calls
 * `resumeOwedAsks` directly: the notice that will call it on its own arrives
 * with the child-finished signal (FIX-1816 P3).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { askGateId } from "../../src/tasks/helpers/wait-for-response";
import {
  act,
  askCall,
  askFlow,
  BOARD,
  finalAnswer,
  rows,
  runtimeFor,
  SESSION,
  statusOf,
  stepModel,
  toolResults,
  until,
  USER
} from "./ask-fixture";

describe("ask on the board: file, park, and resume on the row's ending", () => {
  it("files one row marked asked, parks, and resumes with the row's output as the answer (BR-1, BR-2)", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");

      const [row] = await rows(state, flow);
      expect(row).toMatchObject({ status: "pending", resumeOwed: false });
      expect(row!.ask?.gateId).toBe(askGateId(BOARD, row!.id));
      // The default bound: five minutes from filing (BR-14).
      const left = row!.ask!.deadline - Date.now();
      expect(left).toBeGreaterThan(4 * 60_000);
      expect(left).toBeLessThanOrEqual(5 * 60_000);

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "Yes, renewed 2026-08" } });
      // The ending owes the turn its answer.
      expect((await rows(state, flow))[0]).toMatchObject({ status: "completed", resumeOwed: true });

      const touched = await act(state, flow, "touch");
      expect(touched.output).toMatchObject({ resumed: [row!.id], stillOwed: [] });
      await until(state, parked.requestId!, "completed");

      expect(toolResults(seen[1]!.messages)).toContain("Yes, renewed 2026-08");
      const after = await rows(state, flow);
      expect(after).toHaveLength(1);
      expect(after[0]).toMatchObject({ resumeOwed: false });
    } finally {
      await state.dispose();
    }
  });

  for (const [ending, settle, code] of [
    ["fails for good", { kind: "fail", error: "the source was unreachable" }, "wait_task_failed"],
    ["is cancelled", { kind: "cancel" }, "wait_task_cancelled"]
  ] as const) {
    it(`an asked row that ${ending} resumes the turn with ${code} (BR-3)`, async () => {
      const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
      const flow = askFlow(model);
      const state = runtimeFor(flow);
      try {
        const parked = await act(state, flow, "run");
        await act(state, flow, "settle", { outcome: settle });
        await act(state, flow, "touch");
        await until(state, parked.requestId!, "completed");
        expect(toolResults(seen[1]!.messages)).toContain(code);
      } finally {
        await state.dispose();
      }
    });
  }

  it("a row that fails once, is retried, then completes resumes the turn once, with the final answer (BR-12a)", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model, { maxAttempts: 2 });
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");

      await act(state, flow, "settle", { outcome: { kind: "fail", error: "flaky" } });
      // A retried failure is not an ending: nothing is owed, the turn stays parked.
      expect((await rows(state, flow))[0]).toMatchObject({ status: "pending", resumeOwed: false });
      expect((await act(state, flow, "touch")).output).toMatchObject({ resumed: [] });
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "the final answer" } });
      expect((await act(state, flow, "touch")).output).toMatchObject({ resumed: [expect.any(String)] });
      await until(state, parked.requestId!, "completed");
      // A second touch has nothing to do.
      expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });

      expect(seen).toHaveLength(2);
      const sent = toolResults(seen[1]!.messages);
      expect(sent).toContain("the final answer");
      expect(sent).not.toContain("flaky");
    } finally {
      await state.dispose();
    }
  });

  it("a resume accepted but never cleared by the touch is cleared by the turn itself (crash between resume and clear)", async () => {
    const { model } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "answer" } });
      const [row] = await rows(state, flow);

      // The touch resumes the turn and dies before clearing the marker: call
      // the verb the way the touch does, and clear nothing.
      const runtime = await state.getRuntime();
      const resumeOnly = handler({
        name: "resume-only",
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.any(),
        execute: async (_i, ctx) =>
          ctx.requestHost!.resumeAsk!({
            gateId: row!.ask!.gateId,
            outcome: { answered: true, answer: "answer" }
          })
      });
      const resumer = defineFlow({ kind: "ask-board", actions: { go: { block: resumeOnly } } })({ id: "ask-board" });
      const resumed = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: resumer,
        actionName: "go",
        input: {},
        userId: USER,
        sessionId: SESSION,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig
      });
      expect(resumed.output).toEqual({ ok: true });
      await until(state, parked.requestId!, "completed");

      // The turn's gates are gone with it, so no later touch could clear this
      // marker: the turn cleared it when it read its answer.
      expect((await rows(state, flow))[0]).toMatchObject({ resumeOwed: false });
      expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
    } finally {
      await state.dispose();
    }
  });

  it("a second waiting addTask in the same step is refused before anything is filed (BR-8)", async () => {
    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "c1", toolName: "ask_colleague", args: { question: "first" } },
          { toolCallId: "c2", toolName: "ask_colleague", args: { question: "second" } }
        ],
        finishReason: "tool-calls"
      }),
      finalAnswer
    ]);
    const flow = askFlow(model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");
      const filed = await rows(state, flow);
      expect(filed).toHaveLength(1);

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "first answer" } });
      await act(state, flow, "touch");
      await until(state, parked.requestId!, "completed");
      const sent = toolResults(seen[1]!.messages);
      expect(sent).toContain("first answer");
      expect(sent).toContain("wait_already_pending");
      expect(await rows(state, flow)).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("OFF STATE: without durable execution nothing is filed and the call answers wait_unavailable", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model);
    const state = runtimeFor(flow, inMemoryStores(), false);
    try {
      const run = await act(state, flow, "run");
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      expect(toolResults(seen[1]!.messages)).toContain("wait_unavailable");
      expect(await rows(state, flow)).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });
});

describe("ask on the board: the answer always comes back", () => {
  it("a marker clear that fails after the answer still returns the answer; the next touch clears the marker", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model, { failClearOnce: true });
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "Yes, renewed 2026-08" } });
      // The touch resumes the turn; the asking call's own clear of the marker is the one that fails.
      await act(state, flow, "touch");
      await until(state, parked.requestId!, "completed");
      expect(toolResults(seen[1]!.messages)).toContain("Yes, renewed 2026-08");
      // The marker the failed clear left is cleared by the next touch, the gate already resolved.
      await act(state, flow, "touch");
      expect((await rows(state, flow))[0]).toMatchObject({ status: "completed", resumeOwed: false });
    } finally {
      await state.dispose();
    }
  });
});

describe("ask on the board: a host that can't bound the ask", () => {
  it("OFF STATE: durable execution with no durability sweeper refuses wait_unavailable, and files nothing (BR-5)", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model);
    const state = runtimeFor(flow);
    try {
      // A direct caller of addTaskAndWait, on a host whose router (and so its sweeper) was never built.
      const run = await act(state, flow, "run", {}, { sweeper: false });
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      expect(toolResults(seen[1]!.messages)).toContain("wait_unavailable");
      const runtime = await state.getRuntime();
      expect(await runtime.stores.suspensions.list({ sessionId: SESSION })).toHaveLength(0);
    } finally {
      await state.dispose();
    }
  });
});

describe("ask on the board: the row ended first, and the deadline", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a row that ended before the turn parked answers at once, without parking, and clears its marker (BR-7)", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model, { endsOnFiling: "already done" });
    const state = runtimeFor(flow);
    try {
      const run = await act(state, flow, "run");
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      const suspensions = await (await state.getRuntime()).stores.suspensions.list({ sessionId: SESSION });
      expect(suspensions).toHaveLength(0);
      expect(toolResults(seen[1]!.messages)).toContain("already done");
      expect(await rows(state, flow)).toEqual([expect.objectContaining({ status: "completed", resumeOwed: false })]);
    } finally {
      await state.dispose();
    }
  });

  it("a row that ended between the check and the park, with no touch after, answers at the deadline, not wait_timed_out", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model, { endsBeforePark: "Yes, renewed 2026-08" });
    const state = runtimeFor(flow, inMemoryStores(), true, 25);
    try {
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");
      // Nothing touches the board. Past the deadline, the sweep resumes the turn.
      const real = Date.now.bind(Date);
      vi.spyOn(Date, "now").mockImplementation(() => real() + 6 * 60_000);
      await until(state, parked.requestId!, "completed");

      expect(toolResults(seen[1]!.messages)).toContain("Yes, renewed 2026-08");
      expect(toolResults(seen[1]!.messages)).not.toContain("wait_timed_out");
      expect((await rows(state, flow))[0]).toMatchObject({ status: "completed", resumeOwed: false });
    } finally {
      await state.dispose();
    }
  });

  it("an ask open past its deadline is resumed by a real sweep with wait_timed_out, and its row is cancelled (BR-14)", async () => {
    const { model, seen } = stepModel([askCall("c1"), finalAnswer]);
    const flow = askFlow(model);
    const state = runtimeFor(flow, inMemoryStores(), true, 25);
    try {
      await state.getRouter(); // the router builds the sweeper
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");

      // Past the five-minute default.
      const real = Date.now.bind(Date);
      vi.spyOn(Date, "now").mockImplementation(() => real() + 11 * 60_000);
      await until(state, parked.requestId!, "completed");

      expect(toolResults(seen[1]!.messages)).toContain("wait_timed_out");
      const [row] = await rows(state, flow);
      expect(row).toMatchObject({ status: "cancelled", resumeOwed: false });

      // The colleague's later ending is dropped: the row is already over.
      await expect(act(state, flow, "settle", { outcome: { kind: "complete", output: "late" } })).rejects.toThrow();
      expect((await rows(state, flow))[0]).toMatchObject({ status: "cancelled" });
    } finally {
      await state.dispose();
    }
  });
});
