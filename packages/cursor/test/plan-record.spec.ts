/**
 * Cursor's to-do list in the run's plan record (`recordPlan`).
 *
 * What a reader of the plan panel relies on: the record equals the list Cursor
 * last confirmed, an empty confirmed list reads as empty rather than as no
 * plan, two runs in one request never share rows, a list that cannot be saved
 * in full says so without failing the run, and a host that leaves the option
 * off gets exactly the block it had before. The rows, the trim and the marker
 * are core's `replacePlanList`, tested in core; these hold the Cursor side,
 * through a scripted client.
 */
import { describe, it, expect } from "vitest";
import { createTestContext, testBlock } from "@flow-state-dev/testing";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  harnessRunNamespace,
  observedPlanCollection,
  observedPlanItemStateSchema,
  observedPlanListCollection,
} from "@flow-state-dev/core";
import { cursorAgent, INTERNAL_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import { TESTED_SDK_VERSION, type CursorSdkMessage, type ResolvedCursorClient } from "../src/types";
import { WHOLE_LIST, todosFailed, todosRunning, todosSettled, type WireTodo } from "./fixtures/update-todos";

const GATE_OFF = {
  [INTERNAL_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_SDK_VERSION }),
} as CursorAgentOptions;

/** A client whose one run replays `messages` and finishes. */
function replaying(messages: CursorSdkMessage[]): () => ResolvedCursorClient {
  const agent = {
    agentId: "agent_1",
    async send() {
      return {
        id: "run_1",
        stream: async function* () {
          for (const m of messages) yield m;
        },
        wait: async () => ({ status: "finished" }),
        cancel: async () => {},
      };
    },
  };
  return () => ({ create: async () => agent, resume: async () => agent });
}

/** An in-memory stand-in for a collection ref, optionally failing its Nth upsert. */
function memoryCollection(failOnUpsert?: number) {
  const rows = new Map<string, Record<string, unknown>>();
  let upserts = 0;
  return {
    rows,
    async getOptional(key: string) {
      const state = rows.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      upserts += 1;
      if (upserts === failOnUpsert) throw new Error("store unavailable");
      rows.set(key, { ...rows.get(key), ...update });
    },
    async delete(key: string) {
      rows.delete(key);
    },
  };
}

/** Run the block once against in-memory plan collections; return them and the run's namespace. */
async function runWithMemory(
  messages: CursorSdkMessage[],
  opts: { failPlanUpsert?: number } = {},
) {
  const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying(messages), recordPlan: true });
  const runtime = await createTestContext();
  const plan = memoryCollection(opts.failPlanUpsert);
  const marker = memoryCollection();
  const ctx = runtime.ctx as unknown as Record<string, unknown>;
  ctx.resources = { [OBSERVED_PLAN]: plan, [OBSERVED_PLAN_LIST]: marker };
  const handle = await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
  const ns = harnessRunNamespace(runtime.ctx as never);
  const rowsInOrder = [...plan.rows.entries()]
    .filter(([key]) => key.startsWith(`${ns}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, state]) => ({ title: state.title, status: state.status }));
  return { handle, plan, marker, ns, rowsInOrder, markerState: marker.rows.get(ns) };
}

const asRows = (todos: WireTodo[]) => todos.map((t) => ({ title: t.content, status: t.status }));

describe("recordPlan — the hand-off to core's replacePlanList (V2)", () => {
  it("ends with the record equal to the last list Cursor confirmed", async () => {
    const later: WireTodo[] = [
      { content: "Read the failing test", status: "completed" },
      { content: "Fix the parser", status: "completed" },
    ];
    const { rowsInOrder, markerState } = await runWithMemory([
      todosRunning("t1"),
      todosSettled("t1"),
      todosRunning("t2"),
      todosSettled("t2", later),
    ]);

    expect(rowsInOrder).toEqual(asRows(later));
    expect(markerState).toMatchObject({ status: "complete", count: 2 });
  });

  it("records the whole result list for a partial update, never the update as sent", async () => {
    const { rowsInOrder } = await runWithMemory([todosRunning("t1"), todosSettled("t1")]);
    expect(rowsInOrder).toEqual(asRows(WHOLE_LIST));
  });

  it("leaves the record as it was when Cursor rejects an update", async () => {
    const { rowsInOrder } = await runWithMemory([todosSettled("t1"), todosFailed("t2", [])]);
    expect(rowsInOrder).toEqual(asRows(WHOLE_LIST));
  });

  it("keeps two items with the same wording as two rows, and an unknown status as itself", async () => {
    const todos: WireTodo[] = [
      { content: "Run the suite", status: "completed" },
      { content: "Run the suite", status: "blockedOnReview" },
    ];
    const { rowsInOrder } = await runWithMemory([todosSettled("t1", todos)]);
    expect(rowsInOrder).toEqual(asRows(todos));
  });

  it("still writes a confirmed empty list, so the marker says complete with no places", async () => {
    const { rowsInOrder, markerState } = await runWithMemory([todosSettled("t1"), todosSettled("t2", [])]);
    expect(rowsInOrder).toEqual([]);
    expect(markerState).toEqual({ status: "complete", count: 0, reason: null });
  });

  it("writes no marker at all for a run that never confirmed a list", async () => {
    const { markerState } = await runWithMemory([todosRunning("t1")]);
    expect(markerState).toBeUndefined();
  });
});

describe("recordPlan — on the block (V3)", () => {
  it("is off by default: no resources declared, nothing written", async () => {
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([todosSettled("t1")]) });
    expect(block.declaredResources ?? {}).toEqual({});

    const { error } = await testBlock(block, { input: { prompt: "go" } });
    expect(error).toBeNull();
  });

  it("on, declares core's plan record and its list marker", () => {
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([]), recordPlan: true });
    expect(block.declaredResources?.[OBSERVED_PLAN]).toBe(observedPlanCollection);
    expect(block.declaredResources?.[OBSERVED_PLAN_LIST]).toBe(observedPlanListCollection);
  });

  it("keeps two invocations in one request apart: rows and marker per invocation", async () => {
    const first: WireTodo[] = [{ content: "First run's item", status: "pending" }];
    const second: WireTodo[] = [
      { content: "Second run's item", status: "inProgress" },
      { content: "Second run's other item", status: "pending" },
    ];
    const blockA = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([todosSettled("a", first)]), recordPlan: true });
    const blockB = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([todosSettled("b", second)]), recordPlan: true });
    const runtime = await createTestContext({ requestId: "req_shared", declaredResources: blockA.declaredResources });
    const ctx = runtime.ctx as unknown as Record<string, unknown>;

    ctx._blockIdentity = { blockPath: "root/tool(cursor-agent,0:call_a)", attempt: 0 };
    await blockA.config.execute?.({ prompt: "go" }, runtime.ctx as never);
    const nsA = harnessRunNamespace(runtime.ctx as never);
    ctx._blockIdentity = { blockPath: "root/tool(cursor-agent,1:call_b)", attempt: 0 };
    await blockB.config.execute?.({ prompt: "go" }, runtime.ctx as never);
    const nsB = harnessRunNamespace(runtime.ctx as never);
    expect(nsA).not.toBe(nsB);

    const resources = runtime.ctx.resources as unknown as Record<
      string,
      { list(): Promise<Array<{ path: string; state: Record<string, unknown> }>> }
    >;
    const rows = await resources[OBSERVED_PLAN].list();
    const titlesUnder = (ns: string) =>
      rows
        .filter((r) => r.path.startsWith(`${OBSERVED_PLAN}/${ns}/`))
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((r) => r.state.title);
    expect(titlesUnder(nsA)).toEqual(["First run's item"]);
    expect(titlesUnder(nsB)).toEqual(["Second run's item", "Second run's other item"]);

    const markers = await resources[OBSERVED_PLAN_LIST].list();
    const markerFor = (ns: string) => markers.find((m) => m.path === `${OBSERVED_PLAN_LIST}/${ns}`)?.state;
    expect(markerFor(nsA)).toMatchObject({ status: "complete", count: 1 });
    expect(markerFor(nsB)).toMatchObject({ status: "complete", count: 2 });
  });

  it("marks the list incomplete when a row fails to save, and the run still finishes", async () => {
    const { handle, markerState } = await runWithMemory([todosSettled("t1")], { failPlanUpsert: 2 });

    expect(markerState?.status).toBe("incomplete");
    expect(String(markerState?.reason)).toContain("store unavailable");
    expect(handle).toMatchObject({ status: "completed", outcome: "finished" });
  });

  it("runs unrecorded, and does not fail, when the flow has not registered the collections", async () => {
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([todosSettled("t1")]), recordPlan: true });
    // No declared resources: the refs are not there.
    const runtime = await createTestContext();
    const handle = await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
    expect(handle).toMatchObject({ status: "completed" });
  });
});

describe("recordPlan — what a reader receives (V4)", () => {
  it("writes rows that parse with core's shape and reach a subscribed client live", async () => {
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([todosSettled("t1")]), recordPlan: true });
    const runtime = await createTestContext({ declaredResources: block.declaredResources });
    const seen: Array<{ type?: string; resourcePath?: string; delta?: unknown }> = [];
    (runtime.response as unknown as { addEventObserver(fn: (e: unknown) => void): void }).addEventObserver((e) => {
      const item = (e as { item?: { type?: string } }).item;
      if (item?.type === "resource_change") seen.push(item);
    });

    await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const ns = harnessRunNamespace(runtime.ctx as never);
    // The latest delta per row: what an open page holds once the run has written.
    const latest = new Map<string, unknown>();
    for (const c of seen) {
      if (c.resourcePath?.startsWith(`${OBSERVED_PLAN}/${ns}/`)) latest.set(c.resourcePath, c.delta);
    }
    const rows = [...latest.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, delta]) => delta);
    expect(rows).toHaveLength(WHOLE_LIST.length);
    for (const [place, delta] of rows.entries()) {
      // `.strict()`: a field the shared shape lacks fails here.
      const parsed = observedPlanItemStateSchema.strict().parse(delta);
      expect(parsed).toMatchObject({
        title: WHOLE_LIST[place]!.content,
        status: WHOLE_LIST[place]!.status,
        lastOutcome: "applied",
      });
    }
    // And what is stored, which a reader loading the page later gets.
    const stored = await (
      runtime.ctx.resources as unknown as Record<string, { list(): Promise<Array<{ state: unknown }>> }>
    )[OBSERVED_PLAN].list();
    expect(stored).toHaveLength(WHOLE_LIST.length);
    for (const row of stored) observedPlanItemStateSchema.strict().parse(row.state);
    const marker = seen.filter((c) => c.resourcePath === `${OBSERVED_PLAN_LIST}/${ns}`);
    expect(marker.at(-1)?.delta).toEqual({ status: "complete", count: WHOLE_LIST.length, reason: null });
  });
});
