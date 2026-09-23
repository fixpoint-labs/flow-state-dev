/**
 * The two derivations the dispatch runs panel rests on (FIX-1071).
 *
 * Both matter because both fail *quietly* if they are wrong. A key that
 * mis-parses names the wrong board or row on screen and nothing errors; a
 * pairing that is too eager points a task at another board's background work
 * and the developer clicks through into an unrelated session. So the cases
 * pinned here are the ones where a looser implementation still renders
 * something.
 *
 * The labels are built by the writer itself — `taskSessionKeyFor` — rather
 * than by a local mirror of its encoding, so a change to the key's spelling
 * fails here instead of drifting past.
 */
import { describe, expect, it } from "vitest";
import type { ChildSessionSummary } from "@flow-state-dev/client";
import { taskSessionKeyFor } from "@flow-state-dev/core";
import {
  decodeDispatchRunEntry,
  decodeDispatchRunKey,
  linkDispatchRunsToTasks,
  taskLinkKey,
} from "../src/react/lib/dispatch-run-links";
import { groupCollections } from "../src/react/lib/task-collection-state";
import type {
  CollectionView,
  Task,
  TaskStreamItem,
} from "../src/react/lib/task-collection-state";

/** The key a `per-task` seat's hand-off runs `taskId` under, as the writer spells it. */
function perTaskKey(boardId: string, taskId: string): string {
  return taskSessionKeyFor(
    "board",
    "per-task",
    { boardId, seat: "unused", taskId, attempt: 0, createdAt: 0, payload: undefined },
    {} as never
  );
}

/** The key a `per-worker` seat's hand-off runs every one of its rows under. */
function perWorkerKey(boardId: string, seat: string): string {
  return taskSessionKeyFor(
    "board",
    "per-worker",
    { boardId, seat, taskId: "unused", attempt: 0, createdAt: 0, payload: undefined },
    {} as never
  );
}

/** One `task-change` item for `task-a`, as the substrate emits it. */
function taskChange(options: {
  requestId: string;
  ts: number;
  assignee: string;
}): TaskStreamItem {
  return {
    id: `item_${options.requestId}`,
    type: "component",
    status: "completed",
    requestId: options.requestId,
    itemIndex: 0,
    provenance: { blockName: "board", blockInstanceId: "b:0", phase: "main" },
    ts: options.ts,
    component: "task-change",
    data: {
      collectionId: "issues",
      taskId: "task-a",
      kind: "assignee_changed",
      task: {
        id: "task-a",
        goal: "do the thing",
        status: "in_progress",
        assignee: options.assignee,
      },
    },
  } as never;
}

function task(overrides: Partial<Task> & { id: string }): Task {
  return { goal: "do the thing", status: "in_progress", ...overrides };
}

function board(id: string, tasks: Task[]): CollectionView {
  return {
    id,
    boardMeta: {},
    tasks: tasks.map((t) => ({ task: t, changeCount: 1 })),
  };
}

function dispatchRun(overrides: Partial<ChildSessionSummary> & { id: string }): ChildSessionSummary {
  return {
    parentSessionId: "sess_parent",
    createdAt: 1,
    updatedAt: 2,
    coordinate: "task:implement",
    ...overrides,
  };
}

describe("decodeDispatchRunKey", () => {
  it("reads a per-task key back into its board and row", () => {
    expect(decodeDispatchRunKey(perTaskKey("issue-work", "task-a"))).toEqual({
      policy: "per-task",
      boardId: "issue-work",
      taskId: "task-a",
    });
  });

  it("reads a per-worker key back into its board and seat", () => {
    expect(decodeDispatchRunKey(perWorkerKey("issue-work", "implement"))).toEqual({
      policy: "per-worker",
      boardId: "issue-work",
      seat: "implement",
    });
  });

  it("splits fields by their length, not on the first separator", () => {
    // The whole reason the key is length-framed: a board id containing `|` or
    // `:` would make a naive `split` report a board that does not exist.
    expect(decodeDispatchRunKey(perTaskKey("issue|work", "a:b|c"))).toEqual({
      policy: "per-task",
      boardId: "issue|work",
      taskId: "a:b|c",
    });
  });

  it("returns null for a flow-computed key rather than guessing at it", () => {
    // A `{ key }` policy's string is opaque by contract. "FIX-1" names something
    // to the flow's author and nothing to this reader.
    expect(decodeDispatchRunKey("FIX-1")).toBeNull();
    expect(decodeDispatchRunKey("wake")).toBeNull();
  });

  it("returns null for a label whose framing does not check out, instead of half-parsing it", () => {
    // Each of these is one byte away from a key the writer would produce.
    // Accepting any of them prints a board or a row that was never declared,
    // which reads as fact on a debugging surface.
    const good = perTaskKey("issue-work", "task-a");
    expect(decodeDispatchRunKey(`${good}x`)).toBeNull(); // trailing bytes
    expect(decodeDispatchRunKey(good.slice(0, -1))).toBeNull(); // short value
    expect(decodeDispatchRunKey("task|9:issue-work|6:task-a")).toBeNull(); // wrong length
    expect(decodeDispatchRunKey("task|010:issue-work|6:task-a")).toBeNull(); // leading zero
    expect(decodeDispatchRunKey("task|10:issue-work;6:task-a")).toBeNull(); // wrong separator
    expect(decodeDispatchRunKey("task|10:issue-work")).toBeNull(); // one field
    expect(decodeDispatchRunKey("task|0:|6:task-a")).toBeNull(); // empty board
    expect(decodeDispatchRunKey("row|10:issue-work|6:task-a")).toBeNull(); // unknown tag
    expect(decodeDispatchRunKey("10:issue-work|6:task-a")).toBeNull(); // no tag
  });

  it("treats both spellings of absent as absent", () => {
    // A record written before the labels existed reads `undefined`; a store that
    // nulls absent keys hands back `null` (BP-030).
    expect(decodeDispatchRunKey(undefined)).toBeNull();
    expect(decodeDispatchRunKey(null)).toBeNull();
    expect(decodeDispatchRunKey("")).toBeNull();
  });
});

describe("decodeDispatchRunEntry", () => {
  it("splits the dispatch type from the entry name at the first colon", () => {
    expect(decodeDispatchRunEntry("task:implement")).toEqual({
      type: "task",
      action: "implement",
    });
    expect(decodeDispatchRunEntry("internal:wake")).toEqual({ type: "internal", action: "wake" });
    // A dispatch type never contains `:`; a target may.
    expect(decodeDispatchRunEntry("task:ns:implement")).toEqual({
      type: "task",
      action: "ns:implement",
    });
  });

  it("returns null for a label that names no entry", () => {
    expect(decodeDispatchRunEntry("opaque")).toBeNull();
    expect(decodeDispatchRunEntry(":implement")).toBeNull();
    expect(decodeDispatchRunEntry("task:")).toBeNull();
    expect(decodeDispatchRunEntry(undefined)).toBeNull();
    expect(decodeDispatchRunEntry(null)).toBeNull();
  });
});

describe("linkDispatchRunsToTasks", () => {
  it("links a per-task child to the row its key names, in both directions", () => {
    const ws = dispatchRun({ id: "dsx_1", topic: perTaskKey("issue-work", "task-a") });
    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [ws],
      [board("issues", [task({ id: "task-a", assignee: "implement" }), task({ id: "task-b" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBeUndefined();
    expect(byDispatchRun.get("dsx_1")).toEqual([
      { collectionId: "issues", task: task({ id: "task-a", assignee: "implement" }) },
    ]);
  });

  it("fans a per-worker child out over every row on its seat", () => {
    // Not a collision to resolve — it is the substrate's behaviour. A
    // `per-worker` seat runs all of its rows in one child, so the panel has to
    // be able to say so, and each of those rows points back at the same child.
    const ws = dispatchRun({ id: "dsx_impl", topic: perWorkerKey("issue-work", "implement") });
    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [ws],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement" }),
          task({ id: "task-b", assignee: "review" }),
          task({ id: "task-c", assignee: "implement" }),
          // Unassigned: not on any seat, so not on this one.
          task({ id: "task-d" }),
        ]),
      ]
    );
    expect(byDispatchRun.get("dsx_impl")?.map((l) => l.task.id)).toEqual(["task-a", "task-c"]);
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
    expect(byTask.get(taskLinkKey("issues", "task-c"))).toBe(ws);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBeUndefined();
    expect(byTask.get(taskLinkKey("issues", "task-d"))).toBeUndefined();
  });

  it("pairs a per-task key on the row's id, not its assignee", () => {
    // The key names one row. Whatever seat the row is on now — or none — the
    // child derived for it is this one.
    const ws = dispatchRun({ id: "dsx_1", topic: perTaskKey("issue-work", "task-a") });
    const { byTask } = linkDispatchRunsToTasks(
      [ws],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
  });

  it("links nothing off a flow-computed key", () => {
    // A `{ key }` policy run is a board's child too, but its key says nothing
    // this reader can act on. Matching it against a task carrying the same
    // string in some field would be a guess dressed as a rule.
    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [dispatchRun({ id: "dsx_1", topic: "task-a" })],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byDispatchRun.size).toBe(0);
  });

  it("links nothing off a key whose framing does not check out", () => {
    // One byte off from a real key. A lenient reader that recovered "task-a"
    // from it would link on a label the writer never wrote.
    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [dispatchRun({ id: "dsx_1", topic: `${perTaskKey("issue-work", "task-a")}x` })],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byDispatchRun.size).toBe(0);
  });

  it("links nothing off an unlabelled dispatch run instead of matching everything", () => {
    // A row with no topic is unlabelled, not a wildcard. Treating absence as a
    // match would attach the first task on every board to it.
    const { byTask } = linkDispatchRunsToTasks(
      [dispatchRun({ id: "dsx_1", topic: undefined, coordinate: undefined })],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.size).toBe(0);
  });

  it("links nothing off a run that is not a board's", () => {
    // An `internal:` dispatch's key is whatever the block chose. Even one that
    // happens to equal a task id names no row.
    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [dispatchRun({ id: "dsx_wake", topic: "task-a", coordinate: "internal:wake" })],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byDispatchRun.size).toBe(0);
  });

  it("leaves a task with no matching dispatch run unlinked", () => {
    // The majority case: an inline seat runs inside the request being viewed.
    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [dispatchRun({ id: "dsx_1", topic: perTaskKey("issue-work", "task-z") })],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byDispatchRun.size).toBe(0);
  });

  it("does not let the entry label stand in for the key", () => {
    // `coordinate` names the entry the run was dispatched for, and a seat's
    // name is usually its entry's — but "usually" is not a pairing rule. A
    // child whose key does not decode stays unlinked however apt its entry.
    const { byTask } = linkDispatchRunsToTasks(
      [dispatchRun({ id: "dsx_1", topic: "FIX-1", coordinate: "task:implement" })],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
  });

  it("resolves against the task's newest state, not the oldest request's", () => {
    // Driven through the real fold and the real arrival order rather than two
    // pre-ordered snapshots, because the ordering IS the bug — handing the
    // resolver a ready-made `CollectionView` would pass either way.
    //
    // The task was claimed by `implement` in an earlier request and reassigned
    // to `review` in a later one. Requests arrive newest-first, so a fold that
    // takes the last item it walks past holds the `implement` snapshot, and the
    // link then resolves against a seat the task is no longer on.
    const reviewWs = dispatchRun({ id: "dsx_review", topic: perWorkerKey("issue-work", "review") });
    const implementWs = dispatchRun({
      id: "dsx_impl",
      topic: perWorkerKey("issue-work", "implement"),
    });

    const collections = groupCollections([
      // Newer request first, as `listSessionRequests` hands them over.
      taskChange({ requestId: "req_2", ts: 2_000, assignee: "review" }),
      taskChange({ requestId: "req_1", ts: 1_000, assignee: "implement" }),
    ]);

    const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
      [reviewWs, implementWs],
      collections
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(reviewWs);
    expect(byDispatchRun.get("dsx_impl")).toBeUndefined();
  });

  describe("the board leg, which cannot be checked and so is detected", () => {
    // A key frames `boardId` in beside the row or the seat, so a run belongs
    // to ONE board — but nothing on the task side carries a board id.
    // `task-change` and `task-board-meta` emit `collectionId`, and `taskBoard`
    // documents that as a deliberately different string from `boardId`, so
    // board equality can never be checked the way the row and the seat can.
    //
    // What IS observable is contention, and clicking the wrong claimant opens
    // unrelated work, so contention draws nothing.

    it("draws no link when two collections hold the row a per-task child names", () => {
      const ws = dispatchRun({ id: "dsx_1", topic: perTaskKey("issue-work", "task-a") });
      const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
        [ws],
        [
          board("issues", [task({ id: "task-a", assignee: "implement" })]),
          board("chores", [task({ id: "task-a", assignee: "implement" })]),
        ]
      );
      expect(byTask.size).toBe(0);
      expect(byDispatchRun.size).toBe(0);
    });

    it("draws no link when two collections carry the seat a per-worker child names", () => {
      // Seat names are per board, so two boards may each declare `implement`.
      // Only one of them owns this child, and nothing on the wire says which.
      const ws = dispatchRun({ id: "dsx_impl", topic: perWorkerKey("issue-work", "implement") });
      const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
        [ws],
        [
          board("issues", [task({ id: "task-a", assignee: "implement" })]),
          board("chores", [task({ id: "task-b", assignee: "implement" })]),
        ]
      );
      expect(byTask.size).toBe(0);
      expect(byDispatchRun.size).toBe(0);
    });

    it("draws no link when two children name the same row", () => {
      // The other direction of the same gap: two boards' per-task children for
      // a `task-a`, and one rendered collection holding a `task-a`. The keys
      // carry different board ids, and the task carries none to pick with.
      const { byTask, byDispatchRun } = linkDispatchRunsToTasks(
        [
          dispatchRun({ id: "dsx_a", topic: perTaskKey("board-a", "task-a") }),
          dispatchRun({ id: "dsx_b", topic: perTaskKey("board-b", "task-a") }),
        ],
        [board("issues", [task({ id: "task-a", assignee: "implement" })])]
      );
      expect(byTask.size).toBe(0);
      expect(byDispatchRun.size).toBe(0);
    });

    it("keeps one collection's tasks linked when it is the only claimant", () => {
      // The guard against over-reading contention: two collections in the
      // session is not itself ambiguity. Only the collection whose task
      // actually fits the run claims it, so the link stands.
      const ws = dispatchRun({ id: "dsx_impl", topic: perWorkerKey("issue-work", "implement") });
      const { byTask } = linkDispatchRunsToTasks(
        [ws],
        [
          board("issues", [task({ id: "task-a", assignee: "implement" })]),
          board("chores", [task({ id: "task-b", assignee: "review" })]),
        ]
      );
      expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
      expect(byTask.size).toBe(1);
    });
  });

  it("keys a link by collection, so one board's row is never another's", () => {
    // Same task id on two boards is legal, which is why the key carries the
    // collection. Asserted on the key itself rather than through a link, because
    // two boards claiming one dispatch run is refused outright.
    expect(taskLinkKey("issues", "task-a")).not.toBe(taskLinkKey("chores", "task-a"));
  });
});
