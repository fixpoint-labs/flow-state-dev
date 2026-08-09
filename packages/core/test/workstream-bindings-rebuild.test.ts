/**
 * Detached worker bindings must survive every reconstruction (FIX-982 P2).
 *
 * Bindings ride the same rail `declaredResources` does, with one difference that
 * makes the rail easy to break: a board stamps them onto a block *after* it is
 * built, so they live only on the definition. Anything that rebuilds a block has
 * to carry them across explicitly.
 *
 * **`declaredResources` is a tempting oracle and an incomplete one.** At the
 * block combinators it is exact — bindings must travel wherever it travels. At
 * `defineFlow`'s `withFlowTools` it is actively misleading: that path rebuilds a
 * generator from its *config*, and `generator()` recomputes `declaredResources`
 * from what it is handed, so resources survive with no forwarding at all while
 * bindings — which have no config half — are dropped. Three separate rounds of
 * this bug have now been found by naming paths one at a time.
 *
 * So this file is written as a **rule with a completeness guard**, not a list of
 * remembered cases. `BLOCK_COMBINATORS` is parameterized over every
 * block-returning method, and `covers every block-returning combinator` reflects
 * over the built definition and fails if a method exists that the table does not
 * name. Add `.mapInput()` to `buildBlock` tomorrow and this file goes red until
 * someone decides whether bindings should cross it.
 *
 * A dropped binding throws nothing. The symptom is a detached task that is
 * admitted, claimed, dispatched, and then never runs, because the flow it woke
 * into has no route for its coordinate.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, generator, handler, sequencer } from "../src";
import type { BlockDefinition } from "../src/types/block";
import {
  declareWorkstreamBindings,
  workstreamBindingKey,
  type WorkstreamBinding,
} from "../src/types/workstream";

type WorkstreamBindings = NonNullable<BlockDefinition<never, never>["workstreamBindings"]>;

/** A stand-in for a board's detached worker block. */
function workerBlock(name: string): BlockDefinition<never, never> {
  return handler({
    name,
    execute: () => null,
  }) as unknown as BlockDefinition<never, never>;
}

function binding(options: {
  boardId: string;
  coordinateKey?: string;
  worker: BlockDefinition<never, never>;
}): WorkstreamBinding {
  return {
    boardId: options.boardId,
    coordinateKey: options.coordinateKey ?? "assignee|9:implement",
    worker: options.worker,
  };
}

/** Worker names the block's bindings resolve to, sorted. */
function boundWorkers(block: { workstreamBindings?: WorkstreamBindings }): string[] {
  return [...(block.workstreamBindings?.values() ?? [])].map((b) => b.worker.name).sort();
}

/** A block a board has stamped, standing in for anything holding a coordinate. */
function stampedHandler() {
  const block = handler({
    name: "stamped",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true }),
  });
  declareWorkstreamBindings(block, [
    binding({ boardId: "issue-work", worker: workerBlock("implement") }),
  ]);
  return block;
}

/** The same block shape with nothing stamped — the off state. */
function plainHandler() {
  return handler({
    name: "plain",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true }),
  });
}

function recoverHandler() {
  return handler({ name: "recover", execute: () => ({ ok: false }) });
}

type RebuildCase = {
  /** The `BlockDefinition` method under test — also the completeness-guard key. */
  readonly method: string;
  readonly rebuild: (block: ReturnType<typeof plainHandler>) => {
    workstreamBindings?: WorkstreamBindings;
  };
};

/**
 * Every method on a built block that returns another block.
 *
 * Kept in sync with reality by `covers every block-returning combinator` below,
 * not by anyone remembering to update it.
 */
const BLOCK_COMBINATORS: RebuildCase[] = [
  { method: "connectInput", rebuild: (b) => b.connectInput((from: { raw: string }) => ({ id: from.raw })) },
  { method: "mapModelOutput", rebuild: (b) => b.mapModelOutput(() => "done") },
  { method: "rescue", rebuild: (b) => b.rescue([{ block: recoverHandler() }]) },
  { method: "asTool", rebuild: (b) => b.asTool() },
  { method: "connectOutput", rebuild: (b) => b.connectOutput((out) => out) },
];

describe("the rule: a rebuild carries the stamp", () => {
  it.each(BLOCK_COMBINATORS)("$method carries bindings across the rebuild", ({ rebuild }) => {
    expect(boundWorkers(rebuild(stampedHandler()))).toEqual(["implement"]);
  });

  it.each(BLOCK_COMBINATORS)(
    "$method leaves an unstamped block's bindings undefined (BP-035)",
    ({ rebuild }) => {
      // Forwarding must not conjure an empty map onto the ordinary blocks that
      // make up every flow shipping today.
      expect(rebuild(plainHandler()).workstreamBindings).toBeUndefined();
    }
  );

  it("covers every block-returning combinator — a new one fails this test until it is added", () => {
    // The guard that makes the table a rule instead of a list. Three rounds of
    // this bug were each found by a reviewer naming a path nobody enumerated;
    // this fails automatically instead.
    const block = plainHandler() as unknown as Record<string, unknown>;
    const combinators = Object.keys(block)
      .filter((key) => typeof block[key] === "function")
      // `run` executes the block rather than returning a new one.
      .filter((key) => key !== "run")
      .sort();

    expect(combinators).toEqual(BLOCK_COMBINATORS.map((c) => c.method).sort());
  });

  it("carries the stamp through a chain of rebuilds", () => {
    // Each rebuild hands its result to the next, so one dropped site loses the
    // stamp for every site after it.
    const rebuilt = stampedHandler()
      .connectInput((from: { raw: string }) => ({ id: from.raw }))
      .connectOutput((out) => out)
      .asTool();

    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });
});

describe("rescue merges, rather than only passing the base through", () => {
  function stampedRecover() {
    const recover = recoverHandler();
    declareWorkstreamBindings(recover, [
      binding({
        boardId: "rescue-work",
        coordinateKey: "assignee|7:cleanup",
        worker: workerBlock("cleanup"),
      }),
    ]);
    return recover;
  }

  it("folds in bindings the rescue handler itself contributes", () => {
    // A board reachable only on the failure path is still a board the flow must
    // route to after a restart.
    const rebuilt = stampedHandler().rescue([{ block: stampedRecover() }]);
    expect(boundWorkers(rebuilt)).toEqual(["cleanup", "implement"]);
  });

  it("carries the handler's bindings even when the base block has none", () => {
    const rebuilt = plainHandler().rescue([{ block: stampedRecover() }]);
    expect(boundWorkers(rebuilt)).toEqual(["cleanup"]);
  });
});

describe("a stamped sequencer — the shape a board actually produces", () => {
  /**
   * A sequencer stamped after construction, exactly as a board stamps its drain.
   *
   * Every chain method (`step`, `tap`, `map`, `forEach`, `branch`, …) funnels
   * through the sequencer's own `extend`, so one case covers all of them. The
   * two that bypass `extend` and rebuild directly — `connectInput` and `rescue`
   * — are exercised on their own below.
   */
  function stampedDrain() {
    const drain = sequencer({ name: "drain" }).tap(
      handler({ name: "work", execute: () => undefined })
    );
    declareWorkstreamBindings(drain, [
      binding({ boardId: "issue-work", worker: workerBlock("implement") }),
    ]);
    return drain;
  }

  it("survives a chain step (the `extend` funnel)", () => {
    const rebuilt = stampedDrain().tap(handler({ name: "after", execute: () => undefined }));
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives the sequencer's own connectInput, which bypasses `extend`", () => {
    // The reported symptom: `board.drain.connectInput(...)` stays executable and
    // loses its worker.
    const rebuilt = stampedDrain().connectInput((from: { raw: string }) => from.raw);
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives the sequencer's own rescue, which bypasses `extend`", () => {
    const rebuilt = stampedDrain().rescue([
      { block: handler({ name: "cleanup", execute: () => undefined }) },
    ]);
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives asTool and connectOutput, which fall through to the block builder", () => {
    expect(boundWorkers(stampedDrain().asTool())).toEqual(["implement"]);
    expect(boundWorkers(stampedDrain().connectOutput((out) => out))).toEqual(["implement"]);
  });

  it("keeps the binding addressable by board and coordinate", () => {
    // Survival is not enough — the entry has to stay reachable by the two
    // strings a detached wake arrives with.
    const rebuilt = stampedDrain().connectInput((from: { raw: string }) => from.raw);
    expect([...(rebuilt.workstreamBindings?.keys() ?? [])]).toEqual([
      workstreamBindingKey("issue-work", "assignee|9:implement"),
    ]);
  });
});

/**
 * The flow-level reconstruction — `withFlowTools`.
 *
 * A flow that declares `tools` rebuilds every generator action root from its
 * config to merge them in. That is a third reconstruction path, reached only in
 * a configuration nothing else in these tests uses, and it is the one where
 * `declaredResources` gives no warning: it is recomputed from the config and
 * survives regardless.
 */
describe("a flow that declares tools still routes to its boards", () => {
  /** A generator whose rescue handler carries a board's binding. */
  function generatorWithRescuedBoard() {
    const recover = handler({
      name: "recover",
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: false }),
    });
    declareWorkstreamBindings(recover, [
      binding({ boardId: "issue-work", worker: workerBlock("implement") }),
    ]);

    return generator({
      name: "gen",
      model: "test-model",
      prompt: "test-prompt",
      outputSchema: z.object({ ok: z.boolean() }),
    }).rescue([{ block: recover }]);
  }

  function flowBindings(tools: { defaults?: Record<string, unknown> } | undefined) {
    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: generatorWithRescuedBoard() } },
      ...(tools !== undefined ? { tools } : {}),
    } as never)({ id: "board" });
    return boundWorkers(flow as { workstreamBindings?: WorkstreamBindings });
  }

  it("keeps the binding when the flow declares no tools", () => {
    // The control. If this ever fails, the case below proves nothing.
    expect(flowBindings(undefined)).toEqual(["implement"]);
  });

  it("keeps the binding when the flow declares tools", () => {
    // The bug: identical generator, identical board, one config field apart.
    // Declaring `tools` rebuilt the generator and silently dropped the route.
    expect(flowBindings({ defaults: {} })).toEqual(["implement"]);
  });

  it("adds no bindings to a tools-declaring flow that has no board", () => {
    const flow = defineFlow({
      kind: "plain",
      actions: {
        run: {
          block: generator({
            name: "plain-gen",
            model: "test-model",
            prompt: "test-prompt",
            outputSchema: z.object({ ok: z.boolean() }),
          }),
        },
      },
      tools: { defaults: {} },
    } as never)({ id: "plain" });

    expect(flow.workstreamBindings).toBeUndefined();
  });
});
