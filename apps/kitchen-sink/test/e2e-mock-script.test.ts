/**
 * The scripted model's scenario dispatcher, which every keyless check in this
 * app runs on.
 *
 * A scenario is picked by a marker in the LATEST user turn only. A seat's
 * conversation carries its earlier turns, so matching the whole history would
 * answer a new message with an old message's scenario. Red state, before the
 * green was trusted: the dispatcher before FIX-1589 (whole-history match)
 * failed the case below.
 *
 * And the scenarios FIX-1611 adds (`specs/issues/FIX-1611/BUSINESS-RULES.md`,
 * V3): BR-19 `[scenario:recall]` names every token found before the latest
 * turn, and no other, and under `GOAL_CONTROL=no-history` only those in the
 * system message (BR-23); BR-21 `[route:<worker>]` routes, below.
 * `[scenario:needs-a-person]` went with kitchen-sink's escalation feature
 * (FIX-1792).
 *
 * A held scenario (`[scenario:reply-after-a-hold]`) gives a page time to show
 * a seat as working before its line lands. Its line must wait out the hold,
 * and nothing else may hold: every other check's timing depends on that.
 * `[scenario:wake-after-a-hold]` holds the same way before the wake's answer.
 * Without the hold that answer lands before a page can show the seat working,
 * and before the person's own post request ends and the page reads the
 * conversation again anyway.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentSeatMock, coordinatorRouteMock, holdBeforeAnswer } from "@/lib/e2e-mock-script";
import { createKitchenSinkTestModelResolver } from "./mock-flowstate";

const system = (content: string) => ({ role: "system", content });
const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the scripted model's scenario dispatcher", () => {
  it("matches the latest user turn only, not an earlier turn in the conversation", () => {
    agentSeatMock.reset();
    const history = [
      user("devuser, through support.help: [scenario:reply-in-mailbox] reply-token-bbb when do refunds post?"),
      assistant("[reply:in-mailbox] reply-token-bbb Refunds post on Fridays."),
      user("[scenario:talk-to-seat] where is my refund?"),
    ];
    const step = agentSeatMock.next(history);
    expect(step?.text).toContain("[reply:talk-to-seat]");
    expect(step?.text).not.toContain("reply-token-bbb");

    // And a latest turn with no marker is unmatched, however marked the history.
    const unmarked = [...history, assistant("..."), user("just saying hello")];
    expect(agentSeatMock.next(unmarked)?.text).not.toMatch(/\[reply:/);
  });
});

describe("the recall scenario (BR-19)", () => {
  const conversation = [
    system("You answer questions.\n\nSomething from before: reply-token-aaa"),
    user("devuser, through support.help: a question naming case-token-bbb"),
    assistant("[reply:wake] Heard it."),
    user("devuser, through support.help: [scenario:recall] what have we said? recall-token-ccc"),
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

describe("a seat that answers naming the post's token", () => {
  // How a delegate hears a post: `<from>, through <coordinator>: <body>`.
  const heard = (marker: string) => [
    user(`devuser, through support.help: ${marker} reply-token-abc123 when do refunds post?`),
  ];
  const held = () => heard("[scenario:reply-after-a-hold]");
  const plain = () => heard("[scenario:reply-in-mailbox]");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers in text carrying the post's token and its marker, never the scenario's", () => {
    agentSeatMock.reset();
    const step = agentSeatMock.next(plain());
    expect(step?.toolCalls).toBeUndefined();
    expect(step?.text).toBe("[reply:in-mailbox] reply-token-abc123 Refunds post on Fridays.");
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
    expect(agentSeatMock.next(held())).toEqual(agentSeatMock.next(plain()));
  });

  it("keeps the seat's answer back until the hold ends", async () => {
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
    expect(answered).toContain("[reply:in-mailbox] reply-token-abc123");
  });

  it("does not hold a post that names no hold", async () => {
    vi.useFakeTimers();
    agentSeatMock.reset();
    const model = createKitchenSinkTestModelResolver()("test-model", "agent-answer");
    let answered: string | undefined;
    void model.generate({ messages: plain() } as Parameters<typeof model.generate>[0]).then((result) => (answered = result.text));
    await vi.advanceTimersByTimeAsync(0);
    expect(answered).toContain("[reply:in-mailbox]");
  });
});

describe("a seat that holds, then answers the wake", () => {
  const heard = (marker: string) => [user(`devuser, through support.help: ${marker} ask-token-abc123 is anyone there?`)];
  const held = () => heard("[scenario:wake-after-a-hold]");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the agent seat about three seconds, and the plain wake not at all", () => {
    expect(holdBeforeAnswer("agent-answer", held())).toBe(3_000);
    expect(holdBeforeAnswer("agent-answer-with-activate-tool", held())).toBe(3_000);
    expect(holdBeforeAnswer("agent-answer", heard("[scenario:wake]"))).toBe(0);
  });

  it("answers as the wake does", () => {
    agentSeatMock.reset();
    const step = agentSeatMock.next(held());
    expect(step?.toolCalls).toBeUndefined();
    expect(step).toEqual(agentSeatMock.next(heard("[scenario:wake]")));
  });

  it("keeps the answer back until the hold ends", async () => {
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
 * A best-fit coordinator's one evaluation, scripted. A post picks its delegate
 * with `[route:<worker>]`; a post that names none fails the call, which is
 * what sends it to the coordinator's fallback. The script reads the post from
 * the state best fit hands it, `{ post: { from, text } }`.
 */
describe("the scripted best-fit evaluation", () => {
  const route = async (text: string) =>
    (await coordinatorRouteMock.doEvaluate({
      state: { post: { from: "devuser", text } },
      questions: {}
    } as never)) as { answers: Record<string, unknown> };

  it("picks the delegate a post names with [route:<worker>]", async () => {
    const result = await route("[route:support.devices] my laptop won't join the wifi");
    expect(result.answers).toEqual({ member: { type: "choice", choice: "support.devices" } });
  });

  it("fails the call for a post that names no delegate, so the coordinator's fallback takes it", async () => {
    await expect(route("who do I ask about a parking pass?")).rejects.toThrow(/\[route:<worker>\]/);
  });

  it("is what the test-mode resolver hands best fit's evaluator, by its block name", () => {
    const resolver = createKitchenSinkTestModelResolver();
    expect(resolver.resolveEvaluationModel).toBeTypeOf("function");
    const resolved = resolver.resolveEvaluationModel!("any/model", "coordinator-route");
    expect(resolved).toBeDefined();
    expect(resolved).toBe(coordinatorRouteMock);
  });
});

describe("the wake scenario", () => {
  it("answers in text, with no tool call", () => {
    agentSeatMock.reset();
    const step = agentSeatMock.next([user("devuser, through support.help: [scenario:wake] is anyone there?")]);
    expect(step?.toolCalls).toBeUndefined();
    expect(step?.text).toContain("[reply:wake]");
  });
});
