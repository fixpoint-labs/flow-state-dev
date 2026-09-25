/**
 * Tier 3 of `createSkillActivator` on an app-supplied evaluator.
 *
 * Every case runs the real activator through the engine (`runAction`), with a
 * scripted evaluation model and a counting mock for the generator classifier,
 * so "the classifier made no call" is a call count, not the absence of a row.
 *
 * What matters, and why each block below exists:
 * - with no evaluator, nothing changes (apps that pass nothing are not moved);
 * - with one, the evaluator's pick is final: it activates with the model's own
 *   confidence or none, never gated on a number the activator made up;
 * - a failure fails the activator and never quietly runs the classifier.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  choice,
  defineFlow,
  evaluator,
  handler,
  sequencer,
  DEFAULT_ORG_ID,
} from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInMemoryStores, createResponseEmitter, runAction } from "@flow-state-dev/engine";
import {
  createMockModelResolver,
  mockEvaluationModel,
  mockGenerator,
  type MockEvaluationAnswer,
} from "@flow-state-dev/testing";
import {
  createSkillActivator,
  defineSkillsCollection,
  skillEvaluator,
  skillQuestions,
  type SkillActivatorOptions,
} from "../../src/skills";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const skill = (name: string, description: string, extra: string[] = []): InitialSkill => ({
  name,
  skillMd: ["---", `description: ${description}`, ...extra, "---", "", `Body of ${name}.`].join("\n"),
});

const research = skill("research", "Research a topic in depth", [
  "when_to_use: The user asks to investigate or look into something",
  "keywords: [investigate]",
]);
const draft = skill("draft", "Draft a document");
const catalog = [research, draft];

/** A message no slash or keyword tier matches. */
const MISS = "what's known about room-temperature superconductors?";

const pick = (choice: string, confidence?: number): Record<string, MockEvaluationAnswer> => ({
  skill: { type: "choice", choice, ...(confidence !== undefined ? { confidence } : {}) },
});

/** A counting generator-classifier mock, scripted with the given matches. */
function classifierMock(activeSkills: Array<{ name: string; confidence: number }> = []) {
  return mockGenerator({
    name: "skill-classifier",
    script: [
      {
        structuredOutput: {
          reasoning: "scripted",
          activeSkills: activeSkills.map((s) => ({ ...s, input: "" })),
        },
      },
    ] as never,
  });
}

type ActivatorDelta = {
  skills?: Array<Record<string, unknown>>;
  classifierConfidence?: number | null;
};

let requestSeq = 0;

async function runTurn(opts: {
  activator: ReturnType<typeof createSkillActivator>;
  message?: string;
  input?: Record<string, unknown>;
  classifier?: ReturnType<typeof classifierMock>;
  modelResolver?: ModelResolver;
  signal?: AbortSignal;
  stores?: ReturnType<typeof createInMemoryStores>;
  requestId?: string;
}) {
  const requestId = opts.requestId ?? `req_${++requestSeq}`;
  const turn = sequencer({
    name: "turn",
    inputSchema: z.object({ message: z.string() }).passthrough(),
  }).step(opts.activator);
  const flow = defineFlow({
    kind: `activator-${requestId}`,
    resources: { skills: defineSkillsCollection({ scope: "session" }) },
    actions: {
      run: { inputSchema: z.object({ message: z.string() }).passthrough(), block: turn },
    },
  })();
  const classifier = opts.classifier ?? classifierMock();
  const response = createResponseEmitter({ requestId, now: () => Date.now() });
  const stores = opts.stores ?? createInMemoryStores();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input: opts.input ?? { message: opts.message ?? MISS },
    requestId,
    userId: "user_1",
    sessionId: `sess_${requestId}`,
    stores,
    responseEmitter: response,
    signal: opts.signal,
    runtimeConfig: {
      modelResolver:
        opts.modelResolver ??
        createMockModelResolver({ generators: { "skill-classifier": classifier } }),
    },
  });
  const items = response.getItems() as Array<Record<string, unknown>>;
  const traces = items.filter((i) => i.type === "block_trace") as unknown as BlockTraceItem[];
  const stateChanges = items.filter((i) => i.type === "state_change");
  /** The activator's own state, merged across its patches. */
  const activatorState = stateChanges
    .filter(
      (i) =>
        i.scope === "block_instance" &&
        (i.provenance as { blockName?: string }).blockName === "skill-activator",
    )
    .reduce<ActivatorDelta>((acc, i) => ({ ...acc, ...(i.delta as ActivatorDelta) }), {});
  /** Whether the activator wrote the active-skills field at all, and what. */
  const sessionWrite = stateChanges.find(
    (i) => i.scope === "session" && "activeSkills" in (i.delta as Record<string, unknown>),
  );
  const activeSkills = sessionWrite
    ? ((sessionWrite.delta as { activeSkills: Array<{ name: string; source: string; input: string }> })
        .activeSkills)
    : undefined;
  return { result, traces, activatorState, activeSkills, classifier, stores, requestId };
}

// ---------------------------------------------------------------------------
// Off path: nothing passed, nothing changes (BR-1)
// ---------------------------------------------------------------------------

describe("no evaluator passed: today's generator classifier, unchanged (BR-1)", () => {
  it("asks the classifier the same prompt on the same model, and keeps only matches above 0.65", async () => {
    const classifier = classifierMock([
      { name: "research", confidence: 0.9 },
      { name: "draft", confidence: 0.3 },
    ]);
    const { result, traces, activeSkills, activatorState } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog }),
      classifier,
    });

    expect(result.error).toBeUndefined();
    expect(classifier.calls).toHaveLength(1);
    expect(classifier.calls[0]!.model).toBe("intent/utility");
    // The prompt a byte-level snapshot of the pre-change lister's output: the
    // shared catalog lister must describe skills exactly as before.
    const system = JSON.stringify(classifier.calls[0]!.input);
    expect(system).toContain(
      JSON.stringify(
        [
          "You classify a single user message: which (if any) of the available skills applies?",
          "Return your reasoning first (one short sentence), then zero-or-more skill matches with per-match confidence in 0..1.",
          "If no skill clearly applies, return an empty `activeSkills` array. Do not invent skill names not in the catalog.",
          "",
          "Available skills (you may activate zero or more — only when the message clearly matches):",
          "- research: Research a topic in depth\nThe user asks to investigate or look into something",
          "- draft: Draft a document",
        ].join("\n"),
      ).slice(1, -1),
    );
    expect(activeSkills?.map((s) => s.name)).toEqual(["research"]);
    expect(activatorState.classifierConfidence).toBe(0.9);
    // No evaluator block exists on this path, so none can run or resolve a model.
    expect(traces.some((t) => t.blockKind === "evaluator")).toBe(false);
  });

  it("no module but the helper imports core's evaluator values, so an activator built without one never builds one", () => {
    const dir = join(__dirname, "../../src/skills");
    const valueImport =
      /import\s*\{([^}]*)\}\s*from\s*"@flow-state-dev\/core"/g;
    const offenders: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(dir, file), "utf8");
      for (const m of src.matchAll(valueImport)) {
        const names = m[1]!.split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "));
        if (names.some((n) => ["evaluator", "choice", "score", "boolean"].includes(n))) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual(["skill-evaluator.ts"]);
    // The activator reaches the helper module by type only.
    const activatorSrc = readFileSync(join(dir, "skill-activator.ts"), "utf8");
    expect(activatorSrc).not.toMatch(/from\s*"\.\/skill-evaluator"/);
    const tierSrc = readFileSync(join(dir, "skill-evaluator-tier.ts"), "utf8");
    expect(tierSrc).toMatch(/import type \{[^}]*\}\s*from\s*"\.\/skill-evaluator"/);
    expect(tierSrc).not.toMatch(/^import \{[^}]*\}\s*from\s*"\.\/skill-evaluator"/m);
  });
});

// ---------------------------------------------------------------------------
// Which classifier runs (BR-2, BR-3) and what it is offered (BR-4, BR-5, BR-7)
// ---------------------------------------------------------------------------

describe("with an evaluator: when it runs and what it is offered", () => {
  it("a slash hit and a keyword hit each resolve the turn without calling it (BR-2)", async () => {
    for (const message of ["/draft a memo", "please investigate the outage"]) {
      const model = mockEvaluationModel({ answers: pick("research") });
      const { result, activeSkills } = await runTurn({
        activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(model) }),
        message,
      });
      expect(result.error).toBeUndefined();
      expect(activeSkills?.length).toBe(1);
      expect(model.calls).toHaveLength(0);
    }
  });

  it("on a miss, asks once with exactly the allowed, model-invocable, capped catalog plus no-skill, and the classifier never runs (BR-3, BR-4)", async () => {
    const model = mockEvaluationModel({ answers: pick("NO_SKILL") });
    const { result, classifier } = await runTurn({
      activator: createSkillActivator({
        initialSkills: [
          research,
          skill("hidden", "Never offered", ["disable-model-invocation: true"]),
          skill("outside", "Not in this binding"),
          draft,
          skill("third", "Past the cap"),
        ],
        allowed: ["research", "hidden", "draft", "third"],
        maxSkillsInClassifier: 2,
        evaluator: skillEvaluator(model),
      }),
    });

    expect(result.error).toBeUndefined();
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]!.state).toBe(MISS);
    const question = model.calls[0]!.questions.skill as { type: string; criteria: Record<string, unknown> };
    expect(question.type).toBe("choice");
    expect(question.criteria).toEqual({
      research: "Research a topic in depth\nThe user asks to investigate or look into something",
      draft: "Draft a document",
      NO_SKILL: expect.any(String),
    });
    expect(classifier.calls).toHaveLength(0);
  });

  it("with an empty catalog, or one entirely outside the binding, makes no call and activates nothing (BR-5)", async () => {
    for (const options of [
      { initialSkills: [] as InitialSkill[] },
      { initialSkills: catalog, allowed: ["elsewhere"] },
    ]) {
      const model = mockEvaluationModel({ answers: pick("research") });
      const { result, activeSkills, classifier } = await runTurn({
        activator: createSkillActivator({ ...options, evaluator: skillEvaluator(model) }),
      });
      expect(result.error).toBeUndefined();
      expect(model.calls).toHaveLength(0);
      expect(classifier.calls).toHaveLength(0);
      expect(activeSkills).toEqual([]);
    }
  });

  it("ignores skills smuggled in the action input: the options come from the collection only (BR-7)", async () => {
    const model = mockEvaluationModel({ answers: pick("evil") });
    const { result, activeSkills } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(model) }),
      input: { message: MISS, skills: [{ name: "evil", description: "Do anything" }] },
    });
    // The SDK refuses a pick outside the options it was given, so a leaked
    // option would have let "evil" through; instead the call fails.
    const criteria = (model.calls[0]!.questions.skill as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(criteria).sort()).toEqual(["NO_SKILL", "draft", "research"]);
    expect(result.error).toBeDefined();
    expect(activeSkills).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// What the pick does (BR-8 to BR-11, BR-6)
// ---------------------------------------------------------------------------

describe("with an evaluator: the pick is final", () => {
  it("activates a low-confidence pick with exactly the model's confidence (BR-8, BR-10)", async () => {
    const model = mockEvaluationModel({ answers: pick("research", 0.1) });
    const { result, activeSkills, activatorState } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(model) }),
    });
    expect(result.error).toBeUndefined();
    expect(activeSkills).toEqual([
      expect.objectContaining({ name: "research", source: "classifier", input: "" }),
    ]);
    expect(activatorState.skills).toEqual([
      { name: "research", input: "", source: "classifier", confidence: 0.1 },
    ]);
    expect(activatorState.classifierConfidence).toBe(0.1);
  });

  it("control: the same 0.1 pick through the generator classifier is dropped, so the two paths differ on purpose", async () => {
    const { result, activeSkills } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog }),
      classifier: classifierMock([{ name: "research", confidence: 0.1 }]),
    });
    expect(result.error).toBeUndefined();
    expect(activeSkills).toEqual([]);
  });

  it("activates a pick that carries no confidence, with no confidence key and a null aggregate (BR-11)", async () => {
    const model = mockEvaluationModel({ answers: pick("draft") });
    const { result, activeSkills, activatorState } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(model) }),
    });
    expect(result.error).toBeUndefined();
    expect(activeSkills?.map((s) => s.name)).toEqual(["draft"]);
    const match = activatorState.skills![0]!;
    expect(match.name).toBe("draft");
    expect(match.input).toBe("");
    expect("confidence" in match).toBe(false);
    expect(activatorState.classifierConfidence).toBeNull();
  });

  it("'no skill' activates nothing; a skill actually named 'none' is offered and activates when picked (BR-6, BR-9)", async () => {
    const withNone = [...catalog, skill("none", "A skill that happens to be called none")];

    const noSkill = mockEvaluationModel({ answers: pick("NO_SKILL", 0.8) });
    const first = await runTurn({
      activator: createSkillActivator({ initialSkills: withNone, evaluator: skillEvaluator(noSkill) }),
    });
    expect(first.result.error).toBeUndefined();
    expect(first.activeSkills).toEqual([]);
    expect(first.activatorState.classifierConfidence).toBeNull();
    const criteria = (noSkill.calls[0]!.questions.skill as { criteria: Record<string, unknown> }).criteria;
    expect(Object.keys(criteria)).toContain("none");

    const named = mockEvaluationModel({ answers: pick("none") });
    const second = await runTurn({
      activator: createSkillActivator({ initialSkills: withNone, evaluator: skillEvaluator(named) }),
    });
    expect(second.activeSkills?.map((s) => s.name)).toEqual(["none"]);
  });
});

// ---------------------------------------------------------------------------
// Failures (BR-12 to BR-14)
// ---------------------------------------------------------------------------

describe("with an evaluator: failures fail the activator, with no fallback", () => {
  const failing: Array<[string, () => { activator: ReturnType<typeof createSkillActivator>; resolver?: ModelResolver }]> = [
    [
      "a provider error",
      () => ({
        activator: createSkillActivator({
          initialSkills: catalog,
          evaluator: skillEvaluator(mockEvaluationModel({ error: new Error("evaluation provider returned 503") })),
        }),
      }),
    ],
    [
      "a malformed result",
      () => ({
        activator: createSkillActivator({
          initialSkills: catalog,
          evaluator: skillEvaluator(mockEvaluationModel({ answers: {} })),
        }),
      }),
    ],
    [
      "a model string the app's resolver can't evaluate with",
      () => ({
        activator: createSkillActivator({
          initialSkills: catalog,
          evaluator: skillEvaluator("openai/gpt-5.4-mini"),
        }),
      }),
    ],
  ];

  for (const [label, build] of failing) {
    it(`${label}: the activator fails, the classifier makes no call, no skills are written (BR-12)`, async () => {
      const { activator } = build();
      const { result, classifier, activeSkills } = await runTurn({ activator });
      expect(result.error).toBeDefined();
      expect(classifier.calls).toHaveLength(0);
      expect(activeSkills).toBeUndefined();
    });
  }

  it("control: wrapped in .rescue, the turn gets the rescue handler's result instead", async () => {
    const activator = createSkillActivator({
      initialSkills: catalog,
      evaluator: skillEvaluator(mockEvaluationModel({ error: new Error("evaluation provider returned 503") })),
    });
    const fallback = handler({ name: "skip-skills", execute: () => ({ skipped: true }) });
    const { result, classifier } = await runTurn({
      activator: activator.rescue([{ block: fallback }]) as never,
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ skipped: true });
    expect(classifier.calls).toHaveLength(0);
  });

  it("a request cancelled mid-call ends aborted, not failed (BR-13)", async () => {
    const model = mockEvaluationModel({ answers: pick("research"), hold: true });
    const controller = new AbortController();
    const stores = createInMemoryStores();
    const requestId = "req_activator_abort";
    const pending = runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(model) }),
      signal: controller.signal,
      stores,
      requestId,
    });
    await vi.waitFor(() => expect(model.calls).toHaveLength(1));
    await stores.request.setFieldsIfStatus(requestId, { abortRequested: true }, ["in_progress"], Date.now());
    controller.abort();
    const { result, activeSkills } = await pending;

    expect(model.calls[0]!.abortSignal?.aborted).toBe(true);
    expect(result.error).toBeUndefined();
    expect((await stores.request.get(requestId))?.status).toBe("aborted");
    expect(activeSkills).toBeUndefined();
  });

  it("a hand-built evaluator that asks a different question fails, naming the block and the skill question (BR-14)", async () => {
    const wrong = evaluator({
      name: "pick-tone",
      model: mockEvaluationModel({ answers: { tone: { type: "choice", choice: "formal" } } }),
      questions: { tone: choice("Which tone?", { formal: null, casual: null }) },
    });
    const { result, activeSkills } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: wrong }),
    });
    expect(result.error?.message).toMatch(/"pick-tone"/);
    expect(result.error?.message).toMatch(/"skill" choice question/);
    expect(activeSkills).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Configuration (BR-15 to BR-19)
// ---------------------------------------------------------------------------

describe("configuration", () => {
  const model = () => mockEvaluationModel({ answers: pick("research") });

  it("refuses a block that isn't an evaluator, naming the option (BR-15)", () => {
    const notEvaluators = [
      handler({ name: "a-handler", execute: () => ({}) }),
      // A generator-shaped block: what matters is its kind.
      { ...handler({ name: "a-generator", execute: () => ({}) }), kind: "generator" },
    ];
    for (const block of notEvaluators) {
      expect(() =>
        createSkillActivator({ evaluator: block as unknown as SkillActivatorOptions["evaluator"] }),
      ).toThrow(/"evaluator" must be an evaluator block/);
    }
  });

  it("refuses an evaluator beside the generator classifier's options (BR-16)", () => {
    const clashes: Array<Partial<SkillActivatorOptions>> = [
      { classifierModel: "intent/utility" },
      { confidenceThreshold: 0.5 },
      { enableLlmClassifier: false },
    ];
    for (const clash of clashes) {
      expect(() => createSkillActivator({ ...clash, evaluator: skillEvaluator(model()) })).toThrow(
        /configure the generator classifier, which the evaluator replaces/,
      );
    }
    // An explicit `enableLlmClassifier: true` asks for tier 3 and is not a clash.
    expect(() =>
      createSkillActivator({ enableLlmClassifier: true, evaluator: skillEvaluator(model()) }),
    ).not.toThrow();
  });

  it("a model string resolves through the app's resolver once, when the block runs (BR-17)", async () => {
    const evalModel = model();
    const resolveEvaluationModel = vi.fn(async () => evalModel);
    const base = createMockModelResolver({ generators: {} });
    const resolver = Object.assign(((id: string, block?: string) => base(id, block)) as ModelResolver, {
      resolveId: base.resolveId,
      resolveEvaluationModel,
    });

    const block = skillEvaluator("typesafe-ai/jev");
    expect(resolveEvaluationModel).not.toHaveBeenCalled();
    const { result, activeSkills } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: block }),
      modelResolver: resolver,
    });
    expect(result.error).toBeUndefined();
    expect(resolveEvaluationModel).toHaveBeenCalledTimes(1);
    expect(resolveEvaluationModel).toHaveBeenCalledWith("typesafe-ai/jev", "skill-evaluator");
    expect(activeSkills?.map((s) => s.name)).toEqual(["research"]);
  });

  it("an evaluation model instance is used as given; a generate-only one is refused at the helper call (BR-18)", async () => {
    const evalModel = model();
    const { result } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(evalModel) }),
    });
    expect(result.error).toBeUndefined();
    expect(evalModel.calls).toHaveLength(1);

    const textModel = { modelId: "gpt-5.4-mini", doGenerate: async () => ({}), doStream: async () => ({}) };
    expect(() => skillEvaluator(textModel as never)).toThrow(/can generate but not evaluate/);
  });

  it("orchestration depends on core only, and names no evaluation library, lab or model (BR-19)", () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../../package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(["@flow-state-dev/core", "zod"]);

    const dir = join(__dirname, "../../src/skills");
    for (const file of ["skill-evaluator.ts", "skill-evaluator-tier.ts", "skill-activator.ts", "skill-catalog.ts"]) {
      // Code only: doc comments may show an example model.
      const code = readFileSync(join(dir, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      expect(code, file).not.toMatch(/typesafe|jev|@ai-sdk|thought-fabric|gpt-|claude-|gemini|\blab\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// Trace (BR-21)
// ---------------------------------------------------------------------------

describe("trace", () => {
  it("the evaluator's row sits under the activator, with the options it was offered and its answer (BR-21)", async () => {
    const evalModel = mockEvaluationModel({ answers: pick("research", 0.7) });
    const { traces } = await runTurn({
      activator: createSkillActivator({ initialSkills: catalog, evaluator: skillEvaluator(evalModel) }),
    });
    const activatorRow = traces.find((t) => t.blockName === "skill-activator")!;
    const row = traces.find((t) => t.blockKind === "evaluator")!;
    expect(row.blockName).toBe("skill-evaluator");
    expect(row.status).toBe("completed");
    const activatorPath = activatorRow.blockInstanceId.replace(/:\d+$/, "");
    expect(row.blockInstanceId.startsWith(`${activatorPath}/`)).toBe(true);
    expect(row.evaluator?.questions).toEqual(
      skillQuestions({
        message: MISS,
        skills: [
          { name: "research", description: "Research a topic in depth\nThe user asks to investigate or look into something" },
          { name: "draft", description: "Draft a document" },
        ],
      }),
    );
    expect(row.output).toEqual({
      kind: "inline",
      value: { answers: { skill: { type: "choice", choice: "research", confidence: 0.7 } } },
    });
    expect(row.modelUsage?.totalTokens).toBe(11);
  });
});
