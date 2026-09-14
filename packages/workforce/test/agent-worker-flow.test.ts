/**
 * The built-in `agent` flow kind, and the one admission change that lets a
 * worker file reach it.
 *
 * Half of these pin what did NOT change: adding an implicit default must not
 * weaken a refusal that stands today (contract C2). The whitespace case lives
 * in `hire.test.ts` beside the other refusals, because that is the one this
 * change is most likely to swallow.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, InitialSkill } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hire(manifests: WorkerManifest[], kinds: HireOptions["kinds"] = {}): FlowInstance[] {
  return hireWorkforce(manifests, { kinds });
}

function refusalOf(manifests: WorkerManifest[], kinds: HireOptions["kinds"] = {}): string {
  try {
    hireWorkforce(manifests, { kinds });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got seats");
}

const board = handler({
  name: "board",
  description: "Reads the board.",
  inputSchema: z.object({ query: z.string() }),
  outputSchema: z.object({ rows: z.number() }),
  execute: () => ({ rows: 0 })
});

describe("the built-in agent kind", () => {
  it("hires a record that names no `flow:`, handing its body over as instructions", () => {
    const [seat] = hire([
      record({ id: "engineering.lead", declared: { description: "Holds the board." }, body: "You are the lead." })
    ]);

    expect(seat!.kind).toBe(AGENT_KIND);
    expect(seat!.config).toMatchObject({ instructions: "You are the lead." });
  });

  // A bodyless worker is a weak seat, not a failed hire.
  it("hires a record with neither `flow:` nor a body, carrying no instructions", () => {
    const [seat] = hire([record({ id: "engineering.ghost", declared: { description: "Says little." } })]);

    expect(seat!.kind).toBe(AGENT_KIND);
    expect(Object.hasOwn(seat!.config, "instructions")).toBe(false);
  });

  // A roster of records that name no kind needs no `kinds` at all.
  it("hires with no options passed", () => {
    const [seat] = hireWorkforce([record({ id: "engineering.lead", body: "You are the lead." })]);
    expect(seat!.kind).toBe(AGENT_KIND);
  });

  it("hires a record that names `agent` explicitly into the same built-in", () => {
    const [seat] = hire([record({ id: "engineering.lead", declared: { flow: AGENT_KIND }, body: "Hello." })]);
    expect(seat!.kind).toBe(AGENT_KIND);
  });

  // The two defaults a zero-configuration seat is judged on, plus the model.
  it("defaults to a provider-neutral model, no tools, and the classifier tier OFF", () => {
    const [seat] = hire([record({ id: "engineering.lead", body: "Hello." })]);

    expect(seat!.config).toMatchObject({
      // An intent, not a vendor id: a hard-coded provider would fail at run
      // time for any app whose resolver does not carry it.
      model: "intent/chat",
      tools: [],
      skills: { enableLlmClassifier: false }
    });
  });

  // Without the pinned binding a seat would hold skills it could never pull,
  // so the library being installed at all is the thing worth asserting here.
  it("installs the skills library on the built-in", () => {
    const flow = defineAgentWorkerFlow() as unknown as { resources?: Record<string, unknown> };
    expect(Object.keys(flow.resources ?? {})).toContain("skills");
  });

  it("still refuses a kind nobody registered, and now lists `agent` among those available", () => {
    const message = refusalOf([record({ id: "engineering.scribe", declared: { flow: "note-taker" } })]);

    expect(message).toContain('worker "engineering.scribe"');
    expect(message).toContain('"note-taker"');
    expect(message).toContain(`"${AGENT_KIND}"`);
  });
});

describe("the built-in agent kind's tools", () => {
  it("refuses a tool the app's catalog does not carry, naming the tool and the fix", () => {
    const message = refusalOf([
      record({ id: "engineering.lead", declared: { tools: ["board"] }, body: "You are the lead." })
    ]);

    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain('"board"');
    expect(message).toContain("defineAgentWorkerFlow");
  });

  // The empty catalog is not a special case — it takes the same refusal.
  it("refuses the same way when the app supplied no catalog at all", () => {
    const message = refusalOf([record({ id: "engineering.lead", declared: { tools: ["board"] } })]);
    expect(message).toContain("no catalog was passed to defineAgentWorkerFlow");
  });

  it("accepts a tool the app's catalog carries", () => {
    const [seat] = hire([record({ id: "engineering.lead", declared: { tools: ["board"] }, body: "Lead." })], {
      [AGENT_KIND]: defineAgentWorkerFlow({ catalog: { board } })
    });

    expect(seat!.config).toMatchObject({ tools: ["board"] });
  });
});

// The mint-time refusal above proves a bad `tools:` name is rejected before a
// seat exists. It does not prove the accepted names are the ONLY ones a live
// seat can call — the skills library also installs tools on this generator
// (contract C5), and until FIX-1363's runtime fence a seat's own `tools:`
// could be silently widened by whatever the app's catalog carried. These run
// the real `run` sequencer end to end (see the longer note on the skills
// switch describe block below for why `createTestContext`/`executeBlock` are
// needed directly) and check the CATALOG TOOL ITSELF: the model "calling" a
// tool the seat's `tools:` omitted must not reach that tool's own `execute`.
describe("the built-in agent kind's tools — the runtime fence, not just the mint refusal", () => {
  async function contextFor(
    seat: FlowInstance,
    generators: Record<string, ReturnType<typeof mockGenerator>>
  ) {
    return createTestContext({
      flow: { ...seat, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat.actions.run!.block.name,
      declaredResources: seat.actions.run!.block.declaredResources,
      generators
    });
  }

  // A model script that "calls" a named tool. Whether that call ever reaches
  // the tool's own `execute` depends entirely on whether the generator
  // actually registered it — an unregistered name just resolves to a
  // synthesized `{ ok: true }` inside the mock's tool loop (see
  // `MockGeneratorInstance`/`runScript`), so `secretCalls` only moves when
  // the fence has failed.
  const callTool = (toolName: string) => ({
    toolCalls: [{ toolCallId: "call-1", toolName, args: {} }]
  });

  it("does not run a catalog tool the seat's own `tools:` omits", async () => {
    let secretCalls = 0;
    const secret = handler({
      name: "secret",
      description: "A tool this worker did not ask for.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        secretCalls += 1;
        return { ok: true };
      }
    });

    const kind = defineAgentWorkerFlow({ catalog: { board, secret } });
    const [seat] = hire(
      [record({ id: "engineering.lead", declared: { tools: ["board"] }, body: "Lead." })],
      { [AGENT_KIND]: kind }
    );

    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [callTool("secret"), { text: "done" }]
      })
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "use every tool you have" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    expect(secretCalls).toBe(0);
  });

  it("does not run any catalog tool for a seat whose `tools:` is empty", async () => {
    let secretCalls = 0;
    const secret = handler({
      name: "secret",
      description: "A tool this worker did not ask for.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        secretCalls += 1;
        return { ok: true };
      }
    });

    const kind = defineAgentWorkerFlow({ catalog: { board, secret } });
    const [seat] = hire([record({ id: "engineering.ghost", body: "Says little." })], {
      [AGENT_KIND]: kind
    });

    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [callTool("secret"), { text: "done" }]
      })
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "use every tool you have" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    expect(secretCalls).toBe(0);
  });
});

// The Architect's ruling on FIX-1363's PR review: the runtime fence above must
// stand WITHOUT refusing a stock-kind skill that declares `allowed-tools`
// naming a real app catalog tool. Before this ruling, `defineAgentWorkerFlow` handed
// the skills library no catalog at all (see the runtime-fence describe block
// above), so validating a bound skill's `allowed-tools` had nothing to
// validate against and this exact build threw. The library now takes
// `registerCatalogTools: false` (FIX-1363's follow-up), so validation runs
// against the real catalog but registration still only happens through a
// seat's own `tools:` — the fence tests above are untouched by this.
describe("the built-in agent kind's tools — a skill's `allowed-tools` validates but does not register", () => {
  const usesBoard: InitialSkill[] = [
    {
      name: "uses-board",
      skillMd: "---\ndescription: Reads the board.\nallowed-tools: [board]\n---\n\nUse the board tool when asked."
    }
  ];

  it("builds a kind whose catalog carries a skill's declared `allowed-tools` tool", () => {
    expect(() => defineAgentWorkerFlow({ catalog: { board }, skills: usesBoard })).not.toThrow();
  });

  async function contextFor(
    seat: FlowInstance,
    generators: Record<string, ReturnType<typeof mockGenerator>>
  ) {
    return createTestContext({
      flow: { ...seat, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat.actions.run!.block.name,
      declaredResources: seat.actions.run!.block.declaredResources,
      generators
    });
  }

  const callTool = (toolName: string) => ({
    toolCalls: [{ toolCallId: "call-1", toolName, args: {} }]
  });

  // A countable stand-in for `board`, named the same so it still matches
  // `usesBoard`'s `allowed-tools: [board]` and a seat's `tools: ["board"]`.
  // Whether "calling" it reaches this `execute` is exactly what the runtime
  // fence (not build-time validation) decides — the same shape as the
  // fence tests above, applied to a tool a bound skill also names.
  function countedBoard() {
    let calls = 0;
    const tool = handler({
      name: "board",
      description: "Reads the board.",
      inputSchema: z.object({}),
      outputSchema: z.object({ rows: z.number() }),
      execute: () => {
        calls += 1;
        return { rows: 0 };
      }
    });
    return { tool, calls: () => calls };
  }

  it("lets a seat naming `tools: [\"board\"]` actually reach the catalog tool's `execute`", async () => {
    const { tool: board, calls } = countedBoard();
    const kind = defineAgentWorkerFlow({ catalog: { board }, skills: usesBoard });
    const [seat] = hire(
      [record({ id: "engineering.lead", declared: { tools: ["board"] }, body: "Lead." })],
      { [AGENT_KIND]: kind }
    );

    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [callTool("board"), { text: "done" }]
      })
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "check the board" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    expect(calls()).toBe(1);
  });

  it("still keeps a seat that omits `tools:` from reaching the tool, even though the skill declares `allowed-tools: [board]`", async () => {
    const { tool: board, calls } = countedBoard();
    const kind = defineAgentWorkerFlow({ catalog: { board }, skills: usesBoard });
    const [seat] = hire([record({ id: "engineering.ghost", body: "Says little." })], {
      [AGENT_KIND]: kind
    });

    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [callTool("board"), { text: "done" }]
      })
    });

    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "check the board" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    expect(calls()).toBe(0);
  });
});

describe("replacing the built-in agent kind", () => {
  const replacement = defineFlow({
    kind: AGENT_KIND,
    cardinality: "collection",
    configSchema: z.object({ instructions: z.string().optional(), desk: z.string().default("front") }),
    actions: {
      run: {
        inputSchema: z.object({ message: z.string() }),
        block: handler({
          name: "their-answer",
          inputSchema: z.object({ message: z.string() }),
          outputSchema: z.object({ message: z.string() }),
          execute: (input) => input
        })
      }
    }
  });

  // Acceptance criterion 4's mint half. That the seats also REGISTER is proved
  // by the goal check, because a singleton replacement mints fine and is only
  // refused at registration.
  it("gives a caller's own `agent` to EVERY seat, not just the first", () => {
    const seats = hire(
      [
        record({ id: "engineering.intake", declared: { desk: "side" } }),
        record({ id: "engineering.lead", body: "You are the lead." }),
        record({ id: "engineering.scribe", declared: { flow: AGENT_KIND }, body: "You take notes." })
      ],
      { [AGENT_KIND]: replacement }
    );

    expect(seats).toHaveLength(3);
    // Read each seat's own settings rather than counting instances: asserting
    // "three seats came back" passes even when every one of them is ours.
    for (const seat of seats) {
      expect(seat.kind).toBe(AGENT_KIND);
      expect(Object.hasOwn(seat.config, "desk")).toBe(true);
      expect(Object.hasOwn(seat.config, "model")).toBe(false);
    }
  });

  it("creates the built-in once, not per hire", () => {
    const first = hire([record({ id: "a", body: "one." })]);
    const second = hire([record({ id: "b", body: "two." })]);
    expect(first[0]!.kind).toBe(second[0]!.kind);
  });
});

// Criterion 7 — the invent-kill holds. Cheap and durable: the kill targets are
// symbols, so a grep on the new module is the whole check.
describe("the agent kind grows no agent registry", () => {
  it("imports none of `defineAgent`, `materializeAgent` or `AgentRegistry`", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/agent-worker-flow.ts", import.meta.url)), "utf8");
    const importLines = source.split("\n").filter((line) => line.trimStart().startsWith("import"));

    for (const symbol of ["defineAgent", "materializeAgent", "AgentRegistry"]) {
      expect(importLines.join("\n")).not.toContain(symbol);
    }
  });
});

// The regression this covers: the whole up-front matcher (all three tiers)
// used to sit behind one `.tapIf(enableLlmClassifier === true)`, so with the
// switch OFF (the default) slash and keyword matching never ran either.
// Only tier 3 — the model classifier — is meant to be conditional.
//
// This exercises the real `run` sequencer end to end (matcher + generator),
// so it needs `@flow-state-dev/engine`'s `createTestContext` + `executeBlock`
// directly rather than the package's usual `testBlock` helper: the "skills"
// resource this kind installs is org-scoped, and `testBlock`'s public options
// have no way to give a test an org identity (only the lower-level
// `createTestContext` accepts `orgId`). The seat is also patched to
// `cardinality: "singleton"` for the harness call only — `testBlock`/
// `createTestContext` seed a session record with no `flowId`, which a real
// `collection`-cardinality instance then refuses to own (a harness gap, not
// something this test is about); `seat` itself, and the config/resources
// actually under test, are untouched.
describe("the built-in agent kind's skills switch — gates only the model classifier (tier 3)", () => {
  // The skill both cases below match against, supplied the way an app
  // supplies one — `defineAgentWorkerFlow({ skills })`, the stock path — rather than
  // written into the collection by hand. Seeding it by hand would aim these
  // checks at a neighbour of what they claim: the claim is that the tiers run
  // for a seat of this kind, and a seat of this kind gets its catalog from
  // `initialSkills`.
  const knownSkill = [
    {
      name: "known",
      skillMd: "---\ndescription: A known skill.\n---\n\nDo the known thing."
    }
  ];

  async function contextFor(
    seat: FlowInstance,
    generators: Record<string, ReturnType<typeof mockGenerator>>
  ) {
    return createTestContext({
      flow: { ...seat, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: "test-session",
      sequencerName: seat.actions.run!.block.name,
      declaredResources: seat.actions.run!.block.declaredResources,
      generators
    });
  }

  it("runs slash activation on every turn even with the classifier switch OFF (default)", async () => {
    const kind = defineAgentWorkerFlow({ skills: knownSkill });
    const [seat] = hire([record({ id: "engineering.lead", body: "Hello." })], { [AGENT_KIND]: kind });

    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({ name: "agent-answer", script: [{ text: "ok" }] })
    });

    // No mock is registered for "skill-classifier": if the switch being OFF
    // ever let tier 3 run anyway, this throws "No mock for generator" and
    // `result.error` below catches it.
    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "/known" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    const activeSkills = runtime.ctx.session.state.activeSkills as Array<{ name: string; source: string }>;
    expect(activeSkills.map((s) => s.name)).toContain("known");
    expect(activeSkills[0]?.source).toBe("slash");
  });

  it("additionally reaches the model classifier (tier 3) when the switch is ON", async () => {
    const kind = defineAgentWorkerFlow({ skills: knownSkill });
    const [seat] = hire(
      [record({ id: "engineering.lead", declared: { skills: { enableLlmClassifier: true } }, body: "Hello." })],
      { [AGENT_KIND]: kind }
    );

    const classifier = mockGenerator({
      name: "skill-classifier",
      script: [
        {
          structuredOutput: {
            reasoning: "the message asks for help, which the known skill covers",
            activeSkills: [{ name: "known", input: "", confidence: 0.9 }]
          }
        }
      ]
    });
    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({ name: "agent-answer", script: [{ text: "ok" }] }),
      "skill-classifier": classifier
    });

    // The slash tier doesn't match this message, and keyword matching is not
    // part of this kind's activator pipeline at all — so this falls straight
    // through to tier 3, which is ON here.
    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "please help me with something" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    expect(classifier.calls).toHaveLength(1);
    const activeSkills = runtime.ctx.session.state.activeSkills as Array<{ name: string; source: string }>;
    expect(activeSkills.map((s) => s.name)).toContain("known");
  });

  // Stock activation for the built-in `agent` kind is locked to slash +
  // an optional classifier tier — keyword/trigger-phrase matching is out of
  // `defineAgentWorkerFlow` entirely, not merely out of the default branch. This
  // pins that a message that would match a skill's `keywords` frontmatter,
  // but carries no `/skill-name` prefix, does NOT activate it — on either
  // setting of the classifier switch.
  it("does not activate a skill by keyword match — keyword matching is not part of this kind's contract", async () => {
    const keywordOnlySkill = [
      {
        name: "known",
        skillMd: "---\ndescription: A known skill.\nkeywords:\n  - known\n---\n\nDo the known thing."
      }
    ];
    const kind = defineAgentWorkerFlow({ skills: keywordOnlySkill });
    const [seat] = hire([record({ id: "engineering.lead", body: "Hello." })], { [AGENT_KIND]: kind });

    const runtime = await contextFor(seat!, {
      "agent-answer": mockGenerator({ name: "agent-answer", script: [{ text: "ok" }] })
    });

    // The message matches the skill's `keywords` ("known") but carries no
    // `/known` slash prefix. The classifier switch is OFF (default) and no
    // mock is registered for "skill-classifier", so if tier 3 ever ran this
    // would throw — it must not, and neither may a keyword tier.
    const result = await executeBlock({
      block: seat!.actions.run.block,
      input: { message: "please do the known thing" },
      ctx: runtime.ctx
    });

    expect(result.error).toBeUndefined();
    const activeSkills = (runtime.ctx.session.state.activeSkills ?? []) as Array<{
      name: string;
      source: string;
    }>;
    expect(activeSkills.map((s) => s.name)).not.toContain("known");
  });
});
