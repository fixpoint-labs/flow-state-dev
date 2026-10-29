/**
 * A worker consults another of its user's conversations (FIX-2173): it reads
 * what that conversation already holds and answers in its own turn, and the
 * other conversation runs nothing, gets nothing and doesn't change.
 *
 * Why it matters: messaging the other worker would wake it and run its model,
 * the cost a consult removes. So the answer must come from that conversation's
 * history, with no new request, item or message-log row there; another user's
 * conversation must be refused as one that doesn't exist; and the reading must
 * stay out of the asking conversation's history and screen, where it would
 * read as a line of that conversation.
 *
 * Everything is read from what reached each session and the store, never from
 * the tool's return value alone.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import type { WorkerManifest } from "../src";
import { consultSessionsCapability } from "../src/messages/consult";
import { WORKER_MESSAGES_PATTERN } from "../src/messages/message-log";
import { criteriaState, deriveWorkerSessionId } from "../src/workers/derive-session-id";
import { boardWorkers, bootBoardHost, type BoardHost } from "./conversation-board-harness";

const ORG = "acme";
const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

/** The first call whose input mentions `marker` calls the consult with `args` once; the call after it says "Answered.". */
function consultOnce(marker: string, args: unknown): MockGeneratorScriptEntry[] {
  let called = false;
  return [
    { when: (input: unknown) => called && textOf(input).includes(marker), then: { text: "Answered." } },
    {
      when: (input: unknown) => {
        if (called || !textOf(input).includes(marker)) return false;
        called = true;
        return true;
      },
      then: { toolCalls: [{ toolCallId: `consult-${marker}`, toolName: "consultSessionHistory", args }] }
    }
  ];
}

const fallback: MockGeneratorScriptEntry = { when: () => true, then: { text: "" } };

/** The consult's own model: it names the venue when the quoted history holds it. */
const consultModel = () =>
  mockGenerator({
    script: [
      { when: (input: unknown) => textOf(input).includes("Hall K-41"), then: { text: "The user told wren the venue is Hall K-41." } },
      { when: () => true, then: { text: "That conversation doesn't say." } }
    ]
  });

function workers(consults: boolean): WorkerManifest[] {
  return [
    ...boardWorkers(consults ? { otto: { capabilities: { consultSessions: ["consult"] } } } : {}),
    {
      id: "wren",
      declared: { description: "Plans events.", ...(consults ? { capabilities: { consultSessions: ["consult"] } } : {}) },
      body: "You plan events.",
      skills: []
    }
  ];
}

function boot(options: { consults?: boolean; script: MockGeneratorScriptEntry[]; tools?: string[][] }) {
  const consult = consultModel();
  const h = bootBoardHost({
    standard: workers(options.consults ?? true),
    agentUses: (installation) => [consultSessionsCapability(installation)],
    agentAnswer: mockGenerator({ script: [...options.script, fallback] }),
    judgment: mockGenerator({ script: [fallback] }),
    generators: { "consultSessionHistory-answer": consult },
    observeTools: (block, names) => {
      if (block?.startsWith("agent-answer") === true) options.tools?.push(names);
    }
  });
  return Object.assign(h, { consult });
}

async function agentSession(h: BoardHost, userId: string, workerId: string): Promise<string> {
  const created = await h.create(userId, "agent", { state: { workerId } });
  if (created.status !== 201) throw new Error(`creating ${workerId}'s session failed: ${JSON.stringify(created.body)}`);
  return created.body.session!.id;
}

async function itemsOf(h: BoardHost, sessionId: string): Promise<any[]> {
  return (await h.requestsOf(sessionId)).flatMap((request) => (request as unknown as { items?: any[] }).items ?? []);
}

async function consultOutputs(h: BoardHost, sessionId: string): Promise<any[]> {
  return (await itemsOf(h, sessionId)).filter((item) => item.type === "tool_output" && item.toolCall?.name === "consultSessionHistory").map((item) => item.output);
}

async function logRows(h: BoardHost, userId: string) {
  const runtime = await h.state.getRuntime();
  const entries = await runtime.stores.resourceState.getByPrefix("user", `${userId}:~org:${ORG}`, WORKER_MESSAGES_PATTERN.replace("*", ""));
  return Object.values(entries);
}

/** The user tells wren the venue in their conversation with wren, at its derived address. */
async function tellWren(h: BoardHost, userId = "alice") {
  const sessionId = await deriveWorkerSessionId({ userId, orgId: ORG, flow: "agent", criteria: { worker: "wren" } });
  const created = await h.create(userId, "agent", { sessionId, state: criteriaState({ worker: "wren" }) });
  if (created.status !== 201) throw new Error(`creating wren's conversation failed: ${JSON.stringify(created.body)}`);
  const wren = created.body.session!.id;
  await h.post(userId, wren, "respond", { message: "For the record, the venue is Hall K-41." }, "agent");
  await h.settled();
  return wren;
}

describe("a worker consults another of its user's conversations", () => {
  it("answers from wren's conversation in otto's turn, and wren gets no request, item or message", async () => {
    const h = boot({
      script: consultOnce("What venue did I give wren?", { of: "wren", question: "What venue did the user give?" })
    });
    try {
      const wren = await tellWren(h);
      const wrenBefore = { requests: (await h.requestsOf(wren)).length, items: (await itemsOf(h, wren)).length };

      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "respond", { message: "What venue did I give wren?" }, "agent");
      await h.settled();

      expect((await h.messages(otto)).some((m) => m.text === "Answered."), "otto's turn went on after the consult").toBe(true);
      // One model call, on the cheaper model's intent, not otto's.
      expect(h.consult.calls.map((call) => call.model)).toEqual(["intent/utility"]);
      expect(await consultOutputs(h, otto)).toEqual([
        expect.objectContaining({ reading: "The user told wren the venue is Hall K-41.", of: "wren", turnsRead: 1, cut: false, running: false })
      ]);
      // wren ran nothing and got nothing; no message was sent.
      expect((await h.requestsOf(wren)).length).toBe(wrenBefore.requests);
      expect((await itemsOf(h, wren)).length).toBe(wrenBefore.items);
      expect(await logRows(h, "alice")).toEqual([]);
      // The reading is the tool's result, not a line of otto's conversation.
      const consultItems = (await itemsOf(h, otto)).filter((item) => item.type === "message" && item.provenance?.blockName === "consultSessionHistory-answer");
      expect(consultItems.length).toBeGreaterThan(0);
      for (const item of consultItems) expect(item.itemVisibility).toEqual({ client: false, history: false });
    } finally {
      await h.dispose();
    }
  });

  it("refuses another user's conversation as one that doesn't exist, and reads nothing", async () => {
    let wrenId = "";
    let asked = false;
    const step = { toolCalls: [{ toolCallId: "c1", toolName: "consultSessionHistory", args: {} as Record<string, unknown> }] };
    const h = boot({
      script: [
        {
          when: (input: unknown) => {
            if (asked || !textOf(input).includes("their venue")) return false;
            asked = true;
            step.toolCalls[0]!.args = { of: { session: wrenId }, question: "venue?" };
            return true;
          },
          then: step
        }
      ]
    });
    try {
      wrenId = await tellWren(h, "alice");
      const bobOtto = await agentSession(h, "bob", "otto");
      await h.post("bob", bobOtto, "respond", { message: "What is their venue?" }, "agent");
      await h.settled();
      const outputs = await consultOutputs(h, bobOtto);
      expect(outputs[0]).toEqual({ ok: false, error: `no_session: no conversation "${wrenId}" of yours.` });
      expect(JSON.stringify(await itemsOf(h, bobOtto))).not.toContain("Hall K-41");
    } finally {
      await h.dispose();
    }
  });

  it("refuses a worker the user never spoke to, without opening a conversation with it", async () => {
    const h = boot({ script: consultOnce("Ask wren", { of: "wren", question: "venue?" }) });
    try {
      const otto = await agentSession(h, "alice", "otto");
      await h.post("alice", otto, "respond", { message: "Ask wren what venue" }, "agent");
      await h.settled();
      expect((await consultOutputs(h, otto))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^no_conversation:/) });
      expect(await h.client("alice").findWorkerSession({ worker: "wren" })).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });

  // A worker's task or delegate session carries its worker id but is not its
  // conversation with the user, so naming itself there reads that conversation.
  it("reads a worker's own conversation with the user from another of its sessions, and refuses only the running one", async () => {
    const h = boot({
      script: [
        ...consultOnce("What venue did I give you?", { of: "wren", question: "What venue did the user give?" }),
        ...consultOnce("For the record", { of: "wren", question: "venue?" })
      ]
    });
    try {
      const wren = await tellWren(h);
      const other = await agentSession(h, "alice", "wren");
      await h.post("alice", other, "respond", { message: "What venue did I give you?" }, "agent");
      await h.settled();
      expect(await consultOutputs(h, other)).toEqual([expect.objectContaining({ reading: "The user told wren the venue is Hall K-41.", of: "wren" })]);
      expect((await consultOutputs(h, wren))[0]).toMatchObject({ ok: false, error: expect.stringMatching(/^self:/) });
    } finally {
      await h.dispose();
    }
  });

  it("is offered only to a worker whose file picks it", async () => {
    const offered: string[][] = [];
    const notOffered: string[][] = [];
    const on = boot({ script: [], tools: offered });
    const off = boot({ consults: false, script: [], tools: notOffered });
    try {
      for (const [h, _] of [[on, offered], [off, notOffered]] as const) {
        const otto = await agentSession(h, "alice", "otto");
        await h.post("alice", otto, "respond", { message: "hi" }, "agent");
        await h.settled();
      }
      expect(offered.flat()).toContain("consultSessionHistory");
      expect(notOffered.flat()).not.toContain("consultSessionHistory");
    } finally {
      await on.dispose();
      await off.dispose();
    }
  });
});
