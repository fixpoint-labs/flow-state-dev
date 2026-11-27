/**
 * Codex's to-do list in the run's plan record (`recordPlan`).
 */
import { describe, it, expect } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  harnessConversationNamespace,
  harnessRunNamespace,
  observedPlanCollection,
  observedPlanListCollection,
} from "@flow-state-dev/core/harness";
import { codexAgent, INTERNAL_CODEX_SDK_VERSION_READER, type CodexAgentOptions } from "../src/agent";
import { TESTED_CODEX_SDK, type CodexThreadEvent } from "../src/types";

const GATE_OFF = {
  [INTERNAL_CODEX_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CODEX_SDK.range }),
} as CodexAgentOptions;

function scripted(events: CodexThreadEvent[]) {
  const thread = {
    id: "thr_1",
    async runStreamed() {
      return {
        events: (async function* () {
          yield { type: "thread.started", thread_id: "thr_1" } as CodexThreadEvent;
          for (const e of events) yield e;
          yield { type: "turn.completed", usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 1 } } as CodexThreadEvent;
        })(),
      };
    },
  };
  return () => ({ startThread: () => thread, resumeThread: () => thread });
}

function memoryCollection() {
  const rows = new Map<string, Record<string, unknown>>();
  return {
    rows,
    async getOptional(key: string) {
      const state = rows.get(key);
      return state === undefined ? undefined : { state };
    },
    async upsert(key: string, update: Record<string, unknown>) {
      rows.set(key, { ...rows.get(key), ...update });
    },
    async delete(key: string) {
      rows.delete(key);
    },
  };
}

async function run(events: CodexThreadEvent[], options: Partial<CodexAgentOptions> = {}) {
  const block = codexAgent({ ...GATE_OFF, resolveCodexClient: scripted(events) as never, recordPlan: true, ...options });
  const runtime = await createTestContext();
  const plan = memoryCollection();
  const marker = memoryCollection();
  const ctx = runtime.ctx as unknown as Record<string, unknown>;
  ctx.resources = { [OBSERVED_PLAN]: plan, [OBSERVED_PLAN_LIST]: marker };
  await block.config.execute?.({ prompt: "go" }, runtime.ctx as never);
  const ns = harnessConversationNamespace("thr_1");
  const rowsInOrder = [...plan.rows.entries()]
    .filter(([key]) => key.startsWith(`${ns}/`))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, state]) => ({ title: state.title, status: state.status }));
  return { plan, marker, ns, rowsInOrder, pointer: marker.rows.get(harnessRunNamespace(runtime.ctx as never)) };
}

describe("recordPlan — Codex block", () => {
  it("ends with the record equal to the last todo_list Codex confirmed", async () => {
    const { rowsInOrder, pointer } = await run([
      {
        type: "item.completed",
        item: {
          id: "i1",
          type: "todo_list",
          items: [
            { text: "Read the task", completed: true },
            { text: "Fix the bug", completed: false },
          ],
        },
      },
      {
        type: "item.completed",
        item: {
          id: "i2",
          type: "todo_list",
          items: [
            { text: "Read the task", completed: true },
            { text: "Fix the bug", completed: true },
            { text: "Run checks", completed: false },
          ],
        },
      },
    ]);
    expect(rowsInOrder).toEqual([
      { title: "Read the task", status: "completed" },
      { title: "Fix the bug", status: "completed" },
      { title: "Run checks", status: "pending" },
    ]);
    expect(pointer?.conversation).toBe(harnessConversationNamespace("thr_1"));
  });

  it("declares the plan collections when recordPlan is on, and nothing extra when it is off", () => {
    const on = codexAgent({ ...GATE_OFF, recordPlan: true });
    const off = codexAgent({ ...GATE_OFF, recordPlan: false, recordPullRequests: false });
    expect(on.declaredResources?.[OBSERVED_PLAN]).toBe(observedPlanCollection);
    expect(on.declaredResources?.[OBSERVED_PLAN_LIST]).toBe(observedPlanListCollection);
    expect(off.declaredResources?.[OBSERVED_PLAN]).toBeUndefined();
  });
});