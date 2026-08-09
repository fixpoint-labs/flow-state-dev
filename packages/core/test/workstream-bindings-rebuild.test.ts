/**
 * Detached worker bindings must survive every block rebuild (FIX-982 P2).
 *
 * Bindings ride the same rail `declaredResources` does, with one difference that
 * makes the rail easy to break: a board stamps them onto the drain *after* the
 * block is built. Every combinator that rebuilds a block therefore has to read
 * the stamped value off the built definition, not the options it was constructed
 * with — and it has to read it at all, which is the part that was missed.
 *
 * A dropped binding throws nothing. `board.drain.connectInput(...)` hands back a
 * perfectly executable sequencer that has simply forgotten the board inside it,
 * and the symptom arrives much later as a detached task that is admitted,
 * claimed, dispatched, and then never runs because the flow it woke into has no
 * route for its coordinate.
 *
 * So this file is one case per combinator rather than one representative case.
 * The bug was a rail mirrored at one of its sites; a single representative test
 * is exactly what would have passed while the other sites stayed broken.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer } from "../src";
import type { BlockDefinition } from "../src/types/block";
import {
  declareWorkstreamBindings,
  workstreamBindingKey,
  type WorkstreamBinding,
} from "../src/types/workstream";

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

type WorkstreamBindings = NonNullable<BlockDefinition<never, never>["workstreamBindings"]>;

/** Worker names the block's bindings resolve to, sorted. */
function boundWorkers(block: { workstreamBindings?: WorkstreamBindings }): string[] {
  return [...(block.workstreamBindings?.values() ?? [])].map((b) => b.worker.name).sort();
}

/** A stamped handler, standing in for anything a board has marked. */
function stampedHandler(workerName = "implement") {
  const block = handler({
    name: "stamped",
    inputSchema: z.object({ id: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true }),
  });
  declareWorkstreamBindings(block, [
    binding({ boardId: "issue-work", worker: workerBlock(workerName) }),
  ]);
  return block;
}

describe("bindings survive each rebuilding combinator", () => {
  // Each case below rebuilds the block through one combinator. Every one of
  // these was silently dropping the stamp.

  it("survives connectInput", () => {
    const rebuilt = stampedHandler().connectInput((from: { raw: string }) => ({ id: from.raw }));
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives mapModelOutput", () => {
    const rebuilt = stampedHandler().mapModelOutput(() => "done");
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives rescue", () => {
    const rebuilt = stampedHandler().rescue([
      { block: handler({ name: "recover", execute: () => ({ ok: false }) }) },
    ]);
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives asTool", () => {
    const rebuilt = stampedHandler().asTool();
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives connectOutput", () => {
    const rebuilt = stampedHandler().connectOutput((out) => ({ mapped: out.ok }));
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives a chain of combinators", () => {
    // Each rebuild hands its result to the next, so a single dropped site loses
    // the stamp for every site after it.
    const rebuilt = stampedHandler()
      .connectInput((from: { raw: string }) => ({ id: from.raw }))
      .connectOutput((out) => out)
      .asTool();
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });
});

describe("bindings a rescue handler contributes", () => {
  it("merges the handler's own bindings, rather than only passing the base through", () => {
    // A board reachable only on the failure path is still a board the flow must
    // route to after a restart. `declaredResources` already merges here; bindings
    // have to travel the same way, not merely survive.
    const recover = handler({ name: "recover", execute: () => ({ ok: false }) });
    declareWorkstreamBindings(recover, [
      binding({
        boardId: "rescue-work",
        coordinateKey: "assignee|7:cleanup",
        worker: workerBlock("cleanup"),
      }),
    ]);

    const rebuilt = stampedHandler().rescue([{ block: recover }]);

    expect(boundWorkers(rebuilt)).toEqual(["cleanup", "implement"]);
  });

  it("still carries the rescue handler's bindings when the base block has none", () => {
    const recover = handler({ name: "recover", execute: () => null });
    declareWorkstreamBindings(recover, [
      binding({
        boardId: "rescue-work",
        coordinateKey: "assignee|7:cleanup",
        worker: workerBlock("cleanup"),
      }),
    ]);

    const rebuilt = handler({ name: "plain", execute: () => null }).rescue([{ block: recover }]);

    expect(boundWorkers(rebuilt)).toEqual(["cleanup"]);
  });
});

describe("a stamped sequencer — the shape a board actually produces", () => {
  /** A sequencer stamped after construction, exactly as a board stamps its drain. */
  function stampedDrain() {
    const drain = sequencer({ name: "drain" }).tap(
      handler({ name: "work", execute: () => undefined })
    );
    declareWorkstreamBindings(drain, [
      binding({ boardId: "issue-work", worker: workerBlock("implement") }),
    ]);
    return drain;
  }

  it("survives the sequencer's own connectInput", () => {
    // The sequencer overrides `connectInput` with its own rebuild, so the
    // build-block fix does not cover it. This is the reported symptom:
    // `board.drain.connectInput(...)` stays executable and loses its worker.
    const rebuilt = stampedDrain().connectInput((from: { raw: string }) => from.raw);
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives chaining a step on after the stamp", () => {
    const rebuilt = stampedDrain().tap(handler({ name: "after", execute: () => undefined }));
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives asTool, which falls through to the block builder", () => {
    const rebuilt = stampedDrain().asTool();
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("survives connectOutput, which falls through to the block builder", () => {
    const rebuilt = stampedDrain().connectOutput((out) => out);
    expect(boundWorkers(rebuilt)).toEqual(["implement"]);
  });

  it("keys the surviving binding by board and coordinate", () => {
    // Survival is not enough — the entry has to remain addressable by the two
    // strings a detached wake arrives with.
    const rebuilt = stampedDrain().connectInput((from: { raw: string }) => from.raw);
    expect([...(rebuilt.workstreamBindings?.keys() ?? [])]).toEqual([
      workstreamBindingKey("issue-work", "assignee|9:implement"),
    ]);
  });
});

describe("the off state (BP-035)", () => {
  it("leaves an unstamped block's bindings undefined through every combinator", () => {
    // Forwarding must not conjure an empty map onto the ordinary blocks that
    // make up every flow shipping today.
    const plain = handler({
      name: "plain",
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => ({ ok: true }),
    });

    expect(plain.connectInput((v: unknown) => v).workstreamBindings).toBeUndefined();
    expect(plain.mapModelOutput(() => "x").workstreamBindings).toBeUndefined();
    expect(plain.asTool().workstreamBindings).toBeUndefined();
    expect(plain.connectOutput((o) => o).workstreamBindings).toBeUndefined();
    expect(
      plain.rescue([{ block: handler({ name: "r", execute: () => ({ ok: false }) }) }])
        .workstreamBindings
    ).toBeUndefined();
  });
});
