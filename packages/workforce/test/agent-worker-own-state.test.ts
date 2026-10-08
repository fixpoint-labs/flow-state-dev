/**
 * The built-in `agent` keeps a worker's own state out of org scope (FIX-1789
 * V6: BR-9, BR-17, BR-18).
 *
 * Org scope is shared with every member of an org, so whatever a flow writes
 * there, every member's runs can read. The built-in `agent`'s own working
 * state, its skills drawer, belongs to the user the worker runs for. Graded on
 * the store after a real run, not on the flow's declaration: every write the
 * run makes is recorded with the scope it landed in.
 */
import { describe, expect, it } from "vitest";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { mintSeats } from "../src/hire";

const ORG = "acme";
const SKILL_MD = "---\nname: refunds\ndescription: How refunds work\n---\nRefunds take five days.";

type Write = { scopeType: string; scopeId: string; key: string };

async function runAs(users: readonly string[]): Promise<Write[]> {
  const [seat] = mintSeats([
    {
      id: "support.otto",
      declared: {},
      body: "You answer questions.",
      skills: [{ name: "refunds", skillMd: SKILL_MD }]
    }
  ]);
  const writes: Write[] = [];
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
    const store = runtime.stores.resourceState;
    const set = store.set.bind(store);
    store.set = ((scopeType: string, scopeId: string, key: string, ...rest: unknown[]) => {
      writes.push({ scopeType, scopeId, key });
      return (set as (...args: unknown[]) => Promise<unknown>)(scopeType, scopeId, key, ...rest);
    }) as typeof store.set;
    for (const user of users) {
      const result = await runAction({
        orgId: ORG,
        flow: seat!,
        actionName: "run",
        input: { message: "how long do refunds take?" },
        userId: user,
        sessionId: `${user}-conversation`,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(result.error).toBeUndefined();
    }
  } finally {
    await state.dispose();
  }
  return writes;
}

describe("the built-in agent's own state", () => {
  it("is written in its user's scope, and the org's cells hold none of it (BR-17)", async () => {
    const drawer = (await runAs(["alice"])).filter((w) => w.key.startsWith("skills/"));
    // The drawer was written: an empty list would pass the org check below vacuously.
    expect(drawer.length).toBeGreaterThan(0);
    expect(drawer.filter((w) => w.scopeType === "org")).toEqual([]);
    expect(new Set(drawer.map((w) => w.scopeType))).toEqual(new Set(["user"]));
    expect(drawer.every((w) => w.scopeId.includes("alice"))).toBe(true);
  });

  it("is kept apart for another user of the same org (BR-18)", async () => {
    const drawer = (await runAs(["alice", "bob"])).filter((w) => w.key.startsWith("skills/"));
    const cells = new Set(drawer.map((w) => `${w.scopeType}|${w.scopeId}`));
    const alices = [...cells].filter((cell) => cell.includes("alice"));
    const bobs = [...cells].filter((cell) => cell.includes("bob"));
    expect(alices.length).toBeGreaterThan(0);
    expect(bobs.length).toBeGreaterThan(0);
    // No cell holds both users' rows: bob's run seeded and read his own.
    expect(alices.filter((cell) => bobs.includes(cell))).toEqual([]);
    expect(cells.size).toBe(alices.length + bobs.length);
  });
});
