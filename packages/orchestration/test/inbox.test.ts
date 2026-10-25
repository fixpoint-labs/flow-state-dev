/**
 * The Inbox read (`src/inbox`): one item type over what holds a task for the
 * user, its one answer call, and the check that a list is the list it should be.
 *
 * The check is worth something only if it fails when the list is wrong, so
 * each clause has a control that breaks the list one way and must turn it red:
 * a duplicated item, the row holds dropped, a mirror the resume left open, an
 * item with no route, a closed hold back, one stop under two items.
 */
import { describe, expect, it, vi } from "vitest";
import type { Client, SessionRequestSummary } from "@flow-state-dev/client";
import { createInboxClient, inboxItems, type InboxRow, type InboxSuspension } from "../src/inbox";
import { reconcileInbox, rowTruthOf, suspensionTruthOf, taskItemId, type InboxTruth } from "../src/inbox/check";
import { NO_BOARD_UNANSWERABLE, NO_FLOW_UNANSWERABLE } from "../src/inbox/holds";
import type { TaskHold } from "../src/tasks";

const BOARD = "s_desk.tasks";

/** The mirror a task run's stop for the user leaves on its row (FIX-2133). */
const mirror = (requestId: string, suspensionId: string, kind: "approval" | "input" | "review" = "approval", prompt = "?"): TaskHold => ({
  id: suspensionId,
  actor: "user",
  openedAt: 100,
  source: { kind: "suspension", requestId, suspensionId },
  ask: { kind, prompt },
});

/** A running task row whose run stopped for the user, its stop mirrored on its row. */
const stopped = (id: string, suspensionId: string, over: Partial<InboxRow> = {}): InboxRow => ({
  board: BOARD,
  id,
  title: `do ${id}`,
  assignee: "ops.helper",
  status: "in_progress",
  updatedAt: 100,
  run: { sessionId: `run_${id}`, requestId: `req_${id}` },
  holds: [mirror(`req_${id}`, suspensionId, "approval", `Approve ${id}?`)],
  ...over,
});

/** A suspension a reader found in a session. */
const found = (suspensionId: string, over: Partial<InboxSuspension> = {}): InboxSuspension => ({
  sessionId: `s_${suspensionId}`,
  flowId: "asker",
  requestId: `req_${suspensionId}`,
  suspensionId,
  kind: "approval",
  prompt: "ok?",
  since: 50,
  ...over,
});

const flows = (sessionId: string) => (sessionId.startsWith("run_") || sessionId.startsWith("s_") ? "asker" : undefined);

/** The truth for rows and lone suspensions, as they should be. */
function truthOf(rows: InboxRow[], lone: InboxSuspension[]): InboxTruth {
  return {
    rows: rowTruthOf(rows),
    suspensions: [
      ...rows.flatMap((r) =>
        (r.holds ?? []).flatMap((h) =>
          h.source.kind !== "suspension" || r.run == null ? [] : [{ suspensionId: h.source.suspensionId, sessionId: r.run.sessionId, requestId: h.source.requestId, taskRun: true }],
        ),
      ),
      ...lone.map((s) => ({ suspensionId: s.suspensionId, sessionId: s.sessionId, requestId: s.requestId, taskRun: false })),
    ],
  };
}

describe("inboxItems: one item type", () => {
  it("lists a task run's stop once, from its row, even when its session holds it too", () => {
    const rows = [stopped("t1", "sp1")];
    // The run's session holds the same stop: the reader found it there as well.
    const items = inboxItems({ rows, suspensions: [found("sp1", { sessionId: "run_t1", requestId: "req_t1", since: 70, detail: "the card" }), found("lone")], flowOf: flows });
    expect(items.map((i) => [i.id, i.task?.taskId ?? null])).toEqual([
      ["lone", null],
      [taskItemId(BOARD, "t1"), "t1"],
    ]);
    const held = items[1]!;
    expect(held.holds).toEqual([
      {
        id: "sp1",
        source: { kind: "suspension", flowId: "asker", sessionId: "run_t1", requestId: "req_t1", suspensionId: "sp1" },
        ask: { kind: "approval", prompt: "Approve t1?" },
        openedAt: 70,
        answerable: true,
        unanswerable: null,
        detail: "the card",
      },
    ]);
    expect(held.answerable).toBe(true);
  });

  it("keeps listing a stop while a notice or steer turn runs: admission clears waitingOn, keeps the mirror", () => {
    // `admitClaimedTask` for a turn that is not the task's own: `waitingOn` cleared, the mirror kept, still running.
    const turning = { ...stopped("t1", "sp1"), waitingOn: null };
    const items = inboxItems({ rows: [turning], suspensions: [found("sp1", { sessionId: "run_t1", requestId: "req_t1" })], flowOf: flows });
    expect(items.map((i) => [i.id, i.answerable])).toEqual([[taskItemId(BOARD, "t1"), true]]);
    expect(rowTruthOf([turning])).toEqual([{ board: BOARD, taskId: "t1", suspensionHolds: ["sp1"], rowHolds: [] }]);
  });

  it("keeps a stop's place when a notice turn moves its row's updatedAt: since is the stop's own", () => {
    const stop = found("sp1", { sessionId: "run_t1", requestId: "req_t1", since: 40 });
    const before = inboxItems({ rows: [stopped("t1", "sp1", { updatedAt: 100 })], suspensions: [stop], flowOf: flows });
    const after = inboxItems({ rows: [stopped("t1", "sp1", { updatedAt: 900 })], suspensions: [stop], flowOf: flows });
    expect(before[0]!.since).toBe(40);
    expect(after[0]!.since).toBe(40);
    // With no stop found to read it from, the mirror's own opening stands in.
    expect(inboxItems({ rows: [stopped("t1", "sp1", { updatedAt: 900 })], suspensions: [], flowOf: flows })[0]!.since).toBe(100);
  });

  it("a stop in a task's open run that the row records no hold for yet still lists, under the row, answerable", () => {
    // Before the stop arm's write, or a record the row couldn't read: run r1, stop sp1 in r1, no mirror.
    const row = stopped("t1", "sp1", { holds: null, run: { sessionId: "run_t1", requestId: "r1" } });
    const items = inboxItems({ rows: [row], suspensions: [found("sp1", { sessionId: "run_t1", requestId: "r1" })], flowOf: flows });
    expect(items.map((i) => [i.id, i.answerable, i.holds.map((h) => h.id)])).toEqual([[taskItemId(BOARD, "t1"), true, ["sp1"]]]);
    // The row's missing record is the check's to report: drift, and the item isn't one its row holds.
    const result = reconcileInbox(items, { rows: rowTruthOf([row]), suspensions: [{ suspensionId: "sp1", sessionId: "run_t1", requestId: "r1", taskRun: true }] });
    expect(result.drift).toEqual(["stop sp1: 0 open holds", `item ${taskItemId(BOARD, "t1")} shows sp1, its row holds none`]);
  });

  it("lists nothing for a row that holds nothing, or a finished one whose kept mirror only addresses its owed resume", () => {
    const rows = [
      stopped("idle", "x", { holds: null }),
      stopped("done", "y", { status: "completed" }),
      stopped("cancelled", "c", { status: "cancelled" }),
      stopped("queued", "z", { status: "pending", holds: null }),
    ];
    expect(inboxItems({ rows, suspensions: [], flowOf: flows })).toEqual([]);
  });

  it("names a run's flow from the stop the reader found when no listed session does", () => {
    const [item] = inboxItems({ rows: [stopped("t1", "sp1")], suspensions: [found("sp1", { flowId: "worker-flow" })], flowOf: () => undefined });
    expect(item).toMatchObject({ answerable: true, holds: [{ source: { flowId: "worker-flow" } }] });
  });

  it("an item whose session names no flow is listed, unanswerable, saying why, on its hold and on the item", () => {
    const [item] = inboxItems({ rows: [stopped("t1", "sp1")], suspensions: [], flowOf: () => null });
    expect(item).toMatchObject({ answerable: false, unanswerable: NO_FLOW_UNANSWERABLE, holds: [{ answerable: false, unanswerable: NO_FLOW_UNANSWERABLE }] });
  });

  it("an item is answerable when any of its holds is", () => {
    // t1's run stopped twice: one hold the row records (no flow named), one the reader found in its session.
    const row = stopped("t1", "sp1", { run: { sessionId: "run_x", requestId: "req_t1" } });
    const items = inboxItems({ rows: [row], suspensions: [found("sp9", { sessionId: "s_sp9", requestId: "req_t1", flowId: "asker" })], flowOf: () => undefined });
    expect(items).toHaveLength(1);
    expect(items[0]!.holds.map((h) => [h.id, h.answerable])).toEqual([["sp9", true], ["sp1", false]]);
    expect(items[0]).toMatchObject({ answerable: true, unanswerable: null });
  });
});

describe("the one answer call, routed by source, typed by what the hold asks", () => {
  const engine = () => {
    const answer = vi.fn(async () => ({}));
    const request = vi.fn(() => ({ answer }));
    const flow = vi.fn(() => ({ request }));
    return { answer, request, flow, inbox: createInboxClient({ flow } as unknown as Client) };
  };
  const itemAsking = (kind: "approval" | "input" | "review") =>
    inboxItems({ rows: [stopped("t1", "sp1", { holds: [mirror("req_t1", "sp1", kind)] })], suspensions: [], flowOf: flows })[0]!;

  it("an approval's yes and no go to the engine's answer route as approve and reject", async () => {
    const { answer, request, flow, inbox } = engine();
    await inbox.answer(itemAsking("approval"), { approved: true });
    await inbox.answer(itemAsking("approval"), { approved: false, data: { why: "not now" } });
    expect(flow).toHaveBeenCalledWith("asker");
    expect(request).toHaveBeenCalledWith("req_t1");
    expect(answer.mock.calls).toEqual([
      [{ suspensionId: "sp1", action: "approve" }],
      [{ suspensionId: "sp1", action: "reject", data: { why: "not now" } }],
    ]);
  });

  it("an input's or a review's value is submitted, and a skip skips", async () => {
    const { answer, inbox } = engine();
    await inbox.answer(itemAsking("input"), { value: "exports/2026-03.csv" });
    await inbox.answer(itemAsking("review"), { value: { verdict: "ship" } });
    await inbox.answer(itemAsking("input"), { skipped: true });
    expect(answer.mock.calls).toEqual([
      [{ suspensionId: "sp1", action: "submit", data: "exports/2026-03.csv" }],
      [{ suspensionId: "sp1", action: "submit", data: { verdict: "ship" } }],
      [{ suspensionId: "sp1", action: "skip" }],
    ]);
  });

  it("refuses an answer of another shape than the hold asks, and an unanswerable hold, writing nothing", async () => {
    const { answer, inbox } = engine();
    await expect(inbox.answer(itemAsking("approval"), { value: "yes" })).rejects.toThrow(/approval/);
    const [noFlow] = inboxItems({ rows: [stopped("t2", "sp2")], suspensions: [], flowOf: () => null });
    await expect(inbox.answer(noFlow!, { approved: true })).rejects.toThrow(NO_FLOW_UNANSWERABLE);
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("reconcileInbox", () => {
  const rows = [stopped("t1", "sp1"), stopped("t2", "sp2")];
  const lone = [found("lone")];
  const truth = truthOf(rows, lone);
  const items = inboxItems({ rows, suspensions: lone, flowOf: flows });

  it("is green on the list it should be", () => {
    expect(reconcileInbox(items, truth)).toEqual({ green: true, missing: [], duplicate: [], orphan: [], drift: [], unanswerable: [], reopened: [] });
  });

  it("control duplicate-item: an item listed twice", () => {
    expect(reconcileInbox([...items, items[0]!], truth)).toMatchObject({ green: false, duplicate: [items[0]!.id] });
  });

  it("control drop-row-holds: a list built without the rows misses every task's item", () => {
    const result = reconcileInbox(inboxItems({ rows: [], suspensions: lone, flowOf: flows }), truth);
    expect(result.green).toBe(false);
    expect(result.missing.sort()).toEqual([taskItemId(BOARD, "t1"), taskItemId(BOARD, "t2")]);
  });

  it("control mirror-skips-close: a row still holding a stop its resume ended is drift", () => {
    // t1's stop was answered: gone from the suspensions, still on its row.
    const answered = { ...truth, suspensions: truth.suspensions.filter((s) => s.suspensionId !== "sp1") };
    const result = reconcileInbox(items, answered);
    expect(result.green).toBe(false);
    expect(result.drift).toEqual([`hold sp1 on ${BOARD}:t1: no live stop`]);
  });

  it("control stale-item: a listed item still offering a stop its row no longer holds is drift", () => {
    // Listed while t1's run waited on sp1; since then sp1 ended and the run stopped again, on sp2.
    const now = [stopped("t1", "sp2"), stopped("t2", "sp2b")];
    const stale = inboxItems({ rows: [stopped("t1", "sp1"), stopped("t2", "sp2b")], suspensions: [], flowOf: flows });
    const result = reconcileInbox(stale, truthOf(now, []));
    expect(result.green).toBe(false);
    expect(result.drift).toEqual([`item ${taskItemId(BOARD, "t1")} shows sp1, its row holds sp2`]);
  });

  it("drift: a task run's stop with no hold on any row", () => {
    const unmirrored = { ...truth, rows: truth.rows.filter((r) => r.taskId !== "t2") };
    expect(reconcileInbox(items, unmirrored).drift).toEqual(["stop sp2: 0 open holds", `item ${taskItemId(BOARD, "t2")} shows sp2, its row holds none`]);
  });

  it("an item the truth doesn't hold is an orphan", () => {
    const extra = inboxItems({ rows, suspensions: [...lone, found("gone")], flowOf: flows });
    expect(reconcileInbox(extra, truth).orphan).toEqual(["gone"]);
  });

  it("the answerable clause fails on an item with no route", () => {
    const noRoute = inboxItems({ rows, suspensions: lone, flowOf: () => null });
    const result = reconcileInbox(noRoute, truth);
    expect(result.green).toBe(false);
    expect(result.unanswerable.map((u) => [u.id, u.hold]).sort()).toEqual([
      [taskItemId(BOARD, "t1"), "sp1"],
      [taskItemId(BOARD, "t2"), "sp2"],
    ]);
  });

  it("a second stop on the same task, after the first was answered, is not reopened: closure is the hold's", () => {
    // sp1 was approved and answered; the task's run then stopped again on sp2, under the same task item.
    const again = [stopped("t1", "sp2"), stopped("t2", "sp2b")];
    const listed = inboxItems({ rows: again, suspensions: lone, flowOf: flows });
    expect(listed.find((i) => i.task?.taskId === "t1")?.id).toBe(taskItemId(BOARD, "t1"));
    expect(reconcileInbox(listed, { ...truthOf(again, lone), closed: ["sp1"] })).toMatchObject({ green: true, reopened: [] });
  });

  it("control reopened: an answered hold back in a later read, in the list or in the truth alone, is red", () => {
    // sp1 closed, and listed again.
    expect(reconcileInbox(items, { ...truth, closed: ["sp1"] })).toMatchObject({ green: false, reopened: ["sp1"] });
    // Back in the independently read rows only, the list having dropped it.
    const listedWithout = inboxItems({ rows: [stopped("t2", "sp2")], suspensions: lone, flowOf: flows });
    expect(reconcileInbox(listedWithout, { ...truth, closed: ["sp1"] }).reopened).toEqual(["sp1"]);
  });

  it("control one-stop-two-items: a hold listed under two items is a duplicate, though the items' ids differ", () => {
    const t1 = items.find((i) => i.task?.taskId === "t1")!;
    const loneCopy = { ...t1, id: "sp1", task: null };
    expect(reconcileInbox([...items, loneCopy], truth).duplicate).toContain("sp1");
  });
});

describe("a task held on questions (row holds, FIX-2133)", () => {
  const question = (id: string, prompt: string, openedAt: number, kind: "question" | "confirm" = "question"): TaskHold => ({
    id,
    actor: "user",
    openedAt,
    source: { kind: "row", releasedBy: [{ by: "answer" }] },
    ask: { kind, prompt },
  });
  /** A task filed on questions: pending, held by them, answered through the desk's board. */
  const held = (id: string, holds: TaskHold[], over: Partial<InboxRow> = {}): InboxRow => ({
    board: BOARD,
    id,
    title: `do ${id}`,
    assignee: "ops.helper",
    status: "pending",
    holds,
    steers: [],
    holder: { sessionId: "s_desk", action: "updateTask_tasks" },
    ...over,
  });
  const desk = (sessionId: string) => (sessionId === "s_desk" ? "desk" : undefined);
  const csv = question("q1", "Which CSV export should the script read?", 10);
  const column = question("q2", "Which date column?", 20);

  it("lists one item per task with every open question, oldest first, answerable through the board as the user", () => {
    const [item, ...rest] = inboxItems({ rows: [held("t1", [column, csv])], suspensions: [], flowOf: desk });
    expect(rest).toEqual([]);
    expect(item).toMatchObject({ id: taskItemId(BOARD, "t1"), task: { taskId: "t1" }, since: 10, answerable: true });
    expect(item!.holds.map((h) => [h.id, h.ask.prompt, h.source])).toEqual([
      ["q1", csv.ask.prompt, { kind: "row", flowId: "desk", sessionId: "s_desk", action: "updateTask_tasks", taskId: "t1" }],
      ["q2", column.ask.prompt, { kind: "row", flowId: "desk", sessionId: "s_desk", action: "updateTask_tasks", taskId: "t1" }],
    ]);
  });

  it("an answered question leaves the item, by the steer that carries its id; the last one takes the item with it", () => {
    const one = held("t1", [csv, column], { steers: [{ id: "st1", answers: "q1" }] });
    expect(inboxItems({ rows: [one], suspensions: [], flowOf: desk })[0]!.holds.map((h) => h.id)).toEqual(["q2"]);
    const both = held("t1", [csv, column], { steers: [{ id: "st1", answers: "q1" }, { id: "st2", answers: "q2" }] });
    expect(inboxItems({ rows: [both], suspensions: [], flowOf: desk })).toEqual([]);
    // A steer that answers nothing answers nothing.
    expect(inboxItems({ rows: [held("t1", [csv], { steers: [{ id: "st9" }] })], suspensions: [], flowOf: desk })).toHaveLength(1);
  });

  it("a midway question lists on its running row; a finished row lists nothing, its questions closed with it", () => {
    expect(inboxItems({ rows: [held("t4", [column], { status: "in_progress" })], suspensions: [], flowOf: desk })).toHaveLength(1);
    expect(inboxItems({ rows: [held("t3", [csv], { status: "cancelled" })], suspensions: [], flowOf: desk })).toEqual([]);
  });

  it("a question whose board the reader can't place is listed, unanswerable, saying why", () => {
    const [item] = inboxItems({ rows: [held("t1", [csv], { holder: null })], suspensions: [], flowOf: desk });
    expect(item).toMatchObject({ answerable: false, unanswerable: NO_BOARD_UNANSWERABLE });
  });

  describe("the answer, through the board's updateTask on the board's session", () => {
    const board = (output: unknown) => {
      const send = vi.fn(async () => ({ id: "req_answer" }));
      const wait = vi.fn(async () => ({ status: "completed" }));
      const flow = vi.fn(() => ({ send, request: () => ({ wait }) }));
      const requests = vi.fn(async () => [{ id: "req_answer", result: { output } }]);
      return { send, flow, inbox: createInboxClient({ flow, sessions: { requests } } as unknown as Client) };
    };

    it("a question's words go as its message, naming the question, on the board's own session", async () => {
      const { send, flow, inbox } = board({ ok: true });
      const [item] = inboxItems({ rows: [held("t1", [csv, column])], suspensions: [], flowOf: desk });
      await inbox.answer(item!, { text: "The March export, exports/2026-03.csv" }, "q1");
      expect(flow).toHaveBeenCalledWith("desk");
      expect(send.mock.calls).toEqual([["updateTask_tasks", { id: "t1", question: "q1", message: "The March export, exports/2026-03.csv" }, { sessionId: "s_desk" }]]);
    });

    it("a confirm's yes or no goes as done, with its note as the message", async () => {
      const { send, inbox } = board({ ok: true });
      const go = question("c1", "Ship v2 once it builds?", 5, "confirm");
      const [item] = inboxItems({ rows: [held("t10", [go])], suspensions: [], flowOf: desk });
      expect(item!.holds[0]!.ask.kind).toBe("confirm");
      await inbox.answer(item!, { done: true });
      await inbox.answer(item!, { done: false, note: "not this week" });
      expect(send.mock.calls.map((call) => (call as unknown[])[1])).toEqual([
        { id: "t10", question: "c1", done: true },
        { id: "t10", question: "c1", done: false, message: "not this week" },
      ]);
    });

    it("rejects the board's refusal with its words, an answer of another shape, and an unanswerable hold", async () => {
      const { inbox, send } = board({ ok: false, error: 'question_answered: "q1" on task "t1" was already answered. Nothing was written.' });
      const [item] = inboxItems({ rows: [held("t1", [csv])], suspensions: [], flowOf: desk });
      await expect(inbox.answer(item!, { text: "again" })).rejects.toThrow(/question_answered/);
      await expect(inbox.answer(item!, { done: true })).rejects.toThrow(/question/);
      const [unplaced] = inboxItems({ rows: [held("t2", [csv], { holder: null })], suspensions: [], flowOf: desk });
      await expect(inbox.answer(unplaced!, { text: "x" })).rejects.toThrow(NO_BOARD_UNANSWERABLE);
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe("reconcileInbox, with row holds present", () => {
    const rows = [held("t1", [csv, column]), stopped("t9", "sp9")];
    const truth = truthOf(rows, []);
    const items = inboxItems({ rows, suspensions: [], flowOf: (s) => desk(s) ?? flows(s) });

    it("is green on the list it should be: the row's open questions and the task run's mirror", () => {
      expect(rowTruthOf(rows)).toEqual([
        { board: BOARD, taskId: "t1", suspensionHolds: [], rowHolds: ["q1", "q2"] },
        { board: BOARD, taskId: "t9", suspensionHolds: ["sp9"], rowHolds: [] },
      ]);
      expect(reconcileInbox(items, truth)).toMatchObject({ green: true });
    });

    it("control drop-row-holds: a list that drops the questions misses their task's item", () => {
      const dropped = inboxItems({ rows: rows.map((r) => ({ ...r, holds: (r.holds ?? []).filter((h) => h.source.kind !== "row") })), suspensions: [], flowOf: flows });
      const result = reconcileInbox(dropped, truth);
      expect(result.green).toBe(false);
      expect(result.missing).toEqual([taskItemId(BOARD, "t1")]);
    });

    it("an answered question still listed is drift, and a closed one back is reopened", () => {
      const answered = [held("t1", [csv, column], { steers: [{ id: "st1", answers: "q1" }] }), stopped("t9", "sp9")];
      const result = reconcileInbox(items, { ...truthOf(answered, []), closed: ["q1"] });
      expect(result.green).toBe(false);
      expect(result.drift).toEqual([`item ${taskItemId(BOARD, "t1")} shows q1, q2, its row holds q2`]);
      expect(result.reopened).toEqual(["q1"]);
    });
  });
});

describe("suspensionTruthOf: what a session's suspended requests record", () => {
  const request = (id: string, source: string, items: unknown[], status: SessionRequestSummary["status"] = "suspended") =>
    ({ id, flowKind: "f", actionName: "a", userId: "u", source, status, items, createdAt: 0, updatedAt: 0 }) as unknown as SessionRequestSummary;

  it("keeps a user's pending stop, marks a task run's, and drops a resumed one, another reason and another status", () => {
    const requests = [
      request("r1", "task", [
        { type: "suspension", suspensionId: "a", reason: "human_approval" },
        { type: "suspension", suspensionId: "b", reason: "human_input" },
        { type: "suspension_resume", suspensionId: "b" },
        { type: "suspension", suspensionId: "c", reason: "external_event" },
      ]),
      request("r2", "http", [{ type: "suspension", suspensionId: "d", reason: "human_input" }]),
      request("r3", "http", [{ type: "suspension", suspensionId: "e", reason: "human_input" }], "completed"),
    ];
    expect(suspensionTruthOf("s", requests)).toEqual([
      { suspensionId: "a", sessionId: "s", requestId: "r1", taskRun: true },
      { suspensionId: "d", sessionId: "s", requestId: "r2", taskRun: false },
    ]);
  });
});
