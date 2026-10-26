/**
 * The Chief of Staff view's pure parts: where Shift Manager lands (V1, BR-1),
 * which worker is the chief of staff (V2, D2, BR-10 to BR-12), the shift
 * summary's numbers (V3; D1, BR-4), and which session
 * is the user's conversation with it (V4, BR-14).
 */
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@flow-state-dev/client";
import { chiefOfStaffOf, shiftSummary, type LoadedSnapshot } from "../src/lib/derive";
import { conversationAt } from "../src/lib/conversation";
import { parseRoute, pathFor, type Route } from "../src/lib/routes";
import { GENERAL_TEAM, inboxSection, toWorker, type Ask, type BoardRow, type Worker } from "../src/lib/reads";

const ORG = "org_1";
const worker = (id: string, door: string | null = "run"): Worker => ({ ...toWorker({ id, kind: "agent", door })! });

describe("landing (V1, BR-1)", () => {
  it("opens Chief of Staff at /, at /cos and at any path Shift Manager doesn't know", () => {
    // `/w/…` is no level Shift Manager knows, so it lands here too.
    for (const path of ["/", "/cos", "/nowhere", "/cos/extra", "/w", "/w/ops.desk/stream"]) {
      expect(parseRoute(path), path).toEqual({ level: "cos" });
    }
    expect(pathFor({ level: "cos" })).toBe("/cos");
  });

  it("keeps Inbox at /inbox, and every other route round-trips as before", () => {
    const routes: Route[] = [
      { level: "inbox", item: null },
      { level: "inbox", item: "susp 1" },
      { level: "tasks", by: "state" },
      { level: "tasks", by: "worker" },
      { level: "task", boardRef: "s_1.tasks", taskId: "t-1", tab: "diff" },
      { level: "project", projectId: "web", tab: "brief" },
      { level: "resource", sessionId: "s_1", ref: "runbook" },
      { level: "cos" },
    ];
    for (const route of routes) {
      const path = pathFor(route);
      const q = path.indexOf("?");
      expect(parseRoute(q < 0 ? path : path.slice(0, q), q < 0 ? "" : path.slice(q)), path).toEqual(route);
    }
  });
});

describe("which worker is the chief of staff (V2, D2)", () => {
  it("finds an org worker and a team's worker by its name", () => {
    expect(chiefOfStaffOf([worker("chief-of-staff"), worker("ops.asker")])).toEqual({ kind: "one", worker: worker("chief-of-staff") });
    expect(chiefOfStaffOf([worker("desk.chief-of-staff"), worker("desk.asker")])).toEqual({ kind: "one", worker: worker("desk.chief-of-staff") });
  });

  it("is several, and no guess, when two workers carry the name", () => {
    expect(chiefOfStaffOf([worker("chief-of-staff"), worker("desk.chief-of-staff")])).toEqual({
      kind: "several",
      workers: [worker("chief-of-staff"), worker("desk.chief-of-staff")],
    });
    expect(chiefOfStaffOf([worker("desk.chief-of-staff"), worker("ops.chief-of-staff")]).kind).toBe("several");
  });

  it("is none when no worker carries exactly the name", () => {
    expect(chiefOfStaffOf([])).toEqual({ kind: "none" });
    expect(chiefOfStaffOf([worker("desk.chief-of-staffs"), worker("chief"), worker("desk.chief"), worker("chief-of-staff.asker")])).toEqual({
      kind: "none",
    });
  });

  it("reads an org worker's row, which has no team, without error", () => {
    expect(toWorker({ id: "chief-of-staff", kind: "agent", door: "run" })).toEqual({
      id: "chief-of-staff",
      kind: "agent",
      door: "run",
      rules: false,
      team: GENERAL_TEAM,
      teamName: "General",
      name: "chief-of-staff",
      displayName: "chief-of-staff",
    });
  });
});

// ---- the summary -----------------------------------------------------------------

const row = (holderSessionId: string, id: string, status: string): BoardRow => ({
  boardRef: `${holderSessionId}.tasks`,
  holderSessionId,
  id,
  title: id,
  goal: null,
  status,
  assignee: null,
  priority: null,
  labels: [],
  deps: [],
  run: null,
  error: null,
  holds: [],
  steers: [],
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
});

const ask = (workerId: string, suspensionId: string): Ask => ({
  sessionId: `s_${suspensionId}`,
  workerId,
  flowId: workerId,
  parentSessionId: null,
  kind: "approval",
  item: { suspensionId } as Ask["item"],
  since: 0,
  unanswerable: null,
});

function snapshotOf(over: Partial<LoadedSnapshot> = {}): LoadedSnapshot {
  const read: Omit<LoadedSnapshot, "inbox"> = {
    readAt: 0,
    sessions: [],
    orgId: ORG,
    inventory: {
      ok: true,
      value: {
        workers: [worker("ops.a"), worker("ops.b"), worker("ops.c")],
      },
    },
    projects: { ok: true, value: { rows: [] } },
    boards: {
      s_desk: { ok: true, value: { refs: ["s_desk.tasks"], rows: [row("s_desk", "1", "in_progress"), row("s_desk", "2", "in_progress"), row("s_desk", "3", "pending")] } },
      s_side: { ok: true, value: { refs: ["s_side.tasks"], rows: [row("s_side", "4", "in_progress"), row("s_side", "5", "completed")] } },
    },
    asks: { ok: true, value: [ask("ops.a", "x"), ask("ops.c", "y"), ask("ops.a", "z")] },
    resources: { ok: true, value: [] },
    ...over,
  };
  return { ...read, inbox: inboxSection(read.asks, read.boards, read.sessions) };
}

describe("the shift summary (V3; D1, BR-4, BR-7, BR-8)", () => {
  it("counts the pending asks, the running rows and the boards they run on, from the snapshot", () => {
    const summary = shiftSummary(snapshotOf());
    expect(summary.asks).toEqual(snapshotOf().asks);
    expect(summary.running).toEqual({ ok: true, value: { runs: 3, workstreams: 2 } });
  });

  it("still counts what is running when nothing needs the user", () => {
    const summary = shiftSummary(snapshotOf({ asks: { ok: true, value: [] } }));
    expect(summary.asks).toEqual({ ok: true, value: [] });
    expect(summary.running).toEqual({ ok: true, value: { runs: 3, workstreams: 2 } });
  });

  it("carries a failed read as that line's failure, and the other line whole", () => {
    const failure = { message: "store offline", httpStatus: 503 };
    const noAsks = shiftSummary(snapshotOf({ asks: { ok: false, failure } }));
    expect(noAsks.asks).toEqual({ ok: false, failure });
    expect(noAsks.running.ok).toBe(true);
    const noBoard = shiftSummary(snapshotOf({ boards: { ...snapshotOf().boards, s_side: { ok: false, failure } } }));
    expect(noBoard.running).toEqual({ ok: false, failure });
    expect(noBoard.asks.ok).toBe(true);
  });
});

// A worker's proposal waiting on approval is a task held on its question: it
// needs the user as much as a suspension does. What needs the user is what the
// Inbox lists, one item per task, so the summary counts the Inbox, never the
// tasks and the asks side by side (FIX-1972, FIX-2131).
describe("what needs the user, in the shift summary (FIX-2131)", () => {
  const heldOnQuestion = (holder: string, id: string, extra: Partial<BoardRow> = {}): BoardRow => ({
    ...row(holder, id, "in_progress"),
    assignee: "eng.coder",
    holds: [
      {
        id: `q-${id}`,
        actor: "user",
        openedAt: 1,
        source: { kind: "row", releasedBy: [{ by: "answer" }] },
        ask: { kind: "question", prompt: "Approve the plan to merge the rounding copies?" },
      },
    ] as BoardRow["holds"],
    ...extra,
  });

  it("is the Inbox's list: a task held on a question is one item, beside the asks no task holds", () => {
    const waiting = heldOnQuestion("s_side", "6");
    const snapshot = snapshotOf({ boards: { ...snapshotOf().boards, s_side: { ok: true, value: { refs: ["s_side.tasks"], rows: [waiting, row("s_side", "7", "completed")] } } } });
    const summary = shiftSummary(snapshot);
    expect(summary.inbox).toBe(snapshot.inbox);
    const items = summary.inbox.ok ? summary.inbox.value : [];
    expect(items.filter((item) => item.task?.taskId === "6")).toHaveLength(1);
    expect(items).toHaveLength(snapshotOf().asks.ok ? 3 + 1 : 0);
  });

  it("counts a task once when its run also holds one of the asks", () => {
    const pendingAsk = { ...ask("eng.coder", "q"), sessionId: "s_run", item: { suspensionId: "q", requestId: "r", taskId: "6" } as Ask["item"] };
    const held = heldOnQuestion("s_side", "6", { run: { sessionId: "s_run", requestId: "r", attempt: 1 } });
    const summary = shiftSummary(
      snapshotOf({
        asks: { ok: true, value: [pendingAsk] },
        boards: { s_side: { ok: true, value: { refs: ["s_side.tasks"], rows: [held] } } },
      }),
    );
    expect(summary.inbox.ok && summary.inbox.value.map((item) => item.task?.taskId ?? null)).toEqual(["6"]);
  });

  it("fails as its own line when a board didn't load", () => {
    const failure = { message: "store offline", httpStatus: 503 };
    const summary = shiftSummary(snapshotOf({ boards: { ...snapshotOf().boards, s_side: { ok: false, failure } } }));
    expect(summary.inbox.ok).toBe(false);
    expect(summary.asks.ok).toBe(true);
  });
});

describe("the user's conversation with a worker (V4, BR-14, FIX-1989)", () => {
  const session = (id: string, createdAt: number, parentSessionId?: string): SessionSummary =>
    ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "desk.chief-of-staff" }, userId: "u", createdAt, updatedAt: createdAt, ...(parentSessionId === undefined ? {} : { parentSessionId }) }) as SessionSummary;

  it("is the session at the worker's derived address once the listing holds it, never a newer one at another id", () => {
    // A message opens the derived conversation, so the view must be on it, whatever else the user opened.
    expect(conversationAt([session("wks_derived", 1), session("conv_random", 9)], "wks_derived", null)).toBe("wks_derived");
    expect(conversationAt([session("conv_random", 9)], "wks_derived", null)).toBeNull();
    expect(conversationAt([session("conv_random", 9)], null, null)).toBeNull();
  });

  it("is the session a first line opened, before the listing holds it", () => {
    expect(conversationAt([], "wks_derived", "wks_derived")).toBe("wks_derived");
  });
});
