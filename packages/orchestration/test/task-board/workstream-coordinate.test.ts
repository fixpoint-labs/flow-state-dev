/**
 * The routing coordinate a detached worker is addressed by (FIX-982 P2).
 *
 * Every assertion here is about **two things not becoming one thing**. A
 * coordinate is hashed into a persisted session key, so a collision does not
 * throw and does not log: two unrelated bodies of work quietly land in one
 * history, and the only symptom is a worker seeing turns it never produced.
 * That failure is invisible from the outside, which is why the encoding is
 * pinned here rather than left to the call sites that consume it.
 *
 * The three ways two coordinates could alias, each covered below:
 *
 * 1. **Tag aliasing** — a board legally names an assignee `uniform` or `floor`,
 *    and a bare-string encoding merges it with the slot of that name.
 * 2. **Boundary migration** — a separator moves between fields, so
 *    `("a", "b|c")` and `("a|b", "c")` encode identically.
 * 3. **A missing dimension** — two boards in one flow share a topic and an
 *    assignee name. The runtime's key derivation has no board dimension of its
 *    own, so if `boardId` is not folded into the seed the two boards collide.
 */
import { describe, expect, it } from "vitest";
import {
  coordinateKey,
  coordinateLabel,
  workstreamRoutingSeed,
  type WorkerCoordinate,
} from "../../src/task-board";

describe("coordinateKey — the tag cannot alias a name", () => {
  it("keeps an assignee literally named 'uniform' distinct from the uniform slot", () => {
    // Assignee names are unrestricted, so this board is legal. Under a bare
    // string encoding both sides produce "uniform" and the two workers share
    // one Workstream — the exact case the tagged union exists for.
    const named: WorkerCoordinate = { kind: "assignee", name: "uniform" };
    const slot: WorkerCoordinate = { kind: "uniform" };

    expect(coordinateKey(named)).not.toBe(coordinateKey(slot));
  });

  it("keeps an assignee literally named 'floor' distinct from the floor slot", () => {
    expect(coordinateKey({ kind: "assignee", name: "floor" })).not.toBe(
      coordinateKey({ kind: "floor" })
    );
  });

  it("distinguishes two assignees whose names differ only where a separator could migrate", () => {
    // Without length framing, an encoder joining tag and name on a delimiter
    // lets the boundary move: these two must not collapse.
    expect(coordinateKey({ kind: "assignee", name: "a|4:b" })).not.toBe(
      coordinateKey({ kind: "assignee", name: "a" })
    );
  });

  it("is stable for the same coordinate — the property a restart depends on", () => {
    // A binding is re-resolved from strings after a restart. An encoding that
    // varied per process would make every recovered wake unroutable.
    const a = coordinateKey({ kind: "assignee", name: "implement" });
    const b = coordinateKey({ kind: "assignee", name: "implement" });
    expect(a).toBe(b);
  });
});

describe("coordinateLabel — the readable form", () => {
  it("renders the three cases the refusal messages report", () => {
    expect(coordinateLabel({ kind: "assignee", name: "implement" })).toBe("assignee:implement");
    expect(coordinateLabel({ kind: "uniform" })).toBe("uniform");
    expect(coordinateLabel({ kind: "floor" })).toBe("floor");
  });
});

describe("workstreamRoutingSeed — boardId is a dimension the runtime does not have", () => {
  const coordinate: WorkerCoordinate = { kind: "assignee", name: "implement" };

  it("separates two boards that share a topic and an assignee name", () => {
    // The runtime derives a child session from (tenant, principal, parent
    // session, topic, key). There is no board in that material, so if `boardId`
    // is not inside `key` these two derive the SAME child session and interleave
    // two unrelated bodies of work in one history.
    const a = workstreamRoutingSeed({
      boardId: "issue-work",
      coordinate,
      topic: "FIX-1",
      topicFallback: "task-a",
    });
    const b = workstreamRoutingSeed({
      boardId: "review-work",
      coordinate,
      topic: "FIX-1",
      topicFallback: "task-b",
    });

    expect(a.topic).toBe(b.topic);
    expect(a.key).not.toBe(b.key);
  });

  it("does not let the board/coordinate boundary migrate", () => {
    const a = workstreamRoutingSeed({
      boardId: "board",
      coordinate: { kind: "assignee", name: "x" },
      topic: "t",
      topicFallback: "f",
    });
    const b = workstreamRoutingSeed({
      boardId: "boar",
      coordinate: { kind: "assignee", name: "dx" },
      topic: "t",
      topicFallback: "f",
    });

    expect(a.key).not.toBe(b.key);
  });

  it("routes two tasks on one topic to the same key — topic continuity is the point", () => {
    // The second task on a topic must append to the SAME Workstream. This is
    // the ordinary path, not an edge case, so the fallback must not leak into
    // it: both tasks carry a topic, so their differing ids must not matter.
    const first = workstreamRoutingSeed({
      boardId: "issue-work",
      coordinate,
      topic: "FIX-1",
      topicFallback: "task-1",
    });
    const second = workstreamRoutingSeed({
      boardId: "issue-work",
      coordinate,
      topic: "FIX-1",
      topicFallback: "task-2",
    });

    expect(second).toEqual(first);
  });

  it("falls back to the task id when a topic is absent or blank", () => {
    // Continuity must be opted into. Two tasks that both forgot a topic are not
    // related, and silently sharing a Workstream would splice their histories.
    const absent = workstreamRoutingSeed({
      boardId: "issue-work",
      coordinate,
      topicFallback: "task-1",
    });
    const blank = workstreamRoutingSeed({
      boardId: "issue-work",
      coordinate,
      topic: "   ",
      topicFallback: "task-2",
    });

    expect(absent.topic).toBe("task-1");
    expect(blank.topic).toBe("task-2");
    expect(absent.topic).not.toBe(blank.topic);
  });

  it("trims a topic rather than treating padding as meaning", () => {
    const padded = workstreamRoutingSeed({
      boardId: "issue-work",
      coordinate,
      topic: "  FIX-1  ",
      topicFallback: "task-1",
    });
    expect(padded.topic).toBe("FIX-1");
  });
});
