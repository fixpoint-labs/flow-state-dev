/**
 * A task's own session stays open until the task is done, and after (FIX-1817).
 *
 * - V1 (S5): the task as filed is the task turn's user message, so a later
 *   turn in that session is handed what it was asked; a turn re-entered by an
 *   answer is handed the answer as its message, labelled, never the task again.
 * - V2, V5 (S1, S7): a task turn on `agent` is offered `parkOnQuestion`, a
 *   person's turn and an asked row's turn are not, and a turn carries one set
 *   of task tools.
 * - V3 (S2, S3): the conversation answers with `answerTask_tasks`; the task
 *   re-enters the same session, unspent, and is heard once when it ends.
 * - V4 (S4, S6): a follow-up runs in its root task's session, per conversation.
 *
 * The host is the conversation board's (`./conversation-board-harness`): a
 * coordinator conversation filing for `otto`, an `agent` worker, whose model
 * is scripted. What each model call was SENT is read off the mock's calls.
 */
import { describe, expect, it } from "vitest";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { mockGenerator, type MockGeneratorScriptEntry } from "@flow-state-dev/testing";
import { boardWorkers, bootBoardHost, messageOf, type BoardHost } from "./conversation-board-harness";
import type { WorkerManifest } from "../src/manifest";

const workers = (): WorkerManifest[] => [
  ...boardWorkers(),
  { id: "chief", declared: { flow: "coordinator", delegates: ["otto"] }, body: "Hand the work to otto.", skills: [] }
];

type Sent = { role: string; text: string };

/** Every non-system message one model call was sent. */
function sent(messages: unknown): Sent[] {
  return (messages as Array<{ role: string; content: unknown }>)
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role,
      text:
        typeof m.content === "string"
          ? m.content
          : (m.content as Array<{ text?: string; output?: unknown; input?: unknown }>)
              .map((c) => c.text ?? JSON.stringify(c.output ?? c.input ?? ""))
              .join("")
    }));
}

const textOf = (input: unknown) => JSON.stringify(input).replaceAll("\\", "");

function host(agentScript: MockGeneratorScriptEntry[], extra: Parameters<typeof bootBoardHost>[0] = {}) {
  const agentAnswer = mockGenerator({ script: agentScript });
  const h = bootBoardHost({
    standard: workers(),
    agentAnswer,
    judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }),
    ...extra
  });
  return Object.assign(h, { agentAnswer });
}

const file = async (h: BoardHost, conv: string, input: Record<string, unknown>) => {
  const result = await h.act("alice", conv, "addTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

const until = async (check: () => Promise<boolean> | boolean, ms = 5000) => {
  for (const deadline = Date.now() + ms; Date.now() < deadline; ) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return check();
};

describe("V1 · the task session keeps its prompt (S5)", () => {
  it("F1 · a person's later question into a finished task's session is handed the task as filed", async () => {
    const h = host([
      {
        when: (input) => textOf(input).includes("GOAL-audit") && !textOf(input).includes("KESTREL-41"),
        then: { text: "I found licence KESTREL-41 is GPL." }
      },
      { when: () => true, then: { text: "later turn" } }
    ]);
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "GOAL-audit the licences", assignee: "otto" });
      await h.settled();
      const row = (await h.row("alice", filing, filed.taskId!)) as Task;
      expect(row.status).toBe("completed");

      const later = await h.act("alice", row.run!.sessionId, "run", { message: "Which licence was the problem?" }, "agent");
      expect(later.error, messageOf(later.error)).toBeUndefined();
      const messages = sent(h.agentAnswer.calls.at(-1)!.input);
      // The task as filed, the worker's answer, then the new question, in that order.
      const ask = messages.findIndex((m) => m.role === "user" && m.text.includes("GOAL-audit"));
      const did = messages.findIndex((m) => m.role === "assistant" && m.text.includes("KESTREL-41"));
      const now = messages.findIndex((m) => m.role === "user" && m.text.includes("Which licence"));
      expect(ask, JSON.stringify(messages)).toBeGreaterThanOrEqual(0);
      expect(did).toBeGreaterThan(ask);
      expect(now).toBeGreaterThan(did);
      // The task turn itself was sent its task once, not twice.
      const first = sent(h.agentAnswer.calls[0]!.input).filter((m) => m.text.includes("GOAL-audit"));
      expect(first).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});

describe("V4 · a follow-up runs in its task's session (S4, S6)", () => {
  const plain = () => bootBoardHost({ judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }) });

  it("runs in the finished task's session, opens no session, and its ending is heard (BR-20, BR-24)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const filing = await h.filingOf("alice", conv);
      const root = await file(h, conv, { goal: "Draft the plan", assignee: "eng.tasker" });
      await h.settled();
      const first = await file(h, conv, { goal: "Now open the PR", followUpOf: root.taskId });
      expect(first).toMatchObject({ ok: true });
      await h.settled();
      const second = await file(h, conv, { goal: "And tag it", followUpOf: first.taskId });
      await h.settled();

      expect(h.runs.map((run) => run.message)).toEqual(["Draft the plan", "Now open the PR", "And tag it"]);
      expect(new Set(h.runs.map((run) => run.sessionId)).size).toBe(1);
      const rows = await h.rows("alice");
      expect(rows.map((r) => [r.id, r.status, r.followUpOf]).sort()).toEqual(
        [
          [root.taskId, "completed", undefined],
          [first.taskId, "completed", root.taskId],
          [second.taskId, "completed", root.taskId]
        ].sort()
      );
      // Reached by the root task's id; the follow-ups add no key of their own.
      const app = h.client("alice");
      const found = await app.findWorkerSession({ worker: "eng.tasker", taskId: root.taskId!, filingSessionId: filing });
      expect(found?.id).toBe(h.runs[0]!.sessionId);
      // Each ending heard once in the conversation, the follow-ups' included.
      const heard = (await h.requestsOf(conv)).filter((r) => r.actionName === "onTaskSettled");
      expect(heard).toHaveLength(3);
    } finally {
      await h.dispose();
    }
  });

  it("keeps two conversations apart: each follows up its own task, in its own session (BR-23)", async () => {
    const h = plain();
    try {
      const one = await h.conversation("alice", "lead");
      const two = await h.conversation("alice", "lead");
      const a = await file(h, one, { goal: "in one", assignee: "eng.tasker" });
      const b = await file(h, two, { goal: "in two", assignee: "eng.tasker" });
      await h.settled();
      // The other conversation's task is unknown here, and nothing is stored.
      expect(await file(h, two, { goal: "cross", followUpOf: a.taskId })).toMatchObject({
        ok: false,
        error: expect.stringMatching(/^task_not_found/)
      });
      await file(h, one, { goal: "more in one", followUpOf: a.taskId });
      await file(h, two, { goal: "more in two", followUpOf: b.taskId });
      await h.settled();
      const session = (message: string) => h.runs.find((run) => run.message === message)!.sessionId;
      expect(session("more in one")).toBe(session("in one"));
      expect(session("more in two")).toBe(session("in two"));
      expect(session("in one")).not.toBe(session("in two"));
      expect((await h.rows("alice")).some((r) => r.goal === "cross")).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("refuses a follow-up while an earlier one is unfinished, naming it (BR-25)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const root = await file(h, conv, { goal: "Draft the plan", assignee: "eng.tasker" });
      await h.settled();
      const slow = await file(h, conv, { goal: "[slow:400] Now open the PR", followUpOf: root.taskId });
      const refused = await file(h, conv, { goal: "And tag it", followUpOf: root.taskId });
      expect(refused).toMatchObject({ ok: false, error: expect.stringContaining(`task "${slow.taskId}"`) });
      await h.settled();
      expect((await h.rows("alice")).some((r) => r.goal === "And tag it")).toBe(false);
    } finally {
      await h.dispose();
    }
  });
});

describe("V3 · the conversation answers (S2, S3)", () => {
  const plain = () => bootBoardHost({ judgment: mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] }) });
  const answer = (h: BoardHost, conv: string, taskId: string, text: string) =>
    h.act("alice", conv, "answerTask_tasks", { taskId, answer: text }).then((r) => {
      expect(r.error, messageOf(r.error)).toBeUndefined();
      return r.output as { ok: boolean; error?: string };
    });

  it("re-enters the same session with the answer as its message, unspent, heard once each way (BR-6, BR-7, BR-8, BR-15)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "[park:Which region?] deploy", assignee: "eng.tasker" });
      await h.settled();
      expect(await h.row("alice", filing, filed.taskId!)).toMatchObject({ status: "parked", feedback: "Which region?" });

      expect(await answer(h, conv, filed.taskId!, "eu-west")).toEqual({ ok: true });
      await h.settled();
      const row = (await h.row("alice", filing, filed.taskId!))!;
      // Completed on the re-entry, which was not charged: two claims, one of them the answer's.
      expect(row).toMatchObject({ status: "completed", attempts: 2, turnReentries: 1 });
      expect(row.attempts - (row.turnReentries ?? 0)).toBe(1);
      // Both attempts in the one session; the second was handed the answer, labelled.
      expect(h.runs.map((run) => run.sessionId)).toEqual([h.runs[0]!.sessionId, h.runs[0]!.sessionId]);
      expect(h.runs[1]!.message).toBe("Answer to your question:\n\neu-west");
      const endings = (await h.requestsOf(conv))
        .filter((r) => r.actionName === "onTaskSettled")
        .map((r) => (r as any).input?.ending ?? (r as any).input?.notice?.ending);
      expect(endings.filter((e) => e === "completed")).toHaveLength(1);
      expect(endings.filter((e) => e === "parked")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("declines a second answer, naming the status, and re-queues nothing (BR-9)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const filed = await file(h, conv, { goal: "[park:Which region?] deploy", assignee: "eng.tasker" });
      await h.settled();
      await answer(h, conv, filed.taskId!, "eu-west");
      await h.settled();
      const second = await answer(h, conv, filed.taskId!, "us-east");
      expect(second).toMatchObject({ ok: false, error: expect.stringMatching(/^terminal_task_write_declined: .*completed/) });
      await h.settled();
      expect(h.runs).toHaveLength(2);
    } finally {
      await h.dispose();
    }
  });

  it("answers another conversation's task as unknown (BR-11)", async () => {
    const h = plain();
    try {
      const one = await h.conversation("alice", "lead");
      const two = await h.conversation("alice", "lead");
      const filed = await file(h, one, { goal: "[park:Which region?] deploy", assignee: "eng.tasker" });
      await h.settled();
      expect(await answer(h, two, filed.taskId!, "eu-west")).toMatchObject({ ok: false, error: "task_not_found" });
      expect((await h.row("alice", await h.filingOf("alice", one), filed.taskId!))!.status).toBe("parked");
    } finally {
      await h.dispose();
    }
  });

  it("survives a lost start: the answer's row waits, and the next touch of the board runs it (BR-12)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "[park:Which region?] deploy", assignee: "eng.tasker" });
      await h.settled();
      const lost = await h.loseDispatches("runTaskBoard");
      await answer(h, conv, filed.taskId!, "eu-west");
      await h.settled();
      expect(lost.lost()).toBeGreaterThan(0);
      expect((await h.row("alice", filing, filed.taskId!))).toMatchObject({ status: "pending", answered: true });
      lost.restore();
      await h.act("alice", conv, "listTasks_tasks", {});
      await h.settled();
      expect((await h.row("alice", filing, filed.taskId!))!.status).toBe("completed");
      expect(h.runs[1]!.message).toBe("Answer to your question:\n\neu-west");
    } finally {
      await h.dispose();
    }
  });
});

/**
 * A model that calls `parkOnQuestion` once per question on a task whose goal
 * carries `marker`: the first on the task's own turn, each next one on the
 * turn an answer re-entered; after the last answer it finishes with `finish`.
 */
function asker(marker: string, questions: string[], finish: string): MockGeneratorScriptEntry[] {
  let asked = 0;
  const answersIn = (input: unknown) => (textOf(input).match(/Answer to your question/g) ?? []).length;
  return [
    {
      // A tool result just came back: end the turn.
      when: (input) => (input as Array<{ role: string }>).at(-1)?.role === "tool",
      then: { text: "Waiting on your answer." }
    },
    ...questions.map((question, i) => ({
      when: (input: unknown) => {
        if (asked !== i || !textOf(input).includes(marker) || answersIn(input) !== i) return false;
        asked += 1;
        return true;
      },
      then: { toolCalls: [{ toolCallId: `ask-${i}`, toolName: "parkOnQuestion", args: { question } }] }
    })),
    { when: (input) => answersIn(input) >= questions.length, then: { text: finish } },
    { when: () => true, then: { text: "OK." } }
  ];
}

describe("V2, V5 · the question park on a task turn (S1, S7)", () => {
  it("a task turn parks its row on its question, the turn's own answer isn't recorded, and the conversation hears it once (BR-1, BR-4)", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host(asker("DEPLOY-it", ["Which region?"], "Deployed."), {
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "DEPLOY-it to production", assignee: "otto" });
      await h.settled();
      const row = (await h.row("alice", filing, filed.taskId!))!;
      expect(row).toMatchObject({ status: "parked", feedback: "Which region?" });
      expect(row.output).toBeUndefined();
      const notices = (await h.session(conv)).state.taskNotices as string[];
      expect(notices.filter((k) => k.startsWith(`${filed.taskId}:`) && k.endsWith(":parked"))).toHaveLength(1);
      // The task turn was offered the tool exactly once; the coordinator's turns never.
      const agentTurns = seen.filter((s) => s.block?.startsWith("agent-answer"));
      expect(agentTurns.length).toBeGreaterThan(0);
      for (const turn of agentTurns) expect(turn.names.filter((n) => n === "parkOnQuestion")).toHaveLength(1);
      for (const turn of seen.filter((s) => s.block?.startsWith("coordinator-judgment"))) {
        expect(turn.names).not.toContain("parkOnQuestion");
      }
    } finally {
      await h.dispose();
    }
  });

  it("a person's message into the task session is not a task turn: no parkOnQuestion (BR-2)", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host([{ when: () => true, then: { text: "OK." } }], {
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "Audit it", assignee: "otto" });
      await h.settled();
      const sessionId = (await h.row("alice", filing, filed.taskId!))!.run!.sessionId;
      seen.length = 0;
      await h.act("alice", sessionId, "run", { message: "PERSON-asks what you did" }, "agent");
      const turn = seen.filter((s) => s.input.includes("PERSON-asks"));
      expect(turn.length).toBeGreaterThan(0);
      for (const t of turn) expect(t.names).not.toContain("parkOnQuestion");
    } finally {
      await h.dispose();
    }
  });

  it("an asked row's task turn has no parkOnQuestion; an assigned follow-up of a finished asked task has it (BR-1a)", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host([{ when: () => true, then: { text: "Done." } }], {
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const now = Date.now();
      const base = { attempts: 0, maxAttempts: 2, assignee: "otto", createdBy: "alice", createdAt: now, updatedAt: now, incarnationId: `inc-${now}` };
      // An asked row, as the ask path writes one, waiting to run.
      await h.writeRow("alice", filing, { ...base, id: "asked-1", goal: "ASKED-row work", status: "pending", ask: { gateId: "g-1", deadline: now + 600_000 } } as Task);
      await h.act("alice", conv, "listTasks_tasks", {});
      await h.settled();
      const askedTurn = seen.filter((s) => s.block?.startsWith("agent-answer") && s.input.includes("ASKED-row"));
      expect(askedTurn.length).toBeGreaterThan(0);
      for (const t of askedTurn) expect(t.names).not.toContain("parkOnQuestion");
      expect((await h.row("alice", filing, "asked-1"))!.status).toBe("completed");

      const follow = await file(h, conv, { goal: "FOLLOW-up work", followUpOf: "asked-1" });
      expect(follow).toMatchObject({ ok: true });
      await h.settled();
      const followTurn = seen.filter((s) => s.block?.startsWith("agent-answer") && s.input.includes("FOLLOW-up"));
      expect(followTurn.length).toBeGreaterThan(0);
      for (const t of followTurn) expect(t.names.filter((n) => n === "parkOnQuestion")).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });

  it("a coordinator turn carries one set of task tools, answerTask among them, and no parkOnQuestion (V5)", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host([{ when: () => true, then: { text: "OK." } }], {
      judgment: mockGenerator({ script: [{ when: () => true, then: { text: "OK." } }] }),
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      await h.act("alice", conv, "run", { message: "TOOLS-check" });
      const turn = seen.filter((s) => s.input.includes("TOOLS-check"));
      expect(turn.length).toBeGreaterThan(0);
      const tools = ["addTask", "assignTask", "completeTask", "failTask", "blockTask", "cancelTask", "updateTask", "listTasks", "answerTask"];
      for (const t of turn) {
        for (const name of tools) expect(t.names.filter((n) => n === name), name).toHaveLength(1);
        expect(t.names).not.toContain("parkOnQuestion");
      }
    } finally {
      await h.dispose();
    }
  });
});

describe("V1 R1, V3 · the answer is the next turn, in the same session (S5, S2, S3)", () => {
  it("the re-entered turn is handed the answer as its message, after the task, its work and its question; and it may ask again (BR-7, BR-14)", async () => {
    const h = host(asker("SHIP-it", ["Which region?", "Which account?"], "Shipped KESTREL to the answered place."));
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "SHIP-it now", assignee: "otto" });
      await h.settled();
      const first = (await h.row("alice", filing, filed.taskId!))!;
      expect(first.status).toBe("parked");

      const answered = await h.act("alice", conv, "answerTask_tasks", { taskId: filed.taskId, answer: "eu-west" });
      expect(answered.output).toEqual({ ok: true });
      await h.settled();
      // It asked again: a second park, a second notice, the same session.
      const second = (await h.row("alice", filing, filed.taskId!))!;
      expect(second).toMatchObject({ status: "parked", feedback: "Which account?" });
      expect(second.run!.sessionId).toBe(first.run!.sessionId);
      const reentry = sent(h.agentAnswer.calls.find((c) => textOf(c.input).includes("eu-west"))!.input);
      const task = reentry.findIndex((m) => m.role === "user" && m.text.includes("SHIP-it"));
      const question = reentry.findIndex((m) => m.text.includes("Which region?"));
      const answer = reentry.findIndex((m) => m.role === "user" && m.text === "Answer to your question:\n\neu-west");
      expect(task, JSON.stringify(reentry)).toBeGreaterThanOrEqual(0);
      expect(question).toBeGreaterThan(task);
      expect(answer).toBeGreaterThan(question);

      await h.act("alice", conv, "answerTask_tasks", { taskId: filed.taskId, answer: "ops" });
      await h.settled();
      const done = (await h.row("alice", filing, filed.taskId!))!;
      expect(done).toMatchObject({ status: "completed", attempts: 3, turnReentries: 2 });
      expect(done.run!.sessionId).toBe(first.run!.sessionId);
      const notices = (await h.session(conv)).state.taskNotices as string[];
      const mine = notices.filter((k) => k.startsWith(`${filed.taskId}:`));
      expect(mine.filter((k) => k.endsWith(":parked"))).toHaveLength(2);
      expect(mine.filter((k) => k.endsWith(":completed"))).toHaveLength(1);
    } finally {
      await h.dispose();
    }
  });
});
