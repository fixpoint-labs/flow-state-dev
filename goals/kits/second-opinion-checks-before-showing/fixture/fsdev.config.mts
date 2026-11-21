/** Running app fixture for the second-opinion kit goal. */
import { appendFileSync, writeFileSync } from "node:fs";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { secondOpinion } from "@flow-state-dev/patterns/second-opinion";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";

const calls = process.env.CALL_LOG!;
writeFileSync(calls, "");
const base = createMockModelResolver({
  policy: "error",
  generators: {
    "second-opinion-debater-drafter": mockGenerator({ name: "second-opinion-debater-drafter", script: [{ text: "DRAFT_MARKER unverified answer" }] }),
    "second-opinion-debater-critic": mockGenerator({ name: "second-opinion-debater-critic", script: [{ text: "CRITIQUE_MARKER correct the answer" }] }),
    "second-opinion-judge": mockGenerator({ name: "second-opinion-judge", script: [{ text: JSON.stringify({ verdict: "Use the corrected answer", winner: null, reasoning: "The critique found the issue." }) }] }),
    "second-opinion-analyzer": mockGenerator({ name: "second-opinion-analyzer", script: [{ text: JSON.stringify({ analyzerId: "review", category: "correctness", score: 0, shouldSurface: false, annotations: [] }) }] }),
    "second-opinion-synthesizer": mockGenerator({ name: "second-opinion-synthesizer", script: [{ text: "FINAL_MARKER corrected answer" }] }),
  },
});
const modelResolver = Object.assign((id: string, block?: string) => {
  appendFileSync(calls, `${id}|${block ?? ""}\n`);
  return base(id, block);
}, base);

export default createFlowState({
  kits: [secondOpinion({ draftModel: "scripted/draft", reviewModel: "scripted/review" })],
  stores: { default: { primary: inMemoryStores() } },
  modelResolver,
} as never);
