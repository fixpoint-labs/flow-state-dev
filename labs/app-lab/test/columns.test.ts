/**
 * BR-12 for every status the task substrate ships, plus the legacy word a
 * persisted row may still carry (V5); BR-8's three worker states; BR-15's
 * "done rows are left out".
 *
 * The status list is the substrate's own enum, not a copy: a status added
 * there lands here and must be placed, or this fails.
 */
import { describe, expect, it } from "vitest";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { COLUMNS, columnFor, isBlocked, isDone } from "../src/lib/columns";
import { openRows, seatFor, workerStatus, type LoadedSnapshot, type Roster } from "../src/lib/derive";
import { toBoardRow, toSeat, toWorkstream, type BoardRow } from "../src/lib/reads";

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
  toBoardRow("t.c.work", "t.c", id, { id, title: id, status, assignee });

describe("BR-8: a worker's status", () => {
  const seat = toSeat({ id: "team.builder", kind: "worker" })!;
  const roster: Roster = { seats: [seat], workstreams: [] };

  it("is working with a running row, by seat id or by the seat's own name", () => {
    expect(workerStatus(seat, [row("in_progress", "builder")], roster)).toBe("working");
    expect(workerStatus(seat, [row("in_progress", "team.builder")], roster)).toBe("working");
  });

  it("is waiting on you with a parked row, legacy word included", () => {
    expect(workerStatus(seat, [row("parked", "builder")], roster)).toBe("waiting on you");
    expect(workerStatus(seat, [row("awaiting_review", "builder")], roster)).toBe("waiting on you");
  });

  it("working wins over waiting", () => {
    expect(workerStatus(seat, [row("parked", "builder", "a"), row("in_progress", "builder", "b")], roster)).toBe("working");
  });

  it("is idle otherwise: another seat's rows, or rows that aren't running or parked", () => {
    expect(workerStatus(seat, [row("in_progress", "reviewer"), row("pending", "builder"), row("errored", "builder")], roster)).toBe(
      "idle",
    );
    expect(workerStatus(seat, [], roster)).toBe("idle");
  });
});

describe("which seat holds a row, when a bare name is in more than one team", () => {
  const ops = toSeat({ id: "ops.builder", kind: "worker" })!;
  const eng = toSeat({ id: "eng.builder", kind: "worker" })!;
  const onChannel = (channelId: string, members: string[]) => toWorkstream({ id: channelId, kind: "channel", members })!;
  const rowOn = (channelId: string, assignee: string) =>
    toBoardRow(`${channelId}.work`, channelId, "r", { id: "r", title: "r", status: "in_progress", assignee });

  it("resolves the name through the row's channel's members", () => {
    const roster: Roster = { seats: [ops, eng], workstreams: [onChannel("eng.feature", ["eng.builder"])] };
    expect(seatFor(roster, rowOn("eng.feature", "builder"))?.id).toBe("eng.builder");
    expect(workerStatus(eng, [rowOn("eng.feature", "builder")], roster)).toBe("working");
    expect(workerStatus(ops, [rowOn("eng.feature", "builder")], roster)).toBe("idle");
  });

  it("attributes the row to no seat when the channel doesn't settle it, never to several", () => {
    const both: Roster = { seats: [ops, eng], workstreams: [onChannel("x.shared", ["ops.builder", "eng.builder"])] };
    expect(seatFor(both, rowOn("x.shared", "builder"))).toBeUndefined();
    expect(workerStatus(ops, [rowOn("x.shared", "builder")], both)).toBe("idle");
    expect(workerStatus(eng, [rowOn("x.shared", "builder")], both)).toBe("idle");
    const neither: Roster = { seats: [ops, eng], workstreams: [] };
    expect(seatFor(neither, rowOn("x.other", "builder"))).toBeUndefined();
  });

  it("a full seat id always wins", () => {
    const roster: Roster = { seats: [ops, eng], workstreams: [] };
    expect(seatFor(roster, rowOn("x.other", "ops.builder"))?.id).toBe("ops.builder");
  });
});

describe("BR-15: Tasks leaves done rows out, and a parked row with no ask is still a task (BR-27)", () => {
  it("keeps every open row and drops done ones", () => {
    const rows = taskStatusSchema.options.map((s) => row(s, "builder"));
    const snapshot = {
      boards: { "t.c": { ok: true, value: { refs: ["t.c.work"], rows } } },
    } as unknown as LoadedSnapshot;
    expect(openRows(snapshot).map((r) => r.status).sort()).toEqual(["blocked", "errored", "in_progress", "parked", "pending"]);
  });
});
