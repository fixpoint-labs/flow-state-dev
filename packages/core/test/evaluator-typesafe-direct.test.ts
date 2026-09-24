/**
 * Direct Jev: an author-built evaluation model from Jev's own library
 * (`@ai-sdk/typesafe-ai`, an optional peer of core), driven through the
 * evaluator block against a stub `fetch`. Proves the author's key is the one
 * sent and that the confidence Jev reports lands on the answers it covers,
 * and only those.
 */
import { describe, expect, it } from "vitest";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";
import { boolean, choice, evaluator, score } from "../src/blocks/evaluator";
import { createMockContext, runForTest } from "./helpers";

type Captured = { url: string; authorization: string | null; body: Record<string, unknown> };

function stubFetch(responseBody: unknown) {
  const requests: Captured[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    requests.push({
      url: String(input),
      authorization: headers.get("authorization"),
      body: JSON.parse(String(init?.body)),
    });
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

const questions = {
  team: choice("Which team should handle this?", {
    billing: "Payments and refunds",
    technical: "Bugs and outages",
  }),
  frustration: score("How frustrated is the customer?", ["Calm", "Annoyed", "Angry"]),
  urgent: boolean("Does this need someone now?"),
};

describe("evaluator — direct Jev through its own library (BR-9, BR-16 to BR-19)", () => {
  it("sends the author's key and lifts Jev's reported confidence onto choice and score only", async () => {
    const { fetch, requests } = stubFetch({
      model: "jev-2026-09",
      answers: {
        team: { type: "choice", choice: "billing", probabilities: { billing: 0.91, technical: 0.09 }, confidence: 0.94 },
        frustration: { type: "score", score: 1.1, probabilities: { "0": 0.1, "1": 0.7, "2": 0.2 }, confidence: 0.62 },
        urgent: { type: "noul", noul: 0.35 },
      },
      usage: { input_tokens: 120, output_tokens: 4 },
    });
    const jev = createTypeSafeAi({ apiKey: "ts-author-key", fetch }).evaluationModel("jev-latest");

    const output = await runForTest(
      evaluator({ name: "triage", model: jev, questions }),
      "I was charged twice and nobody answers",
      createMockContext()
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]!.authorization).toBe("Bearer ts-author-key");
    expect(requests[0]!.body.model).toBe("jev-latest");

    expect(output.answers.team).toEqual({
      type: "choice",
      choice: "billing",
      probabilities: { billing: 0.91, technical: 0.09 },
      confidence: 0.94,
    });
    expect(output.answers.frustration.confidence).toBe(0.62);
    expect(output.answers.frustration.probabilities).toEqual({ "0": 0.1, "1": 0.7, "2": 0.2 });
    expect(output.answers.urgent).toEqual({ type: "boolean", probability: 0.35 });
    expect("confidence" in output.answers.urgent).toBe(false);
  });

  it("omits the confidence key when Jev reports none", async () => {
    const { fetch } = stubFetch({
      answers: {
        team: { type: "choice", choice: "technical", probabilities: { billing: 0.3, technical: 0.7 }, confidence: null },
        frustration: { type: "score", score: 0, probabilities: { "0": 1, "1": 0, "2": 0 } },
        urgent: { type: "noul", noul: 0.9 },
      },
    });
    const jev = createTypeSafeAi({ apiKey: "ts-author-key", fetch }).evaluationModel("jev-latest");

    const output = await runForTest(
      evaluator({ name: "triage", model: jev, questions }),
      "The dashboard is down",
      createMockContext()
    );

    expect("confidence" in output.answers.team).toBe(false);
    expect("confidence" in output.answers.frustration).toBe(false);
    expect("confidence" in output.answers.urgent).toBe(false);
  });
});
