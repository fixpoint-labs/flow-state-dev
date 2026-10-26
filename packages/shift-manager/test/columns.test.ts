/**
 * BR-12 for every status the task substrate ships; which worker holds a row;
 * BR-15's "done rows are left out".
 *
 * The status list is the substrate's own enum, not a copy: a status added
 * there lands here and must be placed, or this fails.
 */
import { describe, expect, it } from "vitest";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { COLUMNS, columnFor, isHeld, isDone } from "../src/lib/columns";
import { openRows, workerFor, type LoadedSnapshot, type Roster } from "../src/lib/derive";
import { toBoardRow, toWorker, type BoardRow } from "../src/lib/reads";

/** Where BR-12 puts each shipped status. */
const EXPECTED: Record<string, (typeof COLUMNS)[number]> = {
  pending: "QUEUED",
  held: "QUEUED",
  in_progress: "RUNNING",
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

  it("tags held, and nothing else, in QUEUED", () => {
    expect(taskStatusSchema.options.filter(isHeld)).toEqual(["held"]);
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

describe("which worker holds a row, when a bare name is in more than one team", () => {
  const ops = toWorker({ id: "ops.builder", kind: "worker" })!;
  const eng = toWorker({ id: "eng.builder", kind: "worker" })!;
  const rowFor = (assignee: string) => toBoardRow("s_1.tasks", "s_1", "r", { id: "r", title: "r", status: "in_progress", assignee });

  it("attributes the row to no worker, never to several", () => {
    const roster: Roster = { workers: [ops, eng] };
    expect(workerFor(roster, rowFor("builder"))).toBeUndefined();
  });

  it("resolves a name only one worker carries", () => {
    const roster: Roster = { workers: [ops, toWorker({ id: "eng.reviewer", kind: "worker" })!] };
    expect(workerFor(roster, rowFor("builder"))?.id).toBe("ops.builder");
  });

  it("a full worker id always wins", () => {
    const roster: Roster = { workers: [ops, eng] };
    expect(workerFor(roster, rowFor("ops.builder"))?.id).toBe("ops.builder");
  });
});

describe("BR-15: Tasks leaves done rows out (BR-27)", () => {
  it("keeps every open row and drops done ones", () => {
    const rows = taskStatusSchema.options.map((s) => row(s, "builder"));
    const snapshot = {
      boards: { s_1: { ok: true, value: { refs: ["s_1.tasks"], rows } } },
    } as unknown as LoadedSnapshot;
    expect(openRows(snapshot).map((r) => r.status).sort()).toEqual(["errored", "held", "in_progress", "pending"]);
  });
});
