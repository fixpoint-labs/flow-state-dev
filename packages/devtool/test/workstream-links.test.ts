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

  it("checks the coordinate even when the topic has only one candidate", () => {
    // The ordinary shape of the same defect, and the one a count-gated check
    // waves through: two tasks share a topic but target different workers, and
    // only the `implement` one has spawned — the `review` task is inline, or has
    // not started. That single Workstream is then the only candidate for BOTH,
    // so a check that runs only on contested topics links the review task to a
    // session that is not running it.
    const implementWs = workstream({
      id: "dsx_impl",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", assigneeKey("implement")),
    });
    const shared = { topic: "FIX-1" };

    const { byTask, byWorkstream } = linkWorkstreamsToTasks(
      [implementWs],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement", metadata: shared }),
          task({ id: "task-b", assignee: "review", metadata: shared }),
        ]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(implementWs);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBeUndefined();
    // And the reverse direction must not claim the review task either.
    expect(byWorkstream.get("dsx_impl")?.map((l) => l.task.id)).toEqual(["task-a"]);
  });

  it("refuses a named-assignee Workstream for a task carrying no assignee", () => {
    // An ABSENT assignee is not an unreadable one. `coordinateForTask` routes an
    // `assignee` coordinate only when the row has an assignee the board
    // declares (`task.assignee !== undefined && declared.has(...)`); an
    // unassigned row gets `uniform`, `floor`, or a refusal. So this task could
    // not possibly have produced this Workstream, and treating its missing
    // assignee as ignorance throws away something the routing rule tells us.
    const ws = workstream({
      id: "dsx_impl",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", assigneeKey("implement")),
    });

    const { byTask, byWorkstream } = linkWorkstreamsToTasks(
      [ws],
      // A genuinely unassigned task, not a hand-built candidate.
      [board("issues", [task({ id: "task-a", metadata: { topic: "FIX-1" } })])]
    );

    expect(byTask.size).toBe(0);
    expect(byWorkstream.size).toBe(0);
  });

  // The two sides' silences mean different things, and the pair below keeps them
  // apart on purpose. A COORDINATE that names no worker is ignorance and stays
  // eligible; a TASK with no assignee, against a coordinate that DOES name one,
  // is a contradiction. Kept as separate tests so a later change cannot quietly
  // collapse the two back into one rule — the test above pins the second half.

  it("still links a lone Workstream whose coordinate names no assignee, for an assigned task", () => {
    // A `uniform` board's key names no assignee, and an unlabelled record
    // carries no coordinate at all — neither contradicts anything.
    const uniformWs = workstream({
      id: "dsx_uniform",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", "uniform"),
    });
    const bareWs = workstream({ id: "dsx_bare", topic: "FIX-2" });

    const { byTask } = linkWorkstreamsToTasks(
      [uniformWs, bareWs],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement", metadata: { topic: "FIX-1" } }),
          task({ id: "task-b", assignee: "review", metadata: { topic: "FIX-2" } }),
        ]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(uniformWs);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBe(bareWs);
  });

  it("still links a lone Workstream whose coordinate names no assignee, for an UNASSIGNED task", () => {
    // The pairing that must survive the tightening, and the one the assigned
    // case above cannot speak for. An unassigned row is exactly what
    // `coordinateForTask` routes to `uniform` or `floor`, so this is the
    // ordinary shape of unassigned detached work — not an edge case.
    const uniformWs = workstream({
      id: "dsx_uniform",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", "uniform"),
    });
    const floorWs = workstream({
      id: "dsx_floor",
      topic: "FIX-2",
      coordinate: coordinate("issue-work", "floor"),
    });
    const bareWs = workstream({ id: "dsx_bare", topic: "FIX-3" });

    const { byTask } = linkWorkstreamsToTasks(
      [uniformWs, floorWs, bareWs],
      [
        board("issues", [
          task({ id: "task-a", metadata: { topic: "FIX-1" } }),
          task({ id: "task-b", metadata: { topic: "FIX-2" } }),
          task({ id: "task-c", metadata: { topic: "FIX-3" } }),
        ]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(uniformWs);
    expect(byTask.get(taskLinkKey("issues", "task-b"))).toBe(floorWs);
    expect(byTask.get(taskLinkKey("issues", "task-c"))).toBe(bareWs);
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

  describe("the identity parts, taken one at a time", () => {
    // A child session is identified by (board, worker coordinate, topic). The
    // rule is one rule, not three cases: a part that DECODES AND DISAGREES
    // disqualifies a candidate, and a part that cannot be read leaves it
    // eligible. What differs between the parts is only whether the task side
    // carries anything to compare against — and the board side carries nothing,
    // which is why its disagreement has to be detected rather than checked.
    const cases: Array<{
      part: string;
      candidates: WorkstreamSummary[];
      taskAssignee?: string;
      /** The id expected, or `undefined` for "ambiguous, draw nothing". */
      expected: string | undefined;
      why: string;
    }> = [
      {
        part: "board",
        candidates: [
          workstream({
            id: "dsx_a",
            topic: "FIX-1",
            coordinate: coordinate("board-a", assigneeKey("implement")),
          }),
          workstream({
            id: "dsx_b",
            topic: "FIX-1",
            coordinate: coordinate("board-b", assigneeKey("implement")),
          }),
        ],
        taskAssignee: "implement",
        expected: undefined,
        why: "the task carries no board id, so it cannot pick between them",
      },
      {
        part: "worker (task names one)",
        candidates: [
          workstream({
            id: "dsx_impl",
            topic: "FIX-1",
            coordinate: coordinate("issue-work", assigneeKey("implement")),
          }),
          workstream({
            id: "dsx_review",
            topic: "FIX-1",
            coordinate: coordinate("issue-work", assigneeKey("review")),
          }),
        ],
        taskAssignee: "implement",
        expected: "dsx_impl",
        // The one part the task CAN check, so a difference is resolvable rather
        // than ambiguous. Refusing here would delete correct behaviour.
        why: "assignee decides it",
      },
      {
        part: "worker (task names none)",
        candidates: [
          workstream({
            id: "dsx_impl",
            topic: "FIX-1",
            coordinate: coordinate("issue-work", assigneeKey("implement")),
          }),
          workstream({
            id: "dsx_review",
            topic: "FIX-1",
            coordinate: coordinate("issue-work", assigneeKey("review")),
          }),
        ],
        expected: undefined,
        // Not "nothing to compare" — an unassigned row cannot reach an
        // assignee coordinate at all, so BOTH are contradicted rather than
        // both being unknown. Same outcome, different reason.
        why: "an unassigned task contradicts every named-assignee coordinate",
      },
      {
        part: "nothing (identical coordinates)",
        candidates: [
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
        taskAssignee: "implement",
        expected: undefined,
        why: "a uniform board names no assignee, so neither can be excluded",
      },
    ];

    for (const scenario of cases) {
      it(`differing in ${scenario.part} — ${scenario.why}`, () => {
        const { byTask } = linkWorkstreamsToTasks(scenario.candidates, [
          board("issues", [
            task({
              id: "task-a",
              metadata: { topic: "FIX-1" },
              ...(scenario.taskAssignee !== undefined
                ? { assignee: scenario.taskAssignee }
                : {}),
            }),
          ]),
        ]);

        expect(byTask.get(taskLinkKey("issues", "task-a"))?.id).toBe(scenario.expected);
      });
    }
  });

  it("draws no link when two boards in the session contend for one Workstream", () => {
    // The third leg of identity. `deriveChildSessionId` hashes topic AND a key
    // built from `boardId|coordinateKey`, so a Workstream belongs to ONE board —
    // but nothing on the task side carries a board id. `task-change` and
    // `task-board-meta` emit `collectionId`, and `taskBoard` documents that as a
    // deliberately different string from `boardId`, so board equality can never
    // be checked the way the worker can.
    //
    // What IS observable is contention: if tasks in more than one collection
    // each resolve to the same Workstream, at most one of them owns it and
    // nothing on the wire says which. Clicking the wrong one opens unrelated
    // work, so neither gets a link.
    const ws = workstream({
      id: "dsx_1",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", assigneeKey("implement")),
    });
    const shared = { topic: "FIX-1" };

    const { byTask, byWorkstream } = linkWorkstreamsToTasks(
      [ws],
      [
        board("issues", [task({ id: "task-a", assignee: "implement", metadata: shared })]),
        board("chores", [task({ id: "task-b", assignee: "implement", metadata: shared })]),
      ]
    );

    expect(byTask.size).toBe(0);
    expect(byWorkstream.size).toBe(0);
  });

  it("keeps one board's tasks linked when it is the only claimant", () => {
    // The guard against over-reading contention: two collections in the session
    // is not itself ambiguity. Only the collection whose task actually resolves
    // to the Workstream claims it, so the link stands.
    const ws = workstream({
      id: "dsx_1",
      topic: "FIX-1",
      coordinate: coordinate("issue-work", assigneeKey("implement")),
    });

    const { byTask } = linkWorkstreamsToTasks(
      [ws],
      [
        board("issues", [
          task({ id: "task-a", assignee: "implement", metadata: { topic: "FIX-1" } }),
        ]),
        board("chores", [
          task({ id: "task-b", assignee: "implement", metadata: { topic: "FIX-2" } }),
        ]),
      ]
    );

    expect(byTask.get(taskLinkKey("issues", "task-a"))).toBe(ws);
    expect(byTask.size).toBe(1);
  });

  it("keys a link by collection, so one board's row is never another's", () => {
    // Same task id on two boards is legal, which is why the key carries the
    // collection. Asserted on the key itself rather than through a link, because
    // two boards claiming one Workstream is now refused outright.
    expect(taskLinkKey("issues", "task-a")).not.toBe(taskLinkKey("chores", "task-a"));
  });
});
