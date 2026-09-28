/**
 * The scripted model's scenario dispatcher, which every keyless check in this
 * app runs on.
 *
 * Two promises, and why each matters:
 *
 *   - A scenario is picked by a marker in the LATEST user turn only. A seat's
 *     conversation carries its earlier notes, so matching the whole history
 *     would answer a new note with an old note's scenario.
 *   - Each request walks its own copy of a scenario's steps. A multi-step
 *     scenario (a tool call, then the reply) run twice in one process must
 *     start at its first step both times; one shared cursor made the second
 *     run start mid-script and skip the tool call.
 *
 * Red state, before the green was trusted: today's dispatcher (whole-history
 * match, one cursor per scenario) failed both cases.
 *
 * A held scenario (`[scenario:reply-after-a-hold]`) gives a page time to show
 * a seat as working before its line lands. Its line must wait out the hold,
 * and nothing else may hold: every other check's timing depends on that.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentSeatMock, channelRouteMock, deskClerkMock, holdBeforeAnswer } from "@/lib/e2e-mock-script";
import { createKitchenSinkTestModelResolver } from "./mock-flowstate";

const user = (content: string) => ({ role: "user", content });
const assistant = (content: string) => ({ role: "assistant", content });

describe("the scripted model's scenario dispatcher", () => {
  it("starts a multi-step scenario at its first step on every request", () => {
    deskClerkMock.reset();
    const note = "[scenario:clerk-file] clerk-token-aaa the charger caught fire";

    const first = [user(note)];
    expect(deskClerkMock.next(first)?.toolCalls?.[0]?.toolName).toBe("desk-clerk-file");
    expect(deskClerkMock.next(first)?.text).toContain("[clerk:filed]");

    // A second request with the very same note: a fresh messages array, so a
    // fresh walk of the script.
    const second = [user(note)];
    expect(deskClerkMock.next(second)?.toolCalls?.[0]?.toolName).toBe("desk-clerk-file");
    expect(deskClerkMock.next(second)?.text).toContain("[clerk:filed]");
  });

  it("matches the latest user turn only, not an earlier note in the conversation", () => {
    deskClerkMock.reset();
    const history = [
      user("[scenario:clerk-file] clerk-token-bbb please escalate"),
      assistant("[front desk] [clerk:filed] Filed onto escalations."),
      user("[scenario:clerk-answer] clerk-token-ccc where is my refund?"),
    ];
    const step = deskClerkMock.next(history);
    expect(step?.toolCalls).toBeUndefined();
    expect(step?.text).toContain("[clerk:answered]");

    // And a latest turn with no marker is unmatched, however marked the history.
    const unmarked = [...history, assistant("..."), user("just saying hello")];
    expect(deskClerkMock.next(unmarked)?.text).not.toMatch(/\[clerk:/);
  });
});

describe("a seat that holds before answering", () => {
  // How a seat hears a post: `<writer> in <channel>: <body>`.
  const heard = (marker: string) => [
    user(`visitor-1 in support.desk: ${marker} reply-token-abc123 when do refunds post?`),
  ];
  const held = () => heard("[scenario:reply-after-a-hold]");
  const plain = () => heard("[scenario:reply-in-channel]");

  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds the agent seat about three seconds for the held scenario, and nothing else", () => {
    expect(holdBeforeAnswer("agent-answer", held())).toBe(3_000);
    expect(holdBeforeAnswer("agent-answer-with-activate-tool", held())).toBe(3_000);
    // The same post without the hold marker, and other generators, answer at once.
    expect(holdBeforeAnswer("agent-answer", plain())).toBe(0);
    expect(holdBeforeAnswer("desk-clerk-answer", held())).toBe(0);
    expect(holdBeforeAnswer("assistant-generator", held())).toBe(0);
  });

  it("answers exactly as reply-in-channel does once the hold ends", () => {
    agentSeatMock.reset();
    const heldTurn = held();
    const plainTurn = plain();
    const heldSteps = [agentSeatMock.next(heldTurn), agentSeatMock.next(heldTurn)];
    const plainSteps = [agentSeatMock.next(plainTurn), agentSeatMock.next(plainTurn)];
    expect(heldSteps).toEqual(plainSteps);
    expect(heldSteps[0]?.toolCalls?.[0]).toMatchObject({
      toolName: "post-to-channel",
      args: { channel: "support.desk" },
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
          name: "post-to-channel",
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
    expect(result.text).toContain("[reply:in-channel]");
  });

  it("does not hold a post that names no hold", async () => {
    vi.useFakeTimers();
    agentSeatMock.reset();
    const posted: unknown[] = [];
    const model = createKitchenSinkTestModelResolver()("test-model", "agent-answer");
    await model.generate({
      messages: plain(),
      tools: [{ name: "post-to-channel", execute: async (args) => void posted.push(args) }],
    } as Parameters<typeof model.generate>[0]);
    expect(posted).toHaveLength(1);
  });
});

/**
 * A routed channel's one evaluation, scripted. A post picks its member with
 * `[route:<member>]`; a post that names none fails the call, which is what
 * sends it to the channel's fallback. The script reads the post from the state
 * the route hands it, `{ recent, post: { from, text } }`.
 */
describe("the scripted channel route", () => {
  const route = async (text: string) =>
    (await channelRouteMock.doEvaluate({
      state: { recent: [], post: { from: "devuser", text } },
      questions: {}
    } as never)) as { answers: Record<string, unknown> };

  it("picks the member a post names with [route:<member>]", async () => {
    const result = await route("[route:support.devices] my laptop won't join the wifi");
    expect(result.answers).toEqual({ member: { type: "choice", choice: "support.devices" } });
  });

  it("fails the call for a post that names no member, so the channel's fallback takes it", async () => {
    await expect(route("who do I ask about a parking pass?")).rejects.toThrow(/\[route:<member>\]/);
  });

  it("is what the test-mode resolver hands the route's evaluator, by its block name", () => {
    const resolver = createKitchenSinkTestModelResolver();
    expect(resolver.resolveEvaluationModel).toBeTypeOf("function");
    const resolved = resolver.resolveEvaluationModel!("any/model", "channel-route");
    expect(resolved).toBeDefined();
    expect(resolved).toBe(channelRouteMock);
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
