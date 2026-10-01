/**
 * The Chief of Staff view's pure parts: where Shift Manager lands (V1, BR-1),
 * which seat is the chief of staff (V2, D2, BR-10 to BR-12), the shift
 * summary's and the rail's numbers (V3, V7; D1, BR-4, BR-19), and which session
 * is the person's conversation with it (V4, BR-14).
 */
import { describe, expect, it } from "vitest";
import type { SessionSummary } from "@flow-state-dev/client";
import { chiefOfStaffOf, shiftSummary, streamCounts, type LoadedSnapshot } from "../src/lib/derive";
import { conversationSession, currentConversation, newConversationId } from "../src/lib/cos";
import { parseRoute, pathFor, type Route } from "../src/lib/routes";
import { toSeat, type Ask, type BoardRow, type Seat } from "../src/lib/reads";

const ORG = "org_1";
const seat = (id: string, door: string | null = "run"): Seat => ({ ...toSeat({ id, kind: "agent", door })! });

describe("landing (V1, BR-1)", () => {
  it("opens Chief of Staff at /, at /cos and at any path Shift Manager doesn't know", () => {
    for (const path of ["/", "/cos", "/nowhere", "/cos/extra", "/w"]) {
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
      { level: "task", boardRef: "ops.desk.work", taskId: "t-1", tab: "diff" },
      { level: "workstream", channelId: "ops.desk", tab: "board" },
      { level: "project", projectId: "unassigned", tab: "brief" },
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

describe("which seat is the chief of staff (V2, D2)", () => {
  it("finds an org seat and a team's seat by the name after the org's address", () => {
    expect(chiefOfStaffOf([seat("chief-of-staff"), seat("ops.asker")], ORG)).toEqual({ kind: "one", seat: seat("chief-of-staff") });
    expect(chiefOfStaffOf([seat("desk.chief-of-staff"), seat("desk.asker")], ORG)).toEqual({ kind: "one", seat: seat("desk.chief-of-staff") });
    // An Ops-hired seat's address is `<org>.<seatId>`.
    expect(chiefOfStaffOf([seat(`${ORG}.chief-of-staff`)], ORG)).toEqual({ kind: "one", seat: seat(`${ORG}.chief-of-staff`) });
    expect(chiefOfStaffOf([seat(`${ORG}.desk.chief-of-staff`)], ORG).kind).toBe("one");
  });

  it("is several, and no guess, when two seats carry the name", () => {
    expect(chiefOfStaffOf([seat("chief-of-staff"), seat("desk.chief-of-staff")], ORG)).toEqual({
      kind: "several",
      seats: [seat("chief-of-staff"), seat("desk.chief-of-staff")],
    });
    expect(chiefOfStaffOf([seat("desk.chief-of-staff"), seat("ops.chief-of-staff")], ORG).kind).toBe("several");
  });

  it("is none when no seat carries exactly the name", () => {
    expect(chiefOfStaffOf([], ORG)).toEqual({ kind: "none" });
    expect(chiefOfStaffOf([seat("desk.chief-of-staffs"), seat("chief"), seat("desk.chief"), seat("chief-of-staff.asker")], ORG)).toEqual({
      kind: "none",
    });
  });

  it("reads an org seat's row, which has no team, without error", () => {
    expect(toSeat({ id: "chief-of-staff", kind: "agent", door: "run" })).toEqual({
      id: "chief-of-staff",
      kind: "agent",
      door: "run",
      team: null,
      name: "chief-of-staff",
    });
  });
});

// ---- the summary and the rail ---------------------------------------------------

const row = (channelId: string, id: string, status: string): BoardRow => ({
  boardRef: `${channelId}.work`,
  channelId,
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

const ask = (seatId: string, suspensionId: string): Ask => ({
  sessionId: `s_${suspensionId}`,
  seatId,
  flowId: seatId,
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
        seats: [seat("ops.a"), seat("ops.b"), seat("ops.c")],
        workstreams: [
          { id: "ops.desk", kind: "channel", members: ["ops.a", "ops.b"] },
          { id: "ops.side", kind: "channel", members: ["ops.c"] },
          { id: "ops.quiet", kind: "channel", members: [] },
        ],
      },
    },
    boards: {
      "ops.desk": { ok: true, value: { refs: ["ops.desk.work"], rows: [row("ops.desk", "1", "in_progress"), row("ops.desk", "2", "in_progress"), row("ops.desk", "3", "pending")] } },
      "ops.side": { ok: true, value: { refs: ["ops.side.work"], rows: [row("ops.side", "4", "in_progress"), row("ops.side", "5", "completed")] } },
      "ops.quiet": { ok: true, value: { refs: [], rows: [] } },
    },
    asks: { ok: true, value: [ask("ops.a", "x"), ask("ops.c", "y"), ask("ops.a", "z")] },
    resources: { ok: true, value: [] },
    ...over,
  };
}

describe("the shift summary (V3; D1, BR-4, BR-7, BR-8)", () => {
  it("counts the pending asks, the running rows and the workstreams they run in, from the snapshot", () => {
    const summary = shiftSummary(snapshotOf());
    expect(summary.asks).toEqual(snapshotOf().asks);
    expect(summary.running).toEqual({ ok: true, value: { runs: 3, workstreams: 2 } });
  });

  it("still counts what is running when nothing needs the person", () => {
    const summary = shiftSummary(snapshotOf({ asks: { ok: true, value: [] } }));
    expect(summary.asks).toEqual({ ok: true, value: [] });
    expect(summary.running).toEqual({ ok: true, value: { runs: 3, workstreams: 2 } });
  });

  it("carries a failed read as that line's failure, and the other line whole", () => {
    const failure = { message: "store offline", httpStatus: 503 };
    const noAsks = shiftSummary(snapshotOf({ asks: { ok: false, failure } }));
    expect(noAsks.asks).toEqual({ ok: false, failure });
    expect(noAsks.running.ok).toBe(true);
    const noBoard = shiftSummary(snapshotOf({ boards: { ...snapshotOf().boards, "ops.side": { ok: false, failure } } }));
    expect(noBoard.running).toEqual({ ok: false, failure });
    expect(noBoard.asks.ok).toBe(true);
  });
});

describe("the rail's STREAMS (V7, BR-19)", () => {
  it("gives each workstream its running rows and its members' pending asks", () => {
    expect(streamCounts(snapshotOf())).toEqual({
      ok: true,
      value: [
        { workstream: expect.objectContaining({ id: "ops.desk" }), running: { ok: true, value: 2 }, needsYou: 2 },
        { workstream: expect.objectContaining({ id: "ops.side" }), running: { ok: true, value: 1 }, needsYou: 1 },
        { workstream: expect.objectContaining({ id: "ops.quiet" }), running: { ok: true, value: 0 }, needsYou: 0 },
      ],
    });
  });

  it("fails as a whole only when the inventory did", () => {
    const failure = { message: "no inventory" };
    expect(streamCounts(snapshotOf({ inventory: { ok: false, failure } }))).toEqual({ ok: false, failure });
    const one = streamCounts(snapshotOf({ boards: { ...snapshotOf().boards, "ops.side": { ok: false, failure } } }));
    expect(one.ok && one.value[1]!.running).toEqual({ ok: false, failure });
  });
});

describe("the person's conversation with the chief of staff (V4, BR-14)", () => {
  const session = (id: string, flowId: string | undefined, createdAt: number, parentSessionId?: string): SessionSummary =>
    ({ id, flowKind: "agent", ...(flowId === undefined ? {} : { flowId }), userId: "u", createdAt, updatedAt: createdAt, ...(parentSessionId === undefined ? {} : { parentSessionId }) }) as SessionSummary;

  it("is the newest session on the seat's flow that no channel or run started", () => {
    const sessions = [
      session("old", "desk.chief-of-staff", 1),
      session("newest", "desk.chief-of-staff", 3),
      session("heard", "desk.chief-of-staff", 9, "desk.front"),
      session("other", "desk.asker", 10),
      session("mid", "desk.chief-of-staff", 2),
    ];
    expect(conversationSession(sessions, "desk.chief-of-staff")).toBe("newest");
  });

  it("is never a session a channel post or another run started, and none when there is no direct one", () => {
    expect(conversationSession([session("heard", "desk.chief-of-staff", 9, "desk.front")], "desk.chief-of-staff")).toBeNull();
    // A store that nulls absent keys hands back `null` for a direct session's parent.
    expect(conversationSession([{ ...session("direct", "desk.chief-of-staff", 1), parentSessionId: null } as unknown as SessionSummary], "desk.chief-of-staff")).toBe(
      "direct",
    );
    expect(conversationSession([], "desk.chief-of-staff")).toBeNull();
  });
});

describe("which conversation the view is on, once a line opened one (V4, BR-14)", () => {
  const session = (id: string, createdAt: number): SessionSummary =>
    ({ id, flowKind: "agent", flowId: "desk.chief-of-staff", userId: "u", createdAt, updatedAt: createdAt }) as SessionSummary;

  it("keeps the session a first line opened until the listing holds it", () => {
    expect(currentConversation([], "desk.chief-of-staff", "cos_new")).toBe("cos_new");
    expect(currentConversation([session("older", 1)], "desk.chief-of-staff", "cos_new")).toBe("cos_new");
  });

  it("follows the newest direct session once the listing has caught up, even one started elsewhere", () => {
    expect(currentConversation([session("cos_new", 2)], "desk.chief-of-staff", "cos_new")).toBe("cos_new");
    expect(currentConversation([session("cos_new", 2), session("from_another_tab", 3)], "desk.chief-of-staff", "cos_new")).toBe("from_another_tab");
    expect(currentConversation([session("listed", 1)], "desk.chief-of-staff", null)).toBe("listed");
  });
});

describe("a new conversation's id", () => {
  it("is minted without crypto.randomUUID, which a page on plain HTTP doesn't have", () => {
    const real = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true, writable: true });
    try {
      const a = newConversationId();
      const b = newConversationId();
      expect(a).toMatch(/^cos_[0-9a-f]{32}$/);
      expect(a).not.toBe(b);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: real, configurable: true, writable: true });
    }
  });
});
