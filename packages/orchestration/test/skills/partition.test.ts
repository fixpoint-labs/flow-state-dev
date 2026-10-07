/**
 * A skills library kept per partition (`createSkillsLibrary({ partitionBy })`):
 * several parties run through ONE registered copy of a flow, and each reads
 * and writes only its own catalog.
 *
 * On the real engine. The party is a readonly session-state field, set when
 * the session is created and never changed, so the test reads what a run sees
 * and what the store holds, never a key it computed itself.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockContext, FlowInstance } from "@flow-state-dev/core/types";
import {
  createFlowApiRouter,
  createFlowRegistry,
  createInMemoryStores,
  resolveUserStorageKey,
  runAction,
  type StoreRegistry
} from "@flow-state-dev/engine";
import { z } from "zod";
import { defineSkillsCollection } from "../../src/skills/collection";
import { resolveSkillsCollection } from "../../src/skills/partition";

function drawerFlow(partitioned: boolean): FlowInstance {
  // The collection the library declares, on its own: a handler can't take
  // the library's context presets, and the partition lives on the collection.
  const skills = defineSkillsCollection({
    scope: "user",
    ...(partitioned ? { partitionBy: (ctx: BlockContext) => (ctx.session.state as { party?: string }).party } : {})
  });
  const keep = handler({
    name: "keep",
    inputSchema: z.object({ note: z.string() }),
    resources: { skills },
    execute: async (input, ctx) => {
      const skills = resolveSkillsCollection(ctx, "skills")!;
      await skills.create(`${input.note}/SKILL.md`, { name: input.note, description: input.note });
      return { held: (await skills.list()).map((ref) => ref.state.name).sort() };
    }
  });
  const look = handler({
    name: "look",
    inputSchema: z.object({ note: z.string() }),
    resources: { skills },
    execute: async (_input, ctx) => {
      const view = resolveSkillsCollection(ctx, "skills")!;
      return {
        held: (await view.list()).map((ref) => ref.state.name).sort(),
        found: (await view.getOptional("alpha/SKILL.md")) !== undefined
      };
    }
  });
  return defineFlow({
    kind: "drawer",
    session: { stateSchema: z.object({ party: z.string().readonly().optional() }) },
    actions: {
      keep: { inputSchema: z.object({ note: z.string() }), block: keep },
      look: { inputSchema: z.object({ note: z.string() }), block: look }
    }
  })({ id: "drawer" }) as unknown as FlowInstance;
}

async function boot(partitioned: boolean) {
  const flow = drawerFlow(partitioned);
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  registry.register(flow);
  const router = createFlowApiRouter({ registry, stores });
  for (const [sessionId, party] of [["s-a", "worker-a"], ["s-b", "worker-b"], ["s-none", undefined]]) {
    const res = await router.POST(
      new Request("http://localhost/api/flows/drawer/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "alice", sessionId, ...(party !== undefined ? { state: { party } } : {}) })
      }),
      { params: { path: ["drawer", "sessions"] } }
    );
    expect(res.status).toBe(201);
  }
  const run = (sessionId: string, actionName: "keep" | "look", note: string) =>
    runAction({
      flow, actionName, input: { note }, userId: "alice", orgId: DEFAULT_ORG_ID, sessionId, stores, runtimeConfig: {}
    });
  const keep = async (sessionId: string, note: string) => {
    const result = await run(sessionId, "keep", note);
    expect(result.error).toBeUndefined();
    return (result.output as { held: string[] }).held;
  };
  return { stores, keep, run };
}

async function storedKeys(stores: StoreRegistry): Promise<string[]> {
  const cell = resolveUserStorageKey("alice", DEFAULT_ORG_ID, { id: "drawer", isolateUserState: false });
  return Object.keys(await stores.resourceState.getAll("user", cell)).filter((key) => key.endsWith("SKILL.md")).sort();
}

describe("a skills library kept per partition", () => {
  it("gives each party on one copy of a flow its own catalog", async () => {
    const { stores, keep } = await boot(true);
    expect(await keep("s-a", "alpha")).toEqual(["alpha"]);
    expect(await keep("s-b", "beta")).toEqual(["beta"]);
    expect(await keep("s-a", "gamma")).toEqual(["alpha", "gamma"]);
    expect(await storedKeys(stores)).toEqual([
      "skills/worker-a/alpha/SKILL.md",
      "skills/worker-a/gamma/SKILL.md",
      "skills/worker-b/beta/SKILL.md"
    ]);
  });

  it("gives a run with no partition no party's skills, and refuses its writes", async () => {
    const { keep, run } = await boot(true);
    await keep("s-a", "alpha");
    await keep("s-b", "beta");
    const looked = await run("s-none", "look", "");
    expect(looked.error).toBeUndefined();
    expect(looked.output).toEqual({ held: [], found: false });
    const wrote = await run("s-none", "keep", "gamma");
    expect(String((wrote.error as { message?: string } | undefined)?.message ?? wrote.error)).toMatch(/names none/);
  });

  it("is one shared catalog without a partition, which is what the option exists to split", async () => {
    const { keep } = await boot(false);
    expect(await keep("s-a", "alpha")).toEqual(["alpha"]);
    expect(await keep("s-b", "beta")).toEqual(["alpha", "beta"]);
  });
});
