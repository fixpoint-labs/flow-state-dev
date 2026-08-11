/**
 * The two derivations the Workstreams panel rests on (FIX-1071).
 *
 * Both matter because both fail *quietly* if they are wrong. A coordinate that
 * mis-parses names the wrong board on screen and nothing errors; a topic match
 * that is too eager points a task at another board's background work and the
 * developer clicks through into an unrelated session. So the cases pinned here
 * are the ones where a looser implementation still renders something.
 */
import { describe, expect, it } from "vitest";
import type { WorkstreamSummary } from "@flow-state-dev/client";
import {
  decodeWorkstreamCoordinate,
  linkWorkstreamsToTasks,
  taskLinkKey,
} from "../src/react/lib/workstream-links";
import type { CollectionView, Task } from "../src/react/lib/task-collection-state";

/** The exact encoding `workstreamRoutingSeed` writes into `coordinate`. */
function coordinate(boardId: string, coordinateKey: string): string {
  return `${boardId.length}:${boardId}|${coordinateKey.length}:${coordinateKey}`;
}

function assigneeKey(name: string): string {
  return `assignee|${name.length}:${name}`;
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

function workstream(overrides: Partial<WorkstreamSummary> & { id: string }): WorkstreamSummary {
  return {
    parentSessionId: "sess_parent",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("decodeWorkstreamCoordinate", () => {
  it("splits the board from the worker, not on the first separator", () => {
    // The whole reason the encoding is length-framed: a board id containing the
    // separator would make a naive `split("|")` report board "issue" and a
    // worker of "work", which is a board that does not exist.
    const decoded = decodeWorkstreamCoordinate(
      coordinate("issue|work", assigneeKey("implement"))
    );
    expect(decoded).toEqual({ boardId: "issue|work", worker: "assignee:implement" });
  });

  it("spells an assignee the way the board's own diagnostics do", () => {
    expect(
      decodeWorkstreamCoordinate(coordinate("b", assigneeKey("review")))?.worker
    ).toBe("assignee:review");
  });

  it("keeps uniform and floor apart from an assignee that shares their spelling", () => {
    // Assignee names are unrestricted, so a board may legally declare one called
    // "uniform". The tag is serialized before the name precisely so the two
    // cannot alias, and this asserts the reader honours that.
    expect(decodeWorkstreamCoordinate(coordinate("b", "uniform"))?.worker).toBe(
      "uniform"
    );
    expect(
      decodeWorkstreamCoordinate(coordinate("b", assigneeKey("uniform")))?.worker
    ).toBe("assignee:uniform");
  });

  it("returns null for a label it does not recognise rather than half-parsing one", () => {
    // A Workstream started by something other than a task board may put anything
    // here. Guessing at a partial parse would print a board id that was never
    // declared, which reads as fact.
    expect(decodeWorkstreamCoordinate("not-framed")).toBeNull();
    expect(decodeWorkstreamCoordinate("5:ab|3:cd")).toBeNull();
    expect(decodeWorkstreamCoordinate(coordinate("b", "uniform") + "trailing")).toBeNull();
  });

  it("treats both spellings of absent as absent", () => {
    // A record written before the labels existed reads `undefined`; a store that
    // nulls absent keys hands back `null` (BP-030).
    expect(decodeWorkstreamCoordinate(undefined)).toBeNull();
    expect(decodeWorkstreamCoordinate(null)).toBeNull();
    expect(decodeWorkstreamCoordinate("")).toBeNull();
  });
});

describe("linkWorkstreamsToTasks", () => {
  it("matches a task that declared no topic by its id", () => {
    // The routing seed falls back to the task id, so an unlabelled task's
    // Workstream is named after it. Without this the common case — a board whose
    // tasks carry no topic metadata — would show no links at all.
    const ws = workstream({ id: "dsx_1", topic: "task-a" });
    const { byTask, byWorkstream } = linkWorkstreamsToTasks(
      [ws],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
    expect(byWorkstream.get("dsx_1")).toEqual([
      { collectionId: "issues", task: task({ id: "task-a" }) },
    ]);
  });

  it("prefers a declared topic over the id, the way the seed does", () => {
    const ws = workstream({ id: "dsx_1", topic: "FIX-1" });
    const { byTask } = linkWorkstreamsToTasks(
      [ws],
      [board("issues", [task({ id: "task-a", metadata: { topic: "FIX-1" } })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
  });

  it("falls back to the id when the declared topic is blank", () => {
    // `workstreamRoutingSeed` normalizes a whitespace-only topic to absent, so a
    // reader that trusted the blank string would fail to match the very
    // Workstream the seed created.
    const ws = workstream({ id: "dsx_1", topic: "task-a" });
    const { byTask } = linkWorkstreamsToTasks(
      [ws],
      [board("issues", [task({ id: "task-a", metadata: { topic: "  " } })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
  });

  it("puts several tasks on one Workstream when they share a topic", () => {
    // Not a collision to resolve — it is the substrate's behaviour. A second task
    // on the same topic lands in the same child session and continues its
    // history, so the panel has to be able to say so.
    const ws = workstream({ id: "dsx_1", topic: "FIX-1" });
    const shared = { topic: "FIX-1" };
    const { byWorkstream } = linkWorkstreamsToTasks(
      [ws],
      [
        board("issues", [
          task({ id: "task-a", metadata: shared }),
          task({ id: "task-b", metadata: shared }),
        ]),
      ]
    );
    expect(byWorkstream.get("dsx_1")?.map((l) => l.task.id)).toEqual([
      "task-a",
      "task-b",
    ]);
  });

  it("leaves a task with no matching Workstream unlinked", () => {
    // The majority case: an inline worker runs inside the request being viewed.
    const { byTask, byWorkstream } = linkWorkstreamsToTasks(
      [workstream({ id: "dsx_1", topic: "something-else" })],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byWorkstream.size).toBe(0);
  });

  it("links nothing off an unlabelled Workstream instead of matching everything", () => {
    // A row with no topic is unlabelled, not a wildcard. Treating absence as a
    // match would attach the first task on every board to it.
    const { byTask } = linkWorkstreamsToTasks(
      [workstream({ id: "dsx_1" })],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.size).toBe(0);
  });

  it("separates two workers on one topic by the task's assignee", () => {
    // A topic is not a session. The routing seed hashes the topic AND the
    // coordinate key, so one topic routed to two workers is two child sessions
    // — matching on topic alone sent both tasks into whichever arrived first
    // and left the other Workstream looking taskless.
    const implementWs = workstream({
      id: "dsx_impl",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", assigneeKey("implement")),
    });
    const reviewWs = workstream({
      id: "dsx_review",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", assigneeKey("review")),
    });
    const shared = { topic: "FIX-1" };

    const { byTask } = linkWorkstreamsToTasks(
      [implementWs, reviewWs],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement", metadata: shared }),
          task({ id: "task-b", assignee: "review", metadata: shared }),
        ]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(implementWs);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBe(reviewWs);
  });

  it("draws no link when a shared topic cannot be resolved to one worker", () => {
    // A `uniform` board's coordinate names no assignee, so nothing distinguishes
    // the two candidates. On a debugging surface a wrong link is worse than
    // none — the developer clicks through into unrelated background work.
    const { byTask, byWorkstream } = linkWorkstreamsToTasks(
      [
        workstream({
          id: "dsx_1",
          topic: "FIX-1",
          coordinate: coordinate("issue-work", "uniform"),
        }),
        workstream({
          id: "dsx_2",
          topic: "FIX-1",
          coordinate: coordinate("issue-work", "uniform"),
        }),
      ],
      [board("issues", [task({ id: "task-a", assignee: "implement", metadata: { topic: "FIX-1" } })])]
    );

    expect(byTask.size).toBe(0);
    expect(byWorkstream.size).toBe(0);
  });

  it("does not merge two boards' tasks under different collection ids", () => {
    // Same task id on two boards is legal. The key carries the collection so the
    // two rows stay distinct even when both link to the same Workstream.
    const ws = workstream({ id: "dsx_1", topic: "task-a" });
    const { byTask } = linkWorkstreamsToTasks(
      [ws],
      [board("issues", [task({ id: "task-a" })]), board("chores", [task({ id: "task-a" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
    expect(byTask.get(taskLinkKey("chores", "task-a"))).toBe(ws);
    expect(byTask.size).toBe(2);
  });
});
