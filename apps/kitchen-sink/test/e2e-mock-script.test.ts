/**
 * The scripted model's scenario dispatcher, which every keyless check in this
 * app runs on.
 *
 * Two promises, and why each matters:
 *
 *   - A scenario is picked by a marker in the LATEST user turn only. A seat's
 *     conversation carries its earlier turns, so matching the whole history
 *     would answer a new message with an old message's scenario.
 *   - Each request walks its own copy of a scenario's steps. A multi-step
 *     scenario (a tool call, then the reply) run twice in one process must
 *     start at its first step both times; one shared cursor made the second
 *     run start mid-script and skip the tool call.
 *
 * Red state, before the green was trusted: the dispatcher before FIX-1589
 * (whole-history match, one cursor per scenario) failed both cases.
 *
 * And the two scenarios FIX-1611 adds (`specs/issues/FIX-1611/BUSINESS-RULES.md`,
 * V3): BR-19 `[scenario:recall]` names every token found before the latest
 * turn, and no other, and under `GOAL_CONTROL=no-history` only those in the
 * system message (BR-23); BR-20 `[scenario:needs-a-person]` calls `escalate`
 * once with the post's token, then says it filed, or that it did not; BR-21
 * `[route:<member>]` routes, below.
 *
 * A held scenario (`[scenario:reply-after-a-hold]`) gives a page time to show
 * a seat as working before its line lands. Its line must wait out the hold,
 * and nothing else may hold: every other check's timing depends on that.
 * `[scenario:wake-after-a-hold]` holds the same way before a text answer, which
 * lands by the kind's own landing rather than the post tool. Without the hold
 * that answer lands before a page can show the seat working, and before the
 * person's own post request ends and the page reads the mailbox again anyway.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentSeatMock, mailboxRouteMock, holdBeforeAnswer } from "@/lib/e2e-mock-script";
import { createKitchenSinkTestModelResolver } from "./mock-flowstate";

const system = (content: string) => ({ role: "system", content });
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the scripted model's scenario dispatcher", () => {
  it("starts a multi-step scenario at its first step on every request", () => {
    agentSeatMock.reset();
    const turn = "[scenario:needs-a-person] case-token-aaa the charger caught fire";

    const first = [user(turn)];
    expect(agentSeatMock.next(first)?.toolCalls?.[0]?.toolName).toBe("escalate");
    expect(agentSeatMock.next(first)?.text).toContain("[reply:escalated]");

    // A second request with the very same turn: a fresh messages array, so a
    // fresh walk of the script.
    const second = [user(turn)];
    expect(agentSeatMock.next(second)?.toolCalls?.[0]?.toolName).toBe("escalate");
    expect(agentSeatMock.next(second)?.text).toContain("[reply:escalated]");
  });

  it("matches the latest user turn only, not an earlier turn in the conversation", () => {
    agentSeatMock.reset();
    const history = [
      user("[scenario:needs-a-person] case-token-bbb please escalate"),
      assistant("[reply:escalated] Filed onto escalations."),
      user("[scenario:talk-to-seat] where is my refund?"),
    ];
    const step = agentSeatMock.next(history);
    expect(step?.toolCalls).toBeUndefined();
    expect(step?.text).toContain("[reply:talk-to-seat]");

    // And a latest turn with no marker is unmatched, however marked the history.
    const unmarked = [...history, assistant("..."), user("just saying hello")];
    expect(agentSeatMock.next(unmarked)?.text).not.toMatch(/\[reply:/);
  });
});

describe("the needs-a-person scenario (BR-20)", () => {
  it("calls escalate once with the post's token as the case, then says it filed", () => {
    agentSeatMock.reset();
    const messages = [user("devuser in support.help: [route:support.devices] [scenario:needs-a-person] case-token-ccc it smokes")];
    const call = agentSeatMock.next(messages);
    expect(call?.toolCalls).toHaveLength(1);
    expect(call?.toolCalls?.[0]).toMatchObject({ toolName: "escalate", args: { case: expect.stringContaining("case-token-ccc") } });
    // The case alone: the script names no author, board or mailbox.
    expect(Object.keys(call?.toolCalls?.[0]?.args ?? {})).toEqual(["case"]);
    expect(agentSeatMock.next(messages)?.text).toMatch(/^\[reply:escalated\] /);
  });

  it("says nothing was filed when the tool reports it filed nothing", () => {
    agentSeatMock.reset();
    const messages = [user("[scenario:needs-a-person] case-token-ddd it smokes")];
    agentSeatMock.next(messages);
    const reply = agentSeatMock.next(messages, {
      toolResults: [{ toolCallId: "tc", toolName: "escalate", result: { filed: false, reason: "unavailable" } }],
    } as never);
    expect(reply?.text).toMatch(/^\[reply:unfiled\] /);
    expect(reply?.text).not.toContain("[reply:escalated]");
  });

  it("with [forge-author], also names an author, a board and a mailbox of its own", () => {
    agentSeatMock.reset();
    const call = agentSeatMock.next([user("[scenario:needs-a-person] [forge-author] case-token-eee refund me")]);
    expect(call?.toolCalls?.[0]?.args).toEqual({
      case: expect.stringContaining("case-token-eee"),
      author: "support.fsd",
      board: "followups",
      mailbox: "support.elsewhere",
    });
  });
});

describe("the recall scenario (BR-19)", () => {
  const conversation = [
    system("You answer questions.\n\nRecent lines in the mailbox, oldest first:\n- support.devices: [reply:in-mailbox] reply-token-aaa Refunds post on Fridays."),
    user("devuser in support.help: a question naming case-token-bbb"),
    assistant("[reply:wake] Heard it in the mailbox."),
    user("devuser in support.help: [scenario:recall] what have we said? recall-token-ccc"),
  ];

  it("names every token found before the latest turn, in the system message or an earlier turn, and no other", () => {
    agentSeatMock.reset();
    const text = agentSeatMock.next(conversation)?.text ?? "";
    expect(text).toMatch(/^\[reply:recall\]/);
    expect(text).toContain("reply-token-aaa");
    expect(text).toContain("case-token-bbb");
    // The latest turn's own token is not something it recalls.
    expect(text).not.toContain("recall-token-ccc");
  });

  it("under no-history, recalls only what the system message holds (BR-23)", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "1");
    vi.stubEnv("GOAL_CONTROL", "no-history");
    agentSeatMock.reset();
    const text = agentSeatMock.next(conversation)?.text ?? "";
    expect(text).toContain("reply-token-aaa");
    expect(text).not.toContain("case-token-bbb");
  });

  it("ignores no-history outside test mode", () => {
    vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
    vi.stubEnv("GOAL_CONTROL", "no-history");
    agentSeatMock.reset();
    expect(agentSeatMock.next(conversation)?.text).toContain("case-token-bbb");
  });
});

describe("a seat that holds before answering", () => {
  // How a seat hears a post: `<writer> in <mailbox>: <body>`.
  const heard = (marker: string) => [
    user(`visitor-1 in support.help: ${marker} reply-token-abc123 when do refunds post?`),
  ];
  const held = () => heard("[scenario:reply-after-a-hold]");
  const plain = () => heard("[scenario:reply-in-mailbox]");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the agent seat about three seconds for the held scenario, and nothing else", () => {
    expect(holdBeforeAnswer("agent-answer", held())).toBe(3_000);
    expect(holdBeforeAnswer("agent-answer-with-activate-tool", held())).toBe(3_000);
    // The same post without the hold marker, and other generators, answer at once.
    expect(holdBeforeAnswer("agent-answer", plain())).toBe(0);
    expect(holdBeforeAnswer("assistant-generator", held())).toBe(0);
  });

  it("answers exactly as reply-in-mailbox does once the hold ends", () => {
    agentSeatMock.reset();
    const heldTurn = held();
    const plainTurn = plain();
    const heldSteps = [agentSeatMock.next(heldTurn), agentSeatMock.next(heldTurn)];
    const plainSteps = [agentSeatMock.next(plainTurn), agentSeatMock.next(plainTurn)];
    expect(heldSteps).toEqual(plainSteps);
    expect(heldSteps[0]?.toolCalls?.[0]).toMatchObject({
      toolName: "post-to-mailbox",
      args: { mailbox: "support.help" },
    });
  });

  it("keeps the seat's line back until the hold ends", async () => {
    vi.useFakeTimers();
    agentSeatMock.reset();
    const posted: unknown[] = [];
    const model = createKitchenSinkTestModelResolver()("test-model", "agent-answer");
    const answer = model.generate({
      messages: held(),
      tools: [
        {
          name: "post-to-mailbox",
          execute: async (args) => {
            posted.push(args);
            return { ok: true };
          },
        },
      ],
    } as Parameters<typeof model.generate>[0]);

    await vi.advanceTimersByTimeAsync(2_900);
    expect(posted).toEqual([]);

    await vi.advanceTimersByTimeAsync(200);
    const result = await answer;
    expect(posted).toHaveLength(1);
    expect(result.text).toContain("[reply:in-mailbox]");
  });

  it("does not hold a post that names no hold", async () => {
    vi.useFakeTimers();
    agentSeatMock.reset();
    const posted: unknown[] = [];
    const model = createKitchenSinkTestModelResolver()("test-model", "agent-answer");
    await model.generate({
      messages: plain(),
      tools: [{ name: "post-to-mailbox", execute: async (args) => void posted.push(args) }],
    } as Parameters<typeof model.generate>[0]);
    expect(posted).toHaveLength(1);
  });
});

describe("a seat that holds, then answers in text", () => {
  const heard = (marker: string) => [user(`devuser in support.help: ${marker} ask-token-abc123 is anyone there?`)];
  const held = () => heard("[scenario:wake-after-a-hold]");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the agent seat about three seconds, and the plain wake not at all", () => {
    expect(holdBeforeAnswer("agent-answer", held())).toBe(3_000);
    expect(holdBeforeAnswer("agent-answer-with-activate-tool", held())).toBe(3_000);
    expect(holdBeforeAnswer("agent-answer", heard("[scenario:wake]"))).toBe(0);
  });

  it("answers as the wake does, in text, and never calls the post tool", () => {
    agentSeatMock.reset();
    const step = agentSeatMock.next(held());
    expect(step?.toolCalls).toBeUndefined();
    expect(step).toEqual(agentSeatMock.next(heard("[scenario:wake]")));
  });

  it("keeps the text answer back until the hold ends", async () => {
    vi.useFakeTimers();
    agentSeatMock.reset();
    const model = createKitchenSinkTestModelResolver()("test-model", "agent-answer");
    let answered: string | undefined;
    const answer = model
      .generate({ messages: held() } as Parameters<typeof model.generate>[0])
      .then((result) => (answered = result.text));

    await vi.advanceTimersByTimeAsync(2_900);
    expect(answered).toBeUndefined();

    await vi.advanceTimersByTimeAsync(200);
    await answer;
    expect(answered).toContain("[reply:wake]");
  });
});

/**
 * A routed mailbox's one evaluation, scripted. A post picks its member with
 * `[route:<member>]`; a post that names none fails the call, which is what
 * sends it to the mailbox's fallback. The script reads the post from the state
 * the route hands it, `{ recent, post: { from, text } }`.
 */
describe("the scripted mailbox route", () => {
  const route = async (text: string) =>
    (await mailboxRouteMock.doEvaluate({
      state: { recent: [], post: { from: "devuser", text } },
      questions: {}
    } as never)) as { answers: Record<string, unknown> };

  it("picks the member a post names with [route:<member>]", async () => {
    const result = await route("[route:support.devices] my laptop won't join the wifi");
    expect(result.answers).toEqual({ member: { type: "choice", choice: "support.devices" } });
  });

  it("fails the call for a post that names no member, so the mailbox's fallback takes it", async () => {
    await expect(route("who do I ask about a parking pass?")).rejects.toThrow(/\[route:<member>\]/);
  });

  it("is what the test-mode resolver hands the route's evaluator, by its block name", () => {
    const resolver = createKitchenSinkTestModelResolver();
    expect(resolver.resolveEvaluationModel).toBeTypeOf("function");
    const resolved = resolver.resolveEvaluationModel!("any/model", "mailbox-route");
    expect(resolved).toBeDefined();
    expect(resolved).toBe(mailboxRouteMock);
  });
});

describe("the wake scenario", () => {
  it("answers in text and never calls the post tool, on a routed post or not", () => {
    agentSeatMock.reset();
    const heard = "devuser in support.help: [scenario:wake] is anyone there?";
    const routed = `${heard}\n\nYou were picked to answer this post, and your reply is posted to support.help as you.`;
    for (const turn of [heard, routed]) {
      const step = agentSeatMock.next([user(turn)]);
      expect(step?.toolCalls).toBeUndefined();
      expect(step?.text).toContain("[reply:wake]");
    }
  });
});
