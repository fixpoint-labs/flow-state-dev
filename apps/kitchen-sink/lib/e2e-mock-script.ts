/**
 * Deterministic mock generators for kitchen-sink E2E tests. Loaded only
 * when `KITCHEN_SINK_TEST_MODE=1`.
 *
 * The chat-agent flow runs four generators per turn (intent-classifier,
 * thinking-style-classifier, assistant-generator, auto-title). Each gets
 * its own mock instance below. `policy: "allow"` (set in `lib/server.ts`)
 * catches anything else with a no-op model.
 *
 * `assistantMock` uses a hand-rolled scenario dispatcher because the
 * built-in `mockGenerator` only supports either plain sequential steps
 * (consumed once) or predicates (matched repeatedly with a fixed `then`).
 * Tool-call scenarios need a sequence of distinct steps per turn that's
 * also keyed by the user-message sentinel — neither shape covers that.
 */
import type {
  MockGeneratorInstance,
  MockGeneratorScriptStep,
  MockGeneratorScriptEntry,
} from "@flow-state-dev/testing";
import { mockGenerator } from "@flow-state-dev/testing";

type ScenarioScript = {
  match: (json: string) => boolean;
  steps: MockGeneratorScriptStep[];
};

const SCENARIO_SCRIPTS: ScenarioScript[] = [
  {
    match: (json) => json.includes("[scenario:tool-1]"),
    steps: [
      {
        toolCalls: [
          { toolCallId: "tc_1", toolName: "search", args: { query: "alpha" } },
        ],
      },
      {
        toolCalls: [
          { toolCallId: "tc_2", toolName: "search", args: { query: "beta" } },
        ],
      },
      { text: "Found alpha and beta." },
    ],
  },
  {
    match: (json) => json.includes("[scenario:mode-build]"),
    steps: [{ text: "Build mode acknowledged." }],
  },
  {
    match: (json) => json.includes("[scenario:devtool]"),
    steps: [{ text: "DevTool scenario response." }],
  },
  {
    match: (json) => json.includes("[scenario:resume]"),
    steps: [{ text: "I will remember." }],
  },
  {
    match: (json) => json.includes("[scenario:smoke]"),
    steps: [{ text: "Smoke test response." }],
  },
];

/**
 * `MockGeneratorInstance`-shaped dispatcher: routes by the message
 * sentinel and walks the matched scenario's plain-step list per call.
 * The framework calls `next()` once per generator step, including each
 * iteration of the internal tool loop, so a single turn that wants two
 * tool calls + a terminal text needs three sequential entries.
 */
function buildAssistantMock(): MockGeneratorInstance {
  const cursors = new Map<ScenarioScript, number>();
  const calls: MockGeneratorInstance["calls"] = [];

  const next = (input?: unknown): MockGeneratorScriptStep | undefined => {
    const json = JSON.stringify(input ?? "");
    const scenario = SCENARIO_SCRIPTS.find((s) => s.match(json));
    if (!scenario) {
      return { text: "Test mode (no scenario sentinel matched)." };
    }
    const i = cursors.get(scenario) ?? 0;
    const step = scenario.steps[Math.min(i, scenario.steps.length - 1)];
    cursors.set(scenario, i + 1);
    return step;
  };

  return {
    name: "assistant-generator",
    calls,
    next,
    reset: () => cursors.clear(),
  };
}

export const assistantMock = buildAssistantMock();

const alwaysTrue = (_input: unknown) => true;

/** Low-confidence "default" → router falls through to assistant-generator. */
const thinkingStyleClassifierScript: MockGeneratorScriptEntry[] = [
  {
    when: alwaysTrue,
    then: { structuredOutput: { category: "default", confidence: 0 } },
  },
];

/** Empty active-skills → no skill activation in test mode. */
const intentClassifierScript: MockGeneratorScriptEntry[] = [
  {
    when: alwaysTrue,
    then: {
      structuredOutput: { reasoning: "test mode", activeSkills: [] },
    },
  },
];

const titleScript: MockGeneratorScriptEntry[] = [
  { when: alwaysTrue, then: { text: "E2E session" } },
];

export const thinkingStyleClassifierMock = mockGenerator({
  name: "thinking-style-classifier",
  script: thinkingStyleClassifierScript,
});

export const intentClassifierMock = mockGenerator({
  name: "intent-classifier",
  script: intentClassifierScript,
});

export const autoTitleMock = mockGenerator({
  name: "auto-title",
  script: titleScript,
});
