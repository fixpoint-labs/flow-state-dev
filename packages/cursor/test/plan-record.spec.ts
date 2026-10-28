/**
 * Cursor's to-do list in the run's plan record (`recordPlan`).
 *
 * What a reader of the plan panel relies on: the record equals the list Cursor
 * last confirmed, the plan belongs to Cursor's agent so a later run of the same
 * agent carries it on, each run points at the agent's plan, an empty confirmed
 * list reads as empty rather than as no plan, two agents never share rows, a
 * list that cannot be saved
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
  harnessConversationNamespace,
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

/** A client whose one run replays `messages` and finishes, on agent `agentId`. */
function replaying(messages: CursorSdkMessage[], agentId = "agent_1"): () => ResolvedCursorClient {
  const agent = {
    agentId,
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

/** Run the block once against in-memory plan collections; return them, the agent's plan namespace and the run's pointer. */
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
  const ns = harnessConversationNamespace("agent_1");
  const pointer = marker.rows.get(harnessRunNamespace(runtime.ctx as never));
  const rowsInOrder = [...plan.rows.entries()]
    .filter(([key]) => key.startsWith(`${ns}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, state]) => ({ title: state.title, status: state.status }));
  return { handle, plan, marker, ns, pointer, rowsInOrder, markerState: marker.rows.get(ns) };
}

const asRows = (todos: WireTodo[]) => todos.map((t) => ({ title: t.content, status: t.status }));

describe("recordPlan — what it passes to core's replacePlanList (V2)", () => {
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

  it("writes no plan marker for a run that never confirmed a list, only the run's pointer", async () => {
    const { markerState, pointer } = await runWithMemory([todosRunning("t1")]);
    expect(markerState).toBeUndefined();
    expect(pointer).toEqual({ conversation: "conversation/agent_1" });
  });

  it("stamps each row with the request that wrote it", async () => {
    const { plan } = await runWithMemory([todosSettled("t1")]);
    const requestIds = new Set([...plan.rows.values()].map((row) => row.requestId));
    expect(requestIds.size).toBe(1);
    expect([...requestIds][0]).toEqual(expect.any(String));
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

  it("gives a later run of the same agent its plan, and keeps a different agent's apart", async () => {
    const first: WireTodo[] = [
      { content: "Read the failing test", status: "completed" },
      { content: "Fix the parser", status: "pending" },
    ];
    const other: WireTodo[] = [{ content: "Another agent's item", status: "inProgress" }];
    const turn1 = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([todosSettled("a", first)]), recordPlan: true });
    // The same agent's next run updates nothing: its plan stays turn 1's.
    const turn2 = cursorAgent({ ...GATE_OFF, resolveCursorClient: replaying([]), recordPlan: true });
    const elsewhere = cursorAgent({
      ...GATE_OFF,
      resolveCursorClient: replaying([todosSettled("c", other)], "agent_2"),
      recordPlan: true,
    });
    const runtime = await createTestContext({ requestId: "req_shared", declaredResources: turn1.declaredResources });
    const ctx = runtime.ctx as unknown as Record<string, unknown>;

    const runs: string[] = [];
    for (const [i, block] of [turn1, turn2, elsewhere].entries()) {
      ctx._blockIdentity = { blockPath: `root/tool(cursor-agent,${i}:call_${i})`, attempt: 0 };
      await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
      runs.push(harnessRunNamespace(runtime.ctx as never));
    }

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
    const agent1 = harnessConversationNamespace("agent_1");
    const agent2 = harnessConversationNamespace("agent_2");
    expect(titlesUnder(agent1)).toEqual(["Read the failing test", "Fix the parser"]);
    expect(titlesUnder(agent2)).toEqual(["Another agent's item"]);
    for (const run of runs) expect(titlesUnder(run)).toEqual([]);

    const markers = await resources[OBSERVED_PLAN_LIST].list();
    const markerFor = (ns: string) => markers.find((m) => m.path === `${OBSERVED_PLAN_LIST}/${ns}`)?.state;
    expect(markerFor(agent1)).toMatchObject({ status: "complete", count: 2 });
    expect(markerFor(agent2)).toMatchObject({ status: "complete", count: 1 });
    expect(runs.map((run) => markerFor(run)?.conversation)).toEqual([agent1, agent1, agent2]);
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

    const ns = harnessConversationNamespace("agent_1");
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
    expect(marker.at(-1)?.delta).toEqual({ status: "complete", count: WHOLE_LIST.length, reason: null, conversation: null });
  });
});
