/**
 * Deterministic mock script for kitchen-sink E2E tests. Loaded only when
 * `KITCHEN_SINK_TEST_MODE=1`. Each scenario sends a message containing a
 * unique sentinel substring (e.g. `[scenario:smoke]`); the matching predicate
 * returns a scripted assistant turn so tests don't hit a real LLM.
 *
 * Predicate entries are repeatable, and `mockGenerator` walks them in order
 * on every call. Tool-call entries are placed before the terminal text entry
 * for the same sentinel so the in-flight tool loop fires the tools first and
 * the terminal text last.
 */
import type { MockGeneratorScriptEntry } from "@flow-state-dev/testing";

const inputContains = (needle: string) => (input: unknown) =>
  JSON.stringify(input).includes(needle);

export const e2eMockScript: MockGeneratorScriptEntry[] = [
  // Tool-call scenario — predicates are matched in order on each generate()
  // call. The first call returns the first tool batch (the mock executes the
  // tools and pulls the next step internally), the second call returns the
  // second batch, and finally the third call returns the terminal text.
  // Because predicates are walked top-down, we place batches before the text.
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

  // Mode-switching scenario — second message after mode is switched to Build.
  {
    when: inputContains("[scenario:mode-build]"),
    then: { text: "Build mode acknowledged." },
  },

  // DevTool reflection — same as smoke but uses a distinct sentinel so the
  // navigator entry can be matched in the panel.
  {
    when: inputContains("[scenario:devtool]"),
    then: { text: "DevTool scenario response." },
  },

  // Session resume scenario.
  {
    when: inputContains("[scenario:resume]"),
    then: { text: "I will remember." },
  },

  // Default smoke / streaming-indicator scenario. Matches anything
  // containing `[scenario:smoke]`.
  {
    when: inputContains("[scenario:smoke]"),
    then: { text: "Smoke test response." },
  },
];
