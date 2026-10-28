/**
 * A wait on a task this session filed (FIX-2082): the request takes the row's
 * wait slot, parks, and resumes once, with the ending the claim gate wrote or
 * at the deadline with the task still running. The deadline cancels nothing.
 *
 * The waiting request is a generator in a plain sequencer, the shape a
 * Workforce turn has. "The colleague" is a later request in the same session
 * that claims and settles the row. The board touch is a request that calls
 * `payOwedResumes`, unless the flow declares `onTaskSettled`, whose pass then
 * pays the resume on its own.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { inMemoryStores, runAction, type StoreAdapter } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { z } from "zod";
import { waitGateId } from "../../src/tasks/helpers/wait-on-task";
import type { TaskSettledInput } from "../../src";
import {
  act,
  waitAgain,
  waitCall,
  waitedTaskId,
  waitFlow,
  BOARD,
  finalAnswer,
  getTask,
  rows,
  runtimeFor,
  SESSION,
  statusOf,
  stepModel,
  toolResults,
  until,
  USER,
  type StepFn
} from "./wait-fixture";
import { heard } from "../fixtures/heard";

/** Deadlines the tests can wait out. */
const SHORT = { minMs: 10 };

/** The notice markers a row still owes, held ones included (a cleared marker is `null`). */
function owedMarkers(row: { metadata?: Record<string, unknown> }): string[] {
  return Object.entries(row.metadata ?? {})
    .filter(([key, value]) => key.startsWith("noticeOwed:") && value !== null)
    .map(([key]) => key);
}

describe("wait on a task: take the slot, park, and resume on the row's ending", () => {
  it("takes the row's slot as the wait starts, parks, and resumes with the row as it ended", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");

      const [row] = await rows(state, flow);
      expect(row).toMatchObject({ status: "pending", resumeOwed: false });
      expect(row!.wait?.gateId.startsWith(`${waitGateId(BOARD, row!.id)}#`)).toBe(true);
      // Server-written: the waiting request, never input.
      expect(row!.wait?.requestId).toBe(parked.requestId);
      // The host's default: five minutes from the call.
      const left = row!.wait!.deadline - Date.now();
      expect(left).toBeGreaterThan(4 * 60_000);
      expect(left).toBeLessThanOrEqual(5 * 60_000);

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "Yes, renewed 2026-08" } });
      // The ending owes the waiting request its resume, not a notice.
      const ended = (await rows(state, flow))[0]!;
      expect(ended).toMatchObject({ status: "completed", resumeOwed: true });
      expect(owedMarkers(ended)).toEqual([]);

      const touched = await act(state, flow, "touch");
      expect(touched.output).toMatchObject({ resumed: [row!.id], stillOwed: [] });
      await until(state, parked.requestId!, "completed");

      const sent = toolResults(seen[1]!.messages);
      expect(sent).toContain('"status":"completed"');
      expect(sent).toContain("Yes, renewed 2026-08");
      expect((await rows(state, flow))[0]).toMatchObject({ resumeOwed: false });
    } finally {
      await state.dispose();
    }
  });

  for (const [ending, settle, status] of [
    ["fails for good", { kind: "fail", error: "the source was unreachable" }, "errored"],
    ["is cancelled", { kind: "cancel" }, "cancelled"]
  ] as const) {
    it(`a waited-on row that ${ending} resumes the request with the row, ${status}`, async () => {
      const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
      const flow = waitFlow(model);
      const state = runtimeFor(flow);
      try {
        const parked = await act(state, flow, "run");
        await act(state, flow, "settle", { outcome: settle });
        await act(state, flow, "touch");
        await until(state, parked.requestId!, "completed");
        expect(toolResults(seen[1]!.messages)).toContain(`"status":"${status}"`);
      } finally {
        await state.dispose();
      }
    });
  }

  it("a row that fails once, is retried, then completes resumes the request once, with the final ending", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model, { maxAttempts: 2 });
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");

      await act(state, flow, "settle", { outcome: { kind: "fail", error: "flaky" } });
      // A retried failure is not an ending: nothing is owed, the request stays parked.
      expect((await rows(state, flow))[0]).toMatchObject({ status: "pending", resumeOwed: false });
      expect((await act(state, flow, "touch")).output).toMatchObject({ resumed: [] });
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "the final answer" } });
      expect((await act(state, flow, "touch")).output).toMatchObject({ resumed: [expect.any(String)] });
      await until(state, parked.requestId!, "completed");
      expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });

      expect(seen).toHaveLength(2);
      expect(toolResults(seen[1]!.messages)).toContain("the final answer");
    } finally {
      await state.dispose();
    }
  });

  it("a resume accepted but never cleared by the touch is cleared by the request itself", async () => {
    const { model } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "answer" } });
      const [row] = await rows(state, flow);

      // The touch resumes the request and dies before clearing the marker.
      const runtime = await state.getRuntime();
      const resumeOnly = handler({
        name: "resume-only",
        inputSchema: z.object({}).passthrough(),
        outputSchema: z.any(),
        execute: async (_i, ctx) =>
          ctx.requestHost!.resumeWait!({ gateId: row!.wait!.gateId, outcome: { answered: true, answer: "answer" } })
      });
      const resumer = defineFlow({ internal: { actions: { ...heard } }, kind: "wait-board", actions: { go: { block: resumeOnly } } })({ id: "wait-board" });
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

      expect((await rows(state, flow))[0]).toMatchObject({ resumeOwed: false });
      expect((await act(state, flow, "touch")).output).toEqual({ resumed: [], stillOwed: [] });
    } finally {
      await state.dispose();
    }
  });

  it("with onTaskSettled declared, the ending's own pass resumes the request: no touch", async () => {
    const notices: TaskSettledInput[] = [];
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "heard at once" } });
      await until(state, parked.requestId!, "completed");
      expect(toolResults(seen[1]!.messages)).toContain("heard at once");
      // The waiting request had it: the filer's onTaskSettled never does.
      expect(notices).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});

describe("wait on a task: each check refuses before anything is written", () => {
  it("a second wait in the same step is refused wait_already_pending, and takes no slot", async () => {
    const { model, seen } = stepModel([
      () => ({
        toolCalls: [
          { toolCallId: "c1", toolName: "wait_on_colleague", args: { question: "first" } },
          { toolCallId: "c2", toolName: "wait_on_colleague", args: { question: "second" } }
        ],
        finishReason: "tool-calls"
      }),
      finalAnswer
    ]);
    const flow = waitFlow(model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");
      const filed = await rows(state, flow);
      expect(filed.filter((row) => row.wait !== undefined)).toHaveLength(1);

      const waited = filed.find((row) => row.wait !== undefined)!;
      await act(state, flow, "settle", { outcome: { kind: "complete", output: "first answer" } });
      await act(state, flow, "touch");
      await until(state, parked.requestId!, "completed");
      const sent = toolResults(seen[1]!.messages);
      expect(sent).toContain("wait_already_pending");
      expect((await rows(state, flow)).find((row) => row.id === waited.id)).toMatchObject({ status: "completed" });
    } finally {
      await state.dispose();
    }
  });

  it("another session of the same user is refused wait_not_filer on a task it didn't file", async () => {
    let filedId = "";
    const first = stepModel([waitCall("c1"), finalAnswer]);
    // A board every session of the user reaches.
    const flow = waitFlow(first.model, { scope: "user" });
    const state = runtimeFor(flow);
    try {
      // The filing session waits, and parks.
      const parked = await act(state, flow, "run");
      filedId = (await rows(state, flow))[0]!.id;
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");

      // The same user's other session reaches the same flow and names the task.
      const other = stepModel([waitAgain("c1", () => filedId), finalAnswer]);
      const otherFlow = waitFlow(other.model, { scope: "user" });
      const run = await act(state, otherFlow, "run", {}, { sessionId: "s_other" });
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      expect(toolResults(other.seen[1]!.messages)).toContain("wait_not_filer");
    } finally {
      await state.dispose();
    }
  });

  it("a second request of the filing session is refused wait_taken while the first waits", async () => {
    let filedId = "";
    const first = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(first.model);
    const state = runtimeFor(flow);
    try {
      const parked = await act(state, flow, "run");
      filedId = (await rows(state, flow))[0]!.id;

      const second = stepModel([waitAgain("c1", () => filedId), finalAnswer]);
      const secondFlow = waitFlow(second.model);
      const run = await act(state, secondFlow, "run");
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      expect(toolResults(second.seen[1]!.messages)).toContain("wait_taken");
      // The first wait still holds the slot.
      expect((await rows(state, flow))[0]!.wait?.requestId).toBe(parked.requestId);
    } finally {
      await state.dispose();
    }
  });

  it("a deadline outside the host's bounds is refused wait_deadline_out_of_range, never clamped", async () => {
    const { model, seen } = stepModel([waitCall("c1", "q", 25 * 3_600_000), finalAnswer]);
    const flow = waitFlow(model);
    const state = runtimeFor(flow);
    try {
      const run = await act(state, flow, "run");
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      expect(toolResults(seen[1]!.messages)).toContain("wait_deadline_out_of_range");
      expect((await rows(state, flow)).filter((row) => row.wait !== undefined)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("OFF STATE: without durable execution the wait is refused wait_unavailable, and takes no slot", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = runtimeFor(flow, inMemoryStores(), false);
    try {
      const run = await act(state, flow, "run");
      expect(await statusOf(state, run.requestId!)).toBe("completed");
      expect(toolResults(seen[1]!.messages)).toContain("wait_unavailable");
      expect((await rows(state, flow)).filter((row) => row.wait !== undefined)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("OFF STATE: durable execution with no durability sweeper refuses wait_unavailable, and parks nothing", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model);
    const state = runtimeFor(flow);
    try {
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

describe("wait on a task: an ending first, and the deadline that cancels nothing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a row that ended before the wait answers at once, without parking", async () => {
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model, { endsOnFiling: "already done" });
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

  it("a row that ended before the wait is heard once, through the wait: no onTaskSettled runs for it", async () => {
    // The filer waited on it, so the wait's answer is its delivery. A notice
    // too would wake a second turn on the same ending, whose answer replaces
    // the first. The notice waits for the turn to end, as in a Workforce session.
    const notices: TaskSettledInput[] = [];
    const { model, seen } = stepModel([waitCall("c1"), finalAnswer]);
    const flow = waitFlow(model, { endsOnFiling: "already done", heard: notices, noticeAfterTurn: true });
    const state = runtimeFor(flow);
    try {
      // Through the host's dispatch, which keeps the turn's line (a direct run keeps none).
      const router = await state.getRouter();
      const path = ["wait-board", SESSION, "actions", "run"];
      const sent = await router.POST(
        new Request(`http://localhost/api/flows/${path.join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: USER, input: {} })
        }),
        { params: { path } }
      );
      expect(sent.status).toBe(202);
      const requestId = ((await sent.json()) as { request: { id: string } }).request.id;
      await until(state, requestId, "completed", 10_000);
      expect(toolResults(seen[1]!.messages)).toContain("already done");
      // Past the notice's due time: the fast path's copy and the pass's resend have both had their chance.
      await new Promise((r) => setTimeout(r, 2_500));
      expect(owedMarkers((await rows(state, flow))[0]!)).toEqual([]);
      expect(notices).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("a row that ended after the slot was taken and before the park, with no touch after, answers at the deadline with its ending", async () => {
    const { model, seen } = stepModel([waitCall("c1", "q", 50), finalAnswer]);
    const flow = waitFlow(model, { endsAfterMark: "Yes, renewed 2026-08" });
    const state = runtimeFor(flow, inMemoryStores(), true, 25, SHORT);
    try {
      const parked = await act(state, flow, "run");
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");
      // Nothing touches the board. At the deadline, the sweep resumes the request.
      await until(state, parked.requestId!, "completed");
      const sent = toolResults(seen[1]!.messages);
      expect(sent).toContain('"status":"completed"');
      expect(sent).toContain("Yes, renewed 2026-08");
      expect((await rows(state, flow))[0]).toMatchObject({ status: "completed", resumeOwed: false });
    } finally {
      await state.dispose();
    }
  });

  it("at the deadline the request resumes with the task still running, nothing cancelled, and a second wait gets its ending", async () => {
    let taskId = "";
    const seen: Parameters<typeof stepModel>[1] = [];
    const settledAfterDeadline: StepFn = async () => {
      // While this request runs, the colleague finishes.
      return { toolCalls: [{ toolCallId: "c2", toolName: "wait_again", args: { id: taskId, deadline: 60_000 } }], finishReason: "tool-calls" };
    };
    const { model } = stepModel(
      [
        waitCall("c1", "q", 50),
        (opts) => {
          taskId = waitedTaskId([opts], 0);
          return settledAfterDeadline(opts);
        },
        finalAnswer
      ],
      seen
    );
    const flow = waitFlow(model);
    const state = runtimeFor(flow, inMemoryStores(), true, 25, SHORT);
    try {
      const parked = await act(state, flow, "run");
      await until(state, parked.requestId!, "suspended");
      // Past the first deadline: the first wait resumes, and the second parks.
      for (let i = 0; i < 300 && seen.length < 2; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(seen.length).toBeGreaterThanOrEqual(2);
      const first = toolResults(seen[1]!.messages);
      expect(first).toContain('"status":"pending"');
      await until(state, parked.requestId!, "suspended");
      const [row] = await rows(state, flow);
      // Nothing cancelled; the second wait holds the slot.
      expect(row).toMatchObject({ status: "pending" });
      expect(row!.wait?.lapsed).toBeUndefined();

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "found it" } });
      await act(state, flow, "touch");
      await until(state, parked.requestId!, "completed");
      expect(toolResults(seen[2]!.messages)).toContain("found it");
    } finally {
      await state.dispose();
    }
  });

  it("an ending after the deadline, while the request still runs, reaches it once, on its next read, and onTaskSettled never hears it", async () => {
    const notices: TaskSettledInput[] = [];
    let taskId = "";
    let settle: () => Promise<unknown> = async () => undefined;
    const seen: Parameters<typeof stepModel>[1] = [];
    const { model } = stepModel(
      [
        waitCall("c1", "q", 50),
        async (opts) => {
          taskId = waitedTaskId([opts], 0);
          // The colleague finishes while this request still runs.
          await settle();
          return getTask("c2", () => taskId)(opts);
        },
        finalAnswer
      ],
      seen
    );
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, inMemoryStores(), true, 25, SHORT);
    settle = () => act(state, flow, "settle", { outcome: { kind: "complete", output: "late but kept" } });
    try {
      const parked = await act(state, flow, "run");
      await until(state, parked.requestId!, "completed", 10_000);

      expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');
      const read = toolResults(seen[2]!.messages);
      expect(read).toContain('"status":"completed"');
      expect(read).toContain("late but kept");
      // Delivered by the read: nothing owed, the slot released, and no notice past its due time either.
      await new Promise((r) => setTimeout(r, 2_500));
      const [row] = await rows(state, flow);
      expect(row!.wait).toBeUndefined();
      expect(owedMarkers(row!)).toEqual([]);
      expect(notices).toEqual([]);
    } finally {
      await state.dispose();
    }
  });

  it("a request that ends without waiting again leaves the ending to one onTaskSettled", async () => {
    const notices: TaskSettledInput[] = [];
    const { model, seen } = stepModel([waitCall("c1", "q", 50), finalAnswer]);
    const flow = waitFlow(model, { heard: notices });
    const state = runtimeFor(flow, inMemoryStores(), true, 25, SHORT);
    try {
      const parked = await act(state, flow, "run");
      await until(state, parked.requestId!, "completed", 10_000);
      expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');
      // The request ended: its slot was released, and a later ending owes the notice.
      expect((await rows(state, flow))[0]!.wait).toBeUndefined();

      await act(state, flow, "settle", { outcome: { kind: "complete", output: "heard by the filer" } });
      for (let i = 0; i < 400 && notices.length === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
      expect(notices).toEqual([expect.objectContaining({ ending: "completed", output: "heard by the filer" })]);
      await new Promise((r) => setTimeout(r, 2_500));
      expect(notices).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });
});

const parkDirs: string[] = [];
const STORES: ReadonlyArray<readonly [string, () => Promise<StoreAdapter>]> = [
  ["in-memory", async () => inMemoryStores()],
  [
    "sqlite",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "fsd-wait-park-"));
      parkDirs.push(dir);
      return sqliteStores({ filename: join(dir, "store.db") });
    }
  ]
];

describe.each(STORES)("wait on a task: a deadline that passes while the request parks (%s)", (_name, stores) => {
  afterEach(async () => {
    for (const dir of parkDirs.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it("resumes the request with its deadline outcome soon after the park lands, not a retry interval later", async () => {
    // A slow park (a request-end hook that takes its time) must not cost the
    // agent its short deadline: once the request is recorded parked, a deadline
    // that passed meanwhile is delivered within about a sweep.
    const { model, seen } = stepModel([waitCall("c1", "q", 50), finalAnswer]);
    const flow = waitFlow(model, { parkTakesMs: 300 });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const parked = await act(state, flow, "run");
      // The park took longer than the deadline: it passed while the request parked.
      expect(await statusOf(state, parked.requestId!)).toBe("suspended");
      await until(state, parked.requestId!, "completed", 2_000);
      expect(toolResults(seen[1]!.messages)).toContain('"status":"pending"');
      expect((await rows(state, flow))[0]).toMatchObject({ status: "pending" });
    } finally {
      await state.dispose();
    }
  });

  it("a request that resumes and parks again on a second wait gets that deadline soon after its second park too", async () => {
    // The second park is a resumed run's, which holds the request's resume
    // lease until it has parked: the deadline must not wait out a retry for it.
    let taskId = "";
    const { model, seen } = stepModel([
      waitCall("c1", "q", 50),
      (opts) => {
        taskId = waitedTaskId([opts], 0);
        return waitAgain("c2", () => taskId, 50)(opts);
      },
      finalAnswer
    ]);
    const flow = waitFlow(model, { parkTakesMs: 300 });
    const state = runtimeFor(flow, await stores(), true, 25, SHORT);
    try {
      const parked = await act(state, flow, "run");
      await until(state, parked.requestId!, "completed", 3_000);
      expect(seen).toHaveLength(3);
      expect(toolResults(seen[2]!.messages)).toContain('"status":"pending"');
    } finally {
      await state.dispose();
    }
  });
});
