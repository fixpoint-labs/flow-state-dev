/**
 * The Shift Coordinator view's pure parts: where Shift Manager lands (V1, BR-1),
 * which worker is the Shift Coordinator (V2, D2, BR-10 to BR-12), the shift
 * summary's numbers (V3; D1, BR-4), and which session
 * is the user's conversation with it (V4, BR-14).
 */
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@flow-state-dev/client";
import { inboxItems, taskActionName } from "@flow-state-dev/orchestration/inbox";
import type { InboxAsk, InboxViewValue } from "../src/lib/inbox";
import { shiftSummary } from "../src/lib/tasks";
import { shiftCoordinatorOf } from "../src/lib/shift";
import { conversationAt } from "../src/lib/conversation";
import { parseRoute, pathFor, type Route } from "../src/lib/routes";
import type { BoardTaskView } from "../src/lib/boards";
import type { Worker } from "../src/lib/workers";
import { GENERAL_TEAM, toWorker } from "../src/lib/workers";

const worker = (id: string, door: string | null = "run"): Worker => ({ ...toWorker({ id, kind: "agent", door })! });

describe("landing (V1, BR-1)", () => {
  it("opens Shift Coordinator at /, at /shift-coordinator and at any path Shift Manager doesn't know", () => {
    // `/w/…` is no level Shift Manager knows, so it lands here too.
    for (const path of ["/", "/shift-coordinator", "/nowhere", "/shift-coordinator/extra", "/w", "/w/ops.desk/stream"]) {
      expect(parseRoute(path), path).toEqual({ level: "shift-coordinator" });
    }
    expect(pathFor({ level: "shift-coordinator" })).toBe("/shift-coordinator");
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
      { level: "shift-coordinator" },
    ];
    for (const route of routes) {
      const path = pathFor(route);
      const q = path.indexOf("?");
      expect(parseRoute(q < 0 ? path : path.slice(0, q), q < 0 ? "" : path.slice(q)), path).toEqual(route);
    }
  });
});

describe("which worker is the Shift Coordinator (V2, D2)", () => {
  it("finds an org worker and a team's worker by its name", () => {
    expect(shiftCoordinatorOf([worker("shift-coordinator"), worker("ops.asker")])).toEqual({ kind: "one", worker: worker("shift-coordinator") });
    expect(shiftCoordinatorOf([worker("desk.shift-coordinator"), worker("desk.asker")])).toEqual({ kind: "one", worker: worker("desk.shift-coordinator") });
  });

  it("is several, and no guess, when two workers carry the name", () => {
    expect(shiftCoordinatorOf([worker("shift-coordinator"), worker("desk.shift-coordinator")])).toEqual({
      kind: "several",
      workers: [worker("shift-coordinator"), worker("desk.shift-coordinator")],
    });
    expect(shiftCoordinatorOf([worker("desk.shift-coordinator"), worker("ops.shift-coordinator")]).kind).toBe("several");
  });

  it("is none when no worker carries exactly the name", () => {
    expect(shiftCoordinatorOf([])).toEqual({ kind: "none" });
    expect(shiftCoordinatorOf([worker("desk.shift-coordinators"), worker("chief"), worker("desk.chief"), worker("shift-coordinator.asker")])).toEqual({
      kind: "none",
    });
  });

  it("reads an org worker's entry, which has no team, without error", () => {
    expect(toWorker({ id: "shift-coordinator", kind: "agent", door: "run" })).toEqual({
      id: "shift-coordinator",
      kind: "agent",
      door: "run",
      rules: false,
      doorTakesTask: false,
      team: GENERAL_TEAM,
      teamName: "General",
      name: "shift-coordinator",
      displayName: "shift-coordinator",
    });
  });
});

// ---- the summary -----------------------------------------------------------------

const row = (ownerSessionId: string, id: string, status: string): BoardTaskView => ({
  boardRef: `${ownerSessionId}.tasks`,
  ownerSessionId,
  id,
  title: id,
  goal: null,
  context: null,
  attachments: [],
  status,
  assignee: null,
  priority: null,
  labels: [],
  deps: [],
  run: null,
  error: null,
  holds: [],
  steers: [],
  spend: null,
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
});

type AskAt = { suspensionId: string; workerId: string; sessionId?: string; requestId?: string };
const ask = (workerId: string, suspensionId: string): AskAt => ({ workerId, suspensionId });

const DESK_AND_SIDE = [
  row("s_desk", "1", "in_progress"),
  row("s_desk", "2", "in_progress"),
  row("s_desk", "3", "pending"),
  row("s_side", "4", "in_progress"),
  row("s_side", "5", "completed"),
];
const THREE_ASKS = [ask("ops.a", "x"), ask("ops.c", "y"), ask("ops.a", "z")];

/**
 * The inbox view's answer over `tasks` and the asks, as the server builds it:
 * orchestration's list over the rows (each answered on its conversation's
 * board) and the asks, a task's run's ask claimed by its row.
 */
function viewOf(tasks: BoardTaskView[], asks: AskAt[] = THREE_ASKS): InboxViewValue {
  return {
    tasks: tasks.map((r) => ({ ...r, owner: r.ownerSessionId })),
    items: inboxItems<InboxAsk>({
      rows: tasks.map((r) => ({ ...r, board: r.boardRef, holder: { sessionId: r.ownerSessionId, action: taskActionName("updateTask", "tasks") } })),
      suspensions: asks.map((at) => {
        const sessionId = at.sessionId ?? `s_${at.suspensionId}`;
        const requestId = at.requestId ?? `req_${at.suspensionId}`;
        return {
          sessionId,
          flowId: at.workerId,
          requestId,
          suspensionId: at.suspensionId,
          kind: "approval",
          prompt: "ok?",
          since: 0,
          detail: { ...at, sessionId, requestId, flowKind: at.workerId, kind: "approval", message: "ok?", createdAt: 0, shape: "approval" } as unknown as InboxAsk,
        };
      }),
      flowOf: () => "coordinator",
    }),
  };
}

describe("the shift summary (V3; D1, BR-4, BR-7, BR-8)", () => {
  it("counts the pending asks, the running rows and the boards they run on, from the inbox view", () => {
    const summary = shiftSummary(viewOf(DESK_AND_SIDE));
    expect(summary.needsYou).toBe(THREE_ASKS.length);
    expect(summary.running).toEqual({ runs: 3, workstreams: 2 });
  });

  it("still counts what is running when nothing needs the user", () => {
    const summary = shiftSummary(viewOf(DESK_AND_SIDE, []));
    expect(summary.needsYou).toBe(0);
    expect(summary.running).toEqual({ runs: 3, workstreams: 2 });
  });
});

// A worker's proposal waiting on approval is a task held on its question: it
// needs the user as much as a suspension does. What needs the user is what the
// Inbox lists, one item per task, so the summary counts the Inbox, never the
// tasks and the asks side by side (FIX-1972, FIX-2131).
describe("what needs the user, in the shift summary (FIX-2131)", () => {
  const heldOnQuestion = (holder: string, id: string, extra: Partial<BoardTaskView> = {}): BoardTaskView => ({
    ...row(holder, id, "in_progress"),
    assignee: "eng.coder",
    holds: [
      {
        id: `q-${id}`,
        actor: "user",
        openedAt: 1,
        source: { kind: "task", closedBy: [{ by: "answer" }] },
        ask: { kind: "question", prompt: "Approve the plan to merge the rounding copies?" },
      },
    ] as BoardTaskView["holds"],
    ...extra,
  });

  it("is the Inbox's list: a task held on a question is one item, beside the asks no task holds", () => {
    const waiting = heldOnQuestion("s_side", "6");
    const view = viewOf([...DESK_AND_SIDE.filter((r) => r.ownerSessionId !== "s_side"), waiting, row("s_side", "7", "completed")]);
    expect(view.items.filter((item) => item.task?.taskId === "6")).toHaveLength(1);
    expect(shiftSummary(view).needsYou).toBe(view.items.length);
    expect(shiftSummary(view).needsYou).toBe(THREE_ASKS.length + 1);
  });

  it("counts a task once when its run also holds one of the asks", () => {
    const held = heldOnQuestion("s_side", "6", { run: { sessionId: "s_run", requestId: "r", attempt: 1 } });
    const view = viewOf([held], [{ ...ask("eng.coder", "q"), sessionId: "s_run", requestId: "r" }]);
    expect(view.items.map((item) => item.task?.taskId ?? null)).toEqual(["6"]);
    expect(shiftSummary(view).needsYou).toBe(1);
  });
});

describe("the user's conversation with a worker (V4, BR-14, FIX-1989)", () => {
  const session = (id: string, createdAt: number, parentSessionId?: string): SessionSummary =>
    ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "desk.shift-coordinator" }, userId: "u", createdAt, updatedAt: createdAt, ...(parentSessionId === undefined ? {} : { parentSessionId }) }) as SessionSummary;

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
