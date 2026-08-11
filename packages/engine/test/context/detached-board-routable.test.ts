/**
 * A detached spawn refuses a board the flow cannot route (FIX-1074).
 *
 * `defineFlow` collects bindings by walking what it can see, and it cannot see
 * everything: a board handed to a generator by a capability preset, one mounted
 * on a tool lifecycle hook, and one produced at dispatch time all reach the
 * runtime without reaching `flow.workstreamBindings`. The first two are entry
 * points the walk could learn about; the third cannot be walked in principle,
 * because the board does not exist when the flow is built.
 *
 * So the walk is coverage, and the guarantee is here — at the spawn, where the
 * fact is knowable whatever produced the board, and where the caller still holds
 * its claim and can settle the row. One hop later the row has been handed over
 * and nothing can settle it until its lease lapses.
 *
 * The three instances are shown to CONVERGE on one state (a flow with a
 * workstream core and no binding for the board), and the refusal is then driven
 * against that state. That is the whole of what the check sees: it takes the
 * flow's bindings, a board id and a coordinate, and cannot tell how the binding
 * came to be missing — so one behavioural test over the shared state, plus proof
 * that each route lands in it, covers all three.
 */
import { describe, it, expect } from "vitest";
import {
  defineCapability,
  defineFlow,
  generator,
  handler,
  sequencer,
  workstreamDispatchInputSchema
} from "@flow-state-dev/core";
import { declareWorkstreamBindings } from "@flow-state-dev/core/types";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { z } from "zod";
import { createRequestHost } from "../../src/context/create-request-host";
import { createInMemoryStores } from "../../src";

const BOARD_ID = "issue-work";
const COORDINATE = "assignee|9:implement";

function workerBlock(name: string): BlockDefinition<never, never> {
  return handler({ name, execute: () => null }) as unknown as BlockDefinition<never, never>;
}

/** A board-shaped drain carrying one detached binding, as `taskBoard()` stamps it. */
function stampedDrain() {
  const drain = sequencer({ name: "drain" }).tap(
    handler({ name: "work", execute: () => undefined })
  );
  declareWorkstreamBindings(drain, [
    {
      boardId: BOARD_ID,
      coordinateKey: COORDINATE,
      worker: workerBlock("implement"),
      runner: workerBlock("runner")
    }
  ]);
  return drain;
}

/** A flow that DOES route the board — the shape every instance below diverges from. */
function routingFlow(): FlowInstance {
  return defineFlow({
    kind: "routes-it",
    actions: { run: { block: stampedDrain() } }
  } as never)({ id: "routes-it" }) as unknown as FlowInstance;
}

const boardIds = (flow: FlowInstance): string[] => [
  ...new Set([...(flow.workstreamBindings?.values() ?? [])].map((b) => b.boardId))
];

describe("the three ways a board reaches the runtime without reaching the flow", () => {
  it("a board supplied by a static capability preset contributes no binding", () => {
    const cap = defineCapability({
      name: "board-cap",
      presets: { default: { tools: [stampedDrain() as never] } }
    } as never);
    const flow = defineFlow({
      kind: "via-capability",
      actions: {
        run: {
          block: generator({
            name: "agent",
            model: "openai/gpt-5.4-mini",
            prompt: "hi",
            outputSchema: z.object({ ok: z.boolean() }),
            uses: [cap as never]
          })
        }
      }
    } as never)({ id: "via-capability" }) as unknown as FlowInstance;

    expect(boardIds(flow)).toEqual([]);
  });

  it("a board mounted on a tool lifecycle hook contributes no binding", () => {
    const flow = defineFlow({
      kind: "via-tool-hook",
      tools: { onToolStarted: stampedDrain() },
      actions: { run: { block: handler({ name: "plain", execute: () => null }) } }
    } as never)({ id: "via-tool-hook" }) as unknown as FlowInstance;

    expect(boardIds(flow)).toEqual([]);
  });

  it("a board behind a runtime-resolved tool set contributes no binding", () => {
    // Unwalkable in principle: the array does not exist until the resolver runs.
    const drain = stampedDrain();
    const flow = defineFlow({
      kind: "via-dynamic-tools",
      actions: {
        run: {
          block: generator({
            name: "agent-dyn",
            model: "openai/gpt-5.4-mini",
            prompt: "hi",
            outputSchema: z.object({ ok: z.boolean() }),
            tools: (() => [drain]) as never
          })
        }
      }
    } as never)({ id: "via-dynamic-tools" }) as unknown as FlowInstance;

    expect(boardIds(flow)).toEqual([]);
  });
});

describe("startDetached refuses a board the flow cannot route", () => {
  const dispatchInput = {
    boardId: BOARD_ID,
    coordinateKey: COORDINATE,
    taskId: "t1",
    attempt: 1,
    createdAt: 1_700_000_000_000,
    payload: { taskId: "t1" }
  };

  /** A flow with a workstream core but no binding for `BOARD_ID`. */
  function unroutingFlow(): FlowInstance {
    const other = sequencer({ name: "other-drain" }).tap(
      handler({ name: "other-work", execute: () => undefined })
    );
    declareWorkstreamBindings(other, [
      {
        boardId: "some-other-board",
        coordinateKey: "assignee|5:other",
        worker: workerBlock("other"),
        runner: workerBlock("other-runner")
      }
    ]);
    return defineFlow({
      kind: "unrouting",
      actions: { run: { block: other } }
    } as never)({ id: "unrouting" }) as unknown as FlowInstance;
  }

  function host(flow: FlowInstance, started: string[] = []) {
    return createRequestHost({
      stores: createInMemoryStores(),
      flow,
      identity: {
        userId: "u_1",
        tenantId: undefined,
        orgId: undefined,
        sessionId: "s_parent"
      },
      startOperation: async () => {
        started.push("dispatched");
        return { requestId: "child_1" };
      },
      liveness: { staleThresholdMs: 30_000, heartbeatIntervalMs: 10_000 } as never
    }).host;
  }

  it("refuses by name, and dispatches nothing", async () => {
    const started: string[] = [];
    const result = await host(unroutingFlow(), started).startDetached({
      seed: { topic: "t1" },
      input: dispatchInput
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refused).toBe("board-not-routable");
    expect(result.detail).toMatch(new RegExp(BOARD_ID));
    // Nothing was handed over, which is what leaves the caller's claim intact
    // and its recorder able to settle the row.
    expect(started).toEqual([]);
  });

  it("starts normally when the flow does route the board", async () => {
    // The control. A guard keyed on "has a workstream core" rather than on the
    // binding would refuse this too, and detached work would stop working.
    const started: string[] = [];
    const result = await host(routingFlow(), started).startDetached({
      seed: { topic: "t1" },
      input: dispatchInput
    });

    expect(result.ok).toBe(true);
    expect(started).toEqual(["dispatched"]);
  });

  it("leaves a caller whose input names no board alone", async () => {
    // `startDetached` is a general verb. A caller with no task board passes
    // whatever its own core takes, and must not be judged against a board.
    const started: string[] = [];
    const result = await host(routingFlow(), started).startDetached({
      seed: { topic: "t1" },
      input: { anything: "at all" }
    });

    expect(workstreamDispatchInputSchema.safeParse({ anything: "at all" }).success).toBe(false);
    expect(result.ok).toBe(true);
    expect(started).toEqual(["dispatched"]);
  });
});
