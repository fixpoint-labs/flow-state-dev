/**
 * The Chief of Staff view's pure parts: where Shift Manager lands (V1, BR-1),
 * which worker is the chief of staff (V2, D2, BR-10 to BR-12), the shift
 * summary's numbers (V3; D1, BR-4), and which session
 * is the user's conversation with it (V4, BR-14).
 */
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@flow-state-dev/client";
import { chiefOfStaffOf, shiftSummary, type LoadedSnapshot } from "../src/lib/derive";
import { conversationSession, currentConversation, newConversationId } from "../src/lib/conversation";
import { parseRoute, pathFor, type Route } from "../src/lib/routes";
import { STAFF_TEAM, toBoardRow, toWorker, type Ask, type BoardRow, type Worker } from "../src/lib/reads";

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
      { level: "inbox", suspensionId: null },
      { level: "inbox", suspensionId: "susp 1" },
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
      team: STAFF_TEAM,
      name: "chief-of-staff",
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
  return {
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

// A worker's proposal waiting on approval is a task parked on its question: it
// needs the user as much as a suspension does, so the summary lists it rather
// than letting it vanish from "what needs you" (FIX-1972).
describe("the tasks waiting on the user, in the shift summary", () => {
  const parked = (holder: string, id: string, extra: Partial<BoardRow> = {}): BoardRow => ({
    ...row(holder, id, "parked"),
    assignee: "eng.coder",
    question: "Approve the plan to merge the rounding copies?",
    ...extra,
  });

  it("lists every parked row, with its question, beside the asks", () => {
    const waiting = parked("s_side", "6");
    const summary = shiftSummary(
      snapshotOf({ boards: { ...snapshotOf().boards, s_side: { ok: true, value: { refs: ["s_side.tasks"], rows: [waiting, row("s_side", "7", "completed")] } } } }),
    );
    expect(summary.parked).toEqual({ ok: true, value: [waiting] });
    expect(summary.asks).toEqual(snapshotOf().asks);
  });

  it("leaves out a parked row whose run holds one of the asks, which already counts it", () => {
    const pendingAsk = { ...ask("eng.coder", "q"), sessionId: "s_run", item: { suspensionId: "q", taskId: "6" } as Ask["item"] };
    const held = parked("s_side", "6", { run: { sessionId: "s_run", requestId: "r", attempt: 1 } });
    const summary = shiftSummary(
      snapshotOf({
        asks: { ok: true, value: [pendingAsk] },
        boards: { s_side: { ok: true, value: { refs: ["s_side.tasks"], rows: [held] } } },
      }),
    );
    expect(summary.parked).toEqual({ ok: true, value: [] });
  });

  it("reads a row's question only when it is parked on one", () => {
    const base = { id: "6", title: "plan", status: "parked", feedback: "Approve the plan?" };
    expect(toBoardRow("s.tasks", "s", "6", { ...base, parkedOnQuestion: true }).question).toBe("Approve the plan?");
    expect(toBoardRow("s.tasks", "s", "6", base)).not.toHaveProperty("question");
  });

  it("leaves out a park that waits on workers, not on a question for the user", () => {
    const pieces = parked("s_side", "8");
    delete pieces.question;
    const summary = shiftSummary(snapshotOf({ boards: { s_side: { ok: true, value: { refs: ["s_side.tasks"], rows: [pieces] } } } }));
    expect(summary.parked).toEqual({ ok: true, value: [] });
  });

  it("fails as its own line when a board didn't load", () => {
    const failure = { message: "store offline", httpStatus: 503 };
    const summary = shiftSummary(snapshotOf({ boards: { ...snapshotOf().boards, s_side: { ok: false, failure } } }));
    expect(summary.parked).toEqual({ ok: false, failure });
    expect(summary.asks.ok).toBe(true);
  });
});

describe("the user's conversation with the chief of staff (V4, BR-14)", () => {
  const cos = worker("desk.chief-of-staff");
  const session = (id: string, workerId: string | undefined, createdAt: number, parentSessionId?: string, flowKind = "agent"): SessionSummary =>
    ({ id, flowKind, flowId: flowKind, ...(workerId === undefined ? {} : { state: { workerId } }), userId: "u", createdAt, updatedAt: createdAt, ...(parentSessionId === undefined ? {} : { parentSessionId }) }) as SessionSummary;

  it("is the newest session on the worker's flow, naming its worker, that no other run started", () => {
    const sessions = [
      session("old", "desk.chief-of-staff", 1),
      session("newest", "desk.chief-of-staff", 3),
      session("heard", "desk.chief-of-staff", 9, "desk.front"),
      session("other", "desk.asker", 10),
      session("mid", "desk.chief-of-staff", 2),
      // The worker's id on another flow, and a session on its flow that names no worker.
      session("elsewhere", "desk.chief-of-staff", 11, undefined, "em"),
      session("nobody", undefined, 12),
    ];
    expect(conversationSession(sessions, cos)).toBe("newest");
  });

  it("is never a session another run started, and none when there is no direct one", () => {
    expect(conversationSession([session("heard", "desk.chief-of-staff", 9, "desk.front")], cos)).toBeNull();
    // A store that nulls absent keys hands back `null` for a direct session's parent.
    expect(conversationSession([{ ...session("direct", "desk.chief-of-staff", 1), parentSessionId: null } as unknown as SessionSummary], cos)).toBe(
      "direct",
    );
    expect(conversationSession([], cos)).toBeNull();
  });
});

describe("which conversation the view is on, once a line opened one (V4, BR-14)", () => {
  const cos = worker("desk.chief-of-staff");
  const session = (id: string, createdAt: number): SessionSummary =>
    ({ id, flowKind: "agent", flowId: "agent", state: { workerId: "desk.chief-of-staff" }, userId: "u", createdAt, updatedAt: createdAt }) as SessionSummary;

  it("keeps the session a first line opened until the listing holds it", () => {
    expect(currentConversation([], cos, "cos_new")).toBe("cos_new");
    expect(currentConversation([session("older", 1)], cos, "cos_new")).toBe("cos_new");
  });

  it("follows the newest direct session once the listing has caught up, even one started elsewhere", () => {
    expect(currentConversation([session("cos_new", 2)], cos, "cos_new")).toBe("cos_new");
    expect(currentConversation([session("cos_new", 2), session("from_another_tab", 3)], cos, "cos_new")).toBe("from_another_tab");
    expect(currentConversation([session("listed", 1)], cos, null)).toBe("listed");
  });
});

describe("a new conversation's id", () => {
  it("is minted without crypto.randomUUID, which a page on plain HTTP doesn't have", () => {
    const real = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
    try {
      const a = newConversationId();
      const b = newConversationId();
      expect(a).toMatch(/^conv_[0-9a-f]{32}$/);
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true, writable: true });
    }
  });
});
