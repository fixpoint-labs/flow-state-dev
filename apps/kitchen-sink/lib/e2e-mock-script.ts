/**
 * Deterministic mock generators for kitchen-sink E2E tests. Loaded only
 * when `KITCHEN_SINK_TEST_MODE=1`.
 *
 * The chat-agent flow runs three generators per turn (skill-classifier,
 * assistant-generator, auto-title). Each gets its own mock instance below.
 * An `agent` seat answers through `agent-answer` (or
 * `agent-answer-with-activate-tool`, when the seat turns that tool on); both
 * share `agentSeatMock`, keyed on its own scenario markers: each answers a post
 * a coordinator delivered, or a person's own turn, and one names the tokens the
 * seat could see from before the turn. Under the goal checks' `no-history` control the scripted model is
 * handed only the system messages and the latest turn.
 * A scenario can hold its answer for a while first (`holdMs`), which
 * `test/mock-flowstate.ts` applies before the model runs.
 * `policy: "allow"` (set in `test/mock-flowstate.ts`) catches anything else
 * with a no-op model.
 *
 * A coordinator's best-fit evaluation, block name `coordinator-route`, is
 * scripted by `coordinatorRouteMock`: `[route:<worker>]` in a post picks that
 * delegate, and a post that names none fails the call, so the coordinator's
 * fallback takes it.
 *
 * `assistantMock` uses a hand-rolled scenario dispatcher because the
 * built-in `mockGenerator` only supports either plain sequential steps
 * (consumed once) or predicates (matched repeatedly with a fixed `then`).
 * Tool-call scenarios need a sequence of distinct steps per turn that's
 * also keyed by the user-message sentinel — neither shape covers that.
 */
import type {
  MockGeneratorInstance,
  MockToolResult,
  MockGeneratorScriptStep,
  MockGeneratorScriptEntry,
} from "@flow-state-dev/testing";
import { mockEvaluationModel, mockGenerator } from "@flow-state-dev/testing";

import { goalControl } from "./goal-control";

type ScenarioScript = {
  /** Whether the latest user turn picks this scenario. */
  match: (turn: string) => boolean;
  /** How long the seat holds before answering, so a page can see it working. */
  holdMs?: number;
  /**
   * The steps, or a function of the turn, what this call's tools returned so
   * far, and the whole message list the model is handed.
   */
  steps:
    | MockGeneratorScriptStep[]
    | ((turn: string, toolResults: MockToolResult[], messages: Message[]) => MockGeneratorScriptStep[]);
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
  {
    // A post a coordinator delivered to the seat (FIX-1590). The seat hears it
    // as `<from>, through <coordinator>: <body>`, so the marker is still in the
    // turn. Its answer lands in the person's conversation under its name.
    match: (turn) => turn.includes("[scenario:wake]"),
    steps: [{ text: "[reply:wake] Heard it." }],
  },
  {
    // A post the seat answers naming the post's `reply-token-…` (FIX-1594): the
    // answer that lands in the person's conversation carries the token and
    // `[reply:in-mailbox]`, never the scenario marker, so a seat handed the
    // answer does not answer it again.
    match: (turn) => turn.includes("[scenario:reply-in-mailbox]"),
    steps: replyWithToken,
  },
  {
    // The same answer, held about three seconds first, so a page can be seen
    // showing the seat as working on the post before its line lands.
    match: (turn) => turn.includes("[scenario:reply-after-a-hold]"),
    holdMs: 3_000,
    steps: replyWithToken,
  },
  {
    // The wake's answer, held about three seconds first, so the hold outlasts
    // the person's own post request: a page is seen showing the seat as working
    // before its line lands, and a page that does not follow the conversation
    // live never sees the line without a reload.
    match: (turn) => turn.includes("[scenario:wake-after-a-hold]"),
    holdMs: 3_000,
    steps: [{ text: "[reply:wake] Heard it." }],
  },
  {
    // What the seat can see from before this turn (FIX-1611 BR-19): every
    // token in the system messages and in the earlier turns of this
    // conversation, and none from the turn itself. The reply names nothing it could not see, so a check reads what
    // reached the model off the reply.
    match: (turn) => turn.includes("[scenario:recall]"),
    steps: (_turn, _toolResults, messages) => {
      const seen = tokensBeforeLatestTurn(messages);
      return [{ text: `[reply:recall] ${seen.length > 0 ? seen.join(" ") : "Nothing came before this."}` }];
    },
  },
];

/**
 * A seat's answer naming the post's `reply-token-…`, so a check can tell which
 * post a landed line answers. It carries `[reply:in-mailbox]`, never a scenario
 * marker, so a seat handed the answer does not answer it again.
 */
function replyWithToken(turn: string): MockGeneratorScriptStep[] {
  const token = /reply-token-[a-z0-9]+/.exec(turn)?.[0] ?? "no-token";
  return [{ text: `[reply:in-mailbox] ${token} Refunds post on Fridays.` }];
}

/** A token a check mints into a post, and the only thing recall names. */
const TOKEN = /[a-z]+-token-[a-z0-9]+/;

type Message = { role?: unknown; content?: unknown };

/** The messages of a model call, or none when the input is not a message list. */
function messagesOf(input: unknown): Message[] {
  return Array.isArray(input) ? (input as Message[]).filter((m) => m !== null && typeof m === "object") : [];
}

/** The index of the latest user turn, or -1. */
function latestUserIndex(messages: Message[]): number {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]!.role === "user") return i;
  }
  return -1;
}

/** Every token in the messages before the latest user turn, once each, in order. */
function tokensBeforeLatestTurn(messages: Message[]): string[] {
  const before = messages.slice(0, Math.max(latestUserIndex(messages), 0));
  const found = before.flatMap((m) => JSON.stringify(m.content ?? "").match(new RegExp(TOKEN.source, "g")) ?? []);
  return [...new Set(found)];
}

/**
 * The messages the seat's model is handed, as the scripted model reads them.
 *
 * Under the goal checks' `no-history` control (test mode only, `goalControl`),
 * only the system messages and the latest user turn: the conversation's
 * earlier turns never reach the model, as if the kind kept no history. A check
 * that a seat recalls an earlier turn must FAIL under it. The kind has no
 * switch for this, and must not: a public option only a control would use.
 */
function asHeard(messages: Message[]): Message[] {
  if (goalControl() !== "no-history") return messages;
  const latest = latestUserIndex(messages);
  return messages.filter((m, i) => m.role === "system" || i === latest);
}

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

  const next: MockGeneratorInstance["next"] = (input, context) => {
    const turn = latestUserTurn(input);
    const scenario = scripts.find((s) => s.match(turn));
    if (!scenario) {
      return { text: "Test mode (no scenario sentinel matched)." };
    }
    const keyed = typeof input === "object" && input !== null;
    const i = (keyed ? byRequest.get(input) : byTurn.get(turn)) ?? 0;
    if (keyed) byRequest.set(input, i + 1);
    else byTurn.set(turn, i + 1);
    const steps =
      typeof scenario.steps === "function"
        ? scenario.steps(turn, context?.toolResults ?? [], asHeard(messagesOf(input)))
        : scenario.steps;
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

/** The scripts whose scenarios may hold, by the generator they answer for. */
const SCRIPTS_BY_GENERATOR: Record<string, ScenarioScript[]> = {
  "agent-answer": AGENT_SEAT_SCRIPTS,
  "agent-answer-with-activate-tool": AGENT_SEAT_SCRIPTS,
};

/**
 * How long `generator` holds before answering this call: the `holdMs` of the
 * scenario the latest user turn picks, or 0.
 *
 * @param generator The generator block's name, as the model resolver gets it.
 * @param input The call's messages.
 */
export function holdBeforeAnswer(generator: string, input: unknown): number {
  const scripts = SCRIPTS_BY_GENERATOR[generator];
  if (scripts === undefined) return 0;
  const turn = latestUserTurn(input);
  return scripts.find((s) => s.match(turn))?.holdMs ?? 0;
}

/**
 * A coordinator's best-fit evaluation. Reads the post from the state best fit
 * hands it (`{ post: { from, text } }`): `[route:<worker>]` picks that
 * delegate, where `<worker>` is an id the coordinator's `delegates:` lists. A
 * post that names none fails the call, which sends it to the coordinator's
 * fallback.
 */
export const coordinatorRouteMock = mockEvaluationModel({
  answers: ({ state }) => {
    const text = (state as { post?: { text?: unknown } }).post?.text;
    const member = typeof text === "string" ? /\[route:([^\]\s]+)\]/.exec(text)?.[1] : undefined;
    if (member === undefined) {
      throw new Error("coordinator-route (test mode): the post names no [route:<worker>], so the call fails");
    }
    return { member: { type: "choice", choice: member } };
  },
});

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
