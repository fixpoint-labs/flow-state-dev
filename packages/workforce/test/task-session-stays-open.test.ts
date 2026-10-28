/**
 * A task's own session stays open until the task is done, and after (FIX-1817).
 *
 * - V1 (S5): the task as filed is the task turn's user message, so a later
 *   turn in that session is handed what it was asked.
 * - V2, V5 (FIX-2131): a task turn on `agent` is offered `askQuestion`, a
 *   user's turn is not, and a coordinator turn carries one set of task tools.
 * - V3 (FIX-2131): an answer to the question, `updateTask_tasks` naming it,
 *   owes the task one more turn in the same session, on the same attempt,
 *   whose brief holds the answer; the task is heard once when it ends.
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
  const result = await h.act("alice", conv, "createTask_tasks", input);
  expect(result.error, messageOf(result.error)).toBeUndefined();
  return result.output as { ok: boolean; taskId?: string; error?: string };
};

describe("V1 · the task session keeps its prompt (S5)", () => {
  it("F1 · a user's later message in the finished task's session is talk, answered from the task as filed (FIX-2086)", async () => {
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

      const later = await h.act("alice", row.run!.sessionId, "respond", { message: "Which licence was the problem?" }, "agent");
      expect(later.error, messageOf(later.error)).toBeUndefined();
      await h.settled();
      // Talk: the task, its output and its attempts are as they were.
      expect(await h.row("alice", filing, filed.taskId!)).toMatchObject({ status: "completed", attempts: 1, output: row.output });
      const messages = sent(h.agentAnswer.calls.at(-1)!.input);
      // The task as filed, the worker's answer, then the user's message, in that order.
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

  it("a follow-up held with addTask waits, and released runs in the root task's session", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const root = await file(h, conv, { goal: "Draft the plan", assignee: "eng.tasker" });
      await h.settled();
      const recorded = await h.act("alice", conv, "createTask_tasks", { held: true, goal: "Now open the PR", followUpOf: root.taskId });
      expect(recorded.error, messageOf(recorded.error)).toBeUndefined();
      const followUp = recorded.output as { ok: boolean; taskId?: string; status?: string };
      expect(followUp).toMatchObject({ ok: true, status: "held" });
      await h.settled();
      // Held: nothing ran.
      expect(h.runs.map((run) => run.message)).toEqual(["Draft the plan"]);

      expect((await h.act("alice", conv, "updateTask_tasks", { id: followUp.taskId, status: "pending" })).output).toEqual({ ok: true });
      await h.settled();
      expect(h.runs.map((run) => run.message)).toEqual(["Draft the plan", "Now open the PR"]);
      expect(new Set(h.runs.map((run) => run.sessionId)).size).toBe(1);
      const row = (await h.rows("alice")).find((r) => r.id === followUp.taskId)!;
      expect(row).toMatchObject({ status: "completed", followUpOf: root.taskId, assignee: "eng.tasker" });
    } finally {
      await h.dispose();
    }
  });

  it("follows up a task filed for the delegate's ongoing session there, one open task at a time (FIX-2111)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      // A routed task runs in the delegate's ongoing session, not one of its own.
      const root = await file(h, conv, { goal: "Draft the post", assignee: "eng.tasker", session: "ongoing" });
      await h.settled();
      // Another ongoing task holds that session while the follow-up is filed.
      await file(h, conv, { goal: "[slow:400] Check the alerts", assignee: "eng.tasker", session: "ongoing" });
      const followUp = await file(h, conv, { goal: "A shorter version", followUpOf: root.taskId });
      expect(followUp).toMatchObject({ ok: true });
      const early = (await h.rows("alice")).find((r) => r.id === followUp.taskId)!;
      expect(early).toMatchObject({ status: "pending", attempts: 0 });
      await h.settled();
      // The follow-up ran where the post was drafted, with its history, after
      // the task that held the session.
      expect(h.runs.map((run) => run.message)).toEqual(["Draft the post", "[slow:400] Check the alerts", "A shorter version"]);
      expect(new Set(h.runs.map((run) => run.sessionId)).size).toBe(1);
      const rows = await h.rows("alice");
      expect(rows.find((r) => r.id === followUp.taskId)).toMatchObject({ status: "completed", followUpOf: root.taskId, session: "ongoing" });
      const alerts = rows.find((r) => r.goal === "[slow:400] Check the alerts")!;
      expect(rows.find((r) => r.id === followUp.taskId)!.startedAt!).toBeGreaterThanOrEqual(alerts.completedAt!);
    } finally {
      await h.dispose();
    }
  });

  it("lands a routed task's follow-up as the delegate's answer, once, as the routed task's did (FIX-2122)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const root = await file(h, conv, { goal: "Draft the post", assignee: "eng.tasker", session: "ongoing", resultTo: "conversation" });
      await h.settled();
      const followUp = await file(h, conv, { goal: "A shorter version", followUpOf: root.taskId });
      await h.settled();
      const lines = (await h.messages(conv)).filter((m) => m.agentName === "eng.tasker");
      // Each answer is a line of its own under the delegate's name: no notice about a task.
      expect(lines.map((m) => m.text)).toEqual(["eng.tasker did: Draft the post", "eng.tasker did: A shorter version"]);
      const row = (await h.rows("alice")).find((r) => r.id === followUp.taskId)!;
      expect(row).toMatchObject({ status: "completed", resultTo: "conversation", maxAttempts: 1 });
    } finally {
      await h.dispose();
    }
  });

  it("hears a routed task's failed follow-up as its routing does: a line, and a turn only where the routing runs one (FIX-2122)", async () => {
    for (const [coordinator, turns] of [
      ["rota", 0],
      ["lead", 1]
    ] as const) {
      const judgment = mockGenerator({ script: [{ when: () => true, then: { text: "Noted." } }] });
      const h = bootBoardHost({ judgment });
      try {
        const conv = await h.conversation("alice", coordinator);
        const root = await file(h, conv, { goal: "Draft the post", assignee: "eng.tasker", session: "ongoing", resultTo: "conversation" });
        await h.settled();
        const before = judgment.calls.length;
        const followUp = await file(h, conv, { goal: "[fail] A shorter version", followUpOf: root.taskId });
        await h.settled();
        expect((await h.rows("alice")).find((r) => r.id === followUp.taskId)).toMatchObject({ status: "errored" });
        // The line lands either way.
        const lines = (await h.messages(conv)).filter((m) => m.text.includes(followUp.taskId!) && m.text.includes("failed for good"));
        expect(lines, coordinator).toHaveLength(1);
        // A round-robin coordinator runs no turn of its own; a judgment one reads the failure.
        expect(judgment.calls.length - before, coordinator).toBe(turns);
      } finally {
        await h.dispose();
      }
    }
  });

  it("refuses a follow-up that names a target, and files nothing: it runs where its root ran (FIX-2111)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const root = await file(h, conv, { goal: "Draft the plan", assignee: "eng.tasker" });
      await h.settled();
      const refused = await file(h, conv, { goal: "Now open the PR", followUpOf: root.taskId, target: "nope/none" });
      expect(refused).toMatchObject({ ok: false, error: expect.stringMatching(/^follow_up_takes_no_target: /) });
      expect((await h.rows("alice")).some((r) => r.goal === "Now open the PR")).toBe(false);
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

  it("files a follow-up while an earlier one runs: it waits, then runs after it in the same session (FIX-2080)", async () => {
    const h = plain();
    try {
      const conv = await h.conversation("alice", "lead");
      const root = await file(h, conv, { goal: "Draft the plan", assignee: "eng.tasker" });
      await h.settled();
      const slow = await file(h, conv, { goal: "[slow:400] Now open the PR", followUpOf: root.taskId });
      const waiting = await file(h, conv, { goal: "And tag it", followUpOf: root.taskId });
      expect(waiting).toMatchObject({ ok: true });
      // Filed while the session works another task: it doesn't start yet.
      const early = (await h.rows("alice")).find((r) => r.id === waiting.taskId)!;
      expect(early).toMatchObject({ status: "pending", attempts: 0 });
      await h.settled();
      // Then it runs, after the one before it, in the root task's session.
      expect(h.runs.map((run) => run.message)).toEqual(["Draft the plan", "[slow:400] Now open the PR", "And tag it"]);
      expect(new Set(h.runs.map((run) => run.sessionId)).size).toBe(1);
      const rows = await h.rows("alice");
      expect(rows.find((r) => r.id === slow.taskId)?.status).toBe("completed");
      expect(rows.find((r) => r.id === waiting.taskId)?.status).toBe("completed");
    } finally {
      await h.dispose();
    }
  });
});

/**
 * A model that calls `askQuestion` once per question on a task whose goal
 * carries `marker`: the first on the task's own turn, each next one on the
 * turn an answer owed; after the last answer it finishes with `finish`. An
 * answer reaches the turn in its brief, as a steer naming its question.
 */
function questioner(marker: string, questions: string[], answers: string[], finish: string): MockGeneratorScriptEntry[] {
  let asked = 0;
  const answersIn = (input: unknown) => answers.filter((answer) => textOf(input).includes(answer)).length;
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
      then: { toolCalls: [{ toolCallId: `ask-${i}`, toolName: "askQuestion", args: { question } }] }
    })),
    { when: (input) => answersIn(input) >= questions.length, then: { text: finish } },
    { when: () => true, then: { text: "OK." } }
  ];
}

/** The row's one open question, by id. */
const openQuestion = (row: Task) => {
  const open = (row.holds ?? []).filter((hold) => hold.source.kind === "row" && !(row.steers ?? []).some((steer) => steer.answers === hold.id));
  expect(open).toHaveLength(1);
  return open[0]!;
};

describe("V2, V5 · a task turn's question (FIX-2131)", () => {
  it("a task turn asks its question: the task holds on it, the turn's own answer isn't recorded, and no ending is heard (FIX-2131)", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host(questioner("DEPLOY-it", ["Which region?"], [], "Deployed."), {
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "DEPLOY-it to production", assignee: "otto" });
      await h.settled();
      const row = (await h.row("alice", filing, filed.taskId!))!;
      expect(row).toMatchObject({ status: "in_progress", attempts: 1 });
      expect(row.leaseUntil).toBeUndefined();
      expect(openQuestion(row).ask).toMatchObject({ kind: "question", prompt: "Which region?" });
      expect(row.output).toBeUndefined();
      // Nothing ended, so the filer is told nothing yet (until FIX-2070).
      const notices = ((await h.session(conv)).state.taskNotices ?? []) as string[];
      expect(notices.filter((k) => k.startsWith(`${filed.taskId}:`))).toEqual([]);
      // The task turn was offered the tool exactly once; the coordinator's turns never.
      const agentTurns = seen.filter((s) => s.block?.startsWith("agent-answer"));
      expect(agentTurns.length).toBeGreaterThan(0);
      for (const turn of agentTurns) expect(turn.names.filter((n) => n === "askQuestion")).toHaveLength(1);
      for (const turn of seen.filter((s) => s.block?.startsWith("coordinator-judgment"))) {
        expect(turn.names).not.toContain("askQuestion");
      }
    } finally {
      await h.dispose();
    }
  });

  it("a user's line in a finished task's session is talk, not a task turn: no askQuestion", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host([{ when: () => true, then: { text: "OK." } }], {
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "Audit it", assignee: "otto" });
      await h.settled();
      const done = (await h.row("alice", filing, filed.taskId!))!;
      const sessionId = done.run!.sessionId;
      expect(done.status).toBe("completed");
      seen.length = 0;
      await h.act("alice", sessionId, "respond", { message: "USER-asks what you did" }, "agent");
      const turn = seen.filter((s) => s.input.includes("USER-asks"));
      expect(turn.length).toBeGreaterThan(0);
      for (const t of turn) expect(t.names).not.toContain("askQuestion");
    } finally {
      await h.dispose();
    }
  });

  it("a coordinator turn carries one set of the filer's four task tools, and no askQuestion (V5)", async () => {
    const seen: Array<{ block?: string; names: string[]; input: string }> = [];
    const h = host([{ when: () => true, then: { text: "OK." } }], {
      judgment: mockGenerator({ script: [{ when: () => true, then: { text: "OK." } }] }),
      observeTools: (block, names, input) => seen.push({ block, names, input: textOf(input) })
    });
    try {
      const conv = await h.conversation("alice", "chief");
      await h.act("alice", conv, "respond", { message: "TOOLS-check" });
      const turn = seen.filter((s) => s.input.includes("TOOLS-check"));
      expect(turn.length).toBeGreaterThan(0);
      for (const t of turn) {
        for (const name of ["createTask", "getTask", "listTasks", "updateTask"]) expect(t.names.filter((n) => n === name), name).toHaveLength(1);
        expect(t.names).not.toContain("askQuestion");
        expect(t.names).not.toContain("answerTask");
      }
    } finally {
      await h.dispose();
    }
  });
});

describe("V1 R1, V3 · the answer owes one more turn, in the same session, on the same attempt (FIX-2131)", () => {
  it("the next turn's brief holds the answer; it may ask again; the task completes on attempt 1 and is heard once", async () => {
    const h = host(questioner("SHIP-it", ["Which region?", "Which account?"], ["eu-west", "the ops account"], "Shipped KESTREL to the answered place."));
    try {
      const conv = await h.conversation("alice", "chief");
      const filing = await h.filingOf("alice", conv);
      const filed = await file(h, conv, { goal: "SHIP-it now", assignee: "otto" });
      await h.settled();
      const first = (await h.row("alice", filing, filed.taskId!))!;
      const asked = openQuestion(first);
      expect(asked.ask.prompt).toBe("Which region?");

      const answered = await h.act("alice", conv, "updateTask_tasks", { id: filed.taskId, question: asked.id, message: "eu-west" });
      expect(answered.output).toMatchObject({ ok: true });
      await h.settled();
      // It asked again: a second question, the same session, the same attempt.
      const second = (await h.row("alice", filing, filed.taskId!))!;
      expect(openQuestion(second).ask.prompt).toBe("Which account?");
      expect(second).toMatchObject({ status: "in_progress", attempts: 1 });
      expect(second.run!.sessionId).toBe(first.run!.sessionId);
      const next = sent(h.agentAnswer.calls.find((c) => textOf(c.input).includes("eu-west"))!.input);
      // The turn starts from the task as filed and its work so far, and takes the answer as the user's, naming the question.
      expect(next[0]).toMatchObject({ role: "user", text: expect.stringContaining("SHIP-it") });
      expect(next.some((m) => m.role === "user" && m.text.includes('From the user, answering "Which region?": eu-west')), JSON.stringify(next)).toBe(true);

      await h.act("alice", conv, "updateTask_tasks", { id: filed.taskId, question: openQuestion(second).id, message: "the ops account" });
      await h.settled();
      const done = (await h.row("alice", filing, filed.taskId!))!;
      expect(done).toMatchObject({ status: "completed", attempts: 1, output: "Shipped KESTREL to the answered place." });
      expect(done.run!.sessionId).toBe(first.run!.sessionId);
      const notices = (await h.session(conv)).state.taskNotices as string[];
      const mine = notices.filter((k) => k.startsWith(`${filed.taskId}:`));
      expect(mine).toEqual([`${filed.taskId}:1:completed`]);
    } finally {
      await h.dispose();
    }
  });
});
