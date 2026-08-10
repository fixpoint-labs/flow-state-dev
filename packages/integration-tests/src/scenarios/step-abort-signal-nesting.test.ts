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
