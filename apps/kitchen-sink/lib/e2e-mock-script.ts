/**
 * Deterministic mock scripts for kitchen-sink E2E tests. Loaded only when
 * `KITCHEN_SINK_TEST_MODE=1`.
 *
 * The chat-agent flow runs several generators per turn beyond the primary
 * assistant. Each script below matches one of those slots:
 *
 *   - `assistantScript` → assistant-generator's text response.
 *   - `thinkingStyleClassifierScript` → returns a low-confidence "default"
 *     match so `applyClassifiedStyle` falls back to the default pipeline
 *     (which is the assistant-generator). Avoids running plan-and-execute,
 *     supervisor, or any other thinking-style worker pattern in tests.
 *   - `intentClassifierScript` → returns an empty `activeSkills` list so
 *     no skill is activated. Keeps the system prompt minimal.
 *   - `titleScript` → returns a short title so auto-title doesn't crash on
 *     an empty noop response.
 *
 * Predicates are matched per call. Tool-call scenarios place the tool-call
 * entries before the terminal text so the mock's tool loop fires the tools
 * first and returns the terminal text last.
 */
import type { MockGeneratorScriptEntry } from "@flow-state-dev/testing";

const inputContains = (needle: string) => (input: unknown) =>
  JSON.stringify(input).includes(needle);

const alwaysTrue = (_input: unknown) => true;

export const assistantScript: MockGeneratorScriptEntry[] = [
  {
    when: inputContains("[scenario:tool-1]"),
    then: {
      toolCalls: [
        { toolCallId: "tc_1", toolName: "search", args: { query: "alpha" } },
      ],
    },
  },
  {
    when: inputContains("[scenario:tool-1]"),
    then: {
      toolCalls: [
        { toolCallId: "tc_2", toolName: "search", args: { query: "beta" } },
      ],
    },
  },
  {
    when: inputContains("[scenario:tool-1]"),
    then: { text: "Found alpha and beta." },
  },
  {
    when: inputContains("[scenario:mode-build]"),
    then: { text: "Build mode acknowledged." },
  },
  {
    when: inputContains("[scenario:devtool]"),
    then: { text: "DevTool scenario response." },
  },
  {
    when: inputContains("[scenario:resume]"),
    then: { text: "I will remember." },
  },
  {
    when: inputContains("[scenario:smoke]"),
    then: { text: "Smoke test response." },
  },
];

/**
 * Low-confidence match → `applyClassifiedStyle` resolves to "default" and
 * the thinking-style router falls through to the assistant generator.
 */
export const thinkingStyleClassifierScript: MockGeneratorScriptEntry[] = [
  {
    when: alwaysTrue,
    then: { structuredOutput: { category: "default", confidence: 0 } },
  },
];

export const intentClassifierScript: MockGeneratorScriptEntry[] = [
  {
    when: alwaysTrue,
    then: {
      structuredOutput: { reasoning: "test mode", activeSkills: [] },
    },
  },
];

export const titleScript: MockGeneratorScriptEntry[] = [
  { when: alwaysTrue, then: { text: "E2E session" } },
];
