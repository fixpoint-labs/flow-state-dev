// FIX-1558 · POC · which evaluation adapters report confidence.
// Throwaway evidence for DECISIONS.md → Settled. Not production code; nothing imports it.
//
// Question: the epic (D2) says the popular providers' evaluation adapters return no
// confidence and no distribution, so a cascadingRouter on them always lands on
// `ambiguous`. Re-check that against the published adapters, on their real code path.
//
// Run:  npm install --no-package-lock && node check.mjs
// Control: POC_CONTROL=planted node check.mjs   (must FAIL: plants a `typesafe`
//          confidence in the OpenAI stub's metadata, proving the check can see one)

import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { Experimental_EvaluationLanguageModel } from "@ai-sdk/provider-utils/experimental-evaluation";
import { createTypeSafeAi } from "@ai-sdk/typesafe-ai";

const planted = process.env.POC_CONTROL === "planted";
const questions = {
  route: {
    type: "choice",
    instructions: "Which team should handle this?",
    criteria: { billing: "Payments and refunds", technical: "Bugs and outages" },
  },
};
const state = "My card was charged twice.";

/** What FIX-1554's seam will read: providerMetadata.typesafe.confidence[id]. */
const readConfidence = (result, id) => result.providerMetadata?.typesafe?.confidence?.[id];

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures += 1;
};

// 1. OpenAI and Anthropic hand back the same generic wrapper.
const oa = openai.evaluationModel("gpt-5.4-mini");
const an = anthropic.evaluationModel("claude-haiku-4-5");
check("openai.evaluationModel is the generic evaluation wrapper", oa instanceof Experimental_EvaluationLanguageModel);
check("anthropic.evaluationModel is the generic evaluation wrapper", an instanceof Experimental_EvaluationLanguageModel);

// 2. That wrapper, fed a model reply that carries the provider's own metadata
//    (logprobs included), returns a bare choice: no probabilities, no confidence.
oa.model = {
  specificationVersion: "v4",
  provider: "openai.responses",
  modelId: "gpt-5.4-mini",
  supportedUrls: {},
  async doGenerate() {
    return {
      content: [{ type: "text", text: JSON.stringify({ q0: "c1" }) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: { inputTokens: { total: 10 }, outputTokens: { total: 2 } },
      warnings: [],
      providerMetadata: {
        openai: { responseId: "resp_1", logprobs: [[{ token: "c1", logprob: -0.01 }]] },
        ...(planted ? { typesafe: { confidence: { route: 0.5 } } } : {}),
      },
      response: { id: "resp_1", modelId: "gpt-5.4-mini", timestamp: new Date(0) },
    };
  },
};
const oaResult = await oa.doEvaluate({ state, questions });
check("adapter answers the choice", oaResult.answers.route?.choice === "technical");
check("adapter answer has no probabilities", !("probabilities" in oaResult.answers.route));
check("adapter answer has no confidence key", !("confidence" in oaResult.answers.route));
check("adapter metadata carries no typesafe confidence", readConfidence(oaResult, "route") === undefined);

// 3. Jev's own library, on a stub fetch, reports confidence and a distribution;
//    and omits confidence for an answer the API returned it null for.
const jevReply = {
  model: "jev-latest",
  answers: {
    route: { type: "choice", choice: "billing", probabilities: { billing: 0.9, technical: 0.1 }, confidence: 0.93 },
    again: { type: "choice", choice: "billing", probabilities: { billing: 0.6, technical: 0.4 }, confidence: null },
  },
  usage: { input_tokens: 10, output_tokens: 2 },
};
const jev = createTypeSafeAi({
  apiKey: "test-key",
  fetch: async () => new Response(JSON.stringify(jevReply), { status: 200, headers: { "content-type": "application/json" } }),
}).evaluationModel("jev-latest");
const jevResult = await jev.doEvaluate({ state, questions: { route: questions.route, again: questions.route } });
check("Jev reports confidence (the detector can see one)", readConfidence(jevResult, "route") === 0.93);
check("Jev reports a distribution", jevResult.answers.route.probabilities?.billing === 0.9);
check("Jev omits confidence when its API returns null", readConfidence(jevResult, "again") === undefined);

console.log(failures === 0 ? "\nall legs pass" : `\n${failures} leg(s) failed`);
process.exit(failures === 0 ? 0 : 1);
