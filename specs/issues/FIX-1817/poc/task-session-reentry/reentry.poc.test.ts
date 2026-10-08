/**
 * FIX-1817 POC · what a later turn in a task's own session is handed, on main.
 * Experimental evidence, not a maintained test: run it with `run.sh`, which
 * copies it into packages/workforce/test for the run.
 *
 * FIX-1817 promises two things about a task's session: an answered question
 * carries on in it "with everything it already knew", and a finished task's
 * session answers a follow-up question from its history. Both rest on one
 * premise nobody had run: a LATER turn in a task session is handed the
 * EARLIER task turn. The agent kind keeps `history: true`, but the task entry
 * (`work`) declares no `userMessage`, so it was unclear what history holds.
 *
 * The host is the existing hand-over fixture's: a mailbox list, a coordinator
 * board that hands each task to `work` on the shared `agent` copy, per-task
 * sessions, the real engine with in-memory stores, a scripted model.
 *
 * Legs:
 *   F1  follow-up question   A task completes. A person then sends the public
 *                            `run` door into that task's own session. Is it
 *                            refused (a lock)? What does the model receive?
 *   R1  re-entry             A finished row is written back to `pending`
 *                            with an answer in `feedback` (a raw write,
 *                            standing in for `unpark`, which an `agent`
 *                            worker cannot reach today). The board runs
 *                            again. Same session? What does the model
 *                            receive, and does the answer reach it?
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, dispatcher } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { taskBoard } from "@flow-state-dev/orchestration/task-board";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import {
  createWorkerInstallation,
  createWorkerLookup,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  mailboxBoard,
  mailboxInstances,
  openMailboxes,
  type MailboxManifest
} from "../src/index";

const ORG = DEFAULT_ORG_ID;
const USER_ID = "u_alice";
const MAILBOX = "ops.desk";
const roster: MailboxManifest[] = [
  { id: MAILBOX, declared: { members: ["eng.auditor"], boards: ["work"] }, body: "The desk." }
];
const list = mailboxBoard(MAILBOX, "work");

type Sent = { role: string; text: string };

/** Every non-system message the model was sent on one call. */
function conversation(messages: unknown): Sent[] {
  return (messages as Array<{ role: string; content: unknown }>)
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      text:
        typeof m.content === "string"
          ? m.content
          : (m.content as Array<{ text?: string }>).map((c) => c.text ?? "").join("")
    }));
}

async function host() {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [{ id: "eng.auditor", declared: {}, body: "You audit." }],
    workerFlows: () => flows as never
  });
  flows = { agent: defineAgentWorkerFlow({ installation, taskLists: [list.id] }) };
  const lookup = createWorkerLookup({ installation });
  const copies = hireWorkforce(installation);
  const [mailbox] = mailboxInstances(roster, {
    kinds: { mailbox: defineMailboxFlow({ checkAssignee: lookup.filingCheck() }) as never }
  });
  const board = taskBoard({
    name: "desk-coordinator",
    boardId: list.id,
    collection: list,
    workers: {},
    defaultWorker: dispatcher({
      name: "desk-hand-over",
      action: "work",
      session: "per-task",
      flowKind: lookup.flowKind,
      state: lookup.state
    })
  });
  const coordinator = defineFlow({ kind: "desk-coordinator", actions: { drain: { block: board.drain } } })({
    id: "desk-coordinator"
  });

  // The scripted worker. Turn 1 of the task finds a fact only it knows and
  // asks a question. Every later call answers with a fixed line; what matters
  // is what each call was SENT, recorded on `answer.calls`.
  const answer = mockGenerator({
    name: "agent-answer",
    script: [
      {
        when: (input: unknown) => JSON.stringify(input).includes("GOAL-audit") && !JSON.stringify(input).includes("KESTREL-41"),
        then: { text: "I found licence KESTREL-41 is GPL. QUESTION: may I replace the package?" }
      },
      { when: () => true, then: { text: "later turn" } }
    ]
  });

  const state = createFlowState({
    flows: {
      [mailbox!.kind]: mailbox!,
      [coordinator.id]: coordinator,
      ...Object.fromEntries(copies.map((copy) => [copy.id, copy]))
    },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({ generators: { "agent-answer": answer }, policy: "allow" })
  });
  const runtime: FlowStateRuntime = await state.getRuntime();
  await openMailboxes(roster, { client: sessionApi(runtime), userId: USER_ID });

  const act = (flow: FlowInstance, sessionId: string, actionName: string, input: unknown) =>
    runAction({
      orgId: ORG,
      flow,
      actionName,
      input,
      userId: USER_ID,
      sessionId,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never) as Promise<{ output?: any; error?: any }>;

  const agent = copies.find((copy) => copy.id === "agent") ?? copies[0]!;
  const key = (taskId: string) => `${list.id}/${taskId}`;
  return {
    state,
    runtime,
    answer,
    agent,
    file: (goal: string) => act(mailbox!, MAILBOX, "fileTask", { board: "work", goal, assignee: "eng.auditor" }),
    drain: () => act(coordinator, "s_coordinator", "drain", {}),
    say: (sessionId: string, message: string) => act(agent, sessionId, "run", { message }),
    row: async (taskId: string) =>
      (await runtime.stores.resourceState.get("org", ORG, key(taskId)))?.state as Record<string, any> | undefined,
    rewrite: async (taskId: string, patch: Record<string, unknown>) => {
      const current = (await runtime.stores.resourceState.get("org", ORG, key(taskId)))!;
      const next: Record<string, unknown> = { ...(current.state as object), ...patch };
      for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
      await runtime.stores.resourceState.set("org", ORG, key(taskId), next as never, "any");
    }
  };
}

async function until(predicate: () => Promise<boolean>, label: string) {
  for (let i = 0; i < 300; i += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("FIX-1817 POC · a later turn in a task's own session", () => {
  it("F1 · a finished task's session takes a person's question, and is handed the task turn", async () => {
    const h = await host();
    try {
      const taskId = (await h.file("GOAL-audit the licences")).output.taskId as string;
      expect((await h.drain()).error).toBeUndefined();
      await until(async () => (await h.row(taskId))?.status === "completed", "the task to complete");
      const sessionId = (await h.row(taskId))!.run.sessionId as string;

      const followUp = await h.say(sessionId, "Which licence was the problem?");
      const sent = conversation(h.answer.calls.at(-1)!.input);
      console.log("F1 · follow-up error:", followUp.error?.message ?? "none");
      console.log("F1 · follow-up was sent:", JSON.stringify(sent, null, 2));

      expect(followUp.error).toBeUndefined(); // no lock: the turn runs
      // What history carries: the task turn's answer, so the fact only the
      // task session knew reaches the follow-up.
      expect(sent.some((m) => m.role === "assistant" && m.text.includes("KESTREL-41"))).toBe(true);
      // Recorded, not asserted as desired: whether the task's own prompt is there.
      console.log("F1 · task prompt in history:", sent.some((m) => m.role === "user" && m.text.includes("GOAL-audit")));
    } finally {
      await h.state.dispose();
    }
  });

  it("R1 · a row put back to pending re-enters the same session; what the second task turn is handed", async () => {
    const h = await host();
    try {
      const taskId = (await h.file("GOAL-audit the licences")).output.taskId as string;
      expect((await h.drain()).error).toBeUndefined();
      await until(async () => (await h.row(taskId))?.status === "completed", "the first turn to end");
      const first = (await h.row(taskId))!;
      const firstSession = first.run.sessionId as string;
      console.log("R1 · row after turn 1:", JSON.stringify({ status: first.status, attempts: first.attempts, run: first.run }));

      // Stand-in for `unpark(taskId, answer)`: back to pending, the answer as feedback.
      await h.rewrite(taskId, {
        status: "pending",
        feedback: "ANSWER: yes, replace it with the MIT fork.",
        output: undefined,
        leaseUntil: undefined,
        claimedBy: undefined
      });
      const callsBefore = h.answer.calls.length;
      expect((await h.drain()).error).toBeUndefined();
      await until(async () => (await h.row(taskId))?.status === "completed" && h.answer.calls.length > callsBefore, "the re-entry to end");
      const second = (await h.row(taskId))!;
      const sent = conversation(h.answer.calls.at(-1)!.input);
      console.log("R1 · row after re-entry:", JSON.stringify({ status: second.status, attempts: second.attempts, run: second.run }));
      console.log("R1 · re-entry was sent:", JSON.stringify(sent, null, 2));

      expect(second.run.sessionId).toBe(firstSession); // the same task session
      expect(sent.some((m) => m.role === "assistant" && m.text.includes("KESTREL-41"))).toBe(true); // it remembers
      console.log("R1 · the answer reached the model:", sent.some((m) => m.text.includes("MIT fork")));
      console.log("R1 · attempts charged by the re-entry:", second.attempts - first.attempts);
    } finally {
      await h.state.dispose();
    }
  });
});

/** `openMailboxes`'s session API over the runtime's own stores (copied from the hand-over test). */
function sessionApi(runtime: FlowStateRuntime) {
  const stores = runtime.stores;
  return {
    createSession: async (options: { flowKind: string; userId: string; sessionId?: string; orgId?: string; state?: Record<string, unknown> }) => {
      const id = String(options.sessionId);
      if ((await stores.session.get(id)) !== undefined) {
        throw Object.assign(new Error(`Session "${id}" already exists`), { status: 409 });
      }
      const now = Date.now();
      await stores.session.set(
        id,
        {
          id,
          flowKind: options.flowKind,
          flowId: options.flowKind,
          userId: options.userId,
          orgId: options.orgId ?? DEFAULT_ORG_ID,
          state: options.state ?? {},
          lineageId: `lin_${id}`,
          version: 0,
          createdAt: now,
          updatedAt: now,
          journal: []
        } as never,
        "absent"
      );
      return { id };
    },
    getSession: async (sessionId: string) => {
      const found = await stores.session.get(sessionId);
      return {
        flowKind: String(found?.flowKind),
        flowId: found?.flowId,
        userId: String(found?.userId),
        orgId: (found as { orgId?: string } | undefined)?.orgId,
        state: found?.state as Record<string, unknown> | undefined
      };
    },
    deleteSession: async (sessionId: string): Promise<void> => {
      await stores.session.delete(sessionId);
    }
  };
}
