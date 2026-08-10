/**
 * The bindings rail is derived from retained children, not propagated by hand
 * (FIX-982 P2).
 *
 * Its companion file, `workstream-bindings-rebuild.test.ts`, pins the *rule*: a
 * binding survives every rebuild. This file pins the *mechanism* that makes the
 * rule hold without anyone remembering it, because the rule kept being broken
 * one site at a time. Eleven review findings on this change were all one class —
 * a composition site that propagated two of three rails, or none.
 *
 * The mechanism has two halves, and they are one change:
 *
 * 1. A block **retains its children** (`BlockDefinition.childBlocks`). A
 *    `SequencerOperation` is `{name, run}` with the child captured in the
 *    closure, so before this the sequencer edge was invisible to any traversal —
 *    and a board's drain IS a sequencer, so a walk from an action root reached
 *    no real board at all.
 * 2. Because children are retained, the bindings rail is **derived** from them
 *    at build time rather than accumulated and re-passed at each site. A site
 *    can now only forget the child itself, which drops every rail at once and is
 *    caught at `defineFlow` by the reachability assertion below.
 *
 * The tests here are written against observable behaviour — what a flow can
 * route to — rather than against the shape of the derivation, so they stay
 * meaningful if the derivation is rewritten again.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler, router, sequencer } from "../src";
import type { BlockDefinition } from "../src/types/block";
import {
  declareWorkstreamBindings,
  type WorkstreamBinding,
} from "../src/types/workstream";

type WorkstreamBindings = NonNullable<BlockDefinition<never, never>["workstreamBindings"]>;

function workerBlock(name: string): BlockDefinition<never, never> {
  return handler({ name, execute: () => null }) as unknown as BlockDefinition<never, never>;
}

/**
 * One runner per board, standing in for what `taskBoard()` stamps.
 *
 * Memoized by `boardId` because that is the real invariant: a board builds its
 * runner once and puts the SAME object on every binding it declares. A fixture
 * that minted a fresh runner per binding would make a one-board flow look like a
 * boardId collision to the assembly.
 */
const runners = new Map<string, BlockDefinition<never, never>>();
function runnerBlock(boardId: string): BlockDefinition<never, never> {
  const existing = runners.get(boardId);
  if (existing !== undefined) return existing;
  const runner = workerBlock(`runner-${boardId}`);
  runners.set(boardId, runner);
  return runner;
}

function binding(boardId: string, workerName: string): WorkstreamBinding {
  return {
    boardId,
    coordinateKey: `assignee|${workerName.length}:${workerName}`,
    worker: workerBlock(workerName),
    runner: runnerBlock(boardId),
  };
}

/** A stamped sequencer, standing in for the drain a board builds and stamps. */
function stampedDrain(workerName: string, boardId = `board-${workerName}`) {
  const drain = sequencer({ name: `drain-${workerName}` }).tap(
    handler({ name: `work-${workerName}`, execute: () => undefined })
  );
  declareWorkstreamBindings(drain, [binding(boardId, workerName)]);
  return drain;
}

/** Worker names reachable from a block or flow, sorted. */
function boundWorkers(carrier: { workstreamBindings?: WorkstreamBindings }): string[] {
  return [...(carrier.workstreamBindings?.values() ?? [])].map((b) => b.worker.name).sort();
}

const plainRoot = () => handler({ name: "root", execute: () => null });

describe("every chaining method carries a nested board, because each hands over the block", () => {
  /**
   * One case per shape of child argument the sequencer accepts. These are not
   * "the sites that were broken" — they are the argument shapes, which is what
   * the funnel actually varies over now that each site passes the block itself.
   */
  const CHAIN_SHAPES: Array<{ name: string; chain: (drain: never) => { workstreamBindings?: WorkstreamBindings } }> = [
    { name: "step", chain: (d) => sequencer({ name: "s" }).step(d) },
    { name: "stepIf", chain: (d) => sequencer({ name: "s" }).stepIf(() => true, d) },
    { name: "tap", chain: (d) => sequencer({ name: "s" }).tap(d) },
    { name: "tapIf", chain: (d) => sequencer({ name: "s" }).tapIf(() => true, d) },
    { name: "work", chain: (d) => sequencer({ name: "s" }).work(d) },
    { name: "workIf", chain: (d) => sequencer({ name: "s" }).workIf(true, d) },
    { name: "forEach", chain: (d) => sequencer({ name: "s" }).forEach(d) },
    { name: "forEachBackground", chain: (d) => sequencer({ name: "s" }).forEachBackground(d) },
    { name: "doUntil", chain: (d) => sequencer({ name: "s" }).doUntil(() => true, d) },
    { name: "doWhile", chain: (d) => sequencer({ name: "s" }).doWhile(() => false, d) },
    { name: "parallel", chain: (d) => sequencer({ name: "s" }).parallel({ a: d }) },
    { name: "stepAll", chain: (d) => sequencer({ name: "s" }).stepAll([d]) },
    { name: "stepAny", chain: (d) => sequencer({ name: "s" }).stepAny([d]) },
    { name: "race", chain: (d) => sequencer({ name: "s" }).race([d]) },
    {
      name: "branch",
      chain: (d) => sequencer({ name: "s" }).branch({ only: [(v: unknown) => v, () => true, d] }),
    },
    { name: "rescue", chain: (d) => sequencer({ name: "s" }).rescue([{ block: d }]) },
  ];

  it.each(CHAIN_SHAPES)("$name bubbles the nested board to the enclosing sequencer", ({ chain }) => {
    expect(boundWorkers(chain(stampedDrain("implement") as never))).toEqual(["implement"]);
  });

  it.each(CHAIN_SHAPES)("$name leaves an unstamped chain's bindings undefined (BP-035)", ({ chain }) => {
    // The off state. Deriving must not conjure an empty map onto the ordinary
    // blocks that make up every flow shipping today.
    const plain = sequencer({ name: "inner" }).tap(handler({ name: "w", execute: () => undefined }));
    expect(chain(plain as never).workstreamBindings).toBeUndefined();
  });

  it("bubbles a board nested several sequencers deep", () => {
    // Each level merges the level below's already-merged set, so depth costs
    // nothing — but only if every level actually retains its child.
    const deep = sequencer({ name: "outer" }).step(
      sequencer({ name: "middle" }).step(sequencer({ name: "inner" }).step(stampedDrain("implement")))
    );

    expect(boundWorkers(deep)).toEqual(["implement"]);
  });

  it("bubbles a board reached down one arm of a router", () => {
    const routed = router({
      name: "pick",
      routes: [stampedDrain("implement"), plainRoot()],
      execute: () => stampedDrain("implement"),
    });

    expect(boundWorkers(routed)).toEqual(["implement"]);
  });
});

describe("blocks retain their children, so the graph is walkable at definition time", () => {
  it("retains the block each chain step dispatches", () => {
    const first = handler({ name: "first", execute: () => undefined });
    const second = handler({ name: "second", execute: () => undefined });
    const chain = sequencer({ name: "s" }).tap(first).tap(second);

    // The point is reachability, not bookkeeping: before this, both were
    // captured in operation closures and retained nowhere.
    expect(chain.childBlocks?.map((b) => b.name)).toEqual(["first", "second"]);
  });

  it("retains chain-level rescue handlers as children too", () => {
    // A board reachable only on the failure path is still one the flow must
    // route to, so a handler is a child like any other.
    const chain = sequencer({ name: "s" })
      .tap(handler({ name: "main", execute: () => undefined }))
      .rescue([{ block: handler({ name: "cleanup", execute: () => undefined }) }]);

    expect(chain.childBlocks?.map((b) => b.name)).toEqual(["main", "cleanup"]);
  });

  it("retains a router's routes", () => {
    const routed = router({
      name: "pick",
      routes: [handler({ name: "a", execute: () => null }), handler({ name: "b", execute: () => null })],
      execute: () => handler({ name: "a", execute: () => null }),
    });

    expect(routed.childBlocks?.map((b) => b.name)).toEqual(["a", "b"]);
  });
});

describe("defineFlow refuses a board it can reach but cannot route to", () => {
  /**
   * A binding that exists on a reachable block but never reached the root.
   *
   * Produced here by stamping a child *after* it was composed — the parent
   * derived its set at composition time, so the late stamp never bubbled. That
   * is the same end state a dropped rail produces, and it is the state that used
   * to ship silently: the board runs, and the wake that follows has no route.
   */
  function lateStampedChild() {
    const child = sequencer({ name: "late" }).tap(handler({ name: "w", execute: () => undefined }));
    const root = sequencer({ name: "root" }).step(child);
    declareWorkstreamBindings(child, [binding("issue-work", "implement")]);
    return root;
  }

  it("throws at definition time, naming the board and coordinate", () => {
    expect(() =>
      defineFlow({ kind: "board", actions: { run: { block: lateStampedChild() } } } as never)
    ).toThrow(/issue-work/);
  });

  it("names the unreachable worker, so the message points at what would not run", () => {
    expect(() =>
      defineFlow({ kind: "board", actions: { run: { block: lateStampedChild() } } } as never)
    ).toThrow(/implement/);
  });

  it("stays silent for a flow whose boards all resolve", () => {
    const flow = defineFlow({
      kind: "board",
      actions: { run: { block: sequencer({ name: "root" }).step(stampedDrain("implement")) } },
    } as never)({ id: "board" });

    expect(boundWorkers(flow as { workstreamBindings?: WorkstreamBindings })).toEqual(["implement"]);
  });

  it("stays silent for a flow with no detached work at all", () => {
    expect(() =>
      defineFlow({ kind: "plain", actions: { run: { block: plainRoot() } } } as never)
    ).not.toThrow();
  });
});

/**
 * PR #1130 finding 10.
 *
 * `.rescue()` REPLACES the installed handlers, so the rail cannot be
 * accumulated: seeding the merge from the block's post-fold bindings kept the
 * dropped handler's boards. The flow then advertised a worker nothing could
 * reach — and threw a spurious duplicate-coordinate error when the old and new
 * handlers bound the same coordinate, which is the ordinary case when a handler
 * is being swapped for a better one.
 */
describe("replacing a rescue handler forgets the replaced handler's board", () => {
  function stampedHandlerBlock(name: string, workerName: string) {
    const block = handler({ name, execute: () => ({ ok: true }) });
    declareWorkstreamBindings(block, [binding(`board-${workerName}`, workerName)]);
    return block;
  }

  it("drops the old handler's board on a block", () => {
    const rebuilt = handler({ name: "base", execute: () => ({ ok: true }) })
      .rescue([{ block: stampedHandlerBlock("old", "oldWorker") }])
      .rescue([{ block: stampedHandlerBlock("new", "newWorker") }]);

    expect(boundWorkers(rebuilt)).toEqual(["newWorker"]);
  });

  it("drops the old handler's board on a sequencer", () => {
    const rebuilt = sequencer({ name: "s" })
      .tap(handler({ name: "main", execute: () => undefined }))
      .rescue([{ block: stampedHandlerBlock("old", "oldWorker") }])
      .rescue([{ block: stampedHandlerBlock("new", "newWorker") }]);

    expect(boundWorkers(rebuilt)).toEqual(["newWorker"]);
  });

  it("does not throw a duplicate-coordinate error when the replacement takes the same coordinate", () => {
    // The swap a reviewer would actually make: same board, same coordinate,
    // better handler. Accumulating made this a build-time error.
    const oldHandler = handler({ name: "old", execute: () => ({ ok: true }) });
    declareWorkstreamBindings(oldHandler, [binding("issue-work", "implement")]);
    const newHandler = handler({ name: "new", execute: () => ({ ok: true }) });
    declareWorkstreamBindings(newHandler, [binding("issue-work", "implement")]);

    expect(() =>
      handler({ name: "base", execute: () => ({ ok: true }) })
        .rescue([{ block: oldHandler }])
        .rescue([{ block: newHandler }])
    ).not.toThrow();
  });

  it("still keeps the block's own stamp across the replacement", () => {
    // Forgetting the replaced handler must not also forget what the block
    // itself carries — the two are different contributions.
    const base = handler({ name: "base", execute: () => ({ ok: true }) });
    declareWorkstreamBindings(base, [binding("own-board", "ownWorker")]);

    const rebuilt = base
      .rescue([{ block: stampedHandlerBlock("old", "oldWorker") }])
      .rescue([{ block: stampedHandlerBlock("new", "newWorker") }]);

    expect(boundWorkers(rebuilt)).toEqual(["newWorker", "ownWorker"]);
  });
});

/**
 * PR #1130 finding 11.
 *
 * `defineFlow` returns a callable blueprint that mirrors the base instance's
 * fields one by one. `workstreamBindings` was missing from that list, so code
 * inspecting the blueprint directly saw actions, resources, schedules and
 * `requiresOrg` but no detached registry — and concluded the flow had no
 * detached work.
 */
describe("the flow blueprint mirrors the instance's bindings", () => {
  const flowWithBoard = () =>
    defineFlow({
      kind: "board",
      actions: { run: { block: stampedDrain("implement") } },
    } as never);

  it("exposes bindings on the blueprint, not only on a constructed instance", () => {
    expect(boundWorkers(flowWithBoard() as { workstreamBindings?: WorkstreamBindings })).toEqual([
      "implement",
    ]);
  });

  it("agrees with the instance it would construct", () => {
    const flow = flowWithBoard();
    expect(boundWorkers(flow as { workstreamBindings?: WorkstreamBindings })).toEqual(
      boundWorkers(flow({ id: "board" }) as { workstreamBindings?: WorkstreamBindings })
    );
  });

  it("leaves the blueprint's bindings undefined when the flow declares no detached work", () => {
    const flow = defineFlow({ kind: "plain", actions: { run: { block: plainRoot() } } } as never);
    expect((flow as { workstreamBindings?: WorkstreamBindings }).workstreamBindings).toBeUndefined();
  });
});

/** A stamped block behind a schema, to keep the funnel honest about typing. */
describe("deriving does not disturb the other rails", () => {
  const orgResource = z.object({ entries: z.array(z.string()) });

  it("still bubbles requiresOrg from a child", () => {
    const chain = sequencer({ name: "s" }).tap(
      handler({ name: "needs-org", requireOrg: true, execute: () => undefined })
    );
    expect(chain.requiresOrg).toBe(true);
  });

  it("still bubbles a child's declared resources", () => {
    const resource = { scope: "session" as const, stateSchema: orgResource };
    const child = handler({
      name: "declares",
      resources: { entries: resource as never },
      execute: () => undefined,
    });
    const chain = sequencer({ name: "s" }).tap(child);

    expect(Object.keys(chain.declaredResources ?? {})).toEqual(["entries"]);
  });
});
