/**
 * Test-mode model resolver for the kitchen-sink.
 *
 * Composed into `lib/flowstate.ts` only when `KITCHEN_SINK_TEST_MODE === "1"`
 * (Playwright E2E). Mocks every generator on the chat-agent run path so the
 * suite never calls a real model. `policy: "allow"` returns an empty no-op
 * result for any straggler generator (memory capture, bias analyzers, etc.)
 * whose silence doesn't break the user-visible response.
 *
 * This is an app-local test seam, not deployment glue — it lives under
 * `test/` and is gated by an explicit env flag.
 */
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import type { ModelResolver } from "@flow-state-dev/core";
import {
  assistantMock,
  thinkingStyleClassifierMock,
  skillClassifierMock,
  autoTitleMock,
} from "@/lib/e2e-mock-script";

// Deterministic drafter for the workstream-vet headless proof — every call
// returns a schema-valid draft, so the vet's loop mechanics run without a
// model provider.
const wsvetDrafterMock = mockGenerator({
  name: "wsvet-drafter-gen",
  script: [
    {
      when: () => true,
      then: { structuredOutput: { draft: "Mock draft: a short brief." } },
    },
  ],
});

/** Build the mocked model resolver used in `KITCHEN_SINK_TEST_MODE`. */
export function createKitchenSinkTestModelResolver(): ModelResolver {
  return createMockModelResolver({
    generators: {
      "assistant-generator": assistantMock,
      "thinking-style-classifier": thinkingStyleClassifierMock,
      "skill-classifier": skillClassifierMock,
      "auto-title": autoTitleMock,
      "wsvet-drafter-gen": wsvetDrafterMock,
    },
    policy: "allow",
  });
}
