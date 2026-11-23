/**
 * A worker flow names its sessions by their worker (FIX-2875).
 *
 * A worker's session id is derived (`wks_…`), and so is a task's (`dsx_…`):
 * both are hashes. `installation.session()` gives every worker flow a
 * `session.label`, so a reader of the session (the developer tool's flow
 * tree) shows "Amy" or "Amy · task_…" instead.
 */
import { describe, expect, it } from "vitest";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { createWorkerInstallation } from "../src/workers/installation";

function installation() {
  return createWorkerInstallation({
    standardWorkers: [
      { id: "desk.amy", declared: { name: "Amy" }, body: "You are Amy." },
      { id: "desk.bo", declared: {}, body: "You are Bo." }
    ]
  });
}

describe("a worker flow's session label", () => {
  const label = installation().session().label!;

  it("names a worker's session by the worker's name, else its id", () => {
    expect(label({ id: "wks_1", state: { workerId: "desk.amy" } })).toBe("Amy");
    expect(label({ id: "wks_2", state: { workerId: "desk.bo" } })).toBe("desk.bo");
    // A hired worker's name is on its owner's roster, which a label cannot read.
    expect(label({ id: "wks_3", state: { workerId: "my-helper" } })).toBe("my-helper");
  });

  it("names a task's session by its worker and its task", () => {
    expect(label({ id: "dsx_1", state: { workerId: "desk.amy", taskId: "task_0a1b2c" } })).toBe("Amy · task_0a1b2c");
  });

  it("names nothing for a session with no worker", () => {
    expect(label({ id: "s", state: {} })).toBeUndefined();
  });

  it("goes out on the session listing of the built-in agent flow, beside the flow's description", async () => {
    let flows: Record<string, unknown> = {};
    const built = createWorkerInstallation({
      standardWorkers: [{ id: "desk.amy", declared: { name: "Amy" }, body: "You are Amy." }],
      workerFlows: () => flows as never
    });
    const agent = defineAgentWorkerFlow({ installation: built });
    flows = { agent };
    const state = createFlowState({
      flows: [agent({ id: "agent" }) as unknown as FlowInstance],
      stores: { default: { primary: inMemoryStores() } }
    });
    const router = await state.getRouter();

    const created = await router.POST(
      new Request("http://localhost/api/flows/agent/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", sessionId: "conversation-amy", state: { workerId: "desk.amy" } })
      }),
      { params: { path: ["agent", "sessions"] } }
    );
    expect(created.status).toBe(201);

    const listed = await router.GET(new Request("http://localhost/api/flows/sessions?userId=alice&flowId=agent"), {
      params: { path: ["sessions"] }
    });
    const sessions = ((await listed.json()) as { sessions: Array<{ id: string; label?: string }> }).sessions;
    expect(sessions.map((s) => [s.id, s.label])).toEqual([["conversation-amy", "Amy"]]);

    const flowList = await router.GET(new Request("http://localhost/api/flows"), { params: { path: [] } });
    const described = ((await flowList.json()) as { flows: Array<{ id: string; description?: string }> }).flows;
    expect(described.find((f) => f.id === "agent")?.description).toMatch(/worker/i);
  });
});
