/**
 * Roster's rules, below the screen: where a worker is grouped (BR-13a, BR-13b),
 * the one status rule every screen draws (BR-1 to BR-6, BR-20), the counts
 * reduced from it (BR-12, BR-14, BR-15), and the route (BR-13).
 */
import { describe, expect, it } from "vitest";
import { pickedTeam, workerStates, shiftCounts, teamsOf, type LoadedSnapshot } from "../src/lib/derive";
import { parseRoute, pathFor } from "../src/lib/routes";
import { GENERAL_TEAM, inboxSection, toBoardRow, toWorker, type Ask, type BoardRow, type Worker } from "../src/lib/reads";

const ORG = "acme";

describe("BR-13a, BR-13b: which group a worker sits in", () => {
  it("an org worker (no dot) sits in General, never in a team of its own", () => {
    expect(toWorker({ id: "shift-coordinator", kind: "shift-coordinator" })).toMatchObject({ team: GENERAL_TEAM, name: "shift-coordinator" });
    expect(toWorker({ id: "ops", kind: "ops" })).toMatchObject({ team: GENERAL_TEAM, name: "ops" });
  });

  it("a team worker `<team>.<name>` is unchanged", () => {
    expect(toWorker({ id: "eng.coder", kind: "coder" })).toMatchObject({ id: "eng.coder", team: "eng", name: "coder" });
  });

  it("a user reads a worker and its team by their display names; ids stay the wiring", () => {
    expect(toWorker({ id: "eng.em", kind: "em", name: "Engineering Manager", teamName: "Engineering" })).toMatchObject({
      id: "eng.em",
      team: "eng",
      displayName: "Engineering Manager",
      teamName: "Engineering",
    });
    expect(toWorker({ id: "general-lead", kind: "agent", name: "General Lead" })).toMatchObject({
      team: GENERAL_TEAM,
      displayName: "General Lead",
      teamName: "General",
    });
  });

  it("a declared team named `general` stays its own team, apart from the org workers' General group", () => {
    const groups = teamsOf([toWorker({ id: "shift-coordinator", kind: "agent" })!, toWorker({ id: "general.desk", kind: "agent" })!]);
    expect(groups.map(({ team, name, workers }) => [team, name, workers.map((w) => w.id)])).toEqual([
      [GENERAL_TEAM, "General", ["shift-coordinator"]],
      ["general", "general", ["general.desk"]],
    ]);
  });

  it("a worker or team with no display name reads as its id, so nothing shows blank", () => {
    expect(toWorker({ id: "eng.coder", kind: "coder" })).toMatchObject({ displayName: "eng.coder", teamName: "eng" });
    expect(toWorker({ id: "eng.coder", kind: "coder", name: null, teamName: null })).toMatchObject({ displayName: "eng.coder", teamName: "eng" });
  });
});

/** A loaded snapshot of `workers`, one conversation's board holding `rows`, and `asks` (or asks that failed). */
function snapshotOf(workers: Worker[], rows: BoardRow[], asks: Ask[] | "failed" = []) {
  const read = {
    readAt: 0,
    sessions: [],
    orgId: ORG,
    inventory: { ok: true, value: { workers } },
    boards: { s_desk: { ok: true, value: { refs: ["s_desk.tasks"], rows } } },
    asks: asks === "failed" ? { ok: false, failure: { message: "asks offline" } } : { ok: true, value: asks },
    resources: { ok: true, value: [] },
  } as unknown as Omit<LoadedSnapshot, "inbox">;
  return { ...read, inbox: inboxSection(read.asks, read.boards, read.sessions) } as LoadedSnapshot;
}

const worker = (id: string) => toWorker({ id, kind: "worker" })!;
const row = (id: string, status: string, assignee: string | null): BoardRow =>
  toBoardRow("s_desk.tasks", "s_desk", id, { id, title: id, status, assignee });
/** A running row held on a question for you (FIX-2131): what a task waiting on you is. */
const waiting = (id: string, assignee: string | null): BoardRow =>
  toBoardRow("s_desk.tasks", "s_desk", id, {
    id,
    title: id,
    status: "in_progress",
    assignee,
    questions: [{ id: `q-${id}`, actor: "user", openedAt: 1, source: { kind: "row", closedBy: [{ by: "answer" }] }, ask: { kind: "question", prompt: "Which one?" } }],
  });
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
    const states = workerStates(snapshotOf([coder], [waiting("a", "coder"), row("b", "in_progress", "coder")], [ask("eng.coder", "q1")]));
    const state = states.workers.get("eng.coder")!;
    expect(state.status).toBe("on shift");
    expect(state.held.map((r) => r.id)).toEqual(["a", "b"]);
    expect(state.asks.map((a) => a.item.suspensionId)).toEqual(["q1"]);
  });

  it("BR-2: a task held on a question for you alone, or an ask alone, is on shift: the worker is mid-task, waiting on you", () => {
    const states = workerStates(snapshotOf([coder, reviewer], [waiting("a", "coder")], [ask("eng.reviewer", "q1")]));
    expect(states.workers.get("eng.coder")!.status).toBe("on shift");
    expect(states.workers.get("eng.reviewer")!.status).toBe("on shift");
    expect(states.workers.get("eng.reviewer")!.held).toEqual([]);
  });

  it("BR-3: queued, blocked, errored and finished alone are off shift, and hold no slot", () => {
    const rows = ["pending", "held", "errored", "completed", "cancelled"].map((s) => row(s, s, "coder"));
    const state = workerStates(snapshotOf([coder], rows)).workers.get("eng.coder")!;
    expect(state).toMatchObject({ status: "off shift", held: [] });
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
    const states = workerStates(snapshotOf([coder, reviewer], [row("a", "in_progress", "coder"), waiting("b", "reviewer")], "failed"));
    expect(states.partial).toBe(true);
    expect([...states.workers.values()].map((s) => s.status)).toEqual(["on shift", "on shift"]);
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
  const shiftCoordinator = worker("shift-coordinator");
  const snapshot = snapshotOf(
    [coder, reviewer, asker, shiftCoordinator],
    [row("a", "in_progress", "coder"), waiting("b", "coder"), waiting("c", "reviewer"), row("d", "pending", "asker")],
    [ask("ops.asker", "q1"), ask("ops.asker", "q2")],
  );

  it("counts each group, and every waits-on entry, an on-shift worker's included", () => {
    expect(shiftCounts(workerStates(snapshot))).toEqual({ "on shift": 3, "off shift": 1, waiting: 4 });
  });

  it("counts only the workers shown when a team is picked", () => {
    expect(shiftCounts(workerStates(snapshot), "ops")).toEqual({ "on shift": 1, "off shift": 0, waiting: 2 });
    expect(shiftCounts(workerStates(snapshot), GENERAL_TEAM)).toEqual({ "on shift": 0, "off shift": 1, waiting: 0 });
  });

  it("lists teams with General first, each with exactly its workers", () => {
    expect(teamsOf([coder, shiftCoordinator, asker, reviewer]).map(({ team, name, workers }) => [team, name, workers.map((s) => s.id)])).toEqual([
      [GENERAL_TEAM, "General", ["shift-coordinator"]],
      ["eng", "eng", ["eng.coder", "eng.reviewer"]],
      ["ops", "ops", ["ops.asker"]],
    ]);
  });
});

describe("BR-13: the Roster route", () => {
  it("round-trips All and a team", () => {
    for (const route of [{ level: "roster", team: null }, { level: "roster", team: "eng" }, { level: "roster", team: GENERAL_TEAM }] as const) {
      const path = pathFor(route);
      const q = path.indexOf("?");
      expect(parseRoute(q < 0 ? path : path.slice(0, q), q < 0 ? "" : path.slice(q))).toEqual(route);
    }
    expect(pathFor({ level: "roster", team: null })).toBe("/roster");
    expect(pathFor({ level: "roster", team: "eng" })).toBe("/roster?team=eng");
  });

  it("a team the inventory doesn't have reads as All", () => {
    const workers = [worker("eng.coder"), worker("shift-coordinator")];
    expect(pickedTeam(workers, "nope")).toBeNull();
    expect(pickedTeam(workers, "eng")).toBe("eng");
    expect(pickedTeam(workers, GENERAL_TEAM)).toBe(GENERAL_TEAM);
    expect(pickedTeam(workers, null)).toBeNull();
  });
});
