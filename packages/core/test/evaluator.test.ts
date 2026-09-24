/**
 * The `evaluator` block: what it refuses, what it asks, and what it returns.
 *
 * Every test drives the block through its runtime entry with a hand-built
 * evaluation model that counts its calls, so "refused before any call" is an
 * assertion on a counter, not on an error message alone.
 */
import { describe, expect, it, vi } from "vitest";
import { APICallError } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { z } from "zod";
import { boolean, choice, evaluator, score } from "../src/blocks/evaluator";
import type { BlockContext } from "../src/types/block";
import type { EvaluationModel } from "../src/types/evaluation";
import type { GeneratorModel, ModelResolver } from "../src/types/model";
import { selectModel } from "../src/models/selectModel";
import { defineCapability } from "../src/capability/define-capability";
import { defineResource } from "../src/types/resource";
import { createMockContext, runForTest } from "./helpers";

type DoEvaluateOptions = {
  state: unknown;
  questions: Record<string, { type: string }>;
  abortSignal?: AbortSignal;
};

/**
 * An evaluation model whose `doEvaluate` returns `result` (or runs
 * `respond`) and records every call.
 */
function mockEvaluationModel(options: {
  answers?: Record<string, unknown>;
  providerMetadata?: Record<string, Record<string, unknown>>;
  usage?: { inputTokens?: number; outputTokens?: number };
  modelId?: string;
  supportedQuestionTypes?: Array<"choice" | "score" | "boolean">;
  respond?: (call: DoEvaluateOptions) => Promise<unknown>;
}) {
  const calls: DoEvaluateOptions[] = [];
  const model = {
    specificationVersion: "v4",
    provider: "mock.evaluation",
    modelId: options.modelId ?? "mock-eval",
    supportedQuestionTypes: options.supportedQuestionTypes ?? ["choice", "score", "boolean"],
    async doEvaluate(call: DoEvaluateOptions) {
      calls.push(call);
      if (options.respond) return options.respond(call);
      return {
        answers: options.answers ?? {},
        usage: options.usage ?? { inputTokens: 11, outputTokens: 3 },
        warnings: [],
        providerMetadata: options.providerMetadata,
      };
    },
  };
  return { model: model as unknown as EvaluationModel, calls };
}

const ticketQuestions = {
  team: choice("Which team should handle this?", {
    billing: "Payments and refunds",
    technical: "Bugs and outages",
  }),
  frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
  urgent: boolean("Does this need someone now?"),
};

const ticketAnswers = {
  team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1 } },
  frustration: { type: "score", score: 1 },
  urgent: { type: "boolean", probability: 0.2 },
};

/** A context whose resolver counts generate-model and evaluation-model resolutions. */
function spyContext(options?: {
  resolveEvaluationModel?: ModelResolver["resolveEvaluationModel"];
  signal?: AbortSignal;
  onBlockTraceCapture?: NonNullable<BlockContext["_runtimeHooks"]>["onBlockTraceCapture"];
  onGeneratorModelResult?: NonNullable<BlockContext["_runtimeHooks"]>["onGeneratorModelResult"];
}) {
  const generateResolutions = vi.fn((): GeneratorModel => {
    throw new Error("an evaluator must never resolve a generate model");
  });
  const resolveModel = generateResolutions as unknown as ModelResolver;
  resolveModel.resolveId = (id: string) => id;
  if (options?.resolveEvaluationModel !== undefined) {
    resolveModel.resolveEvaluationModel = options.resolveEvaluationModel;
  }
  const ctx = createMockContext({
    resolveModel,
    ...(options?.signal ? { signal: options.signal } : {}),
    _runtimeHooks: {
      onBlockTraceCapture: options?.onBlockTraceCapture,
      onGeneratorModelResult: options?.onGeneratorModelResult,
    },
  });
  return { ctx, generateResolutions };
}

describe("evaluator — the model fence (BR-10, BR-12)", () => {
  it("refuses a language model instance when the block is built, naming evaluationModel(...)", () => {
    const languageModel = new MockLanguageModelV3({ modelId: "gpt-5.4-mini" });
    expect(() =>
      evaluator({ name: "triage", model: languageModel as never, questions: ticketQuestions })
    ).toThrow(/Evaluator "triage": the model can generate but not evaluate[\s\S]*evaluationModel\(/);
  });

  it("refuses an FSD generator model when the block is built", () => {
    const generatorModel: GeneratorModel = {
      modelId: "openai/gpt-5.4-mini",
      generate: async () => ({ text: "no" }),
    };
    expect(() =>
      evaluator({ name: "triage", model: generatorModel as never, questions: ticketQuestions })
    ).toThrow(/can generate but not evaluate/);
  });

  it("refuses an intent, a fallback array and a selectModel result: an evaluator takes one model", () => {
    expect(() =>
      evaluator({ name: "triage", model: "intent/classify", questions: ticketQuestions })
    ).toThrow(/Evaluator "triage".*one model/);
    expect(() =>
      evaluator({
        name: "triage",
        model: ["openai/gpt-5.4-mini", "typesafe-ai/jev"] as never,
        questions: ticketQuestions,
      })
    ).toThrow(/one model/);
    expect(() =>
      evaluator({
        name: "triage",
        model: selectModel("openai/gpt-5.4-mini", [{ preferProvider: () => "openai" }]) as never,
        questions: ticketQuestions,
      })
    ).toThrow(/one model/);
  });
});

describe("evaluator — capabilities", () => {
  it("refuses a capability that supplies a model, while one that supplies resources installs", () => {
    const { model } = mockEvaluationModel({});
    const modelCap = defineCapability({
      name: "picks-a-model",
      presets: { default: ["core"], core: { model: "openai/gpt-5.4-mini" } },
    });
    expect(() =>
      evaluator({ name: "triage", model, questions: ticketQuestions, uses: [modelCap] })
    ).toThrow(/declares model.*only valid on generator/);

    const notes = defineResource({ scope: "session", stateSchema: z.object({ n: z.number() }) });
    const resourceCap = defineCapability({ name: "notes-cap", resources: { notes } });
    const block = evaluator({ name: "triage", model, questions: ticketQuestions, uses: [resourceCap] });
    expect(Object.keys(block.declaredResources ?? {})).toEqual(["notes"]);
  });
});

describe("evaluator — asking (BR-1 to BR-5)", () => {
  it("makes one provider call and returns one typed answer per question id (BR-1)", async () => {
    const { model, calls } = mockEvaluationModel({ answers: ticketAnswers });
    const block = evaluator({ name: "triage", model, questions: ticketQuestions });
    const { ctx, generateResolutions } = spyContext();

    const output = await runForTest(block, "My card was charged twice", ctx);

    expect(calls).toHaveLength(1);
    expect(generateResolutions).not.toHaveBeenCalled();
    expect(Object.keys(output)).toEqual(["answers"]);
    expect(output.answers.team.choice).toBe("billing");
    expect(Object.keys(ticketQuestions.team.criteria)).toContain(output.answers.team.choice);
    expect(output.answers.frustration).toEqual({ type: "score", score: 1 });
    expect(output.answers.urgent).toEqual({ type: "boolean", probability: 0.2 });
    // The SDK receives the questions exactly as built.
    expect(calls[0]!.questions).toEqual(ticketQuestions);
  });

  it("runs a questions function once per execution and asks its result (BR-2)", async () => {
    const { model, calls } = mockEvaluationModel({
      answers: { skill: { type: "choice", choice: "search" } },
    });
    const questionsFn = vi.fn((input: { skills: string[] }) => ({
      skill: choice(
        "Which skill fits?",
        Object.fromEntries(input.skills.map((s) => [s, null])) as Record<string, null>
      ),
    }));
    const block = evaluator({
      name: "activator",
      model,
      inputSchema: z.object({ skills: z.array(z.string()) }),
      questions: questionsFn,
      state: () => "find me the report",
    });

    const output = await runForTest(block, { skills: ["search", "write"] }, spyContext().ctx);

    expect(questionsFn).toHaveBeenCalledTimes(1);
    expect(calls[0]!.questions).toEqual({
      skill: { type: "choice", instructions: "Which skill fits?", criteria: { search: null, write: null } },
    });
    expect(output.answers.skill.choice).toBe("search");
  });

  it("refuses an empty question set, a choice with no options and a one-level score, naming block and question (BR-3)", async () => {
    const { model, calls } = mockEvaluationModel({});
    expect(() => evaluator({ name: "empty", model, questions: {} })).toThrow(
      /Evaluator "empty": questions must contain at least one question/
    );
    expect(() =>
      evaluator({ name: "no-options", model, questions: { team: choice("Which?", {}) } })
    ).toThrow(/Evaluator "no-options": question "team" is a choice with no options/);
    expect(() =>
      evaluator({ name: "one-level", model, questions: { mood: score("How?", ["Calm"]) } })
    ).toThrow(/Evaluator "one-level": question "mood" is a score with fewer than two levels/);

    // A questions function is checked at execution, still before any call.
    const dynamic = evaluator({ name: "dynamic", model, questions: () => ({}) });
    await expect(runForTest(dynamic, "x", spyContext().ctx)).rejects.toThrow(
      /Evaluator "dynamic": questions must contain at least one question/
    );
    expect(calls).toHaveLength(0);
  });

  it("evaluates the input when no state is configured, and the state function's result when one is (BR-4)", async () => {
    const first = mockEvaluationModel({ answers: { urgent: { type: "boolean", probability: 0.5 } } });
    await runForTest(
      evaluator({ name: "plain", model: first.model, questions: { urgent: boolean("Urgent?") } }),
      { message: "help", tier: "gold" },
      spyContext().ctx
    );
    expect(first.calls[0]!.state).toEqual({ message: "help", tier: "gold" });

    const second = mockEvaluationModel({ answers: { urgent: { type: "boolean", probability: 0.5 } } });
    await runForTest(
      evaluator({
        name: "projected",
        model: second.model,
        questions: { urgent: boolean("Urgent?") },
        state: (input: { message: string }) => input.message,
      }),
      { message: "help" },
      spyContext().ctx
    );
    expect(second.calls[0]!.state).toBe("help");
  });

  it("refuses a state that is not a string, an array or a plain object, before any call (BR-4)", async () => {
    const { model, calls } = mockEvaluationModel({});
    const block = evaluator({
      name: "dated",
      model,
      questions: { urgent: boolean("Urgent?") },
      state: () => new Date() as never,
    });
    await expect(runForTest(block, "x", spyContext().ctx)).rejects.toThrow(
      /Evaluator "dated": the evaluated state must be a string, an array or a plain object/
    );
    await expect(
      runForTest(evaluator({ name: "numeric", model, questions: { urgent: boolean("Urgent?") } }), 42 as never, spyContext().ctx)
    ).rejects.toThrow(/Evaluator "numeric".*got number/);
    expect(calls).toHaveLength(0);
  });

  it("refuses a question type the model does not support before any provider I/O, naming the type (BR-5)", async () => {
    const { model, calls } = mockEvaluationModel({ supportedQuestionTypes: ["choice", "score"] });
    const block = evaluator({ name: "triage", model, questions: ticketQuestions });
    await expect(runForTest(block, "x", spyContext().ctx)).rejects.toThrow(/boolean/);
    expect(calls).toHaveLength(0);
  });
});

describe("evaluator — answers (BR-16 to BR-19)", () => {
  it("carries exactly the confidence the model reported, and none where it reported none", async () => {
    const { model } = mockEvaluationModel({
      answers: {
        team: { type: "choice", choice: "technical", probabilities: { billing: 0.2, technical: 0.8 } },
        frustration: { type: "score", score: 2, probabilities: { "0": 0, "1": 0, "2": 1 } },
        urgent: { type: "boolean", probability: 0.9 },
      },
      providerMetadata: { typesafe: { confidence: { team: 0.94, frustration: 0.71 } } },
    });
    const output = await runForTest(
      evaluator({ name: "triage", model, questions: ticketQuestions }),
      "x",
      spyContext().ctx
    );

    expect(output.answers.team.confidence).toBe(0.94);
    expect(output.answers.frustration.confidence).toBe(0.71);
    // P(true) is an answer, never copied into confidence.
    expect("confidence" in output.answers.urgent).toBe(false);
    expect(output.answers.urgent.probability).toBe(0.9);
    // Distributions pass through unchanged.
    expect(output.answers.team.probabilities).toEqual({ billing: 0.2, technical: 0.8 });
    expect(output.answers.frustration.probabilities).toEqual({ "0": 0, "1": 0, "2": 1 });
  });

  it("leaves the confidence key out entirely when the model reports no confidence", async () => {
    const { model } = mockEvaluationModel({ answers: ticketAnswers });
    const output = await runForTest(
      evaluator({ name: "triage", model, questions: ticketQuestions }),
      "x",
      spyContext().ctx
    );
    for (const answer of Object.values(output.answers)) {
      expect("confidence" in answer).toBe(false);
    }
    expect("probabilities" in output.answers.frustration).toBe(false);
  });
});

describe("evaluator — failures (BR-14, BR-20, BR-21)", () => {
  it("makes exactly one call when the provider fails, and fails with the provider's message (BR-14, BR-21)", async () => {
    const { model, calls } = mockEvaluationModel({
      // A transient provider error the SDK would retry by default: the block
      // must still make exactly one call.
      respond: async () => {
        throw new APICallError({
          message: "upstream 503 from evaluation provider",
          url: "https://evaluation.example/v1",
          requestBodyValues: {},
          statusCode: 503,
          isRetryable: true,
        });
      },
    });
    const { ctx, generateResolutions } = spyContext();
    await expect(
      runForTest(evaluator({ name: "triage", model, questions: ticketQuestions }), "x", ctx)
    ).rejects.toThrow(/upstream 503 from evaluation provider/);
    expect(calls).toHaveLength(1);
    expect(generateResolutions).not.toHaveBeenCalled();
  });

  it("fails with the SDK's validation error when a successful result is missing an answer, reporting nothing (BR-20)", async () => {
    const { model, calls } = mockEvaluationModel({
      answers: { team: ticketAnswers.team, frustration: ticketAnswers.frustration },
    });
    const onGeneratorModelResult = vi.fn();
    const { ctx } = spyContext({ onGeneratorModelResult });
    await expect(
      runForTest(evaluator({ name: "triage", model, questions: ticketQuestions }), "x", ctx)
    ).rejects.toThrow(/exactly one answer for every question/);
    expect(calls).toHaveLength(1);
    expect(onGeneratorModelResult).not.toHaveBeenCalled();
  });

  it("fails with the SDK's validation error when a distribution does not sum to one (BR-20)", async () => {
    const { model } = mockEvaluationModel({
      answers: {
        ...ticketAnswers,
        team: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.9 } },
      },
    });
    await expect(
      runForTest(evaluator({ name: "triage", model, questions: ticketQuestions }), "x", spyContext().ctx)
    ).rejects.toThrow(/probabilities must sum to 1/);
  });

  it("hands the provider call the block's abort signal (BR-22)", async () => {
    const { model, calls } = mockEvaluationModel({ answers: ticketAnswers });
    const controller = new AbortController();
    await runForTest(
      evaluator({ name: "triage", model, questions: ticketQuestions }),
      "x",
      spyContext({ signal: controller.signal }).ctx
    );
    expect(calls[0]!.abortSignal).toBe(controller.signal);
  });
});

describe("evaluator — model strings and the resolver hook (D1, D4)", () => {
  it("refuses a model string when the resolver has no resolveEvaluationModel hook, before any call (BR-29)", async () => {
    const block = evaluator({ name: "triage", model: "typesafe-ai/jev", questions: ticketQuestions });
    const { ctx, generateResolutions } = spyContext();
    await expect(runForTest(block, "x", ctx)).rejects.toThrow(
      /Evaluator "triage".*"typesafe-ai\/jev".*resolveEvaluationModel/
    );
    expect(generateResolutions).not.toHaveBeenCalled();
  });

  it("resolves a model string through the hook, once, and asks the model it returns", async () => {
    const { model, calls } = mockEvaluationModel({ answers: ticketAnswers });
    const hook = vi.fn(async () => model);
    const block = evaluator({ name: "triage", model: "typesafe-ai/jev", questions: ticketQuestions });
    await runForTest(block, "x", spyContext({ resolveEvaluationModel: hook }).ctx);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(hook).toHaveBeenCalledWith("typesafe-ai/jev", "triage");
    expect(calls).toHaveLength(1);
  });

  it("refuses what a hook returns when it cannot evaluate, before any call", async () => {
    const languageModel = new MockLanguageModelV3({ modelId: "gpt-5.4-mini" });
    const hook = vi.fn(() => languageModel as never);
    const block = evaluator({ name: "triage", model: "openai/gpt-5.4-mini", questions: ticketQuestions });
    await expect(
      runForTest(block, "x", spyContext({ resolveEvaluationModel: hook }).ctx)
    ).rejects.toThrow(/cannot evaluate/);
  });

  it("uses an evaluation model instance without consulting the resolver (BR-9, BR-30)", async () => {
    const { model } = mockEvaluationModel({ answers: ticketAnswers });
    const hook = vi.fn();
    await runForTest(
      evaluator({ name: "triage", model, questions: ticketQuestions }),
      "x",
      spyContext({ resolveEvaluationModel: hook }).ctx
    );
    expect(hook).not.toHaveBeenCalled();
  });
});

describe("evaluator — trace (BR-23, BR-24)", () => {
  it("records the requested model and questions, then reports usage and the model that answered", async () => {
    const { model } = mockEvaluationModel({
      answers: ticketAnswers,
      usage: { inputTokens: 40, outputTokens: 2 },
      modelId: "jev-latest",
    });
    const onBlockTraceCapture = vi.fn();
    const onGeneratorModelResult = vi.fn();
    await runForTest(
      evaluator({ name: "triage", model, questions: ticketQuestions }),
      "x",
      spyContext({ onBlockTraceCapture, onGeneratorModelResult }).ctx
    );

    const evaluatorPhase = onBlockTraceCapture.mock.calls.find(([payload]) => payload.phase === "evaluator");
    expect(evaluatorPhase?.[0].data.evaluator).toEqual({
      model: "mock.evaluation/jev-latest",
      questions: ticketQuestions,
    });
    expect(onGeneratorModelResult).toHaveBeenCalledTimes(1);
    expect(onGeneratorModelResult).toHaveBeenCalledWith({
      model: "mock.evaluation/jev-latest",
      usage: { promptTokens: 40, completionTokens: 2, totalTokens: 42 },
      identity: { actual: "jev-latest", requested: "mock.evaluation/jev-latest" },
    });
  });
});
