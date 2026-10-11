/**
 * Roster's rules, below the screen: where a worker is grouped (BR-13a, BR-13b),
 * the one status rule every screen draws (BR-1 to BR-6, BR-20), the counts
 * reduced from it (BR-12, BR-14, BR-15), and the route (BR-13).
 */
import { describe, expect, it } from "vitest";
import { pickedTeam, workerStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import { parseRoute, pathFor } from "../src/lib/routes";
import { STAFF_TEAM, toBoardRow, toWorker, type Ask, type BoardRow, type Worker } from "../src/lib/reads";

const ORG = "acme";

describe("BR-13a, BR-13b: which group a worker sits in", () => {
  it("an org worker (no dot) sits in Staff, never in a team of its own", () => {
    expect(toWorker({ id: "chief-of-staff", kind: "cos" })).toMatchObject({ team: STAFF_TEAM, name: "chief-of-staff" });
    expect(toWorker({ id: "ops", kind: "ops" })).toMatchObject({ team: STAFF_TEAM, name: "ops" });
  });

  it("a team worker `<team>.<name>` is unchanged", () => {
    expect(toWorker({ id: "eng.coder", kind: "coder" })).toMatchObject({ id: "eng.coder", team: "eng", name: "coder" });
  });
});

/** A loaded snapshot of `workers`, one conversation's board holding `rows`, and `asks` (or asks that failed). */
function snapshotOf(workers: Worker[], rows: BoardRow[], asks: Ask[] | "failed" = []) {
  return {
    readAt: 0,
    sessions: [],
    orgId: ORG,
    inventory: { ok: true, value: { workers } },
    boards: { s_desk: { ok: true, value: { refs: ["s_desk.tasks"], rows } } },
    asks: asks === "failed" ? { ok: false, failure: { message: "asks offline" } } : { ok: true, value: asks },
    resources: { ok: true, value: [] },
  } as unknown as LoadedSnapshot;
}

const worker = (id: string) => toWorker({ id, kind: "worker" })!;
const row = (id: string, status: string, assignee: string | null): BoardRow =>
  toBoardRow("s_desk.tasks", "s_desk", id, { id, title: id, status, assignee });
const ask = (workerId: string | null, suspensionId: string): Ask =>
  ({ sessionId: `s_${suspensionId}`, workerId, flowId: workerId, parentSessionId: null, kind: "approval", item: { suspensionId }, since: 0, unanswerable: null }) as unknown as Ask;

describe("BR-1 to BR-5: the one status rule", () => {
  const coder = worker("eng.coder");
  const reviewer = worker("eng.reviewer");
  const idle = worker("eng.idle");

  it("returns every inventory worker once, in inventory order", () => {
    const states = workerStates(snapshotOf([coder, reviewer, idle], []));
    expect([...states.workers.keys()]).toEqual(["eng.coder", "eng.reviewer", "eng.idle"]);
    expect([...states.workers.values()].map((s) => s.status)).toEqual(["off shift", "off shift", "off shift"]);
  });

  it("BR-1: a running task is on shift, and beats waiting", () => {
    const states = workerStates(snapshotOf([coder], [row("a", "parked", "coder"), row("b", "in_progress", "coder")], [ask("eng.coder", "q1")]));
    const state = states.workers.get("eng.coder")!;
    expect(state.status).toBe("on shift");
    expect(state.held.map((r) => r.id)).toEqual(["a", "b"]);
    expect(state.asks.map((a) => a.item.suspensionId)).toEqual(["q1"]);
  });

  it("BR-2: a parked task alone, or an ask alone, is on call", () => {
    const states = workerStates(snapshotOf([coder, reviewer], [row("a", "parked", "coder")], [ask("eng.reviewer", "q1")]));
    expect(states.workers.get("eng.coder")!.status).toBe("on call");
    expect(states.workers.get("eng.reviewer")!.status).toBe("on call");
    expect(states.workers.get("eng.reviewer")!.held).toEqual([]);
  });

  it("BR-3: queued, blocked, errored and finished alone are off shift, and hold no slot", () => {
    const rows = ["pending", "blocked", "errored", "completed", "cancelled"].map((s) => row(s, s, "coder"));
    const state = workerStates(snapshotOf([coder], rows)).workers.get("eng.coder")!;
    expect(state).toMatchObject({ status: "off shift", held: [] });
  });

  it("BR-4: the legacy waiting word reads as waiting on you", () => {
    expect(workerStates(snapshotOf([coder], [row("a", "awaiting_review", "coder")])).workers.get("eng.coder")!.status).toBe("on call");
  });

  it("BR-5: an assignee that resolves to no single worker, or an ask with no worker, counts for nobody", () => {
    const ops = worker("ops.coder");
    // `coder` names a worker in two teams: no single worker.
    const states = workerStates(
      snapshotOf([coder, ops], [row("a", "in_progress", "coder"), row("b", "in_progress", "ghost")], [ask(null, "q1"), ask("nobody.here", "q2")]),
    );
    expect([...states.workers.values()].map((s) => [s.status, s.held.length, s.asks.length])).toEqual([
      ["off shift", 0, 0],
      ["off shift", 0, 0],
    ]);
  });

  it("BR-20: asks that did not load mark the whole result partial, and leave statuses from the boards alone", () => {
    const states = workerStates(snapshotOf([coder, reviewer], [row("a", "in_progress", "coder"), row("b", "parked", "reviewer")], "failed"));
    expect(states.partial).toBe(true);
    expect([...states.workers.values()].map((s) => s.status)).toEqual(["on shift", "on call"]);
    expect(workerStates(snapshotOf([coder], [])).partial).toBe(false);
  });

  it("is one result per snapshot, so every screen reads the same object", () => {
    const snapshot = snapshotOf([coder], []);
    expect(workerStates(snapshot)).toBe(workerStates(snapshot));
  });
});

describe("BR-12, BR-14, BR-15: counts reduce from the one result", () => {
  const coder = worker("eng.coder");
  const reviewer = worker("eng.reviewer");
  const asker = worker("ops.asker");
  const chief = worker("chief-of-staff");
  const snapshot = snapshotOf(
    [coder, reviewer, asker, chief],
    [row("a", "in_progress", "coder"), row("b", "parked", "coder"), row("c", "parked", "reviewer"), row("d", "pending", "asker")],
    [ask("ops.asker", "q1"), ask("ops.asker", "q2")],
  );

  it("counts each group, and every waits-on entry, an on-shift worker's included", () => {
    expect(shiftCounts(workerStates(snapshot))).toEqual({ "on shift": 1, "on call": 2, "off shift": 1, waiting: 4 });
  });

  it("counts only the workers shown when a team is picked", () => {
    expect(shiftCounts(workerStates(snapshot), "ops")).toEqual({ "on shift": 0, "on call": 1, "off shift": 0, waiting: 2 });
    expect(shiftCounts(workerStates(snapshot), STAFF_TEAM)).toEqual({ "on shift": 0, "on call": 0, "off shift": 1, waiting: 0 });
  });

  it("lists teams with Staff first, each with exactly its workers", () => {
    expect(teamsOf([coder, chief, asker, reviewer]).map(({ team, workers }) => [team, workers.map((s) => s.id)])).toEqual([
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
    const workers = [worker("eng.coder"), worker("chief-of-staff")];
    expect(pickedTeam(workers, "nope")).toBeNull();
    expect(pickedTeam(workers, "eng")).toBe("eng");
    expect(pickedTeam(workers, STAFF_TEAM)).toBe(STAFF_TEAM);
    expect(pickedTeam(workers, null)).toBeNull();
  });
});
