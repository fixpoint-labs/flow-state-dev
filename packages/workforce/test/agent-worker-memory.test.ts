/**
 * Memory attaching to the built-in `agent` kind by composition — the three
 * app-level doors, and whether a worker built to the documented recipe
 * actually remembers.
 *
 * The first test is the one that matters. A worker carrying only the read
 * side of memory recalls whatever something else stored and records nothing
 * of its own, and every other check here passes on exactly that worker. So
 * the round trip is written with **nothing seeded**: the fact has to come out
 * of the worker's own conversation or it is not there to read back.
 *
 * `@flow-state-dev/memory` is a devDependency for these tests only. The
 * package itself must not depend on it, which is what the last test pins —
 * the whole point of a generic seam is that this package knows no memory.
 *
 * Two harness notes:
 *
 * - The seats are driven through `testFlow` with their sessions pre-seeded,
 *   because `testFlow` seeds a session naming no owning instance and a
 *   collection flow's ownership check refuses that run. Tracked as FIX-1397.
 * - The fence test resolves its own model so it can read the tool list handed
 *   to the provider, which is the thing being asserted. Counting a tool's
 *   `execute` (as the sibling fence tests do) would only prove the model did
 *   not call a tool it was offered.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator, testFlow } from "@flow-state-dev/testing";
import { system } from "@flow-state-dev/memory";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";

const USER_ID = "one-human";
const FACT = "the human prefers dark mode";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hire(manifests: WorkerManifest[], kinds: HireOptions["kinds"] = {}): FlowInstance[] {
  return hireWorkforce(manifests, { kinds });
}

/** The write-side entry point — `createMemoryCapability` would be read-only. */
function memory() {
  return system({
    model: "openai/gpt-5.4-mini",
    working: { capacity: 7 },
    episodic: true,
    semantic: true
  });
}

/**
 * The recipe the README teaches: tool-bearing presets off so a worker's
 * `tools:` stays the only door, the two durable read presets on (they are off
 * by default, and without them the stores are written and never read back),
 * and the capture pipeline in the post-answer door.
 */
/**
 * The same kind with memory's tool-bearing presets left ON, so the capability
 * actually contributes a tool for the fence to act on. `rememberingKind` turns
 * `recall`/`connect` off — which is the documented recipe, but it also means a
 * fence test built on it has nothing to observe and passes either way.
 */
function toolBearingKind(mem: ReturnType<typeof memory>) {
  return defineAgentWorkerFlow({
    uses: [
      mem.capability.presets({
        recall: true,
        connect: true,
        semantic: true,
        episodic: true
      })
    ],
    isolateUserState: false,
    afterAnswer: mem.captureFromItems
  });
}

function rememberingKind(mem: ReturnType<typeof memory>, isolateUserState: boolean) {
  return defineAgentWorkerFlow({
    uses: [
      mem.capability.presets({
        recall: false,
        connect: false,
        semantic: true,
        episodic: true
      })
    ],
    isolateUserState,
    afterAnswer: mem.captureFromItems
  });
}

/** What the observer "extracts" — permanent + a stable category reaches semantic. */
function observed(content: string) {
  return {
    structuredOutput: {
      items: [
        {
          subject: "user",
          content,
          importance: 0.9,
          durability: "permanent" as const,
          category: "preference" as const
        }
      ]
    }
  };
}

/**
 * Give a seat's session a record naming its owning instance. `testFlow` seeds
 * one without a `flowId`, which a collection flow reads as a pre-ownership row
 * and refuses; seeding first wins.
 */
async function seedOwnedSession(
  stores: ReturnType<typeof createInMemoryStores>,
  sessionId: string,
  seat: FlowInstance
): Promise<void> {
  const now = new Date().toISOString();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: seat.kind,
      flowId: seat.id,
      userId: USER_ID,
      orgId: "test-org",
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

/**
 * One turn against a seat, on shared stores. Returns everything the answer
 * generator was handed EXCEPT the user's own message — so a fact found in it
 * got there by injection from memory and not by the caller having just said
 * it. Without that filter the round-trip test passes on a worker with no
 * memory at all.
 */
async function turn(
  stores: ReturnType<typeof createInMemoryStores>,
  seat: FlowInstance,
  sessionId: string,
  message: string,
  extract?: string
): Promise<string> {
  const answer = mockGenerator({ name: "agent-answer", script: [{ text: "noted" }] });
  const result = await testFlow({
    sessionId,
    flow: seat,
    action: "run",
    userId: USER_ID,
    input: { message },
    stores,
    // The skills collection every seat of this kind carries lives at org
    // scope, so a run without an org has nowhere to resolve it from.
    seed: { org: { state: {} } },
    generators: {
      "agent-answer": answer,
      "memory/observe": mockGenerator({
        name: "memory/observe",
        script: [observed(extract ?? message)]
      })
    },
    // Consolidation and prune hang off capture's own side-chains behind
    // guards. They are not what is under test, and a missing mock for one
    // would fail the turn rather than the claim.
    unmockedGeneratorPolicy: "allow"
  });

  if (result.error) throw result.error;
  const messages = (answer.calls[0]?.input ?? []) as Array<{ role?: string }>;
  return JSON.stringify(messages.filter((message) => message.role !== "user"));
}

describe("memory attaches to the built-in agent kind by composition", () => {
  // THE test. It fails against a read-only attach (nothing is ever recorded)
  // and against an attach that turns `recall` off without turning the durable
  // context presets on (the stores fill up and are never read back).
  //
  // The second conversation is a SEPARATE session on purpose. Working memory
  // is session-scoped and its preset is on by default, so a same-session
  // round trip passes without either durable tier ever being read — which is
  // the check that looks green while the promise is broken.
  it("records what it is told in one conversation and reads it back in the next, with nothing seeded", async () => {
    const mem = memory();
    const kind = rememberingKind(mem, false);
    const [seat] = hire([record({ id: "engineering.lead", body: "You are the lead." })], {
      [AGENT_KIND]: kind
    });
    const stores = createInMemoryStores();
    await seedOwnedSession(stores, "first-conversation", seat!);
    await seedOwnedSession(stores, "second-conversation", seat!);

    // Conversation one: the worker is told the fact, and knows nothing going in.
    const first = await turn(stores, seat!, "first-conversation", FACT);
    expect(first).not.toContain(FACT);

    // Conversation two: the fact is back, and the only place it can have come
    // from is what the worker recorded for itself.
    const second = await turn(stores, seat!, "second-conversation", "what do you know about me?");
    expect(second).toContain(FACT);
  });

  it("carries no memory at all when the factory is called with no arguments", () => {
    const [plain] = hire([record({ id: "engineering.lead", body: "Hello." })]);

    // The skills collection is the whole resource surface — no memory store
    // is declared anywhere in the default kind.
    expect(Object.keys(plain!.resources ?? {})).toEqual(["skills"]);
    // Nothing runs after the answer — the sequence is what it was.
    const children = plain!.actions.run!.block.childBlocks?.map((b) => b.name) ?? [];
    expect(children.some((name) => name.startsWith("memory/"))).toBe(false);
    // And every worker on the roster shares one user-scoped cell.
    expect(plain!.isolateUserState).toBe(false);
  });

  // The control for the check above: the same assertions, run against a kind
  // that DID attach memory, so a green default is not a harness that sees
  // nothing either way.
  it("declares the memory stores and the capture step once memory is attached", () => {
    const mem = memory();
    const [seat] = hire([record({ id: "engineering.lead", body: "Hello." })], {
      [AGENT_KIND]: rememberingKind(mem, true)
    });

    expect(Object.keys(seat!.resources ?? {})).toEqual(
      expect.arrayContaining(["workingMemory", "semanticMemory", "episodicMemory"])
    );
    const children = seat!.actions.run!.block.childBlocks?.map((b) => b.name) ?? [];
    expect(children.some((name) => name.startsWith("memory/"))).toBe(true);
    expect(seat!.isolateUserState).toBe(true);
  });

  // A capture call that times out is not a conversation failure. The docs say
  // so, so it is checked rather than inferred from `.sideChain`'s semantics.
  it("still answers when the post-answer step throws", async () => {
    let ran = 0;
    const exploding = handler({
      name: "explodes",
      inputSchema: z.any(),
      outputSchema: z.object({ never: z.boolean() }),
      execute: () => {
        ran += 1;
        throw new Error("the write side fell over");
      }
    });
    const [seat] = hire([record({ id: "engineering.lead", body: "Lead." })], {
      [AGENT_KIND]: defineAgentWorkerFlow({ afterAnswer: exploding })
    });

    const answer = mockGenerator({ name: "agent-answer", script: [{ text: "answered anyway" }] });
    const runtime = await createTestContext({
      flow: { ...seat!, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat!.actions.run!.block.name,
      declaredResources: seat!.actions.run!.block.declaredResources,
      generators: { "agent-answer": answer }
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "hello" },
      ctx: runtime.ctx
    });

    expect(ran).toBe(1);
    expect(result.error).toBeUndefined();
  });

  // Covers the general guarantee now, not just the recipe: core fences a
  // capability's catalog tools behind a declared `tools:` (FIX-1393), and this
  // kind declares one on every seat.
  //
  // **This test used to pass for the wrong reason.** It mocked `agent-answer`
  // through `generators:` and then wrapped `ctx.resolveModel` to watch the tool
  // list — but a mocked generator never consults the resolver, so the wrapper's
  // `generate` was never called and `seen` stayed `[]` no matter what the fence
  // did. `expect(answer.calls.length).toBeGreaterThan(0)` looked like a control
  // and was not: it proved the MOCK ran, which is exactly what stopped the
  // observation happening. The fix is to let the real generator run against a
  // recording model resolver, and to assert the observation occurred at all —
  // an empty list is only evidence if something was there to see it.
  it("sends zero tools to the model for a worker with an empty `tools:`, on the recipe's kind", async () => {
    const mem = memory();
    // Tool-bearing presets ON. With them off (the recipe's own opt-out) the
    // capability contributes nothing and this test cannot fail — it would
    // observe an empty list whether the fence worked or not.
    const [seat] = hire([record({ id: "engineering.ghost", body: "Says little." })], {
      [AGENT_KIND]: toolBearingKind(mem)
    });

    const seen: string[] = [];
    let generateCalls = 0;

    // Supply the resolver to the harness rather than mocking the generator and
    // wrapping afterwards: the real generator has to run for the tool list to
    // be resolved at all, and that list IS the fence.
    const recording = ((): GeneratorModel => ({
      modelId: "m",
      async generate(options: { tools?: Array<{ name: string }> }) {
        generateCalls += 1;
        seen.push(...(options.tools ?? []).map((tool) => tool.name));
        return { text: "done" };
      }
    })) as unknown as ModelResolver;
    recording.resolveId = (modelId: string) => modelId;

    const runtime = await createTestContext({
      flow: { ...seat!, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat!.actions.run!.block.name,
      declaredResources: seat!.actions.run!.block.declaredResources,
      modelResolver: recording,
      unmockedGeneratorPolicy: "allow"
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "what do you remember?" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    // The control. Without this the assertion below passes whenever the model
    // is never reached — which is how this test passed before it observed
    // anything. An empty list is evidence only if something looked.
    expect(generateCalls).toBeGreaterThan(0);
    expect(seen).toEqual([]);
  });

  it("gives each worker its own memory when isolation is on, and one shared memory when it is off", async () => {
    async function twoSeats(isolateUserState: boolean): Promise<string> {
      const mem = memory();
      const kind = rememberingKind(mem, isolateUserState);
      const [lead, designer] = hire(
        [
          record({ id: "engineering.lead", body: "Lead." }),
          record({ id: "engineering.designer", body: "Designer." })
        ],
        { [AGENT_KIND]: kind }
      );
      const stores = createInMemoryStores();
      await seedOwnedSession(stores, "sess-lead", lead!);
      await seedOwnedSession(stores, "sess-designer", designer!);

      await turn(stores, lead!, "sess-lead", FACT);
      return turn(stores, designer!, "sess-designer", "what do you know?", "nothing in particular");
    }

    // Isolated: the designer never sees what the lead was told.
    expect(await twoSeats(true)).not.toContain(FACT);
    // Control — without it, a harness that saw nothing either way would pass.
    expect(await twoSeats(false)).toContain(FACT);
  });

  it("keeps the skills library working alongside an attached memory capability", async () => {
    const mem = memory();
    const kind = defineAgentWorkerFlow({
      skills: [
        {
          name: "shipping",
          skillMd: "---\ndescription: How we ship.\n---\n\nShip on Fridays."
        }
      ],
      uses: [mem.capability.presets({ recall: false, connect: false, semantic: true, episodic: true })],
      afterAnswer: mem.captureFromItems
    });
    const [seat] = hire([record({ id: "engineering.lead", body: "Lead." })], {
      [AGENT_KIND]: kind
    });

    const answer = mockGenerator({ name: "agent-answer", script: [{ text: "done" }] });
    const runtime = await createTestContext({
      flow: { ...seat!, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat!.actions.run!.block.name,
      declaredResources: seat!.actions.run!.block.declaredResources,
      generators: { "agent-answer": answer },
      unmockedGeneratorPolicy: "allow"
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "/shipping" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    // The slash hit still activates the skill, which it could not do if the
    // memory capability had displaced the skills binding.
    const activeSkills = runtime.ctx.session.state.activeSkills as Array<{ name: string; source: string }>;
    expect(activeSkills.map((skill) => skill.name)).toContain("shipping");
    expect(activeSkills[0]?.source).toBe("slash");
  });

  it("takes no runtime dependency on the memory package", async () => {
    const manifest = (await import("../package.json", { with: { type: "json" } })).default as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(Object.keys(manifest.dependencies)).not.toContain("@flow-state-dev/memory");
    // Present only for these tests — the seam is generic, and this package
    // learns nothing about memory.
    expect(Object.keys(manifest.devDependencies)).toContain("@flow-state-dev/memory");
  });
});
