/**
 * `.step(block, { abortSignal })` — running a step under an additional
 * caller-supplied abort signal (FIX-1005).
 *
 * The sequencer is what dispatches a step, so running one under an extra
 * signal is its primitive to own. A caller that needs this has a signal only
 * the *runtime* knows about — which claim this iteration holds, which lease it
 * is renewing — so the block itself cannot carry it and there was no seam to
 * hand it through: `.work()` takes no signal either.
 *
 * The composition is the contract. The extra signal is added to the request's,
 * never substituted for it, so a caller cannot accidentally build a step that
 * outlives a cancelled request.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { handler, sequencer } from "../src";
import { createMockContext, runForTest } from "./helpers";

/** A block that reports whether the signal it ran under was already aborted. */
const reportsAbort = handler({
  name: "reports-abort",
  inputSchema: z.unknown(),
  outputSchema: z.object({ aborted: z.boolean() }),
  execute: async (_input, ctx) => ({ aborted: ctx.signal?.aborted === true }),
});

/** A block that waits for its signal and reports how it ended. */
const waitsForAbort = handler({
  name: "waits-for-abort",
  inputSchema: z.unknown(),
  outputSchema: z.object({ ended: z.string() }),
  execute: async (_input, ctx) =>
    new Promise((resolve) => {
      if (ctx.signal?.aborted === true) return resolve({ ended: "already" });
      ctx.signal?.addEventListener("abort", () => resolve({ ended: "aborted" }), {
        once: true,
      });
      setTimeout(() => resolve({ ended: "timeout" }), 50);
    }),
});

describe(".step(block, { abortSignal })", () => {
  it("aborts on the SUPPLIED signal", async () => {
    const extra = new AbortController();
    extra.abort();
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      abortSignal: () => extra.signal,
    });

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: true });
  });

  it("aborts on the REQUEST signal, so the extra one never widens the step's life", async () => {
    const request = new AbortController();
    request.abort();
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      // A perfectly healthy extra signal. The request's is what fires.
      abortSignal: () => new AbortController().signal,
    });

    expect(
      await runForTest(seq, null, createMockContext({ signal: request.signal }))
    ).toEqual({ aborted: true });
  });

  it("aborts on NEITHER when both are clear", async () => {
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      abortSignal: () => new AbortController().signal,
    });

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
  });

  it("propagates a LATER abort on the supplied signal into a running step", async () => {
    // The case the composition exists for: the signal fires while the step is
    // in flight, not before it starts.
    const extra = new AbortController();
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(waitsForAbort, {
      abortSignal: () => extra.signal,
    });

    const running = runForTest(seq, null, createMockContext());
    setTimeout(() => extra.abort(), 5);

    expect(await running).toEqual({ ended: "aborted" });
  });

  it("resolves the signal per dispatch, not once at definition time", async () => {
    // A step composed once and run many times must get its own signal each
    // turn — the whole point is that the signal is a runtime fact.
    const signals: AbortSignal[] = [];
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      abortSignal: () => {
        const c = new AbortController();
        signals.push(c.signal);
        return c.signal;
      },
    });

    await runForTest(seq, null, createMockContext());
    await runForTest(seq, null, createMockContext());

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("is a complete no-op when the resolver returns undefined", async () => {
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      abortSignal: () => undefined,
    });

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
  });

  it("does not disturb the existing step overloads", async () => {
    // The options bag is discriminated on its own member, so adding it cannot
    // silently re-route a `step(connector, block)` or `step(factory, config)`
    // call that was already there.
    const withConnector = sequencer({ name: "a", inputSchema: z.unknown() })
      .map(() => ({ n: 1 }))
      .step((out: { n: number }) => out.n, reportsAbort);
    expect(await runForTest(withConnector, null, createMockContext())).toEqual({
      aborted: false,
    });

    const inline = sequencer({ name: "b", inputSchema: z.unknown() }).step(handler, {
      name: "inline",
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async () => ({ ok: true }),
    });
    expect(await runForTest(inline, null, createMockContext())).toEqual({ ok: true });
  });

  it("works the same on .stepIf", async () => {
    const extra = new AbortController();
    extra.abort();
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ go: true }))
      .stepIf((out: { go: boolean }) => out.go, reportsAbort, {
        abortSignal: () => extra.signal,
      });

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: true });
  });
});
