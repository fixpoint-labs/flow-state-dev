/**
 * A worker's skills are that worker's — the promise the contract already made in
 * writing, and what this pins.
 *
 * Two halves, and the tests are split the same way. **Storage**: two workers hold
 * two catalogs, asserted on CONTENTS — two workers with distinct storage keys and
 * identical catalogs is the bug wearing a passing test, so a key check proves
 * nothing here. **Activation**: holding a skill is not the same as paying for
 * it, so a zero-configuration worker must show no catalog listing, no load tool
 * and no extra model call, and a skill only reaches the prompt when the worker
 * said so or someone typed a slash.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance, InitialSkill } from "@flow-state-dev/core/types";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { executeBlock } from "@flow-state-dev/engine";
import { mintWorkers, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { workerConfigSchema } from "../src/worker-config";
import { workerDoor } from "./worker-door";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function hire(manifests: WorkerManifest[], flows: HireOptions["workerFlows"] = {}): FlowInstance[] {
  return mintWorkers(manifests, { workerFlows: flows });
}

function refusalOf(manifests: WorkerManifest[], flows: HireOptions["workerFlows"] = {}): string {
  try {
    mintWorkers(manifests, { workerFlows: flows });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got workers");
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
  worker: FlowInstance,
  message: string,
  generators: Record<string, ReturnType<typeof mockGenerator>> = answerMocks([{ text: "done" }]),
) {
  const runtime = await createTestContext({
    flow: { ...worker, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: `session-${worker.id}`,
    sequencerName: worker.actions.respond!.block.name,
    declaredResources: worker.actions.respond!.block.declaredResources,
    generators,
  });

  const result = await executeBlock({
    block: worker.actions.respond.block,
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

/** The skill names this worker's catalog actually holds, read back off storage. */
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
// The mint — what a worker's skills are allowed to be
// ---------------------------------------------------------------------------

describe("a worker's skills at the mint", () => {
  it("hands a loaded record's own skills to its flow", () => {
    const [worker] = hire([
      record({ id: "qa.tester", body: "You test.", skills: [writeRegression] }),
    ]);

    expect(worker!.config).toMatchObject({
      workerSkills: [{ name: "write-regression" }],
    });
  });

  // A hand-built record has not been read for, which is not the same as having
  // been read for and found empty — so nothing is imposed and the worker flow's own
  // default applies.
  it("hires a hand-built record with no skills field at all", () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test." })]);
    expect(worker!.config).toMatchObject({ workerSkills: [] });
  });

  // An empty set must not be imposed either, or every custom worker flow written
  // before `workerSkills` existed would stop hiring off a roster with no skills.
  it("imposes nothing for a loaded record whose set is empty", () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [] })]);
    expect(worker!.config).toMatchObject({ workerSkills: [] });
  });

  // The arm this issue removes. A custom worker flow whose schema cannot take the bag
  // used to hire on a roster with skills and be handed NOTHING — silently, so
  // an author who dropped a folder in `org/skills/` had no way to find out
  // their worker was running short. The bag goes to every worker flow now, so the same
  // roster refuses, for the whole roster, naming the worker flow's missing door.
  //
  // The cost is stated rather than hidden: a shared `org/skills/` folder does
  // break every custom worker flow on that roster at once. That is the upgrade, paid
  // once per worker flow, and it is the trade the silence was not worth.
  it("refuses a custom worker flow that never composed the contract, on a roster that has skills", () => {
    const triage = defineFlow({
      kind: "request-triage",
      cardinality: "collection",
      configSchema: z.object({ desk: z.string().default("front") }),
      actions: { ...workerDoor,
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

    // Named: which flow, and the contract it has to compose.
    expect(message).toContain('worker flow "request-triage"');
    expect(message).toContain("workerConfigSchema()");
    // Nothing was hired — not even the worker whose own worker flow was fine. A refusal
    // that hired half a roster would leave an app half-configured at boot.
    expect(message).toContain("nothing was hired");
  });

  // The other half of the same rule, and the one that keeps the refusal above
  // from reading as "custom worker flows cannot be hired": compose the contract and
  // the identical roster hires, with each worker handed its own folder's skills.
  it("hires that same custom worker flow once it composes the contract", () => {
    const triage = defineFlow({
      kind: "request-triage",
      cardinality: "collection",
      configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
      actions: { ...workerDoor,
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

    const workers = hire(
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

    const router = workers.find((s) => s.id === "ops.router")!;
    const tester = workers.find((s) => s.id === "qa.tester")!;

    // The custom worker flow gets the folder's skills, and keeps its own setting.
    expect(router.config).toMatchObject({
      workerSkills: [{ name: "house-style" }],
      desk: "front",
    });
    expect(tester.config).toMatchObject({ workerSkills: [{ name: "house-style" }] });
  });

  it("refuses a worker that declares `workerSkills:` itself, by name", () => {
    const message = refusalOf([
      record({ id: "qa.tester", declared: { workerSkills: [] }, body: "You test." }),
    ]);

    expect(message).toContain('worker "qa.tester"');
    expect(message).toContain("workerSkills");
    expect(message).toContain("the folders it can see");
  });

  // One catalog, two sources, no precedence rule — the same answer the loader
  // already gives for a name reaching one worker from two levels.
  it("refuses a name that arrives from both the app and the worker's folders", () => {
    const message = refusalOf(
      [record({ id: "qa.tester", body: "You test.", skills: [houseStyle] })],
      { [AGENT_FLOW]: defineAgentWorkerFlow({ skills: [houseStyle] }) },
    );

    expect(message).toContain('worker "qa.tester"');
    expect(message).toContain("house-style");
    expect(message).toContain("no precedence rule");
  });

  it("accepts the same name on two different teams", () => {
    const review = skill("review", "MARKER-REVIEW");
    const workers = hire([
      record({ id: "qa.tester", body: "One.", skills: [review] }),
      record({ id: "sec.auditor", body: "Two.", skills: [review] }),
    ]);

    expect(workers).toHaveLength(2);
  });

  it("defaults both new switches off", () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test." })]);
    expect(worker!.config).toMatchObject({
      skills: { active: [], activateTool: false, enableLlmClassifier: false },
    });
  });
});

// ---------------------------------------------------------------------------
// Criterion 5 — two workers, two catalogs
// ---------------------------------------------------------------------------

describe("two workers on one roster", () => {
  it("fills each worker's catalog with its own skills and not the other's", async () => {
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

  it("gives a worker with no skills an empty catalog", async () => {
    const [worker] = hire([record({ id: "qa.ghost", body: "Says little." })]);
    const { runtime } = await runTurn(worker!, "hello");
    expect(await catalogNames(runtime)).toEqual([]);
  });

  it("carries the app's own skills onto every worker alongside its own", async () => {
    const flow = defineAgentWorkerFlow({ skills: [houseStyle] });
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })], {
      [AGENT_FLOW]: flow,
    });

    const { runtime } = await runTurn(worker!, "hello");
    expect(await catalogNames(runtime)).toEqual(["house-style", "write-regression"]);
  });
});

// ---------------------------------------------------------------------------
// Activation — holding a skill is not paying for it
// ---------------------------------------------------------------------------

describe("what reaches a worker's prompt", () => {
  it("keeps a skill the worker merely holds out of the prompt", async () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { generators } = await runTurn(worker!, "fix the flake");

    expect(shown(answered(generators))).not.toContain("MARKER-WRITE-REGRESSION");
  });

  it("puts an always-on skill in the prompt on every turn", async () => {
    const [worker] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["write-regression"] } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { generators } = await runTurn(worker!, "fix the flake");
    expect(shown(answered(generators))).toContain("MARKER-WRITE-REGRESSION");
  });

  // The ordering rule the whole append step exists for: the matcher's apply
  // step REPLACES the active set, so a default written before it is wiped.
  it("keeps the always-on skills in place through a slash hit", async () => {
    const [worker] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["house-style"] } },
        body: "You test.",
        skills: [houseStyle, writeRegression],
      }),
    ]);

    const { generators } = await runTurn(worker!, "/write-regression fix the flake");
    const prompt = shown(answered(generators));

    expect(prompt).toContain("MARKER-WRITE-REGRESSION");
    expect(prompt).toContain("MARKER-HOUSE-STYLE");
  });

  // The always-on append dedupes, so a default the matcher already activated
  // this turn is not a second activation. Asserted on the rendered set rather
  // than on the step's own count, because the set is what the model sees.
  it("does not double-activate a skill that is both always-on and slashed", async () => {
    const [worker] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["write-regression"] } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { generators, runtime } = await runTurn(worker!, "/write-regression fix the flake");

    const session = (runtime.ctx as { session?: { state?: Record<string, unknown> } }).session;
    const entries = session?.state?.activeSkills as Array<{ name: string }> | undefined;
    expect((entries ?? []).filter((e) => e.name === "write-regression")).toHaveLength(1);
    expect(shown(answered(generators))).toContain("MARKER-WRITE-REGRESSION");
  });

  it("activates a held skill on a slash with no always-on list at all", async () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { generators } = await runTurn(worker!, "/write-regression fix the flake");

    expect(shown(answered(generators))).toContain("MARKER-WRITE-REGRESSION");
  });

  // Cross-field, so it could not be refused at the mint — see the note on
  // `assertHeldSkills`. It still has to be loud, and still has to say what the
  // worker does hold.
  it("refuses an always-on name the worker does not hold, listing what it does", async () => {
    const [worker] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { active: ["nope"] } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { result } = await runTurn(worker!, "hello");

    expect(result.error).toBeDefined();
    expect(String(result.error)).toContain('"nope"');
    expect(String(result.error)).toContain("write-regression");
  });
});

describe("what a zero-configuration worker pays for", () => {
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
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const { generators, runtime } = await runTurn(worker!, "hello", loadThenAnswer());
    const ran = answered(generators);

    // The plain arm ran, so the activate-tool arm never did.
    expect(ran.name).toBe("agent-answer");
    // No listing: nothing tells the model the tool or the skill is there...
    expect(shown(ran)).not.toContain("loadSkill");
    // ...and calling it anyway activates nothing.
    expect(activated(runtime)).toEqual([]);
  });

  it("takes the activate-tool arm, and pulls the skill in, when the worker asks", async () => {
    const [worker] = hire([
      record({
        id: "qa.tester",
        declared: { skills: { activateTool: true } },
        body: "You test.",
        skills: [writeRegression],
      }),
    ]);

    const { generators, runtime } = await runTurn(worker!, "hello", loadThenAnswer());
    const ran = answered(generators);

    expect(ran.name).toBe("agent-answer-with-activate-tool");
    expect(shown(ran)).toContain("loadSkill");
    expect(activated(runtime)).toEqual(["write-regression"]);
  });

  // The classifier is a generator of its own. Mocking it and finding it unused
  // is the trace assertion: an extra model call per turn is what the default
  // refuses to spend.
  it("makes no classifier call with the classifier tier off", async () => {
    const [worker] = hire([record({ id: "qa.tester", body: "You test.", skills: [writeRegression] })]);
    const classifier = mockGenerator({
      name: "skill-classifier",
      script: [{ object: { skills: [] } }] as never,
    });

    const { generators } = await runTurn(worker!, "fix the flake", {
      ...answerMocks([{ text: "done" }]),
      "skill-classifier": classifier,
    });

    expect(answered(generators).calls).toHaveLength(1);
    expect(classifier.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The fence — a worker's own skill must not widen what it can call
// ---------------------------------------------------------------------------

describe("the tools fence, against a worker's own skill", () => {
  /** A skill the worker holds, invoked by slash so its body is in the turn. */
  const held = skill("held", "MARKER-HELD: use what you have.");

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
  // worker rather than to the app.
  it("does not let a worker with `tools: []` call an app tool directly", async () => {
    const { tool: secret, calls } = countedSecret();
    const flow = defineAgentWorkerFlow({ catalog: { secret } });
    const [worker] = hire(
      [record({ id: "qa.tester", body: "You test.", skills: [held] })],
      { [AGENT_FLOW]: flow },
    );

    const { result } = await runTurn(
      worker!,
      "/held do it",
      answerMocks([callTool("secret"), { text: "done" }]),
    );

    expect(result.error).toBeUndefined();
    expect(calls()).toBe(0);
  });
});
