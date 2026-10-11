/**
 * BR-12 for every status the task substrate ships, plus the legacy word a
 * persisted row may still carry (V5); which seat holds a row; BR-15's
 * "done rows are left out".
 *
 * The status list is the substrate's own enum, not a copy: a status added
 * there lands here and must be placed, or this fails.
 */
import { describe, expect, it } from "vitest";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { COLUMNS, columnFor, isBlocked, isDone } from "../src/lib/columns";
import { openRows, seatFor, type LoadedSnapshot, type Roster } from "../src/lib/derive";
import { toBoardRow, toSeat, type BoardRow } from "../src/lib/reads";

/** Where BR-12 puts each shipped status. */
const EXPECTED: Record<string, (typeof COLUMNS)[number]> = {
  pending: "QUEUED",
  blocked: "QUEUED",
  in_progress: "RUNNING",
  parked: "NEEDS YOU",
  errored: "NEEDS YOU",
  completed: "DONE",
  cancelled: "DONE",
};

describe("BR-12: a row's column", () => {
  it("draws the five columns in v2's order: IN REVIEW before NEEDS YOU (v2:1327)", () => {
    expect([...COLUMNS]).toEqual(["QUEUED", "RUNNING", "IN REVIEW", "NEEDS YOU", "DONE"]);
  });

  it("places every shipped status", () => {
    const shipped = taskStatusSchema.options;
    expect([...shipped].sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const status of shipped) expect([status, columnFor(status)]).toEqual([status, EXPECTED[status]]);
  });

  it("reads the legacy awaiting_review as parked", () => {
    expect(columnFor("awaiting_review")).toBe("NEEDS YOU");
  });

  it("tags blocked, and nothing else, in QUEUED", () => {
    expect(taskStatusSchema.options.filter(isBlocked)).toEqual(["blocked"]);
  });

  it("IN REVIEW holds no shipped status", () => {
    expect(taskStatusSchema.options.filter((s) => columnFor(s) === "IN REVIEW")).toEqual([]);
  });

  it("done is exactly completed and cancelled", () => {
    expect(taskStatusSchema.options.filter(isDone).sort()).toEqual(["cancelled", "completed"]);
  });
});

const row = (status: string, assignee: string | null, id = status): BoardRow =>
  toBoardRow("s_1.tasks", "s_1", id, { id, title: id, status, assignee });

describe("which seat holds a row, when a bare name is in more than one team", () => {
  const ops = toSeat({ id: "ops.builder", kind: "worker" })!;
  const eng = toSeat({ id: "eng.builder", kind: "worker" })!;
  const rowFor = (assignee: string) => toBoardRow("s_1.tasks", "s_1", "r", { id: "r", title: "r", status: "in_progress", assignee });

  it("attributes the row to no seat, never to several", () => {
    const roster: Roster = { seats: [ops, eng] };
    expect(seatFor(roster, rowFor("builder"))).toBeUndefined();
  });

  it("resolves a name only one seat carries", () => {
    const roster: Roster = { seats: [ops, toSeat({ id: "eng.reviewer", kind: "worker" })!] };
    expect(seatFor(roster, rowFor("builder"))?.id).toBe("ops.builder");
  });

  it("a full seat id always wins", () => {
    const roster: Roster = { seats: [ops, eng] };
    expect(seatFor(roster, rowFor("ops.builder"))?.id).toBe("ops.builder");
  });
});

describe("BR-15: Tasks leaves done rows out, and a parked row with no ask is still a task (BR-27)", () => {
  it("keeps every open row and drops done ones", () => {
    const rows = taskStatusSchema.options.map((s) => row(s, "builder"));
    const snapshot = {
      boards: { s_1: { ok: true, value: { refs: ["s_1.tasks"], rows } } },
    } as unknown as LoadedSnapshot;
    expect(openRows(snapshot).map((r) => r.status).sort()).toEqual(["blocked", "errored", "in_progress", "parked", "pending"]);
  });
});
