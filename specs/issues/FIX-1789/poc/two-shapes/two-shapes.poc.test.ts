/**
 * FIX-1789 POC · the worker contract, built two ways side by side.
 *
 * Experimental evidence, not a maintained test. `run.sh` copies this directory
 * into packages/workforce/test for the run and removes it afterwards.
 *
 *   A  list.ts     a list the installation keeps; plain `defineFlow` flows
 *   B  wrapper.ts  a `defineWorkerFlow()` wrapper; the installation registers marked flows
 *
 * Both call the same three checks (contract.ts), so the legs measure where the
 * checks run, who declares what, and what each shape costs existing flows.
 *
 * Legs:
 *   S  same verdicts   both shapes accept and refuse the same fixture flows
 *   T  timing          where a broken flow is refused: author time or boot
 *   H  hand-built      a flow that meets the contract without the wrapper
 *   G  agent           today's built-in `agent` flow, as it is declared on main
 *   F  standard-only   the flag, the no-flow default, and replacing `agent`
 *   R  runtime         declared shared state with attribution; and the CONTROL (R3, R4):
 *                      undeclared org scope state, which both shapes admit
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { FlowType } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { defineAgentWorkerFlow } from "../../src/agent-worker-flow";
import { workerConfigSchema } from "../../src/worker-config";
import { contractProblems, sharedResource, writeShared, CONTRACT_KEYS } from "./contract";
import * as A from "./list";
import * as B from "./wrapper";

type AnyFlow = FlowType<any, any, any, any, any, any, any>;
const message = z.object({ message: z.string() });
const reply = z.object({ reply: z.string() });

// ─── the blocks every fixture shares ──────────────────────────────────────

const echo = handler({ name: "echo", inputSchema: message, outputSchema: reply, execute: (i) => ({ reply: i.message }) });

/** A coordinator's routing step: delegates live in session state (ER-4's shape). */
const route = handler({
  name: "route",
  inputSchema: message,
  outputSchema: reply,
  sessionStateSchema: z.object({ delegates: z.array(z.string()).default([]) }),
  execute: async (i, ctx: any) => {
    await ctx.session.patchState({ delegates: [...ctx.session.state.delegates, "researcher"] });
    return { reply: `routed: ${i.message}` };
  }
});

/** Writes the org scope record with nothing declared: the path no declaration shows. */
const orgRecordWrite = handler({
  name: "org-record-write",
  inputSchema: message,
  outputSchema: z.object({ reply: z.string(), before: z.any() }),
  execute: async (i, ctx: any) => {
    const before = { ...(ctx.org?.state ?? {}) };
    await ctx.org.patchState({ lastMessage: i.message });
    return { reply: "ok", before };
  }
});

const notes = sharedResource("team-notes/*", { text: z.string() });
const noteWrite = handler({
  name: "note-write",
  inputSchema: message,
  outputSchema: reply,
  resources: { notes },
  execute: async (i, ctx: any) => {
    await writeShared(ctx, "notes", `from-${ctx.session.identity.userId}`, { text: i.message });
    return { reply: "noted" };
  }
});

/** Private notes kept at org scope, with no attribution: what the private-state rule refuses. */
const privateOrgNotes = {
  notes: defineResourceCollection({ pattern: "private-notes/*", scope: "org", stateSchema: z.object({ text: z.string() }) })
};

const door = (block: any) => ({ run: { inputSchema: message, block, userMessage: (i: { message: string }) => i.message } });

// ─── the same five flows, written for each shape ──────────────────────────

/** Shape A: plain defineFlow, composing the contract by hand where needed. */
const asA = {
  agent: defineFlow({ kind: "agent", cardinality: "collection", configSchema: workerConfigSchema(), actions: door(echo) }),
  triage: defineFlow({
    kind: "triage",
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    actions: door(echo)
  }),
  coordinator: defineFlow({ kind: "coordinator", cardinality: "collection", configSchema: workerConfigSchema(), actions: door(route) }),
  scribe: defineFlow({ kind: "scribe", cardinality: "collection", configSchema: workerConfigSchema(), actions: door(noteWrite) }),
  // refused
  mute: defineFlow({ kind: "mute", cardinality: "collection", configSchema: workerConfigSchema(), actions: { run: { inputSchema: message, block: echo } } }),
  leaky: defineFlow({ kind: "leaky", cardinality: "collection", configSchema: workerConfigSchema(), resources: privateOrgNotes, actions: door(echo) }),
  bare: defineFlow({ kind: "bare", cardinality: "collection", configSchema: z.object({ desk: z.string().default("front") }), actions: door(echo) })
};

/** Shape B: the wrapper. A broken flow can't be defined, so the refused ones are thunks. */
const asB = {
  agent: () => B.defineWorkerFlow({ kind: "agent", actions: door(echo) }),
  triage: () => B.defineWorkerFlow({ kind: "triage", config: { desk: z.string().default("front") }, actions: door(echo) }),
  coordinator: () => B.defineWorkerFlow({ kind: "coordinator", actions: door(route) }),
  scribe: () => B.defineWorkerFlow({ kind: "scribe", actions: door(noteWrite) }),
  mute: () => B.defineWorkerFlow({ kind: "mute", actions: { run: { inputSchema: message, block: echo } } }),
  leaky: () => B.defineWorkerFlow({ kind: "leaky", resources: privateOrgNotes, actions: door(echo) })
  // `bare` can't be written: the wrapper always composes the contract.
};

// ─── S · same verdicts ────────────────────────────────────────────────────

describe("S · both shapes give the same verdict on the same flows", () => {
  it("S1 accepts the app's own flow, a coordinator keeping delegates in session state, and a flow writing a shared resource", () => {
    const a = A.registerWorkerFlows({ triage: asA.triage, coordinator: asA.coordinator, scribe: asA.scribe }, asA.agent);
    const b = B.registerWorkerFlows({ triage: asB.triage(), coordinator: asB.coordinator(), scribe: asB.scribe() }, asB.agent());
    expect([...a.keys()].sort()).toEqual(["agent", "coordinator", "scribe", "triage"]);
    expect([...b.keys()].sort()).toEqual(["agent", "coordinator", "scribe", "triage"]);
  });

  it("S2 refuses a flow with no door, and private state kept at org scope, naming each", () => {
    expect(() => A.registerWorkerFlows({ mute: asA.mute, leaky: asA.leaky }, asA.agent)).toThrow(
      /flow "mute" has no door[\s\S]*flow "leaky" keeps "notes" \(private-notes\/\*\) at org scope/
    );
    expect(asB.mute).toThrow(/flow "mute" has no door/);
    expect(asB.leaky).toThrow(/flow "leaky" keeps "notes" \(private-notes\/\*\) at org scope/);
  });

  it("S3 refuses a flow that doesn't accept the standard configuration (A at boot; B can't express it)", () => {
    expect(() => A.registerWorkerFlows({ bare: asA.bare }, asA.agent)).toThrow(
      new RegExp(`flow "bare" does not accept ${CONTRACT_KEYS.map((k) => `\`${k}\``).join(", ")}`)
    );
  });

  it("S4 a worker can name only a registered worker flow, in both", () => {
    const a = A.registerWorkerFlows({ triage: asA.triage }, asA.agent);
    const b = B.registerWorkerFlows({ triage: asB.triage() }, asB.agent());
    for (const [list, resolve] of [[a, A.resolveWorkerFlow], [b, B.resolveWorkerFlow]] as const) {
      expect(resolve(list as any, { id: "w1", flow: "coder", standard: false })).toEqual({
        refused: `worker "w1" names flow "coder", which is not a registered worker flow. Registered: "agent", "triage"`
      });
      expect(resolve(list as any, { id: "w2", standard: false })).toMatchObject({ kind: "agent" });
    }
  });
});

// ─── T · timing ───────────────────────────────────────────────────────────

describe("T · where a broken flow is refused", () => {
  it("T1 B refuses where the flow is written; A defines it and refuses at registration", () => {
    let aDefined: AnyFlow | undefined;
    expect(() => {
      aDefined = defineFlow({ kind: "mute", cardinality: "collection", configSchema: workerConfigSchema(), actions: { run: { inputSchema: message, block: echo } } });
    }).not.toThrow();
    expect(() => A.registerWorkerFlows({ mute: aDefined! }, asA.agent)).toThrow(/has no door/);
    expect(asB.mute).toThrow(/has no door/);
  });

  it("T2 A's check is one exported function: a library can run it in its own tests, with no installation", () => {
    expect(contractProblems("mute", asA.mute)).toEqual([
      `flow "mute" has no door: no public action takes \`{ message }\` with \`userMessage\``
    ]);
    expect(contractProblems("triage", asA.triage)).toEqual([]);
  });
});

// ─── H · hand-built ───────────────────────────────────────────────────────

describe("H · a flow that meets the contract without the wrapper", () => {
  it("H1 A registers it, as hire.ts admits a hand-declared schema today; B refuses it as unmarked", () => {
    const handBuilt = defineFlow({
      kind: "triage",
      cardinality: "collection",
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.any()).default([]),
        seatTools: z.array(z.any()).default([]),
        seatPackages: z.array(z.any()).optional(),
        seatId: z.string().optional(),
        desk: z.string().default("front")
      }),
      actions: door(echo)
    });
    expect(contractProblems("triage", handBuilt)).toEqual([]);
    expect(() => A.registerWorkerFlows({ triage: handBuilt }, asA.agent)).not.toThrow();
    expect(() => B.registerWorkerFlows({ triage: handBuilt }, asB.agent())).toThrow(
      /flow "triage" was not defined with defineWorkerFlow\(\)/
    );
  });
});

// ─── G · today's built-in agent ───────────────────────────────────────────

describe("G · the built-in agent flow as main declares it", () => {
  const builtIn = defineAgentWorkerFlow() as unknown as AnyFlow;

  it("G1 fails the private-state rule in BOTH shapes: its skills drawer is at org scope", () => {
    expect(contractProblems("agent", builtIn)).toEqual([
      `flow "agent" keeps "skills" (skills/**) at org scope without \`writtenBy\`: every member reads it, and nothing says who wrote it`
    ]);
    expect(() => A.registerWorkerFlows({}, builtIn)).toThrow(/keeps "skills"/);
  });

  it("G2 B also refuses it for being unmarked: it has to move onto the wrapper", () => {
    expect(() => B.registerWorkerFlows({}, builtIn)).toThrow(/flow "agent" was not defined with defineWorkerFlow\(\)/);
  });

  it("G3 the other two checks pass on it today", () => {
    expect(contractProblems("agent", builtIn).filter((p) => !p.includes("org scope"))).toEqual([]);
  });

  it("G4 taking tasks from a mailbox board adds a second refusal: the board's ledger is at org scope too", () => {
    const withTasks = defineAgentWorkerFlow({ taskLists: ["support-help-board"] }) as unknown as AnyFlow;
    expect(contractProblems("agent", withTasks)).toEqual([
      `flow "agent" keeps "support-help-board" (support-help-board/**) at org scope without \`writtenBy\`: every member reads it, and nothing says who wrote it`,
      `flow "agent" keeps "skills" (skills/**) at org scope without \`writtenBy\`: every member reads it, and nothing says who wrote it`
    ]);
  });
});

// ─── F · standard-only ────────────────────────────────────────────────────

describe("F · standard-only, the no-flow default, and replacing agent", () => {
  it("F1 a non-standard worker can't run on a standard-only flow; a standard one can", () => {
    const a = A.registerWorkerFlows({ coordinator: { flow: asA.coordinator, standardOnly: true } }, asA.agent);
    const b = B.registerWorkerFlows(
      { coordinator: B.defineWorkerFlow({ kind: "coordinator", actions: door(route), standardOnly: true }) },
      asB.agent()
    );
    for (const [list, resolve] of [[a, A.resolveWorkerFlow], [b, B.resolveWorkerFlow]] as const) {
      expect(resolve(list as any, { id: "fork", flow: "coordinator", standard: false })).toMatchObject({ refused: expect.stringContaining(`can't run on flow "coordinator"`) });
      expect(resolve(list as any, { id: "chief", flow: "coordinator", standard: true })).toMatchObject({ kind: "coordinator" });
    }
  });

  it("F2 the no-flow default resolves to agent first; a standard-only agent then refuses a user's own worker", () => {
    const a = A.registerWorkerFlows({ agent: { flow: asA.agent, standardOnly: true } }, asA.agent);
    expect(A.resolveWorkerFlow(a, { id: "mine", standard: false })).toEqual({
      refused: `worker "mine" can't run on flow "agent": this installation keeps it for standard workers`
    });
  });

  it("F3 replacing agent: in A the flag is the installation's entry and stays; in B it travels with the replacement flow", () => {
    // The installation keeps agent standard-only. An app then swaps in a library's agent.
    const libraryAgentA = defineFlow({ kind: "agent", cardinality: "collection", configSchema: workerConfigSchema(), actions: door(echo) });
    const a = A.registerWorkerFlows({ agent: { flow: libraryAgentA, standardOnly: true } }, asA.agent);
    expect(A.resolveWorkerFlow(a, { id: "mine", standard: false })).toMatchObject({ refused: expect.any(String) });

    // In B the library decided, and its author didn't mark it: the installation's policy is gone.
    const libraryAgentB = B.defineWorkerFlow({ kind: "agent", actions: door(echo) });
    const b = B.registerWorkerFlows({ agent: libraryAgentB }, asB.agent());
    expect(B.resolveWorkerFlow(b, { id: "mine", standard: false })).toMatchObject({ kind: "agent" });
  });

  it("F4 one library flow, two installations with different policies: A holds both; B needs two definitions", () => {
    const one = A.registerWorkerFlows({ coordinator: { flow: asA.coordinator, standardOnly: true } }, asA.agent);
    const two = A.registerWorkerFlows({ coordinator: asA.coordinator }, asA.agent);
    expect(A.resolveWorkerFlow(one, { id: "x", flow: "coordinator", standard: false })).toMatchObject({ refused: expect.any(String) });
    expect(A.resolveWorkerFlow(two, { id: "x", flow: "coordinator", standard: false })).toMatchObject({ kind: "coordinator" });
  });
});

// ─── R · runtime ──────────────────────────────────────────────────────────

/** One registered copy of `flow`, run by two users of one org. The copy's `seatId` stands in for the worker. */
async function boot(flow: AnyFlow) {
  const instance = (flow as any)({ id: flow.kind, config: { seatId: "w1" } });
  const state = createFlowState({
    flows: { [flow.kind]: instance } as any,
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  const runtime = await state.getRuntime();
  const run = async (userId: string, text: string) => {
    const result = await runAction({
      orgId: "acme",
      flow: instance,
      actionName: "run",
      input: { message: text },
      userId,
      sessionId: `s-${userId}`,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    });
    if (result.error !== undefined) throw result.error;
    return result.output as any;
  };
  return { run, stores: runtime.stores as any };
}

describe("R · runtime, on the real engine", () => {
  it("R1 a shared resource: alice's entry is in the org's cell and names alice and her worker", async () => {
    const list = A.registerWorkerFlows({ scribe: asA.scribe }, asA.agent);
    const { run, stores } = await boot(list.get("scribe")!.flow);
    await run("alice", "launch is friday");
    const entry = await stores.resourceState.get("org", "acme", "team-notes/from-alice");
    expect(entry?.state).toEqual({ text: "launch is friday", writtenBy: { userId: "alice", workerId: "w1" } });
  });

  it("R2 an entry written without attribution is refused by the resource's own schema", async () => {
    const raw = handler({
      name: "raw-write",
      inputSchema: message,
      outputSchema: reply,
      resources: { notes },
      execute: async (i, ctx: any) => {
        await ctx.resources.notes.create("raw", { text: i.message });
        return { reply: "wrote" };
      }
    });
    const flow = defineFlow({ kind: "raw", cardinality: "collection", configSchema: workerConfigSchema(), actions: door(raw) });
    expect(contractProblems("raw", flow)).toEqual([]);
    const { run } = await boot(flow);
    await expect(run("alice", "unsigned")).rejects.toThrow(/writtenBy/);
  });

  it("R3 CONTROL · a flow that declares nothing and writes the org scope record passes BOTH shapes, and bob reads alice's write", async () => {
    const aFlow = defineFlow({ kind: "recorder", cardinality: "collection", configSchema: workerConfigSchema(), actions: door(orgRecordWrite) });
    const bFlow = B.defineWorkerFlow({ kind: "recorder", actions: door(orgRecordWrite) });
    expect(contractProblems("recorder", aFlow)).toEqual([]);
    expect(() => A.registerWorkerFlows({ recorder: aFlow }, asA.agent)).not.toThrow();
    expect(() => B.registerWorkerFlows({ recorder: bFlow }, asB.agent())).not.toThrow();

    const { run } = await boot(aFlow);
    await run("alice", "alice's secret");
    const bob = await run("bob", "hello");
    expect(bob.before).toEqual({ lastMessage: "alice's secret" });
  });

  it("R4 declaring a strict, empty org scope record doesn't stop the write either", async () => {
    const strict = defineFlow({
      kind: "strict",
      cardinality: "collection",
      configSchema: workerConfigSchema(),
      org: { stateSchema: z.object({}).strict() },
      actions: door(orgRecordWrite)
    });
    const { run } = await boot(strict);
    await run("alice", "alice's secret");
    const bob = await run("bob", "hello");
    expect(bob.before).toEqual({ lastMessage: "alice's secret" });
  });
});
