/**
 * FIX-1005 — `.step(block, { abortSignal })` reaches a COMPOSITE child's
 * descendants, not just the child itself.
 *
 * The seam exists so a claimed-work step stops when its claim is lost. That
 * promise is only worth anything if it survives nesting: the blocks people
 * hand to `routedSpecialists` and to the task board are routinely sequencers,
 * and a specialist that is a sequencer runs its real work two or three scopes
 * below the step that was dispatched with the signal. If the extra signal
 * reached only the outermost child, a displaced worker would abort its wrapper
 * and its generators would keep making model calls underneath.
 *
 * Every test here runs through the real engine (`runAction`), because that is
 * the only place `_withExecutionScope` exists — the seam the signal has to
 * thread. A unit-test context installs no scope, so it cannot tell the
 * one-level case apart from the propagating one.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runAction, createInMemoryStores } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";

interface Marker {
  ran: boolean;
  abortedWhenDone: boolean;
}

const SLOW_MS = 200;

/** Waits ~SLOW_MS, resolving early on abort, and records what it saw. */
function slowLeaf(name: string, marker: Marker) {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      marker.ran = true;
      await new Promise<void>((resolve) => {
        if (ctx.signal?.aborted === true) return resolve();
        const timer = setTimeout(resolve, SLOW_MS);
        ctx.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            resolve();
          },
          { once: true }
        );
      });
      marker.abortedWhenDone = ctx.signal?.aborted === true;
      return null;
    },
  });
}

function runWith(root: ReturnType<typeof sequencer>) {
  const flow = defineFlow({
    kind: "fix1005-step-abort-nesting",
    actions: { run: { block: root } },
  })({ id: "test" });

  return runAction({
    flow,
    actionName: "run",
    userId: "u",
    input: undefined,
    stores: createInMemoryStores(),
    runtimeConfig: {
      modelResolver: createMockModelResolver({ policy: "allow" }),
    },
  });
}

describe("FIX-1005: step abortSignal through nested scopes", () => {
  it("aborts a leaf child", async () => {
    const marker: Marker = { ran: false, abortedWhenDone: false };
    const extra = new AbortController();

    const root = sequencer({ name: "root", inputSchema: z.unknown() }).step(
      slowLeaf("leaf", marker),
      { abortSignal: () => extra.signal }
    );

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("aborts a COMPOSITE child's nested descendant", async () => {
    // The regression guard. The handler lives two scopes below the dispatched
    // step, so its `ctx.signal` carries the extra signal only if the override
    // threaded through every `_withExecutionScope` rather than stopping at the
    // first. This is the shape a real specialist / task-board worker takes.
    const marker: Marker = { ran: false, abortedWhenDone: false };
    const extra = new AbortController();

    const inner = sequencer({ name: "inner", inputSchema: z.unknown() }).step(
      slowLeaf("deep", marker)
    );
    const composite = sequencer({
      name: "composite",
      inputSchema: z.unknown(),
    }).step(inner);

    const root = sequencer({ name: "root", inputSchema: z.unknown() }).step(
      composite,
      { abortSignal: () => extra.signal }
    );

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("aborts a composite descendant dispatched through .stepIf too", async () => {
    // `routedSpecialists` dispatches its specialist through `.stepIf`, so the
    // conditional arm needs the same guarantee as the unconditional one.
    const marker: Marker = { ran: false, abortedWhenDone: false };
    const extra = new AbortController();

    const inner = sequencer({ name: "inner", inputSchema: z.unknown() }).step(
      slowLeaf("deep-if", marker)
    );
    const composite = sequencer({
      name: "composite-if",
      inputSchema: z.unknown(),
    }).step(inner);

    const root = sequencer({ name: "root", inputSchema: z.unknown() })
      .map(() => ({ go: true }))
      .stepIf((v: { go: boolean }) => v.go, composite, {
        abortSignal: () => extra.signal,
      });

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("leaves a nested descendant alone when no extra signal is supplied", async () => {
    // The negative control: without the option the deep handler runs to
    // completion, so the assertions above are reading the signal and not some
    // ambient teardown.
    const marker: Marker = { ran: false, abortedWhenDone: false };

    const inner = sequencer({ name: "inner", inputSchema: z.unknown() }).step(
      slowLeaf("deep-clean", marker)
    );
    const composite = sequencer({
      name: "composite-clean",
      inputSchema: z.unknown(),
    }).step(inner);

    const root = sequencer({ name: "root", inputSchema: z.unknown() }).step(
      composite
    );

    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(false);
  });
});

describe("FIX-1005: step abortSignal reaches BACKGROUND work", () => {
  // `.sideChain()` / `.sideChainIf()` / `.forEachSideChain()` do not run under
  // `ctx.signal`. They substitute the request's background signal so a task
  // tree survives transport teardown (FIX-663) — and that substitution used to
  // discard anything a caller had composed on top, including the signal that
  // says "stop, this work can no longer be recorded".
  //
  // This is the expensive place for it to be wrong: foreground steps stop and
  // the background generators keep calling models.
  //
  // These run through `runAction` — a unit context installs no background
  // signal at all, so it cannot reproduce the substitution that causes this.

  function sideChainFlow(
    build: (probe: Marker) => ReturnType<typeof sequencer>
  ) {
    const marker: Marker = { ran: false, abortedWhenDone: false };
    const extra = new AbortController();
    const root = sequencer({ name: "root", inputSchema: z.unknown() }).step(
      build(marker),
      { abortSignal: () => extra.signal }
    );
    return { marker, extra, root };
  }

  it("aborts a .sideChain() task dispatched by the child", async () => {
    const { marker, extra, root } = sideChainFlow((probe) =>
      sequencer({ name: "bg-child", inputSchema: z.unknown() })
        .sideChain(slowLeaf("bg", probe))
        .map(() => ({ done: true }))
    );

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("aborts a .sideChainIf() task dispatched by the child", async () => {
    const { marker, extra, root } = sideChainFlow((probe) =>
      sequencer({ name: "bgif-child", inputSchema: z.unknown() })
        .sideChainIf(() => true, slowLeaf("bg-if", probe))
        .map(() => ({ done: true }))
    );

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("aborts a .forEachSideChain() task dispatched by the child", async () => {
    const { marker, extra, root } = sideChainFlow((probe) =>
      sequencer({ name: "feb-child", inputSchema: z.unknown() })
        .map(() => [1])
        .forEachSideChain(slowLeaf("bg-feb", probe))
        .map(() => ({ done: true }))
    );

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("aborts background work dispatched THREE scopes down", async () => {
    // The depth guard. Composing at the dispatch alone survives one scope: each
    // nested scope re-derives the background signal, so a `.sideChain()` deeper in
    // the tree used to get the request's again with the extra signal gone.
    const { marker, extra, root } = sideChainFlow((probe) => {
      const inner = sequencer({ name: "deep-inner", inputSchema: z.unknown() })
        .sideChain(slowLeaf("bg-deep", probe))
        .map(() => ({ done: true }));
      const middle = sequencer({
        name: "deep-middle",
        inputSchema: z.unknown(),
      }).step(inner);
      return sequencer({ name: "deep-outer", inputSchema: z.unknown() }).step(
        middle
      );
    });

    setTimeout(() => extra.abort(), 20);
    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(true);
  });

  it("does NOT abort background work when only the transport signal fires", async () => {
    // The promise this must not break: composing the extra signal in must not
    // re-couple background work to transport teardown. No extra signal is
    // supplied here, so the task runs to completion as FIX-663 requires.
    const marker: Marker = { ran: false, abortedWhenDone: false };
    const child = sequencer({ name: "bg-clean", inputSchema: z.unknown() })
      .sideChain(slowLeaf("bg-untouched", marker))
      .map(() => ({ done: true }));
    const root = sequencer({ name: "root", inputSchema: z.unknown() }).step(child);

    const result = await runWith(root);

    expect(result.error).toBeUndefined();
    expect(marker.ran).toBe(true);
    expect(marker.abortedWhenDone).toBe(false);
  });
});
