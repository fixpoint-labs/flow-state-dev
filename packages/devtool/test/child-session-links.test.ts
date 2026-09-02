/**
 * The two derivations the Children panel rests on (FIX-1071).
 *
 * Both matter because both fail *quietly* if they are wrong. A coordinate that
 * mis-parses names the wrong dispatch on screen and nothing errors; a topic
 * match that is too eager points a task at another board's background work and
 * the developer clicks through into an unrelated session. So the cases pinned
 * here are the ones where a looser implementation still renders something.
 */
import { describe, expect, it } from "vitest";
import type { ChildSessionSummary } from "@flow-state-dev/client";
import {
  decodeCoordinate,
  linkChildSessionsToTasks,
  taskLinkKey,
} from "../src/react/lib/child-session-links";
import { groupCollections } from "../src/react/lib/task-collection-state";
import type {
  CollectionView,
  Task,
  TaskStreamItem,
} from "../src/react/lib/task-collection-state";

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
        metadata: { topic: "FIX-1" },
      },
    },
  } as never;
}

/** The exact encoding `create-request-host.ts` writes into `topic` for the default `"per-task"` session policy. */
function framed(value: string): string {
  return `${value.length}:${value}`;
}

function perTaskTopic(boardId: string, taskId: string): string {
  return `task|${framed(boardId)}|${framed(taskId)}`;
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

function childSession(
  overrides: Partial<ChildSessionSummary> & { id: string }
): ChildSessionSummary {
  return {
    parentSessionId: "sess_parent",
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

describe("decodeCoordinate", () => {
  it("splits the type from the target on the FIRST colon", () => {
    // A dispatcher name (the "internal" target) may itself contain a colon;
    // splitting on the first one keeps the rest of it in `target` rather than
    // truncating it.
    expect(decodeCoordinate("internal:reviewer:v2")).toEqual({
      type: "internal",
      target: "reviewer:v2",
    });
  });

  it("splits a task hand-off's coordinate into type and assignee", () => {
    expect(decodeCoordinate("task:implement")).toEqual({
      type: "task",
      target: "implement",
    });
  });

  it("decodes an empty assignee, which is a legal worker name", () => {
    // The empty string is a name, not an absence — a board declaring
    // `workers: { "": … }` stamps `coordinate: "task:"` verbatim.
    expect(decodeCoordinate("task:")).toEqual({ type: "task", target: "" });
  });

  it("returns null for a label with no colon at all", () => {
    // A child session started by something other than the dispatch seam may put
    // anything here. Guessing at a partial parse would print a type that was
    // never declared, which reads as fact.
    expect(decodeCoordinate("not-a-coordinate")).toBeNull();
  });

  it("treats both spellings of absent as absent", () => {
    // A record written before the labels existed reads `undefined`; a store that
    // nulls absent keys hands back `null` (BP-030).
    expect(decodeCoordinate(undefined)).toBeNull();
    expect(decodeCoordinate(null)).toBeNull();
    expect(decodeCoordinate("")).toBeNull();
  });
});

describe("linkChildSessionsToTasks", () => {
  it("matches on the per-task key's embedded task id, given a matching coordinate", () => {
    // The default `"per-task"` session policy's topic embeds the task id
    // length-prefixed; a substring check is enough to find it without
    // re-parsing the whole key.
    const child = childSession({
      id: "dsx_1",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:implement",
    });
    const { byTask, byChild } = linkChildSessionsToTasks(
      [child],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(child);
    expect(byChild.get("dsx_1")).toEqual([
      { collectionId: "issues", task: task({ id: "task-a", assignee: "implement" }) },
    ]);
  });

  it("matches on the task's declared metadata.topic under a custom key policy, without the id appearing anywhere", () => {
    // A custom `{ key }` session policy is free to derive a topic that does not
    // mention the task id at all — the fallback the routing seed itself once
    // used (`metadata.topic`) is exactly this shape.
    const child = childSession({
      id: "dsx_1",
      topic: "custom-key-value",
      coordinate: "task:implement",
    });
    const { byTask } = linkChildSessionsToTasks(
      [child],
      [
        board("issues", [
          task({
            id: "task-a",
            assignee: "implement",
            metadata: { topic: "custom-key-value" },
          }),
        ]),
      ]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(child);
  });

  it("does not match when the topic carries neither the id nor the declared topic", () => {
    const child = childSession({
      id: "dsx_1",
      topic: "something-unrelated",
      coordinate: "task:implement",
    });
    const { byTask, byChild } = linkChildSessionsToTasks(
      [child],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byChild.size).toBe(0);
  });

  it("matches a task coordinate whose entry is named differently from the assignee", () => {
    // The coordinate's target is the flow's task ENTRY, and a seat may hand
    // off to an entry of another name — so the entry name alone cannot rule a
    // child out. The topic is what carries the evidence.
    const child = childSession({
      id: "dsx_1",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:review",
    });
    const { byTask } = linkChildSessionsToTasks(
      [child],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(child);
  });

  it("does not match a non-task coordinate (an internal dispatcher) even when the topic fits", () => {
    const child = childSession({
      id: "dsx_1",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "internal:implement",
    });
    const { byTask } = linkChildSessionsToTasks(
      [child],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
  });

  it("refuses a named-assignee child session for a task carrying no assignee", () => {
    // `coordinate: "task:<assignee>"` cannot be built to compare against without
    // an assignee on the task — an unassigned row routes to `uniform`/`floor`/a
    // refusal, never to a named-assignee seat, so this task could not possibly
    // have produced this child.
    const child = childSession({
      id: "dsx_1",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:implement",
    });
    const { byTask, byChild } = linkChildSessionsToTasks(
      [child],
      [board("issues", [task({ id: "task-a" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byChild.size).toBe(0);
  });

  it("links a task whose assignee is the empty string, which is a legal worker name", () => {
    const child = childSession({
      id: "dsx_blank",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:",
    });
    const { byTask } = linkChildSessionsToTasks(
      [child],
      [board("issues", [task({ id: "task-a", assignee: "" })])]
    );
    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(child);
  });

  it("puts several tasks on one child session when a custom key policy shares one topic across them", () => {
    // Not a collision to resolve — it is the substrate's own behaviour under a
    // custom key that ignores task identity. A second task on the same key
    // lands in the same child session and continues its history.
    const child = childSession({
      id: "dsx_1",
      topic: "shared-key",
      coordinate: "task:implement",
    });
    const shared = { topic: "shared-key" };
    const { byChild } = linkChildSessionsToTasks(
      [child],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement", metadata: shared }),
          task({ id: "task-b", assignee: "implement", metadata: shared }),
        ]),
      ]
    );
    expect(byChild.get("dsx_1")?.map((l) => l.task.id)).toEqual(["task-a", "task-b"]);
  });

  it("leaves a task with no matching child session unlinked", () => {
    // The majority case: an inline worker runs inside the request being viewed.
    const { byTask, byChild } = linkChildSessionsToTasks(
      [childSession({ id: "dsx_1", topic: "something-else", coordinate: "task:implement" })],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byChild.size).toBe(0);
  });

  it("links nothing off an unlabelled child session instead of matching everything", () => {
    // A row with no topic is unlabelled, not a wildcard.
    const { byTask } = linkChildSessionsToTasks(
      [childSession({ id: "dsx_1", coordinate: "task:implement" })],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
  });

  it("draws no link when two candidates both fit one task", () => {
    // On a debugging surface a wrong link is worse than none — the developer
    // clicks through into unrelated background work.
    const a = childSession({
      id: "dsx_1",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:implement",
    });
    const b = childSession({
      id: "dsx_2",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:implement",
    });
    const { byTask, byChild } = linkChildSessionsToTasks(
      [a, b],
      [board("issues", [task({ id: "task-a", assignee: "implement" })])]
    );
    expect(byTask.size).toBe(0);
    expect(byChild.size).toBe(0);
  });

  it("separates two workers on one topic by the task's assignee", () => {
    const implementChild = childSession({
      id: "dsx_impl",
      topic: "shared-key",
      coordinate: "task:implement",
    });
    const reviewChild = childSession({
      id: "dsx_review",
      topic: "shared-key",
      coordinate: "task:review",
    });
    const shared = { topic: "shared-key" };

    const { byTask } = linkChildSessionsToTasks(
      [implementChild, reviewChild],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement", metadata: shared }),
          task({ id: "task-b", assignee: "review", metadata: shared }),
        ]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(implementChild);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBe(reviewChild);
  });

  it("resolves against the task's newest state, not the oldest request's", () => {
    // Driven through the real fold and the real arrival order rather than two
    // pre-ordered snapshots, because the ordering IS the bug — handing the
    // resolver a ready-made `CollectionView` would pass either way.
    //
    // The task was claimed by `implement` in an earlier request and reassigned
    // to `review` in a later one. Requests arrive newest-first, so a fold that
    // takes the last item it walks past holds the `implement` snapshot, and the
    // link then resolves against an assignee the task no longer has.
    const reviewChild = childSession({
      id: "dsx_review",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:review",
    });
    const implementChild = childSession({
      id: "dsx_impl",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:implement",
    });

    const collections = groupCollections([
      // Newer request first, as `listSessionRequests` hands them over.
      taskChange({ requestId: "req_2", ts: 2_000, assignee: "review" }),
      taskChange({ requestId: "req_1", ts: 1_000, assignee: "implement" }),
    ]);

    const { byTask } = linkChildSessionsToTasks([reviewChild, implementChild], collections);

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(reviewChild);
  });

  it("draws no link when two boards in the session contend for one child session", () => {
    // `coordinate` carries no board identity at all now, so contention across
    // collections is the only signal available — see the file header. If tasks
    // in more than one collection each resolve to the same child, at most one
    // of them owns it and nothing on the wire says which, so neither gets a
    // link.
    const child = childSession({
      id: "dsx_1",
      topic: "shared-key",
      coordinate: "task:implement",
    });
    const shared = { topic: "shared-key" };

    const { byTask, byChild } = linkChildSessionsToTasks(
      [child],
      [
        board("issues", [task({ id: "task-a", assignee: "implement", metadata: shared })]),
        board("chores", [task({ id: "task-b", assignee: "implement", metadata: shared })]),
      ]
    );

    expect(byTask.size).toBe(0);
    expect(byChild.size).toBe(0);
  });

  it("keeps one board's tasks linked when it is the only claimant", () => {
    // The guard against over-reading contention: two collections in the session
    // is not itself ambiguity. Only the collection whose task actually resolves
    // to the child session claims it, so the link stands.
    const child = childSession({
      id: "dsx_1",
      topic: perTaskTopic("issues", "task-a"),
      coordinate: "task:implement",
    });

    const { byTask } = linkChildSessionsToTasks(
      [child],
      [
        board("issues", [task({ id: "task-a", assignee: "implement" })]),
        board("chores", [task({ id: "task-b", assignee: "implement" })]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(child);
    expect(byTask.size).toBe(1);
  });

  it("keys a link by collection, so one board's row is never another's", () => {
    // Same task id on two boards is legal, which is why the key carries the
    // collection. Asserted on the key itself rather than through a link, because
    // two boards claiming one child session is now refused outright.
    expect(taskLinkKey("issues", "task-a")).not.toBe(taskLinkKey("chores", "task-a"));
  });
});
