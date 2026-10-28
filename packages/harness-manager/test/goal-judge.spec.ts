/**
 * `goalJudge`, the ready-made judge: what the evaluation model's pick becomes.
 *
 * The manager acts on the verdict, so each pick must map to the verdict that
 * does the right thing: *done* closes the task, *not done* hands the next
 * attempt a reason it can act on, and *ask* holds the task on a question the
 * person can answer without opening the run, so it quotes the answer. A pick
 * that isn't an outcome is no verdict at all: the block fails, and the manager
 * settles on the phase's own check.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { createInMemoryStores, createResponseEmitter, runAction } from "@flow-state-dev/engine";
import { GOAL_JUDGE_QUESTION, GOAL_JUDGE_WHY_QUESTION, goalJudge, type HarnessJudgeInput } from "../src";

/** An evaluation model that answers one pick with a confidence, and records the questions it was asked. */
function scripted(pick: { choice: string; confidence?: number; why?: string }) {
  const asked: string[][] = [];
  const model = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test/judge",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doEvaluate(call: { questions: Record<string, unknown> }) {
      asked.push(Object.keys(call.questions));
      return {
        answers: {
          [GOAL_JUDGE_QUESTION]: { type: "choice", choice: pick.choice },
          [GOAL_JUDGE_WHY_QUESTION]: { type: "choice", choice: pick.why ?? "off-target" },
        },
        usage: { inputTokens: 1, outputTokens: 1 },
        warnings: [],
        ...(pick.confidence === undefined ? {} : { providerMetadata: { typesafe: { confidence: { [GOAL_JUDGE_QUESTION]: pick.confidence } } } }),
      };
    },
  };
  const resolver = Object.assign(() => {
    throw new Error("the judge asks no generator model");
  }, { resolveId: (id: string) => id, resolveEvaluationModel: () => model }) as unknown as ModelResolver;
  return { resolver, asked };
}

const RUN: HarnessJudgeInput = {
  goal: "Add a CHANGELOG line for the status page.",
  answer: "Added the line under Unreleased.",
  commits: { count: 1, subjects: ["docs: add the status page line"] },
};

async function judge(pick: { choice: string; confidence?: number; why?: string }, input: HarnessJudgeInput = RUN) {
  const { block, floor } = goalJudge({ name: "test-judge", model: "test/judge", floor: 0.6 });
  const flow = defineFlow({ kind: "goal-judge-test", actions: { judge: { inputSchema: block.inputSchema as never, block } } } as never)();
  const { resolver, asked } = scripted(pick);
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "judge",
    input,
    userId: "u_test",
    sessionId: "s_test",
    requestId: "req_test",
    stores: createInMemoryStores(),
    responseEmitter: createResponseEmitter({ requestId: "req_test", now: () => Date.now() }),
    runtimeConfig: { modelResolver: resolver },
  } as never);
  return { floor, asked, output: result.output as { verdict: string; confidence: number; reason: string } | undefined, error: result.error };
}

describe("goalJudge", () => {
  it("asks the verdict and the why, and keeps the floor it was given", async () => {
    const { floor, asked } = await judge({ choice: "done", confidence: 0.9 });
    expect(floor).toBe(0.6);
    expect(asked).toEqual([[GOAL_JUDGE_QUESTION, GOAL_JUDGE_WHY_QUESTION]]);
  });

  it("reads *done* as done, at the model's confidence", async () => {
    const { output } = await judge({ choice: "done", confidence: 0.92 });
    expect(output).toMatchObject({ verdict: "done", confidence: 0.92 });
  });

  it("hands a *not done* the why the model picked, so the next attempt knows what to fix", async () => {
    const { output } = await judge({ choice: "not-done", confidence: 0.8, why: "change-missing" });
    expect(output?.verdict).toBe("not-done");
    expect(output?.reason).toContain("the run's commits do not make it");
  });

  it("turns *ask* into a question that names the goal and quotes the answer", async () => {
    const { output } = await judge({ choice: "ask", confidence: 0.75 });
    expect(output?.verdict).toBe("ask");
    expect(output?.reason).toContain(RUN.goal);
    expect(output?.reason).toContain(RUN.answer!);
  });

  it("reads no reported confidence as 0, which no floor lets through as a not-done", async () => {
    const { output } = await judge({ choice: "not-done" });
    expect(output?.confidence).toBe(0);
  });

  it("gives no verdict for a pick that isn't an outcome", async () => {
    const { output, error } = await judge({ choice: "maybe", confidence: 0.9 });
    expect(output).toBeUndefined();
    expect(error).toBeDefined();
  });
});
