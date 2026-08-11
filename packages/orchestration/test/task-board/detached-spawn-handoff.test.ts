/**
 * The spawn block's hand-off ordering (FIX-982).
 *
 * A worker body is `.step(spawn) .tap(recordSuccess) .rescue(recordError)`, and
 * both recorders decide what to do by reading `currentClaim` off the body state:
 * present means "this request owns the row and must settle it", absent means
 * "somebody else does, write nothing". So the state write that clears
 * `currentClaim` IS the ownership transfer.
 *
 * That write can fail. Run after an accepted dispatch, a failed clear throws
 * with the old claim still on the state, `recordError` marks the task **failed**,
 * and the Workstream that is actually running it then has its settlement declined
 * at the fence. The work is lost and nothing reports it — the parent request
 * returns successfully, and the row reads terminal.
 *
 * The fix is ordering: release before the point of no return, hand the claim back
 * on a definitive refusal. These tests pin that ordering directly, because it is
 * the whole mechanism and it is invisible in every happy-path assertion — a
 * hand-off that clears afterwards looks identical when nothing fails.
 */
import { describe, expect, it, vi } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import type { BlockContext, StartDetachedResult } from "@flow-state-dev/core/types";
import type { TaskClaimTicket } from "../../src/tasks";
import { createSpawnDetached } from "../../src/task-board/blocks/spawn-detached";
import type { TaskWorkerInput } from "../../src/tasks";

const CLAIM: TaskClaimTicket = {
  collectionId: "issue-ledger",
  taskId: "t1",
  attempt: 1,
  createdAt: 1_700_000_000_000,
  incarnationId: "inc_1",
};

const PAYLOAD: TaskWorkerInput = {
  taskId: "t1",
  goal: "do the background thing",
  attempts: 1,
  input: { note: "background" },
};

const spawn = createSpawnDetached({
  name: "issue-work-spawn-implement",
  boardId: "issue-work",
  coordinate: { kind: "assignee", name: "implement" },
});

/**
 * Drive the spawn against a fake worker-body state and a fake request host,
 * recording every state write and every dispatch onto ONE ordered timeline.
 *
 * The timeline is the point: what has to hold is a relationship between two
 * calls, and a test that only inspected the final state could not tell a
 * release-then-dispatch from a dispatch-then-release.
 */
function drive(options: {
  startDetached: () => Promise<StartDetachedResult>;
  /** Fail the state write matching this predicate, as a store outage would. */
  failWriteWhen?: (updates: Record<string, unknown>) => boolean;
  /** Drive the spawn with this payload instead of the default. */
  payload?: TaskWorkerInput;
  /**
   * Run while the release write is in flight — the window between the payload
   * being validated and the dispatch being built.
   */
  duringRelease?: () => void;
}) {
  const timeline: string[] = [];
  let state: { currentClaim?: TaskClaimTicket } = { currentClaim: CLAIM };

  const startDetached = vi.fn(async () => {
    timeline.push("dispatch");
    return options.startDetached();
  });

  const ctx = {
    sequencer: {
      get state() {
        return state;
      },
      patchState: async (updates: Record<string, unknown>) => {
        const label = "currentClaim" in updates && updates.currentClaim === undefined
          ? "release"
          : "restore";
        timeline.push(label);
        if (options.failWriteWhen?.(updates) === true) {
          throw new Error("state store unavailable");
        }
        if (label === "release") options.duringRelease?.();
        state = { ...state, ...updates };
      },
    },
    requestHost: { startDetached },
  } as unknown as BlockContext;

  const payload = options.payload ?? PAYLOAD;

  return {
    timeline,
    startDetached,
    claimAfter: () => state.currentClaim,
    /** The dispatch envelope the spawn actually handed to the host. */
    dispatched: () =>
      (startDetached.mock.calls[0]?.[0] as { input: { payload: TaskWorkerInput } } | undefined)
        ?.input.payload,
    run: () => runForTest(spawn, payload as never, ctx),
  };
}

const accepted = async (): Promise<StartDetachedResult> => ({
  ok: true,
  sessionId: "s_child",
  requestId: "req_child",
  adopted: false,
});

describe("the parent releases its claim before the dispatch it cannot take back", () => {
  it("releases first, so nothing fallible is left after acceptance", async () => {
    const harness = drive({ startDetached: accepted });

    await expect(harness.run()).resolves.toMatchObject({ detached: true, taskId: "t1" });

    // The ordering IS the fix. Clearing after acceptance leaves a store write
    // between "the Workstream owns this row" and "the recorders know it".
    expect(harness.timeline).toEqual(["release", "dispatch"]);
    expect(harness.claimAfter()).toBeUndefined();
  });

  it("dispatches nothing when the release fails, so the row stays this request's to fail", async () => {
    // The release is a store write and can fail. When it does, the honest
    // outcome is that no hand-off happened at all: `recordError` finds the claim
    // exactly where it was and fails the row against it.
    const harness = drive({
      startDetached: accepted,
      failWriteWhen: (updates) => updates.currentClaim === undefined,
    });

    await expect(harness.run()).rejects.toThrow(/state store unavailable/);

    expect(harness.startDetached).not.toHaveBeenCalled();
    expect(harness.claimAfter()).toEqual(CLAIM);
  });

  it("hands the claim back when the spawn is refused, so the row is failed and not stranded", async () => {
    // Every `ok: false` refusal is decided before anything is dispatched, so the
    // claim is still this request's. Without the restore the row would sit
    // `in_progress` with nobody holding it until its lease lapsed — a
    // configuration error turned into a two-minute stall.
    const harness = drive({
      startDetached: async () => ({
        ok: false,
        refused: "no-workstream-core",
        detail: "flow declares no workstream core",
      }),
    });

    await expect(harness.run()).rejects.toThrow(/no-workstream-core/);

    expect(harness.timeline).toEqual(["release", "dispatch", "restore"]);
    expect(harness.claimAfter()).toEqual(CLAIM);
  });

  it("settles nothing when the dispatch call itself throws", async () => {
    // Not the same case as a refusal, and not merely as a precaution: the host
    // starts the run before it hands `finished` to a deployment's background-work
    // hook, so a throw from there is a throw with a child already running. That
    // is indistinguishable here from a store read that failed before anything was
    // dispatched — so the claim stays released and both recorders find nothing to
    // write, and the row is recovered by the next drain instead of being failed
    // out from under a live child.
    const harness = drive({
      startDetached: async () => {
        throw new Error("dispatch host unreachable");
      },
    });

    await expect(harness.run()).rejects.toThrow(/dispatch host unreachable/);

    expect(harness.claimAfter()).toBeUndefined();
  });
});

describe("the dispatched payload is the same value whichever way it is delivered", () => {
  /** A payload whose `input` reaches one object from two places. */
  function aliasedPayload(): TaskWorkerInput {
    const shared = { seen: 0 };
    return {
      taskId: "t1",
      goal: "do the background thing",
      attempts: 1,
      input: { first: shared, second: shared },
    };
  }

  /** What the child receives on each deployment path, from one dispatch. */
  function delivered(dispatchedPayload: TaskWorkerInput) {
    return {
      // In-process: the runtime hands the child this very object graph.
      inProcess: dispatchedPayload,
      // External dispatcher: the envelope is serialized on its way to a worker.
      external: JSON.parse(JSON.stringify(dispatchedPayload)) as TaskWorkerInput,
    };
  }

  const aliased = (p: TaskWorkerInput): boolean => {
    const bag = p.input as { first: unknown; second: unknown };
    return bag.first === bag.second;
  };

  it("delivers the same aliasing to the child on both paths", async () => {
    // BOTH paths are exercised, because this is exactly the claim that passes
    // when only one is checked. A payload referencing one object twice is legal
    // JSON, so the gate permits it — but a queue's round trip turns the two
    // references into two independent objects while the in-process path keeps
    // them as one. A worker that mutates through one reference, or compares two
    // by identity, then behaves differently by deployment mode with nothing
    // announcing it.
    const harness = drive({ startDetached: accepted, payload: aliasedPayload() });
    await expect(harness.run()).resolves.toMatchObject({ detached: true });

    const { inProcess, external } = delivered(harness.dispatched()!);

    // The outcome: the two modes agree. Asserted as an equality between the
    // paths rather than against a hardcoded expectation, so it cannot pass by
    // pinning whichever behaviour one path happens to have.
    expect(aliased(inProcess)).toBe(aliased(external));
    expect(inProcess).toEqual(external);

    // And they agree on the round-tripped shape — the alias is resolved before
    // dispatch, not left for the transport to resolve or not.
    expect(aliased(inProcess)).toBe(false);
  });

  it("sends the payload that was validated, not one mutated afterwards", async () => {
    // The release write is awaited, so without a snapshot the graph stays
    // mutable between `assertJsonSafe` and the dispatch that carries it. The
    // thing that was checked must be the thing that was sent.
    const payload = aliasedPayload();
    const harness = drive({
      startDetached: accepted,
      payload,
      duringRelease: () => {
        (payload.input as { first: { seen: number } }).first.seen = 999;
        (payload.input as Record<string, unknown>).injected = "after validation";
      },
    });

    await expect(harness.run()).resolves.toMatchObject({ detached: true });

    const sent = harness.dispatched()!.input as Record<string, unknown>;
    expect(sent.injected).toBeUndefined();
    expect((sent.first as { seen: number }).seen).toBe(0);
  });
});
