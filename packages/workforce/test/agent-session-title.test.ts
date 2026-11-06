/**
 * The agent worker flow's title (the lab's wiring): `afterAnswer` set to core's
 * `utility.sessionTitleGenerator`, run as a sidechain of each turn. A turn that
 * ends must leave the session titled with what the generator wrote, because the
 * sessions list reads the stored title and falls back to the first message only
 * while there is none.
 *
 * Driven through `testFlow`, the same `runAction` the server uses, so the
 * sidechain drains before the turn's result is read. A direct `executeBlock` on
 * the respond block would return with the title still pending.
 */
import { describe, expect, it } from "vitest";
import { utility } from "@flow-state-dev/core";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";

const USER_ID = "one-human";

async function runTurn(titler: ReturnType<typeof mockGenerator>) {
  const manifest: WorkerManifest = { id: "desk.main", declared: {}, body: "Main." };
  const worker = mintWorkers([manifest], {
    workerFlows: {
      [AGENT_FLOW]: defineAgentWorkerFlow({
        afterAnswer: utility.sessionTitleGenerator({ name: "auto-title", model: "openai/gpt-6-luna" })
      })
    }
  })[0]!;
  const answer = mockGenerator({ name: "agent-answer", script: [{ text: "Here is the billing plan." }] });
  const stores = createInMemoryStores();
  const sessionId = "session-title";
  const now = new Date().toISOString();
  // A session the worker's flow owns, as the sessions list finds it (see agent-worker-memory.test.ts).
  await stores.session.set(
    sessionId,
    { id: sessionId, flowKind: worker.kind, flowId: worker.id, userId: USER_ID, orgId: "test-org", state: {}, version: 0, createdAt: now, updatedAt: now, journal: [] } as never,
    "any"
  );
  const result = await testFlow({
    sessionId,
    flow: worker,
    action: "respond",
    userId: USER_ID,
    input: { message: "Plan the billing migration" },
    stores,
    seed: { org: { state: {} } },
    generators: { "agent-answer": answer, "auto-title:generate": titler }
  });
  const session = await stores.session.get(sessionId);
  return { result, session, answer };
}

describe("the agent worker flow's session title", () => {
  it("titles the session with the generator's title as a sidechain of the turn, and the turn still answers", async () => {
    const titler = mockGenerator({ name: "auto-title:generate", script: [{ structuredOutput: { title: "Plan the billing migration" } }] });

    const { result, session, answer } = await runTurn(titler);

    expect(result.status).toBe("completed");
    expect(answer.calls).toHaveLength(1);
    expect(titler.calls).toHaveLength(1);
    expect(session?.title).toBe("Plan the billing migration");
  });

  it("leaves the session untitled when generation fails, and the turn still completes with its answer", async () => {
    const failing = mockGenerator({ name: "auto-title:generate", script: [{ text: "not a title object" }] });

    const { result, session, answer } = await runTurn(failing);

    expect(result.status).toBe("completed");
    expect(answer.calls).toHaveLength(1);
    expect(session?.title).toBeUndefined();
  });
});
