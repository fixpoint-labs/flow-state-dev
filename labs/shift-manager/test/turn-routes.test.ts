/**
 * Where a person's line can go (V6; BR-18, BR-19): the seat an `@name` names,
 * the rows of its that take a message, and the door a session's own flow
 * publishes. Pure reads of the snapshot, so each case is staged exactly.
 */
import { describe, expect, it } from "vitest";
import { addressedSeat, doorOf, messageableRows, type Roster } from "../src/lib/derive";
import type { BoardRow, Seat } from "../src/lib/reads";

const seat = (id: string, door: string | null = "message"): Seat => ({
  id,
  kind: "coder",
  door,
  seatId: id,
  team: id.split(".")[0]!,
  name: id.split(".")[1]!,
});

const roster: Roster = {
  seats: [seat("eng.coder"), seat("eng.em", null), seat("ops.coder")],
  workstreams: [{ id: "eng.feature", kind: "channel", members: ["eng.coder", "eng.em"] }],
};
const feature = roster.workstreams[0]!;

const row = (id: string, status: string, run: boolean, assignee = "eng.coder"): BoardRow => ({
  boardRef: "eng.feature.work",
  channelId: "eng.feature",
  id,
  title: `task ${id}`,
  goal: null,
  status,
  assignee,
  priority: null,
  labels: [],
  deps: [],
  run: run ? { sessionId: `s_${id}`, requestId: `r_${id}`, attempt: 1 } : null,
  error: null,
  createdAt: null,
  updatedAt: null,
  startedAt: null,
  completedAt: null,
});

describe("an @name in a workstream (BR-19)", () => {
  it("names the member by its short name, never a seat outside the workstream", () => {
    expect(addressedSeat(roster, feature, "coder")?.id).toBe("eng.coder");
    expect(addressedSeat(roster, feature, "eng.coder")?.id).toBe("eng.coder");
    expect(addressedSeat(roster, feature, "ops.coder")).toBeUndefined();
    expect(addressedSeat(roster, feature, "nobody")).toBeUndefined();
  });

  it("goes to the worker's rows that are running, parked, or pending with a run, and no others", () => {
    const rows = [
      row("running", "in_progress", true),
      row("parked", "parked", true),
      row("between", "pending", true),
      row("never-started", "pending", false),
      row("done", "completed", true),
      row("someone-else", "in_progress", true, "eng.em"),
    ];
    expect(messageableRows(roster, rows, roster.seats[0]!).map((r) => r.id)).toEqual(["running", "parked", "between"]);
  });

  it("has one row, several, or none, as the composer then asks", () => {
    const coder = roster.seats[0]!;
    expect(messageableRows(roster, [row("a", "in_progress", true)], coder)).toHaveLength(1);
    expect(messageableRows(roster, [row("a", "in_progress", true), row("b", "parked", true)], coder)).toHaveLength(2);
    expect(messageableRows(roster, [row("c", "completed", true)], coder)).toHaveLength(0);
  });
});

describe("a session's door (BR-18)", () => {
  it("is the one the session's own flow publishes, or none", () => {
    expect(doorOf(roster.seats, "eng.coder")).toBe("message");
    expect(doorOf(roster.seats, "eng.em")).toBeNull();
    expect(doorOf(roster.seats, "eng.feature")).toBeNull();
  });
});
