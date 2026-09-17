/**
 * A seat's skills are that seat's — the promise the contract already made in
 * writing, and what this pins.
 *
 * Two halves, and the tests are split the same way. **Storage**: two seats hold
 * two catalogs, asserted on CONTENTS — two seats with distinct storage keys and
 * identical catalogs is the bug wearing a passing test, so a key check proves
 * nothing here. **Activation**: holding a skill is not the same as paying for
 * it, so a zero-configuration seat must show no catalog listing, no load tool
 * and no extra model call, and a skill only reaches the prompt when the worker
 * said so or someone typed a slash.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, InitialSkill } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { workerConfigSchema } from "../src/worker-config";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

/** A plain inline skill whose body is recognisable in a rendered prompt. */
const skill = (name: string, body: string, extra: string[] = []): InitialSkill => ({
  name,
  skillMd: ["---", `description: The ${name} skill`, ...extra, "---", "", body].join("\n"),
});

const writeRegression = skill("write-regression", "MARKER-WRITE-REGRESSION: cover the flake.");
const threatModel = skill("threat-model", "MARKER-THREAT-MODEL: enumerate the attack surface.");
const houseStyle = skill("house-style", "MARKER-HOUSE-STYLE: short sentences.");

// ---------------------------------------------------------------------------
// Runtime harness — the real `run` sequencer, no model in the loop.
// ---------------------------------------------------------------------------

/**
 * Both answering generators are mocked under their own names, so a test never
 * has to know which arm the activate-tool switch picked; the one that did not
 * run simply records no calls.
 */
function answerMocks(script: Array<Record<string, unknown>>) {
  return {
    "agent-answer": mockGenerator({ name: "agent-answer", script: script as never }),
    "agent-answer-with-activate-tool": mockGenerator({
      name: "agent-answer-with-activate-tool",
      script: script as never,
    }),
  };
}

async function runTurn(
  seat: FlowInstance,
  message: string,
  generators: Record<string, ReturnType<typeof mockGenerator>> = answerMocks([{ text: "done" }]),
) {
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: `session-${seat.id}`,
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators,
  });

  const result = await executeBlock({
    block: seat.actions.run.block,
    input: { message },
    ctx: runtime.ctx,
  });

  return { result, runtime, generators };
}

/** Whichever answering generator actually ran. Exactly one arm may. */
function answered(generators: Record<string, ReturnType<typeof mockGenerator>>) {
  const ran = Object.values(generators).filter((g) => g.calls.length > 0);
  if (ran.length !== 1) {
    throw new Error(`expected exactly one answering generator to run, got ${ran.length}`);
  }
  return ran[0]!;
}

/**
 * Everything the model was shown on one call — the assembled messages, system
 * prompt included, flattened to a string so a rendered skill body can be looked
 * for by its marker.
 */
function shown(gen: ReturnType<typeof mockGenerator>, call = 0): string {
  return JSON.stringify(gen.calls[call]?.input ?? null);
}

/** The skill names this seat's catalog actually holds, read back off storage. */
async function catalogNames(runtime: { ctx: unknown }): Promise<string[]> {
  const resources = (runtime.ctx as { resources?: Record<string, unknown> }).resources;
  const collection = resources?.skills as
    | { list: (prefix?: string) => Promise<Array<{ path: string }>> }
    | undefined;
  if (!collection) return [];
  const refs = await collection.list();
  return refs
    .filter((ref) => ref.path.endsWith("/SKILL.md"))
    .map((ref) => ref.path.split("/").at(-2)!)
    .sort();
}

// ---------------------------------------------------------------------------
// The mint — what a seat's skills are allowed to be
// ---------------------------------------------------------------------------

describe("a seat's skills at the mint", () => {
  it("hands a loaded record's own skills to its flow", () => {
    const [seat] = hire([
      record({ id: "qa.tester", body: "You test.", skills: [writeRegression] }),
    ]);

    expect(seat!.config).toMatchObject({
      seatSkills: [{ name: "write-regression" }],
    });
  });

  // A hand-built record has not been read for, which is not the same as having
  // been read for and found empty — so nothing is imposed and the kind's own
  // default applies.
  it("hires a hand-built record with no skills field at all", () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test." })]);
    expect(seat!.config).toMatchObject({ seatSkills: [] });
  });

  // An empty set must not be imposed either, or every custom kind written
  // before `seatSkills` existed would stop hiring off a roster with no skills.
  it("imposes nothing for a loaded record whose set is empty", () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test.", skills: [] })]);
    expect(seat!.config).toMatchObject({ seatSkills: [] });
  });

  // The arm this issue removes. A custom kind whose schema cannot take the bag
  // used to hire on a roster with skills and be handed NOTHING — silently, so
  // an author who dropped a folder in `org/skills/` had no way to find out
  // their seat was running short. The bag goes to every kind now, so the same
  // roster refuses, for the whole roster, naming the kind's missing door.
  //
  // The cost is stated rather than hidden: a shared `org/skills/` folder does
  // break every custom kind on that roster at once. That is the upgrade, paid
  // once per kind, and it is the trade the silence was not worth.
  it("refuses a custom kind that never composed the contract, on a roster that has skills", () => {
    const triage = defineFlow({
      kind: "request-triage",
      cardinality: "collection",
      configSchema: z.object({ desk: z.string().default("front") }),
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "triage",
            inputSchema: z.object({ message: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true }),
          }),
        },
      },
    });

    const message = refusalOf(
      [
        // Both read the same org-level folder, so both records carry it.
        record({ id: "qa.tester", body: "You test.", skills: [houseStyle] }),
        record({
          id: "ops.router",
          declared: { flow: "request-triage" },
          body: "",
          skills: [houseStyle],
        }),
      ],
      { "request-triage": triage as never },
    );

    // Named: which worker, and the door its kind has to open.
    expect(message).toContain('worker "ops.router"');
    expect(message).toContain("workerConfigSchema()");
    // Nothing was hired — not even the seat whose own kind was fine. A refusal
    // that hired half a roster would leave an app half-configured at boot.
    expect(message).toContain("nothing was hired");
  });

  // The other half of the same rule, and the one that keeps the refusal above
  // from reading as "custom kinds cannot be hired": compose the contract and
  // the identical roster hires, with each seat handed its own folder's skills.
  it("hires that same custom kind once it composes the contract", () => {
    const triage = defineFlow({
      kind: "request-triage",
      cardinality: "collection",
      configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
      actions: {
        run: {
          inputSchema: z.object({ message: z.string() }),
          block: handler({
            name: "triage",
            inputSchema: z.object({ message: z.string() }),
            outputSchema: z.object({ ok: z.boolean() }),
            execute: () => ({ ok: true }),
          }),
        },
      },
    });

    const seats = hire(
      [
        record({ id: "qa.tester", body: "You test.", skills: [houseStyle] }),
        record({
          id: "ops.router",
          declared: { flow: "request-triage" },
          body: "",
          skills: [houseStyle],
        }),
      ],
      { "request-triage": triage as never },
    );

    const router = seats.find((s) => s.id === "ops.router")!;
    const tester = seats.find((s) => s.id === "qa.tester")!;

    // The custom kind gets the folder's skills, and keeps its own setting.
    expect(router.config).toMatchObject({
      seatSkills: [{ name: "house-style" }],
      desk: "front",
    });
    expect(tester.config).toMatchObject({ seatSkills: [{ name: "house-style" }] });
  });

  it("refuses a worker that declares `seatSkills:` itself, by name", () => {
    const message = refusalOf([
      record({ id: "qa.tester", declared: { seatSkills: [] }, body: "You test." }),
    ]);

    expect(message).toContain('worker "qa.tester"');
    expect(message).toContain("seatSkills");
    expect(message).toContain("the folders it can see");
  });

  // One catalog, two sources, no precedence rule — the same answer the loader
  // already gives for a name reaching one seat from two levels.
  it("refuses a name that arrives from both the app and the seat's folders", () => {
    const message = refusalOf(
      [record({ id: "qa.tester", body: "You test.", skills: [houseStyle] })],
      { [AGENT_KIND]: defineAgentWorkerFlow({ skills: [houseStyle] }) },
    );

    expect(message).toContain('worker "qa.tester"');
    expect(message).toContain("house-style");
    expect(message).toContain("no precedence rule");
  });

  it("accepts the same name on two different teams", () => {
    const review = skill("review", "MARKER-REVIEW");
    const seats = hire([
      record({ id: "qa.tester", body: "One.", skills: [review] }),
      record({ id: "sec.auditor", body: "Two.", skills: [review] }),
    ]);

    expect(seats).toHaveLength(2);
  });

  it("defaults both new switches off", () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test." })]);
    expect(seat!.config).toMatchObject({
      skills: { active: [], activateTool: false, enableLlmClassifier: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — two seats, two catalogs
// ---------------------------------------------------------------------------

describe("two seats on one roster", () => {
  it("fills each seat's catalog with its own skills and not the other's", async () => {
    const [tester, auditor] = hire([
      record({ id: "qa.tester", body: "You test.", skills: [writeRegression] }),
      record({ id: "sec.auditor", body: "You audit.", skills: [threatModel] }),
    ]);

    const testerRun = await runTurn(tester!, "hello");
    const auditorRun = await runTurn(auditor!, "hello");

    // Contents, not keys. Identical catalogs under two distinct storage keys is
    // precisely the defect, and a key assertion would wave it through.
    expect(await catalogNames(testerRun.runtime)).toEqual(["write-regression"]);
    expect(await catalogNames(auditorRun.runtime)).toEqual(["threat-model"]);
  });

  it("gives a seat with no skills an empty catalog", async () => {
    const [seat] = hire([record({ id: "qa.ghost", body: "Says little." })]);
    const { runtime } = await runTurn(seat!, "hello");
    expect(await catalogNames(runtime)).toEqual([]);
  });

  it("carries the app's own skills onto every seat alongside its own", async () => {
    const kind = defineAgentWorkerFlow({ skills: [houseStyle] });
    const [seat] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })], {
      [AGENT_KIND]: kind,
    });

    const { runtime } = await runTurn(seat!, "hello");
    expect(await catalogNames(runtime)).toEqual(["house-style", "write-regression"]);
  });
});

// ---------------------------------------------------------------------------
// Activation — holding a skill is not paying for it
// ---------------------------------------------------------------------------

describe("what reaches a seat's prompt", () => {
  it("keeps a skill the seat merely holds out of the prompt", async () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { generators } = await runTurn(seat!, "fix the flake");

    expect(shown(answered(generators))).not.toContain("MARKER-WRITE-REGRESSION");
  });

  it("puts an always-on skill in the prompt on every turn", async () => {
    const [seat] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["write-regression"] } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { generators } = await runTurn(seat!, "fix the flake");
    expect(shown(answered(generators))).toContain("MARKER-WRITE-REGRESSION");
  });

  // The ordering rule the whole append step exists for: the matcher's apply
  // step REPLACES the active set, so a default written before it is wiped.
  it("keeps the always-on skills in place through a slash hit", async () => {
    const [seat] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["house-style"] } },
        body: "You test.",
        skills: [houseStyle, writeRegression],
      }),
    ]);

    const { generators } = await runTurn(seat!, "/write-regression fix the flake");
    const prompt = shown(answered(generators));

    expect(prompt).toContain("MARKER-WRITE-REGRESSION");
    expect(prompt).toContain("MARKER-HOUSE-STYLE");
  });

  // The always-on append dedupes, so a default the matcher already activated
  // this turn is not a second activation. Asserted on the rendered set rather
  // than on the step's own count, because the set is what the model sees.
  it("does not double-activate a skill that is both always-on and slashed", async () => {
    const [seat] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["write-regression"] } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { generators, runtime } = await runTurn(seat!, "/write-regression fix the flake");

    const session = (runtime.ctx as { session?: { state?: Record<string, unknown> } }).session;
    const entries = session?.state?.activeSkills as Array<{ name: string }> | undefined;
    expect((entries ?? []).filter((e) => e.name === "write-regression")).toHaveLength(1);
    expect(shown(answered(generators))).toContain("MARKER-WRITE-REGRESSION");
  });

  it("activates a held skill on a slash with no always-on list at all", async () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { generators } = await runTurn(seat!, "/write-regression fix the flake");

    expect(shown(answered(generators))).toContain("MARKER-WRITE-REGRESSION");
  });

  // Cross-field, so it could not be refused at the mint — see the note on
  // `assertHeldSkills`. It still has to be loud, and still has to say what the
  // seat does hold.
  it("refuses an always-on name the seat does not hold, listing what it does", async () => {
    const [seat] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["nope"] } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { result } = await runTurn(seat!, "hello");

    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain('"nope"');
    expect(String(result.error)).toContain("write-regression");
  });
});

describe("what a zero-configuration seat pays for", () => {
  // A model script that tries to pull a skill in mid-turn. Whether it works is
  // the switch: a name the generator never registered resolves to a synthesized
  // result inside the mock's tool loop and activates nothing, while the real
  // tool records an activation. That record is the observable difference — the
  // loop runs inside ONE external call, so the two cannot be told apart by
  // comparing step contexts.
  const loadThenAnswer = () =>
    answerMocks([
      { toolCalls: [{ toolCallId: "c1", toolName: "loadSkill", args: { name: "write-regression" } }] },
      { text: "done" },
    ]);

  /** Skill names activated on this session by the end of the turn. */
  const activated = (runtime: { ctx: unknown }): string[] => {
    const session = (runtime.ctx as { session?: { state?: Record<string, unknown> } }).session;
    const entries = session?.state?.activeSkills;
    return Array.isArray(entries) ? entries.map((e: { name: string }) => e.name) : [];
  };

  it("shows no catalog listing and cannot pull a skill mid-turn", async () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { generators, runtime } = await runTurn(seat!, "hello", loadThenAnswer());
    const ran = answered(generators);

    // The plain arm ran, so the activate-tool arm never did.
    expect(ran.name).toBe("agent-answer");
    // No listing: nothing tells the model the tool or the skill is there...
    expect(shown(ran)).not.toContain("loadSkill");
    // ...and calling it anyway activates nothing.
    expect(activated(runtime)).toEqual([]);
  });

  it("takes the activate-tool arm, and pulls the skill in, when the worker asks", async () => {
    const [seat] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { activateTool: true } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { generators, runtime } = await runTurn(seat!, "hello", loadThenAnswer());
    const ran = answered(generators);

    expect(ran.name).toBe("agent-answer-with-activate-tool");
    expect(shown(ran)).toContain("loadSkill");
    expect(activated(runtime)).toEqual(["write-regression"]);
  });

  // The classifier is a generator of its own. Mocking it and finding it unused
  // is the trace assertion: an extra model call per turn is what the default
  // refuses to spend.
  it("makes no classifier call with the classifier tier off", async () => {
    const [seat] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const classifier = mockGenerator({
      name: "skill-classifier",
      script: [{ object: { skills: [] } }] as never,
    });

    const { generators } = await runTurn(seat!, "fix the flake", {
      ...answerMocks([{ text: "done" }]),
      "skill-classifier": classifier,
    });

    expect(answered(generators).calls).toHaveLength(1);
    expect(classifier.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The fence — a seat's own skill must not widen what it can call
// ---------------------------------------------------------------------------

describe("the tools fence, against a seat's own delegating skill", () => {
  /** A skill that declares a delegation agent, and so installs the board. */
  const delegating = skill("delegate", "MARKER-DELEGATE: addTask then runBoard.", [
    "agents:",
    "  analyst:",
    "    prompt: You analyse.",
  ]);

  function countedSecret() {
    let calls = 0;
    const tool = handler({
      name: "secret",
      description: "A tool this worker did not ask for.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        calls += 1;
        return { ok: true };
      },
    });
    return { tool, calls: () => calls };
  }

  const callTool = (toolName: string) => ({
    toolCalls: [{ toolCallId: "call-1", toolName, args: {} }],
  });

  // The host fence itself, restated against a skill that now belongs to the
  // seat rather than to the app.
  it("does not let a seat with `tools: []` call an app tool directly", async () => {
    const { tool: secret, calls } = countedSecret();
    const kind = defineAgentWorkerFlow({ catalog: { secret } });
    const [seat] = hire(
      [record({ id: "qa.tester", body: "You test.", skills: [delegating] })],
      { [AGENT_KIND]: kind },
    );

    const { result } = await runTurn(
      seat!,
      "/delegate do it",
      answerMocks([callTool("secret"), { text: "done" }]),
    );

    expect(result.error).toBeUndefined();
    expect(calls()).toBe(0);
  });

  // The new exposure: the seat's OWN skill declares `agents:`, so the
  // delegation surface installs — and a board worker must not be seated with a
  // tool the seat's `tools:` never named.
  it("does not seat a delegated board worker with a tool the seat never named", async () => {
    const { tool: secret, calls } = countedSecret();
    const kind = defineAgentWorkerFlow({ catalog: { secret } });
    const [seat] = hire(
      [record({ id: "qa.tester", body: "You test.", skills: [delegating] })],
      { [AGENT_KIND]: kind },
    );

    const { result, generators } = await runTurn(
      seat!,
      "/delegate do it",
      answerMocks([
        {
          toolCalls: [
            {
              toolCallId: "call-1",
              toolName: "addTask",
              args: { goal: "run the secret tool", assignee: "secret" },
            },
          ],
        },
        { toolCalls: [{ toolCallId: "call-2", toolName: "runBoard", args: {} }] },
        { text: "done" },
      ]),
    );

    expect(result.error).toBeUndefined();
    // Nothing reached the tool. Whether `addTask` refused the assignee or the
    // drain found no worker for it, the fence held.
    expect(calls()).toBe(0);
    expect(answered(generators).calls.length).toBeGreaterThan(0);
  });

  // The same fence, one layer in. A tool seat is not the only way a skill's
  // `agents:` reaches the catalog: a DECLARED agent is a generator of its own,
  // and its `tools:` list resolves against whatever catalog the library was
  // built with. If the seat's fence is not applied there too, a `tools: []`
  // worker delegates to an agent that calls what the worker itself cannot.
  //
  // Asserted on the tool's own `execute`, never on a registration list: a name
  // the generator never registered resolves to a synthesized result inside the
  // mock's tool loop instead of throwing, so a weaker assertion passes whether
  // or not the fence holds.
  it("does not let a declared agent call a tool the seat never named", async () => {
    const { tool: secret, calls } = countedSecret();
    const delegatingWithTooledAgent = skill(
      "delegate",
      "MARKER-DELEGATE: addTask then runBoard.",
      ["agents:", "  analyst:", "    prompt: You analyse.", "    tools: [secret]"],
    );

    const kind = defineAgentWorkerFlow({ catalog: { secret } });
    const [seat] = hire(
      [record({ id: "qa.tester", body: "You test.", skills: [delegatingWithTooledAgent] })],
      { [AGENT_KIND]: kind },
    );

    const { result } = await runTurn(seat!, "/delegate do it", {
      ...answerMocks([
        {
          toolCalls: [
            {
              toolCallId: "call-1",
              toolName: "addTask",
              args: { goal: "use the secret tool", assignee: "analyst" },
            },
          ],
        },
        { toolCalls: [{ toolCallId: "call-2", toolName: "runBoard", args: {} }] },
        { text: "done" },
      ]),
      // The declared agent's own generator. Scripted to reach for the tool it
      // was handed — which is the whole question.
      skillWorker_delegate_analyst: mockGenerator({
        name: "skillWorker_delegate_analyst",
        script: [
          { toolCalls: [{ toolCallId: "call-3", toolName: "secret", args: {} }] },
          { text: "analysed" },
        ] as never,
      }),
    });

    expect(result.error).toBeUndefined();
    expect(calls()).toBe(0);
  });

  // ...and the fence narrows rather than closes: a tool the seat DID name stays
  // assignable, or this would be a fence that just broke delegation.
  it("still seats a board worker with a tool the seat did name", async () => {
    const { tool: secret } = countedSecret();
    const kind = defineAgentWorkerFlow({ catalog: { secret } });
    const [seat] = hire(
      [
        record({
          id: "qa.tester",
          declared: { tools: ["secret"] },
          body: "You test.",
          skills: [delegating],
        }),
      ],
      { [AGENT_KIND]: kind },
    );

    const { result } = await runTurn(
      seat!,
      "/delegate do it",
      answerMocks([
        {
          toolCalls: [
            {
              toolCallId: "call-1",
              toolName: "addTask",
              args: { goal: "run it", assignee: "secret" },
            },
          ],
        },
        { text: "done" },
      ]),
    );

    expect(result.error).toBeUndefined();
  });
});
