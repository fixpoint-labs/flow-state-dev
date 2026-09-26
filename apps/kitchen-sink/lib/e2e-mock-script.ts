/**
 * Deterministic mock generators for kitchen-sink E2E tests. Loaded only
 * when `KITCHEN_SINK_TEST_MODE=1`.
 *
 * The chat-agent flow runs three generators per turn (skill-classifier,
 * assistant-generator, auto-title). Each gets its own mock instance below.
 * An `agent` seat answers through `agent-answer` (or
 * `agent-answer-with-activate-tool`, when the seat turns that tool on); both
 * share `agentSeatMock`, keyed on its own scenario markers. The `desk-clerk`
 * kind answers through `desk-clerk-answer`, scripted by `deskClerkMock`: one
 * scenario answers, the other files the note through the kind's
 * `desk-clerk-file` tool and then says so.
 * `policy: "allow"` (set in `test/mock-flowstate.ts`) catches anything else
 * with a no-op model.
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
  /** Whether the latest user turn picks this scenario. */
  match: (turn: string) => boolean;
  steps: MockGeneratorScriptStep[] | ((turn: string) => MockGeneratorScriptStep[]);
};

const SCENARIO_SCRIPTS: ScenarioScript[] = [
  {
    match: (turn) => turn.includes("[scenario:tool-1]"),
    steps: [
      // Terminal step (text is set) carrying tool calls — the mock skips
      // its internal tool-execute loop in this branch, which is what we
      // want: the registered `search` tool would otherwise try to hit a
      // real backend without credentials. The framework still emits both
      // the tool-call items and the assistant text from this single
      // generator return.
      {
        text: "Found alpha and beta.",
        toolCalls: [
          { toolCallId: "tc_1", toolName: "search", args: { query: "alpha" } },
          { toolCallId: "tc_2", toolName: "search", args: { query: "beta" } },
        ],
      },
    ],
  },
  {
    match: (turn) => turn.includes("[scenario:mode-build]"),
    steps: [{ text: "Build mode acknowledged." }],
  },
  {
    match: (turn) => turn.includes("[scenario:devtool]"),
    steps: [{ text: "DevTool scenario response." }],
  },
  {
    match: (turn) => turn.includes("[scenario:resume]"),
    steps: [{ text: "I will remember." }],
  },
  {
    match: (turn) => turn.includes("[scenario:smoke]"),
    steps: [{ text: "Smoke test response." }],
  },
];

/**
 * An `agent` seat's scenarios. The reply carries a marker of its own, so a
 * check can tell a scripted answer ran without reading what it says.
 */
const AGENT_SEAT_SCRIPTS: ScenarioScript[] = [
  {
    // A person talking to a seat from the page (FIX-1585).
    match: (turn) => turn.includes("[scenario:talk-to-seat]"),
    steps: [{ text: "[reply:talk-to-seat] Noted, I have your message." }],
  },
];

/**
 * The desk clerk's scenarios. `[scenario:clerk-answer]` answers in words the
 * note does not contain. `[scenario:clerk-file]` files the note through the
 * kind's `desk-clerk-file` tool, onto `escalations` unless the note names
 * another board as `[board:<name>]`, with the note's `clerk-token-…` in the
 * row's goal, then says where it went.
 */
const DESK_CLERK_SCRIPTS: ScenarioScript[] = [
  {
    match: (turn) => turn.includes("[scenario:clerk-answer]"),
    steps: [{ text: "[clerk:answered] The desk has your note and will answer it here." }],
  },
  {
    match: (turn) => turn.includes("[scenario:clerk-file]"),
    steps: (turn) => {
      const board = /\[board:([a-z-]+)\]/.exec(turn)?.[1] ?? "escalations";
      const token = /clerk-token-[a-z0-9]+/.exec(turn)?.[0] ?? "no-token";
      // `[forge-author]` makes the model try to sign as another seat, which
      // the tool must ignore: the author is the seat's own id.
      const forged = turn.includes("[forge-author]") ? { author: "support.grace" } : {};
      return [
        {
          toolCalls: [
            {
              toolCallId: `tc_${token}`,
              toolName: "desk-clerk-file",
              args: { board, goal: `Filed from the desk: ${token}`, ...forged },
            },
          ],
        },
        { text: `[clerk:filed] Filed onto ${board}.` },
      ];
    },
  },
];

/**
 * The latest user turn of a model call, as the text a scenario matches on.
 *
 * Only the latest one: a conversation carries its earlier turns, and matching
 * the whole history would answer a new message with an older message's
 * scenario. Input that is not a message list is matched whole.
 */
function latestUserTurn(input: unknown): string {
  if (!Array.isArray(input)) return JSON.stringify(input ?? "");
  for (let i = input.length - 1; i >= 0; i -= 1) {
    const message = input[i] as { role?: unknown; content?: unknown } | null;
    if (message !== null && typeof message === "object" && message.role === "user") {
      return JSON.stringify(message.content ?? "");
    }
  }
  return "";
}

/**
 * `MockGeneratorInstance`-shaped dispatcher: routes by the scenario marker in
 * the latest user turn and walks the matched scenario's steps, one per call.
 * The framework calls `next()` once per generator step, including each
 * iteration of the internal tool loop, so a single turn that wants two
 * tool calls + a terminal text needs three sequential entries.
 *
 * **Each request keeps its own cursor.** Within one request the mock's tool
 * loop hands every call the same messages array, so the cursor is keyed on
 * that array: a second request, even with the same text, starts at step 0.
 * Input that is not an object is keyed on its latest user turn instead.
 */
function buildScenarioMock(name: string, scripts: ScenarioScript[]): MockGeneratorInstance {
  let byRequest = new WeakMap<object, number>();
  const byTurn = new Map<string, number>();
  const calls: MockGeneratorInstance["calls"] = [];

  const next = (input?: unknown): MockGeneratorScriptStep | undefined => {
    const turn = latestUserTurn(input);
    const scenario = scripts.find((s) => s.match(turn));
    if (!scenario) {
      return { text: "Test mode (no scenario sentinel matched)." };
    }
    const keyed = typeof input === "object" && input !== null;
    const i = (keyed ? byRequest.get(input) : byTurn.get(turn)) ?? 0;
    if (keyed) byRequest.set(input, i + 1);
    else byTurn.set(turn, i + 1);
    const steps = typeof scenario.steps === "function" ? scenario.steps(turn) : scenario.steps;
    return steps[Math.min(i, steps.length - 1)];
  };

  return {
    name,
    calls,
    next,
    reset: () => {
      byRequest = new WeakMap();
      byTurn.clear();
    },
  };
}

export const assistantMock = buildScenarioMock("assistant-generator", SCENARIO_SCRIPTS);

/** Both of the `agent` kind's answering generators. */
export const agentSeatMock = buildScenarioMock("agent-answer", AGENT_SEAT_SCRIPTS);

/** The desk clerk's answering generator. */
export const deskClerkMock = buildScenarioMock("desk-clerk-answer", DESK_CLERK_SCRIPTS);

const alwaysTrue = (_input: unknown) => true;

/** Empty active-skills → no skill activation in test mode. */
const skillClassifierScript: MockGeneratorScriptEntry[] = [
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

/**
 * The detached worker's brief. It runs in a child session, not in the turn that
 * filed it, so this text is the only thing that distinguishes "the background
 * work ran" from "the row was created and nothing happened".
 */
const sideChainBriefScript: MockGeneratorScriptEntry[] = [
  { when: alwaysTrue, then: { text: "Background brief complete." } },
];

export const skillClassifierMock = mockGenerator({
  name: "skill-classifier",
  script: skillClassifierScript,
});

export const autoTitleMock = mockGenerator({
  name: "auto-title",
  script: titleScript,
});

export const sideChainBriefMock = mockGenerator({
  name: "background-brief",
  script: sideChainBriefScript,
});
