/**
 * Roster's rules, below the screen: where a seat is grouped (BR-13a, BR-13b),
 * the one status rule every screen draws (BR-1 to BR-6, BR-20), the counts
 * reduced from it (BR-12, BR-14, BR-15), and the route (BR-13).
 */
import { describe, expect, it } from "vitest";
import { pickedTeam, seatStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import { parseRoute, pathFor } from "../src/lib/routes";
import { STAFF_TEAM, toBoardRow, toSeat, toWorkstream, type Ask, type BoardRow, type Seat } from "../src/lib/reads";

const ORG = "acme";

describe("BR-13a, BR-13b: which group a seat sits in", () => {
  it("an org seat (no dot) sits in Staff, never in a team of its own", () => {
    expect(toSeat({ id: "chief-of-staff", kind: "cos" }, ORG)).toMatchObject({ team: STAFF_TEAM, name: "chief-of-staff" });
    expect(toSeat({ id: "ops", kind: "ops" }, ORG)).toMatchObject({ team: STAFF_TEAM, name: "ops" });
  });

  it("a hired seat `<org>.<seatId>` is grouped by the seat id it holds, user-owned too", () => {
    expect(toSeat({ id: `${ORG}.eng.coder-2`, kind: "coder" }, ORG)).toMatchObject({ team: "eng", name: "coder-2" });
    expect(toSeat({ id: `${ORG}.~u_1.eng.coder-3`, kind: "coder" }, ORG)).toMatchObject({ team: "eng", name: "coder-3" });
  });

  it("a team seat `<team>.<name>` is unchanged", () => {
    expect(toSeat({ id: "eng.coder", kind: "coder" }, ORG)).toMatchObject({ id: "eng.coder", team: "eng", name: "coder" });
  });
});

/** A loaded snapshot of `seats`, one workstream holding `rows`, and `asks` (or asks that failed). */
function snapshotOf(seats: Seat[], rows: BoardRow[], asks: Ask[] | "failed" = [], members: string[] = seats.map((s) => s.id)) {
  return {
    readAt: 0,
    sessions: [],
    orgId: ORG,
    inventory: { ok: true, value: { seats, workstreams: [toWorkstream({ id: "eng.desk", kind: "channel", members })!] } },
    boards: { "eng.desk": { ok: true, value: { refs: ["eng.desk.work"], rows } } },
    asks: asks === "failed" ? { ok: false, failure: { message: "asks offline" } } : { ok: true, value: asks },
    resources: { ok: true, value: [] },
  } as unknown as LoadedSnapshot;
}

const seat = (id: string) => toSeat({ id, kind: "worker" }, ORG)!;
const row = (id: string, status: string, assignee: string | null): BoardRow =>
  toBoardRow("eng.desk.work", "eng.desk", id, { id, title: id, status, assignee });
const ask = (seatId: string | null, suspensionId: string): Ask =>
  ({ sessionId: `s_${suspensionId}`, seatId, flowId: seatId, parentSessionId: null, kind: "approval", item: { suspensionId }, since: 0, unanswerable: null }) as unknown as Ask;

describe("BR-1 to BR-5: the one status rule", () => {
  const coder = seat("eng.coder");
  const reviewer = seat("eng.reviewer");
  const idle = seat("eng.idle");

  it("returns every inventory seat once, in inventory order", () => {
    const states = seatStates(snapshotOf([coder, reviewer, idle], []));
    expect([...states.seats.keys()]).toEqual(["eng.coder", "eng.reviewer", "eng.idle"]);
    expect([...states.seats.values()].map((s) => s.status)).toEqual(["off shift", "off shift", "off shift"]);
  });

  it("BR-1: a running task is on shift, and beats waiting", () => {
    const states = seatStates(snapshotOf([coder], [row("a", "parked", "coder"), row("b", "in_progress", "coder")], [ask("eng.coder", "q1")]));
    const state = states.seats.get("eng.coder")!;
    expect(state.status).toBe("on shift");
    expect(state.held.map((r) => r.id)).toEqual(["a", "b"]);
    expect(state.asks.map((a) => a.item.suspensionId)).toEqual(["q1"]);
  });

  it("BR-2: a parked task alone, or an ask alone, is on call", () => {
    const states = seatStates(snapshotOf([coder, reviewer], [row("a", "parked", "coder")], [ask("eng.reviewer", "q1")]));
    expect(states.seats.get("eng.coder")!.status).toBe("on call");
    expect(states.seats.get("eng.reviewer")!.status).toBe("on call");
    expect(states.seats.get("eng.reviewer")!.held).toEqual([]);
  });

  it("BR-3: queued, blocked, errored and finished alone are off shift, and hold no slot", () => {
    const rows = ["pending", "blocked", "errored", "completed", "cancelled"].map((s) => row(s, s, "coder"));
    const state = seatStates(snapshotOf([coder], rows)).seats.get("eng.coder")!;
    expect(state).toMatchObject({ status: "off shift", held: [] });
  });

  it("BR-4: the legacy waiting word reads as waiting on you", () => {
    expect(seatStates(snapshotOf([coder], [row("a", "awaiting_review", "coder")])).seats.get("eng.coder")!.status).toBe("on call");
  });

  it("BR-5: an assignee that resolves to no single seat, or an ask with no seat, counts for nobody", () => {
    const ops = seat("ops.coder");
    // `coder` names a seat in two teams, both members of the channel: no single seat.
    const states = seatStates(
      snapshotOf([coder, ops], [row("a", "in_progress", "coder"), row("b", "in_progress", "ghost")], [ask(null, "q1"), ask("nobody.here", "q2")], ["eng.coder", "ops.coder"]),
    );
    expect([...states.seats.values()].map((s) => [s.status, s.held.length, s.asks.length])).toEqual([
      ["off shift", 0, 0],
      ["off shift", 0, 0],
    ]);
  });

  it("BR-20: asks that did not load mark the whole result partial, and leave statuses from the boards alone", () => {
    const states = seatStates(snapshotOf([coder, reviewer], [row("a", "in_progress", "coder"), row("b", "parked", "reviewer")], "failed"));
    expect(states.partial).toBe(true);
    expect([...states.seats.values()].map((s) => s.status)).toEqual(["on shift", "on call"]);
    expect(seatStates(snapshotOf([coder], [])).partial).toBe(false);
  });

  it("is one result per snapshot, so every screen reads the same object", () => {
    const snapshot = snapshotOf([coder], []);
    expect(seatStates(snapshot)).toBe(seatStates(snapshot));
  });
});

describe("BR-12, BR-14, BR-15: counts reduce from the one result", () => {
  const coder = seat("eng.coder");
  const reviewer = seat("eng.reviewer");
  const asker = seat("ops.asker");
  const chief = seat("chief-of-staff");
  const snapshot = snapshotOf(
    [coder, reviewer, asker, chief],
    [row("a", "in_progress", "coder"), row("b", "parked", "coder"), row("c", "parked", "reviewer"), row("d", "pending", "asker")],
    [ask("ops.asker", "q1"), ask("ops.asker", "q2")],
  );

  it("counts each group, and every waits-on entry, an on-shift worker's included", () => {
    expect(shiftCounts(seatStates(snapshot))).toEqual({ "on shift": 1, "on call": 2, "off shift": 1, waiting: 4 });
  });

  it("counts only the seats shown when a team is picked", () => {
    expect(shiftCounts(seatStates(snapshot), "ops")).toEqual({ "on shift": 0, "on call": 1, "off shift": 0, waiting: 2 });
    expect(shiftCounts(seatStates(snapshot), STAFF_TEAM)).toEqual({ "on shift": 0, "on call": 0, "off shift": 1, waiting: 0 });
  });

  it("lists teams with Staff first, each with exactly its seats", () => {
    expect(teamsOf([coder, chief, asker, reviewer]).map(({ team, seats }) => [team, seats.map((s) => s.id)])).toEqual([
      [STAFF_TEAM, ["chief-of-staff"]],
      ["eng", ["eng.coder", "eng.reviewer"]],
      ["ops", ["ops.asker"]],
    ]);
  });
});

describe("BR-13: the Roster route", () => {
  it("round-trips All and a team", () => {
    for (const route of [{ level: "roster", team: null }, { level: "roster", team: "eng" }, { level: "roster", team: STAFF_TEAM }] as const) {
      const path = pathFor(route);
      const q = path.indexOf("?");
      expect(parseRoute(q < 0 ? path : path.slice(0, q), q < 0 ? "" : path.slice(q))).toEqual(route);
    }
    expect(pathFor({ level: "roster", team: null })).toBe("/roster");
    expect(pathFor({ level: "roster", team: "eng" })).toBe("/roster?team=eng");
  });

  it("a team the inventory doesn't have reads as All", () => {
    const seats = [seat("eng.coder"), seat("chief-of-staff")];
    expect(pickedTeam(seats, "nope")).toBeNull();
    expect(pickedTeam(seats, "eng")).toBe("eng");
    expect(pickedTeam(seats, STAFF_TEAM)).toBe(STAFF_TEAM);
    expect(pickedTeam(seats, null)).toBeNull();
  });
});
