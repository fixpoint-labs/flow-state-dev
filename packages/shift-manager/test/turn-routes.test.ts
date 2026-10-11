/**
 * Where a person's line can go (V6; BR-18, BR-19): the worker an `@name` names,
 * the rows of its that take a message, and the door a session's own flow
 * publishes. Pure reads of the snapshot, so each case is staged exactly.
 */
import { describe, expect, it } from "vitest";
import { addressedWorker, doorOf, mentionOf, messageableRows, type Roster } from "../src/lib/derive";
import type { BoardRow, Worker } from "../src/lib/reads";

const worker = (id: string, door: string | null = "message", kind = "coder"): Worker => ({
  id,
  kind,
  door,
  team: id.split(".")[0]!,
  name: id.split(".")[1]!,
});

const roster: Roster = {
  workers: [worker("eng.coder"), worker("eng.em", null, "em"), worker("ops.coder")],
  workstreams: [{ id: "eng.feature", kind: "mailbox", members: ["eng.coder", "eng.em"] }],
};
const feature = roster.workstreams[0]!;

const row = (id: string, status: string, run: boolean, assignee = "eng.coder"): BoardRow => ({
  boardRef: "eng.feature.work",
  mailboxId: "eng.feature",
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
  it("names the member by its short name, never a worker outside the workstream", () => {
    expect(addressedWorker(roster, feature, "coder")?.id).toBe("eng.coder");
    expect(addressedWorker(roster, feature, "eng.coder")?.id).toBe("eng.coder");
    expect(addressedWorker(roster, feature, "ops.coder")).toBeUndefined();
    expect(addressedWorker(roster, feature, "nobody")).toBeUndefined();
  });

  it("offers each member by a name that reaches it: short when unique, the full id when two members share it", () => {
    const both = { id: "mixed", kind: "mailbox", members: ["eng.coder", "ops.coder", "eng.em"] };
    const mixed: Roster = { ...roster, workstreams: [both] };
    // Two coders: `@coder` reaches neither, so each is offered by its id, which does.
    for (const s of [mixed.workers[0]!, mixed.workers[2]!]) {
      expect(mentionOf(mixed, both, s)).toBe(s.id);
      expect(addressedWorker(mixed, both, mentionOf(mixed, both, s))?.id).toBe(s.id);
    }
    expect(mentionOf(mixed, both, mixed.workers[1]!)).toBe("em");
    expect(mentionOf(roster, feature, roster.workers[0]!)).toBe("coder");
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
    expect(messageableRows(roster, rows, roster.workers[0]!).map((r) => r.id)).toEqual(["running", "parked", "between"]);
  });

  it("has one row, several, or none, as the composer then asks", () => {
    const coder = roster.workers[0]!;
    expect(messageableRows(roster, [row("a", "in_progress", true)], coder)).toHaveLength(1);
    expect(messageableRows(roster, [row("a", "in_progress", true), row("b", "parked", true)], coder)).toHaveLength(2);
    expect(messageableRows(roster, [row("c", "completed", true)], coder)).toHaveLength(0);
  });
});

describe("a session's door (BR-18)", () => {
  it("is the one the session's own flow publishes, or none", () => {
    expect(doorOf(roster.workers, "coder")).toBe("message");
    expect(doorOf(roster.workers, "em")).toBeNull();
    // A flow no worker runs on, and a worker's id, which names no flow.
    expect(doorOf(roster.workers, "mailbox")).toBeNull();
    expect(doorOf(roster.workers, "eng.coder")).toBeNull();
  });
});
