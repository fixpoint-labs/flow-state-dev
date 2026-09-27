/**
 * The agent kind on a routed delivery: what its turn sees, and where its
 * answer lands.
 *
 * Run on the real kinds, in one in-process host: the built-in channel kind
 * built with `routeByPurpose`, and agent seats carrying the channel-post
 * capability, hired through `hireWorkforce`. The route's evaluation is scripted
 * by block name (`[route:<member>]` picks); the seats' answers are scripted by
 * a marker in the post: `[answer:text]` replies in text, `[answer:tool]` posts
 * through the tool once, `[answer:tool-twice]` twice, `[answer:empty]` replies
 * with nothing. Every landing assertion is on the lines the channel stored.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1610/BUSINESS-RULES.md`, V3):
 *   BR-9  a text reply lands as the seat: one line, `author` its seat id;
 *   BR-10 the tool's first post for the post is the line; a second posts
 *         nothing and says the answer is in; a second delivery of the same
 *         post lands no second line;
 *   BR-11 an empty reply lands nothing and fails the run;
 *   BR-12 the landed line wakes no seat and takes no route;
 *   BR-13 the routed heard turn says the reply is posted to the channel; the
 *         unrouted one is unchanged;
 *   BR-14 an unrouted channel, and direct talk, land nothing on their own;
 *   BR-24/BR-25 the routed turn's system message carries the lines before the
 *         post; the stored conversation does not;
 *   BR-26 the public `run` action takes no lines;
 *   BR-27 a channel's first post has no lines, so no section at all.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime, StoreRegistry } from "@flow-state-dev/engine";
import {
  createMockModelResolver,
  mockEvaluationModel,
  type MockGeneratorInstance,
  type MockGeneratorScriptStep
} from "@flow-state-dev/testing";
import {
  POST_TO_CHANNEL_TOOL,
  channelInstances,
  channelNotifyInputSchema,
  channelPostCapability,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  routeByPurpose,
  wakeMemberSeats,
  type ChannelManifest,
  type ChannelNotifyInput,
  type WorkerManifest
} from "../src/index";
import { postedLines } from "./channel-post-lines";

const USER_ID = "devuser";
const HELP = "support.help";
const LOUNGE = "support.lounge";
const MEMBERS = ["support.devices", "support.accounts", "support.general"];

/** One call the scripted answer model was handed: its system text, and the whole input. */
type AnswerCall = { system: string; turn: string; sent: string };

/**
 * The scripted answer model. Reads the marker in the turn's last user
 * message; a tool step calls `post-to-channel` into the turn's own channel,
 * with no text, so the real tool runs. Each request keeps its own cursor,
 * keyed on the messages array the tool loop hands every call of one request.
 */
function scriptedAnswers(): MockGeneratorInstance & { answers: AnswerCall[] } {
  let cursor = new WeakMap<object, number>();
  const answers: AnswerCall[] = [];
  return {
    name: "agent-answer",
    calls: [],
    answers,
    reset: () => {
      cursor = new WeakMap();
    },
    next: (input: unknown): MockGeneratorScriptStep => {
      const messages = input as Array<{ role: string; content: unknown }>;
      const text = (content: unknown) =>
        typeof content === "string" ? content : (content as Array<{ text?: string }>).map((c) => c.text ?? "").join("");
      const turn = text([...messages].reverse().find((m) => m.role === "user")?.content ?? "");
      const system = messages.filter((m) => m.role === "system").map((m) => text(m.content)).join("\n");
      const step = cursor.get(messages) ?? 0;
      cursor.set(messages, step + 1);
      if (step === 0) answers.push({ system, turn, sent: JSON.stringify(messages) });
      const channel = / in ([a-z.]+): /.exec(turn)?.[1] ?? "support.nowhere";
      const said = turn.replace(/\[[a-z-]+:[a-z.-]+\]\s*/g, "").split(": ").slice(1).join(": ").split("\n")[0];
      const toolCall = (body: string) => ({
        toolCalls: [{ toolCallId: `tc_${step}_${Math.random().toString(36).slice(2)}`, toolName: POST_TO_CHANNEL_TOOL, args: { channel, body } }]
      });
      if (turn.includes("[answer:empty]")) return { text: "" };
      if (turn.includes("[answer:tool-twice]") && step < 2) return toolCall(`From the tool, ${step + 1}.`);
      if (turn.includes("[answer:tool]") && step === 0) return toolCall("From the tool.");
      if (turn.includes("[answer:tool")) return { text: "done" };
      return { text: `Re: ${said}` };
    }
  };
}

/** The scripted route evaluation: `[route:<member>]` picks; anything else fails the call. */
function scriptedRoute() {
  return mockEvaluationModel({
    answers: ({ state }) => {
      const picked = /\[route:([a-z.-]+)\]/.exec((state as { post: { text: string } }).post.text)?.[1];
      if (picked === undefined) throw new Error("no route marker");
      return { member: { type: "choice", choice: picked } };
    }
  });
}

function workers(): WorkerManifest[] {
  return MEMBERS.map((id) => ({
    id,
    declared: { description: `The ${id.split(".")[1]} desk.`, tools: [POST_TO_CHANNEL_TOOL] },
    body: "You answer questions."
  }));
}

const manifests: ChannelManifest[] = [
  { id: HELP, declared: { members: MEMBERS, routing: { fallback: "support.general" } }, body: "Ask support." },
  { id: LOUNGE, declared: { members: MEMBERS }, body: "Chat." }
];

/** A test-only sender standing in for a channel's fan-out: one delivery to one seat, keyed as the wake keys it. */
function redeliverFlow(seatId: string) {
  return defineFlow({
    kind: "redeliver-test",
    actions: {
      deliver: {
        inputSchema: channelNotifyInputSchema,
        block: dispatcher({
          name: "redeliver-seat",
          flowKind: seatId,
          action: "onChannelPost",
          inputSchema: channelNotifyInputSchema,
          session: { key: (post: ChannelNotifyInput) => `channel:${post.channelId}` }
        })
      }
    }
  })({ id: "redeliver-test" });
}

function host() {
  const agent = defineAgentWorkerFlow({ uses: [channelPostCapability] });
  const seats = hireWorkforce(workers(), { kinds: { agent } });
  const [channel] = channelInstances(manifests, {
    kinds: {
      channel: defineChannelFlow({
        notify: wakeMemberSeats(seats),
        route: routeByPurpose(seats, { model: "test/route" })
      }) as never
    }
  });
  const answers = scriptedAnswers();
  const redeliver = redeliverFlow("support.devices");
  const state = createFlowState({
    flows: {
      [channel!.id]: channel!,
      [redeliver.id]: redeliver,
      ...Object.fromEntries(seats.map((seat) => [seat.id, seat]))
    },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({
      generators: { "agent-answer": answers },
      evaluators: { "channel-route": scriptedRoute() },
      policy: "allow"
    })
  });
  const seat = (id: string) => seats.find((s) => s.id === id)!;
  return { channel: channel!, state, answers, seat, redeliver };
}

async function bind(stores: StoreRegistry, sessionId: string) {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: "channel",
      flowId: "channel",
      userId: USER_ID,
      orgId: DEFAULT_ORG_ID,
      state: { members: MEMBERS, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

async function post(runtime: FlowStateRuntime, channel: FlowInstance, sessionId: string, body: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow: channel,
    actionName: "post",
    input: { body },
    userId: USER_ID,
    sessionId,
    stores: runtime.stores,
    runtimeConfig: { ...runtime.runtimeConfig }
  });
  expect(result.error).toBeUndefined();
}

async function until(predicate: () => Promise<boolean>, label: string): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Every request in the host, on every session, has settled. */
async function quiet(runtime: FlowStateRuntime): Promise<void> {
  await until(async () => {
    const sessions = await runtime.stores.session.list({ parentage: "all" });
    for (const session of sessions) {
      const requests = await runtime.stores.request.list({ sessionId: session.id });
      if (requests.some((r) => r.status === "in_progress")) return false;
    }
    return true;
  }, "every request to settle");
  // A landing dispatches into the channel, whose fan-out dispatches again: settle twice over.
  await new Promise((resolve) => setTimeout(resolve, 50));
  await until(async () => {
    const sessions = await runtime.stores.session.list({ parentage: "all" });
    for (const session of sessions) {
      const requests = await runtime.stores.request.list({ sessionId: session.id });
      if (requests.some((r) => r.status === "in_progress")) return false;
    }
    return true;
  }, "every request to settle, again");
}

/** The seat's conversation in a channel: its requests there, with items. */
async function seatRequests(runtime: FlowStateRuntime, seatId: string, channelId: string) {
  const sessions = await runtime.stores.session.list({ parentage: "all" });
  const session = sessions.find((s) => s.flowId === seatId && s.parentSessionId === channelId);
  if (session === undefined) return [];
  return runtime.stores.request.list({ sessionId: session.id, withItems: true });
}

/** The kept conversation messages of a seat's requests, as text. */
function storedMessages(requests: Array<{ items?: unknown[] }>): string[] {
  return requests
    .flatMap((request) => request.items ?? [])
    .filter((item) => (item as { type?: string }).type === "message")
    .map((item) => JSON.stringify(item));
}

const lines = async (runtime: FlowStateRuntime, sessionId: string) =>
  (await postedLines(runtime.stores, sessionId)).map((line) => ({ author: line.author, body: line.body }));

describe("a routed agent's answer lands in the channel", () => {
  it("posts a text reply as the seat, one line, which wakes no seat and takes no route (BR-9, BR-12)", async () => {
    const { channel, state, answers } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:text] my laptop won't join the wifi");
      await quiet(runtime);

      expect(await lines(runtime, HELP)).toEqual([
        { author: undefined, body: "[route:support.devices] [answer:text] my laptop won't join the wifi" },
        { author: "support.devices", body: "Re: my laptop won't join the wifi" }
      ]);
      // One answer: the landed line woke nobody.
      expect(answers.answers).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("keeps the tool's post as the line and lands nothing after it (BR-10)", async () => {
    const { channel, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:tool] my laptop won't join the wifi");
      await quiet(runtime);

      expect((await lines(runtime, HELP)).slice(1)).toEqual([{ author: "support.devices", body: "From the tool." }]);
    } finally {
      await state.dispose();
    }
  });

  it("posts only the tool's first call for the post; the second says the answer is in (BR-10)", async () => {
    const { channel, state, seat } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:tool-twice] my laptop won't join the wifi");
      await quiet(runtime);

      expect((await lines(runtime, HELP)).slice(1)).toEqual([{ author: "support.devices", body: "From the tool, 1." }]);
      const kept = JSON.stringify(await seatRequests(runtime, seat("support.devices").id, HELP));
      expect(kept).toMatch(/already in the channel/);
    } finally {
      await state.dispose();
    }
  });

  it("lands no second line when the same post is delivered to the seat again (BR-10)", async () => {
    const { state, redeliver } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      // Twice, the same routed post, from one sender session: one seat conversation.
      for (let delivery = 0; delivery < 2; delivery += 1) {
        const result = await runAction({
          orgId: DEFAULT_ORG_ID,
          flow: redeliver,
          actionName: "deliver",
          input: {
            channelId: HELP,
            member: "support.devices",
            postId: "p_redelivered",
            body: "[answer:text] my laptop won't join the wifi",
            principal: USER_ID,
            routed: true,
            recent: []
          },
          userId: USER_ID,
          sessionId: "redeliver-session",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });
        expect(result.error).toBeUndefined();
        await quiet(runtime);
      }

      expect(await lines(runtime, HELP)).toEqual([{ author: "support.devices", body: "Re: my laptop won't join the wifi" }]);
    } finally {
      await state.dispose();
    }
  });

  it("lands no second line for a post delivered again after the seat has answered many others (BR-10)", async () => {
    const { state, redeliver } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      const deliver = async (n: number) => {
        const result = await runAction({
          orgId: DEFAULT_ORG_ID,
          flow: redeliver,
          actionName: "deliver",
          input: {
            channelId: HELP,
            member: "support.devices",
            postId: `p_${n}`,
            body: `[answer:text] question ${n}`,
            principal: USER_ID,
            routed: true,
            recent: []
          },
          userId: USER_ID,
          sessionId: "redeliver-session",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });
        expect(result.error).toBeUndefined();
        await quiet(runtime);
      };
      // More answers than any fixed window would keep, one at a time, then the first post again.
      for (let n = 0; n <= 60; n += 1) await deliver(n);
      await deliver(0);

      const answered = await lines(runtime, HELP);
      expect(answered).toHaveLength(61);
      expect(answered.filter((line) => line.body === "Re: question 0")).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  }, 60_000);

  it("lands nothing on an empty reply and fails the run, recorded in the seat's conversation (BR-11)", async () => {
    const { channel, state, seat } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:empty] my laptop won't join the wifi");
      await quiet(runtime);

      expect(await lines(runtime, HELP)).toHaveLength(1);
      const [request] = await seatRequests(runtime, seat("support.devices").id, HELP);
      expect(request!.status).toBe("failed");
      expect(JSON.stringify(request)).toMatch(/empty reply/);
    } finally {
      await state.dispose();
    }
  });
});

describe("what a routed agent's turn sees", () => {
  it("hands the turn the lines before the post as context, which the conversation does not keep (BR-24, BR-25)", async () => {
    const { channel, state, answers, seat } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:text] my laptop won't join the wifi");
      await quiet(runtime);
      await post(runtime, channel, HELP, "[route:support.general] [answer:text] where can I buy it?");
      await quiet(runtime);

      const general = answers.answers.find((a) => a.turn.includes("buy it"))!;
      expect(general.system).toContain(`${USER_ID}: [route:support.devices] [answer:text] my laptop won't join the wifi`);
      expect(general.system).toContain("support.devices: Re: my laptop won't join the wifi");
      // The turn is the post alone; the lines are not in it, nor in what the conversation kept.
      expect(general.turn).not.toContain("laptop");
      const kept = storedMessages(await seatRequests(runtime, seat("support.general").id, HELP));
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.join("\n")).not.toContain("laptop");
    } finally {
      await state.dispose();
    }
  });

  it("says in the routed heard turn that the reply is posted to the channel (BR-13)", async () => {
    const { channel, state, answers } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:text] my laptop won't join the wifi");
      await quiet(runtime);

      const [turn] = answers.answers.map((a) => a.turn);
      expect(turn).toMatch(
        new RegExp(`^${USER_ID} in ${HELP}: \\[route:support.devices\\] \\[answer:text\\] my laptop won't join the wifi\\n\\n`)
      );
      expect(turn).toMatch(/posted to support\.help/);
    } finally {
      await state.dispose();
    }
  });

  it("has no lines on a channel's first post: no section at all (BR-27)", async () => {
    const { channel, state, answers } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      await post(runtime, channel, HELP, "[route:support.devices] [answer:text] my laptop won't join the wifi");
      await quiet(runtime);

      expect(answers.answers[0]!.system).not.toMatch(/recent lines/i);
    } finally {
      await state.dispose();
    }
  });
});

describe("an agent that was not routed", () => {
  it("answers an unrouted channel's post in the turn FIX-1590 hears, and lands nothing on its own (BR-13, BR-14)", async () => {
    const { channel, state, answers } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, LOUNGE);
      await post(runtime, channel, LOUNGE, "[answer:text] lunch?");
      await quiet(runtime);

      expect(answers.answers.map((a) => a.turn).sort()).toEqual([
        `${USER_ID} in ${LOUNGE}: [answer:text] lunch?`,
        `${USER_ID} in ${LOUNGE}: [answer:text] lunch?`,
        `${USER_ID} in ${LOUNGE}: [answer:text] lunch?`
      ]);
      expect(answers.answers.every((a) => !/recent lines/i.test(a.system))).toBe(true);
      expect(await lines(runtime, LOUNGE)).toHaveLength(1);
    } finally {
      await state.dispose();
    }
  });

  it("takes no lines on the public run action, and lands nothing (BR-14, BR-26)", async () => {
    const { state, answers, seat } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, HELP);
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: seat("support.devices"),
        actionName: "run",
        input: {
          message: "[answer:text] hello",
          recent: [{ id: "l_1", at: 1, principal: USER_ID, authorVerified: false, body: "SMUGGLED-LINE" }]
        },
        userId: USER_ID,
        sessionId: "direct-talk",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });
      expect(result.error).toBeUndefined();
      await quiet(runtime);

      expect(answers.answers[0]!.sent).not.toContain("SMUGGLED-LINE");
      expect(await lines(runtime, HELP)).toEqual([]);
    } finally {
      await state.dispose();
    }
  });
});
