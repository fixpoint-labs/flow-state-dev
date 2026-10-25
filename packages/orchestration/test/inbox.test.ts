/**
 * The Inbox read (`src/inbox`): one item type over what holds a task for the
 * user, its one answer call, and the check that a list is the list it should be.
 *
 * The check is worth something only if it fails when the list is wrong, so
 * each clause has a control that breaks the list one way and must turn it red:
 * a duplicated item, the row holds dropped, a mirror the resume left open, an
 * item with no route, a closed item back.
 */
import { describe, expect, it, vi } from "vitest";
import type { Client, SessionRequestSummary } from "@flow-state-dev/client";
import {
  createInboxClient,
  inboxItems,
  NO_FLOW_UNANSWERABLE,
  reconcileInbox,
  rowTruthOf,
  suspensionTruthOf,
  taskItemId,
  type InboxRow,
  type InboxSuspension,
  type InboxTruth,
} from "../src/inbox";

const BOARD = "s_desk.tasks";

/** A running task row whose run stopped for the user, as FIX-2129 records it. */
const stopped = (id: string, suspensionId: string, over: Partial<InboxRow> = {}): InboxRow => ({
  board: BOARD,
  id,
  title: `do ${id}`,
  assignee: "ops.helper",
  status: "in_progress",
  updatedAt: 100,
  run: { sessionId: `run_${id}`, requestId: `req_${id}` },
  waitingFor: { requestId: `req_${id}`, suspensionId, kind: "approval", prompt: `Approve ${id}?` },
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
      ...rows.flatMap((r) => (r.waitingFor == null || r.run == null ? [] : [{ suspensionId: r.waitingFor.suspensionId, sessionId: r.run.sessionId, requestId: r.waitingFor.requestId, taskRun: true }])),
      ...lone.map((s) => ({ suspensionId: s.suspensionId, sessionId: s.sessionId, requestId: s.requestId, taskRun: false })),
    ],
  };
}

describe("inboxItems: one item type", () => {
  it("lists a task run's stop once, from its row, even when its session holds it too", () => {
    const rows = [stopped("t1", "sp1")];
    // The run's session holds the same stop: the reader found it there as well.
    const items = inboxItems({ rows, suspensions: [found("sp1", { sessionId: "run_t1", requestId: "req_t1", detail: "the card" }), found("lone")], flowOf: flows });
    expect(items.map((i) => [i.id, i.source, i.task?.taskId ?? null])).toEqual([
      ["lone", "suspension", null],
      [taskItemId(BOARD, "t1"), "suspension", "t1"],
    ]);
    const held = items[1]!;
    expect(held.holds).toEqual([
      {
        id: "sp1",
        source: { kind: "suspension", flowId: "asker", sessionId: "run_t1", requestId: "req_t1", suspensionId: "sp1" },
        ask: { kind: "approval", prompt: "Approve t1?" },
        openedAt: 100,
        detail: "the card",
      },
    ]);
    expect(held.answerable).toBe(true);
  });

  it("keeps listing a stop while a notice or steer turn runs: admission clears waitingOn, keeps waitingFor", () => {
    // `admitClaimedTask` for a turn that is not the task's own: `waitingOn` cleared, `waitingFor` kept, still running.
    const turning = { ...stopped("t1", "sp1"), waitingOn: null };
    const items = inboxItems({ rows: [turning], suspensions: [found("sp1", { sessionId: "run_t1", requestId: "req_t1" })], flowOf: flows });
    expect(items.map((i) => [i.id, i.answerable])).toEqual([[taskItemId(BOARD, "t1"), true]]);
    expect(rowTruthOf([turning])).toEqual([{ board: BOARD, taskId: "t1", suspensionHolds: ["sp1"] }]);
  });

  it("skips a suspension in a task's open run even when the row records no stop yet", () => {
    const row = stopped("t1", "sp1", { waitingFor: null });
    expect(inboxItems({ rows: [row], suspensions: [found("sp1", { requestId: "req_t1" })], flowOf: flows })).toEqual([]);
  });

  it("lists nothing for a row that holds nothing, a finished one, or one not running", () => {
    const rows = [
      stopped("idle", "x", { waitingFor: null }),
      stopped("done", "y", { status: "completed" }),
      stopped("queued", "z", { status: "pending" }),
    ];
    expect(inboxItems({ rows, suspensions: [], flowOf: flows })).toEqual([]);
  });

  it("names a run's flow from the stop the reader found when no listed session does", () => {
    const [item] = inboxItems({ rows: [stopped("t1", "sp1")], suspensions: [found("sp1", { flowId: "worker-flow" })], flowOf: () => undefined });
    expect(item).toMatchObject({ answerable: true, holds: [{ source: { flowId: "worker-flow" } }] });
  });

  it("an item whose session names no flow is listed, unanswerable, saying why", () => {
    const [item] = inboxItems({ rows: [stopped("t1", "sp1")], suspensions: [], flowOf: () => null });
    expect(item).toMatchObject({ answerable: false, unanswerable: NO_FLOW_UNANSWERABLE });
  });
});

describe("the one answer call, routed by source", () => {
  it("answers a suspension hold through the run's flow and request, and refuses an unanswerable one", async () => {
    const answer = vi.fn(async () => ({}));
    const request = vi.fn(() => ({ answer }));
    const flow = vi.fn(() => ({ request }));
    const inbox = createInboxClient({ flow } as unknown as Client);
    const [item] = inboxItems({ rows: [stopped("t1", "sp1")], suspensions: [], flowOf: flows });
    await inbox.answer(item!, { action: "approve" });
    expect(flow).toHaveBeenCalledWith("asker");
    expect(request).toHaveBeenCalledWith("req_t1");
    expect(answer).toHaveBeenCalledWith({ suspensionId: "sp1", action: "approve" });

    const [noFlow] = inboxItems({ rows: [stopped("t2", "sp2")], suspensions: [], flowOf: () => null });
    await expect(inbox.answer(noFlow!, { action: "approve" })).rejects.toThrow(NO_FLOW_UNANSWERABLE);
    expect(answer).toHaveBeenCalledTimes(1);
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
    expect(reconcileInbox(items, unmirrored).drift).toEqual(["stop sp2: 0 open holds"]);
  });

  it("an item the truth doesn't hold is an orphan", () => {
    const extra = inboxItems({ rows, suspensions: [...lone, found("gone")], flowOf: flows });
    expect(reconcileInbox(extra, truth).orphan).toEqual(["gone"]);
  });

  it("the answerable clause fails on an item with no route", () => {
    const noRoute = inboxItems({ rows, suspensions: lone, flowOf: () => null });
    const result = reconcileInbox(noRoute, truth);
    expect(result.green).toBe(false);
    expect(result.unanswerable.map((u) => u.id).sort()).toEqual([taskItemId(BOARD, "t1"), taskItemId(BOARD, "t2")]);
  });

  it("an answered or cancelled item back in a later read, in the list or the truth, is reopened", () => {
    const id = taskItemId(BOARD, "t1");
    expect(reconcileInbox(items, { ...truth, closed: [id] }).reopened).toEqual([id]);
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
