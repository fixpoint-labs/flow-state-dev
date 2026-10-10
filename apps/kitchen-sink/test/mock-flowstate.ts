/**
 * Test-mode model resolver for the kitchen-sink.
 *
 * Composed into `lib/flowstate.ts` only when `KITCHEN_SINK_TEST_MODE === "1"`
 * (Playwright E2E). Mocks every generator on the chat-agent run path, and the
 * `agent` seat kind's answers, so the suite never calls a real model. `policy: "allow"` returns an empty no-op
 * result for any straggler generator (memory capture, bias analyzers, etc.)
 * whose silence doesn't break the user-visible response.
 *
 * A scenario that names a hold (`holdBeforeAnswer`) is held before its model
 * runs, so a page can be seen showing a seat as working before it answers.
 *
 * This is an app-local test seam, not deployment glue — it lives under
 * `test/` and is gated by an explicit env flag.
 */
import { createMockModelResolver } from "@flow-state-dev/testing";
import type { ModelResolver } from "@flow-state-dev/core";
import {
  holdBeforeAnswer,
  assistantMock,
  skillClassifierMock,
  autoTitleMock,
  sideChainBriefMock,
  agentSeatMock,
  coordinatorRouteMock,
} from "@/lib/e2e-mock-script";

/** Build the mocked model resolver used in `KITCHEN_SINK_TEST_MODE`. */
export function createKitchenSinkTestModelResolver(): ModelResolver {
  const scripted = createMockModelResolver({
    generators: {
      "assistant-generator": assistantMock,
      "skill-classifier": skillClassifierMock,
      "auto-title": autoTitleMock,
      "background-brief": sideChainBriefMock,
      // An `agent` seat answers through one of these two, by its own setting.
      "agent-answer": agentSeatMock,
      "agent-answer-with-activate-tool": agentSeatMock,
    },
    // A best-fit coordinator's one evaluation, by its evaluator's block name.
    evaluators: { "coordinator-route": coordinatorRouteMock },
    policy: "allow",
  });
  const held = ((modelId, blockName, options) => {
    const model = scripted(modelId, blockName, options);
    if (blockName === undefined) return model;
    const hold = (messages: unknown) => {
      const ms = holdBeforeAnswer(blockName, messages);
      return ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : undefined;
    };
    return {
      ...model,
      generate: async (call) => {
        await hold(call.messages);
        return model.generate(call);
      },
      ...(model.stream === undefined
        ? {}
        : {
            stream: async function* (call) {
              await hold(call.messages);
              yield* model.stream!(call);
            },
          }),
    };
  }) as ModelResolver;
  held.resolveId = scripted.resolveId;
  // Evaluators resolve through the same resolver: a best-fit coordinator's pick.
  held.resolveEvaluationModel = scripted.resolveEvaluationModel;
  return held;
}
