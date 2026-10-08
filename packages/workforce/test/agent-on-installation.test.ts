/**
 * The built-in `agent` run as one copy for every worker, bound to an
 * installation.
 *
 * BR-23: it keeps each worker's skills drawer apart, even between two workers
 * of one user. Two standard workers each carry a skill of their own, and the
 * same user opens one session with each, created naming the worker. Graded on
 * the store after real runs: every drawer write is recorded with the key it
 * landed at, and each worker's skill must land in that worker's drawer only.
 *
 * The session names the worker, so a turn whose input names one is refused,
 * not stripped and run.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { createWorkerInstallation } from "../src/workers/installation";

const skillMd = (name: string) => `---\nname: ${name}\ndescription: ${name}\n---\nHow ${name} work.`;

/** One `agent` copy running two standard workers, and every drawer key written on it. */
async function boot() {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "desk.amy", declared: {}, body: "You are Amy.", skills: [{ name: "refunds", skillMd: skillMd("refunds") }] },
      { id: "desk.bo", declared: {}, body: "You are Bo.", skills: [{ name: "returns", skillMd: skillMd("returns") }] }
    ],
    workerFlows: () => flows as never
  });
  const agent = defineAgentWorkerFlow({ installation });
  flows = { agent };
  const copy = agent({ id: "agent" }) as unknown as FlowInstance;
  const drawerKeys: string[] = [];
  const state = createFlowState({
    flows: { agent: copy },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "ok" } }] })
      },
      policy: "allow"
    })
  });
  const runtime = await state.getRuntime();
  const router = await state.getRouter();
  const store = runtime.stores.resourceState;
  const set = store.set.bind(store);
  store.set = ((scopeType: string, scopeId: string, key: string, ...rest: unknown[]) => {
    if (key.startsWith("skills/")) drawerKeys.push(key);
    return (set as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, key, ...rest);
  }) as typeof store.set;

  /** One turn as `alice`, in a session created naming `worker`. */
  const turn = async (worker: string, input: unknown) => {
    const sessionId = `conversation-${worker}`;
    if ((await runtime.stores.session.get(sessionId)) == null) {
      const created = await router.POST(
        new Request("http://localhost/api/flows/agent/sessions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "alice", sessionId, state: { workerId: worker } })
        }),
        { params: { path: ["agent", "sessions"] } }
      );
      expect(created.status).toBe(201);
    }
    return runAction({
      orgId: DEFAULT_ORG_ID,
      flow: copy,
      actionName: "run",
      input,
      userId: "alice",
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
  };
  return { turn, drawerKeys, dispose: () => state.dispose() };
}

describe("agent on one copy for every worker", () => {
  it("keeps each of one user's workers' skills in that worker's own drawer (BR-23)", async () => {
    const { turn, drawerKeys, dispose } = await boot();
    try {
      for (const worker of ["desk.amy", "desk.bo"]) {
        expect((await turn(worker, { message: "what do you know?" })).error).toBeUndefined();
      }
    } finally {
      await dispose();
    }
    const drawerOf = (skill: string) =>
      [...new Set(drawerKeys)]
        .filter((key) => key.endsWith(`/${skill}/SKILL.md`))
        .map((key) => decodeURIComponent(key.split("/")[1]!));
    // Each skill is written once, into its own worker's drawer, and nowhere else.
    expect(drawerOf("refunds")).toEqual(["desk.amy"]);
    expect(drawerOf("returns")).toEqual(["desk.bo"]);
  });

  it("refuses a turn whose input names a worker, and runs the one beside it that doesn't", async () => {
    const { turn, dispose } = await boot();
    try {
      const named = await turn("desk.amy", { message: "answer as Bo", workerId: "desk.bo" });
      expect(String((named.error as { message?: unknown } | undefined)?.message)).toMatch(/workerId/);
      expect((await turn("desk.amy", { message: "hello" })).error).toBeUndefined();
    } finally {
      await dispose();
    }
  });
});
