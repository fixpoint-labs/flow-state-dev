// Every action of the routing-with-evaluators flow on scripted evaluation
// models, so none of this needs an API key.
//
// What each block protects:
// - classify: answers are typed, and `confidence` is only there when the
//   model reported it (the example never invents one);
// - route: the tree opens an edge only on reported confidence that clears the
//   floor, and a model that reports none always lands on review;
// - activate: slash and keyword resolve before the evaluator, the evaluator's
//   pick is final, and its failure fails the turn unless the app rescues it.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer, defineFlow, type EvaluationModel } from "@flow-state-dev/core";
import { defineSkillsCollection } from "@flow-state-dev/orchestration";
import {
  mockEvaluationModel,
  mockGenerator,
  testFlow,
  type MockEvaluationAnswer,
} from "@flow-state-dev/testing";
import { createRoutingFlow } from "../src/flow";
import { initialSkills, skillActivator } from "../src/activate";

const TICKET = { message: "I was charged twice for March" };

/**
 * A scripted model that answers only the questions each call asks, so one
 * model can serve every level of the tree. Every call is recorded.
 */
function scripted(script: Record<string, MockEvaluationAnswer>) {
  const calls: string[][] = [];
  const model = mockEvaluationModel({ answers: script }) as unknown as EvaluationModel & {
    doEvaluate(call: { questions: Record<string, unknown> }): Promise<unknown>;
  };
  const inner = model.doEvaluate.bind(model);
  return Object.assign(model, {
    asked: calls,
    async doEvaluate(call: { questions: Record<string, unknown> }) {
      const ids = Object.keys(call.questions);
      calls.push(ids);
      const result = (await inner(call)) as {
        answers: Record<string, unknown>;
        providerMetadata?: { typesafe: { confidence: Record<string, number> } };
      };
      const pick = <T>(rec: Record<string, T>) =>
        Object.fromEntries(Object.entries(rec).filter(([id]) => ids.includes(id)));
      const confidence = result.providerMetadata ? pick(result.providerMetadata.typesafe.confidence) : {};
      return {
        ...result,
        answers: pick(result.answers),
        providerMetadata: Object.keys(confidence).length > 0 ? { typesafe: { confidence } } : undefined,
      };
    },
  });
}

/** An unused model for the side of the flow a test doesn't run. */
const unused = () => mockEvaluationModel({ error: new Error("this model should not be called") });

type Verdict = { level: string; edge?: string; ambiguous?: string };

/** The cascade's verdicts, in the order its gates ran. */
function verdicts(items: unknown[]): Verdict[] {
  return (items as Array<Record<string, unknown>>)
    .filter((i) => i.type === "block_trace" && String(i.blockName).endsWith("/gate"))
    .map((i) => (i.output as { value: { verdict: Verdict } }).value.verdict);
}

async function run(action: string, models: Parameters<typeof createRoutingFlow>[0], input: unknown = TICKET) {
  return testFlow({ flow: createRoutingFlow(models), action, userId: "test-user", input });
}

describe("classify", () => {
  it("returns typed answers, with confidence only where the model reported it", async () => {
    const model = scripted({
      team: { type: "choice", choice: "billing", confidence: 0.92 },
      frustration: { type: "score", score: 1 },
      urgent: { type: "boolean", probability: 0.8 },
    });
    const result = await run("classify", { confident: model, withoutConfidence: unused() });

    expect(result.error).toBeUndefined();
    const { answers } = result.output as { answers: Record<string, Record<string, unknown>> };
    expect(answers.team).toMatchObject({ type: "choice", choice: "billing", confidence: 0.92 });
    expect(answers.frustration).toMatchObject({ type: "score", score: 1 });
    expect(answers.urgent).toMatchObject({ type: "boolean", probability: 0.8 });
    // Absent, not zero: nothing downstream may read a confidence nobody reported.
    expect("confidence" in answers.frustration!).toBe(false);
    expect("confidence" in answers.urgent!).toBe(false);
    expect(model.asked).toEqual([["team", "frustration", "urgent"]]);
  });
});

describe("route", () => {
  it("reaches the billing-urgent leaf when the model is sure at both levels", async () => {
    const model = scripted({
      team: { type: "choice", choice: "billing", confidence: 0.9 },
      urgency: { type: "choice", choice: "urgent", confidence: 0.8 },
    });
    const result = await run("route", { confident: model, withoutConfidence: unused() });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ queue: "billing-urgent" });
    expect(verdicts(result.items).map((v) => v.edge)).toEqual(["billing", "urgent"]);
  });

  it("sends the ticket to review when confidence is under the edge's floor", async () => {
    const model = scripted({
      team: { type: "choice", choice: "billing", confidence: 0.3 },
      urgency: { type: "choice", choice: "urgent", confidence: 0.9 },
    });
    const result = await run("route", { confident: model, withoutConfidence: unused() });

    expect(result.output).toEqual({ queue: "review" });
    expect(verdicts(result.items)).toEqual([expect.objectContaining({ level: "root", ambiguous: "below-floor" })]);
    // The second level is never asked once the first fails closed.
    expect(model.asked).toEqual([["team"]]);
  });

  it("sends the ticket to review when the model gave the choice but no confidence", async () => {
    const model = scripted({
      team: { type: "choice", choice: "technical" },
    });
    const result = await run("route", { confident: model, withoutConfidence: unused() });

    expect(result.output).toEqual({ queue: "review" });
    expect(verdicts(result.items)).toEqual([expect.objectContaining({ ambiguous: "no-confidence" })]);
  });
});

describe("routeWithoutConfidence", () => {
  it("lands on review for a clear ticket, because the answer carried no confidence", async () => {
    const withoutConfidence = scripted({
      team: { type: "choice", choice: "billing" },
      urgency: { type: "choice", choice: "urgent" },
    });
    const result = await run("routeWithoutConfidence", { confident: unused(), withoutConfidence });

    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ queue: "review" });
    // The reason is the missing number, not a low one.
    expect(verdicts(result.items)).toEqual([
      expect.objectContaining({ level: "root", ambiguous: "no-confidence", choice: "billing" }),
    ]);
  });
});

describe("activate", () => {
  const pick = (choice: string, confidence?: number) =>
    scripted({ skill: { type: "choice", choice, ...(confidence === undefined ? {} : { confidence }) } });

  async function activate(model: EvaluationModel, message: string) {
    const result = await run("activate", { confident: model, withoutConfidence: unused() }, { message });
    return { result, activeSkills: (result.output as { activeSkills?: Array<{ name: string; source: string }> })?.activeSkills };
  }

  it("loads the three bundled skills", () => {
    expect(initialSkills.map((s) => s.name).sort()).toEqual(["outage-status", "plan-change", "refund-request"]);
  });

  it("lets a slash command win before the evaluator is asked", async () => {
    const model = pick("refund-request", 0.99);
    const { activeSkills } = await activate(model, "/plan-change move me to yearly");
    expect(activeSkills).toEqual([{ name: "plan-change", source: "slash" }]);
    expect(model.asked).toEqual([]);
  });

  it("lets a keyword win before the evaluator is asked", async () => {
    const model = pick("plan-change", 0.99);
    const { activeSkills } = await activate(model, "I'd like a refund for last month");
    expect(activeSkills).toEqual([{ name: "refund-request", source: "keyword" }]);
    expect(model.asked).toEqual([]);
  });

  it("activates the evaluator's pick when nothing else matched, however low its confidence", async () => {
    for (const model of [pick("outage-status", 0.2), pick("outage-status")]) {
      const { activeSkills } = await activate(model, "nothing loads for anyone on my team since this morning");
      expect(activeSkills).toEqual([{ name: "outage-status", source: "classifier" }]);
      expect(model.asked).toEqual([["skill"]]);
    }
  });

  it("activates nothing when the evaluator answers no skill", async () => {
    const { result, activeSkills } = await activate(pick("NO_SKILL", 0.9), "thanks, that's all for today");
    expect(result.error).toBeUndefined();
    expect(activeSkills).toEqual([]);
  });

  it("fails the turn when the evaluator fails, without falling back to the generator classifier", async () => {
    const classifier = mockGenerator({ name: "skill-classifier", script: [] });
    const result = await testFlow({
      flow: createRoutingFlow({
        confident: mockEvaluationModel({ error: new Error("provider unavailable") }),
        withoutConfidence: unused(),
      }),
      action: "activate",
      userId: "test-user",
      input: { message: "nothing loads for anyone on my team" },
      generators: { "skill-classifier": classifier },
    });
    expect(result.status).toBe("failed");
    expect(String(result.error?.message)).toContain("provider unavailable");
    expect(classifier.calls).toHaveLength(0);
  });

  it("carries on when the app wraps the activator in .rescue", async () => {
    const turn = sequencer({ name: "turn", inputSchema: z.object({ message: z.string() }) })
      .step(skillActivator(mockEvaluationModel({ error: new Error("provider unavailable") })))
      .rescue([
        {
          block: handler({
            name: "no-skill-this-turn",
            inputSchema: z.any(),
            execute: () => ({ activeSkills: [] as string[], rescued: true }),
          }),
        },
      ]);
    const flow = defineFlow({
      kind: "rescued-activator",
      resources: { skills: defineSkillsCollection({ scope: "session" }) },
      actions: { run: { inputSchema: z.object({ message: z.string() }), block: turn } },
    })();
    const result = await testFlow({
      flow,
      action: "run",
      userId: "test-user",
      input: { message: "nothing loads for anyone on my team" },
    });
    expect(result.error).toBeUndefined();
    expect(result.output).toEqual({ activeSkills: [], rescued: true });
  });
});
