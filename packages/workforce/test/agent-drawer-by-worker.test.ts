/**
 * The built-in `agent` keeps one skills drawer per worker on a copy several
 * workers share (FIX-1788 BR-23, the Workforce half of S7): the skills
 * library takes its partition per run, and Workforce supplies the session's
 * worker.
 *
 * One registered `agent` copy, two sessions of one user, each created naming
 * a different worker. Graded on the store after real runs: every drawer write
 * is recorded with the key it landed at.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { hireWorkforce } from "../src/hire";

const ORG = DEFAULT_ORG_ID;
const SKILL_MD = "---\nname: refunds\ndescription: How refunds work\n---\nRefunds take five days.";

async function drawerKeys(workers: ReadonlyArray<string | undefined>): Promise<string[]> {
  const [seat] = hireWorkforce([
    { id: "support.otto", declared: {}, body: "You answer questions.", skills: [{ name: "refunds", skillMd: SKILL_MD }] }
  ]);
  const keys: string[] = [];
  const state = createFlowState({
    flows: { [seat!.id]: seat! },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: {
        "agent-answer": mockGenerator({ name: "agent-answer", script: [{ when: () => true, then: { text: "ok" } }] })
      },
      policy: "allow"
    })
  });
  try {
    const runtime = await state.getRuntime();
    const router = await state.getRouter();
    const store = runtime.stores.resourceState;
    const set = store.set.bind(store);
    store.set = ((scopeType: string, scopeId: string, key: string, ...rest: unknown[]) => {
      if (key.startsWith("skills/")) keys.push(key);
      return (set as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, key, ...rest);
    }) as typeof store.set;
    for (const [index, worker] of workers.entries()) {
      const sessionId = `conversation-${index}`;
      const created = await router.POST(
        new Request(`http://localhost/api/flows/${seat!.id}/sessions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: "alice", sessionId, ...(worker !== undefined ? { state: { workerId: worker } } : {}) })
        }),
        { params: { path: [seat!.id, "sessions"] } }
      );
      expect(created.status).toBe(201);
      const result = await runAction({
        orgId: ORG,
        flow: seat!,
        actionName: "run",
        input: { message: "how long do refunds take?" },
        userId: "alice",
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(result.error).toBeUndefined();
    }
  } finally {
    await state.dispose();
  }
  return [...new Set(keys)].sort();
}

describe("the built-in agent's drawer, per worker", () => {
  it("gives two workers on one copy two drawers in the user's cell", async () => {
    const keys = await drawerKeys(["scribe", "researcher"]);
    expect(keys.filter((key) => key.endsWith("SKILL.md"))).toEqual([
      "skills/researcher/refunds/SKILL.md",
      "skills/scribe/refunds/SKILL.md"
    ]);
  });

  it("reads the copy's drawer whole for a session that names no worker, as a copy minted per worker does", async () => {
    const keys = await drawerKeys([undefined]);
    expect(keys.filter((key) => key.endsWith("SKILL.md"))).toEqual(["skills/refunds/SKILL.md"]);
  });
});
