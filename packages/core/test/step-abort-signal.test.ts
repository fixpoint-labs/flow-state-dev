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
import { handler, sequencer, SuspensionError } from "../src";
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

/** Throws the one error the sequencer treats as control flow, not failure. */
const suspends = handler({
  name: "suspends",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => {
    throw new SuspensionError({ suspensionId: "sus", reason: "human_approval" });
  },
});

const throws = handler({
  name: "throws",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => {
    throw new Error("boom");
  },
});

describe(".step(block, { onSettled })", () => {
  it("runs when the step RETURNS", async () => {
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      onSettled: () => {
        calls += 1;
      },
    });

    await runForTest(seq, null, createMockContext());
    expect(calls).toBe(1);
  });

  it("runs when the step THROWS, and does not swallow the error", async () => {
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(throws, {
      onSettled: () => {
        calls += 1;
      },
    });

    await expect(runForTest(seq, null, createMockContext())).rejects.toThrow("boom");
    expect(calls).toBe(1);
  });

  it("runs when the step SUSPENDS — the exit no composed handler can see", async () => {
    // The reason this option exists. `.rescue()` is deliberately never run for
    // a `SuspensionError`, and a suspended request does not abort its signal,
    // so without a `finally` here anything the step was holding open — a timer,
    // a lease renewal, a subscription — outlives the request silently.
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .step(suspends, {
        onSettled: () => {
          calls += 1;
        },
      })
      .rescue([{ block: reportsAbort }]);

    await expect(runForTest(seq, null, createMockContext())).rejects.toBeInstanceOf(
      SuspensionError
    );
    // The rescue did NOT fire (suspension is control flow) but the hook did.
    expect(calls).toBe(1);
  });

  it("does NOT run when a .stepIf condition skips the dispatch", async () => {
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ go: false }))
      .stepIf((out: { go: boolean }) => out.go, reportsAbort, {
        onSettled: () => {
          calls += 1;
        },
      });

    await runForTest(seq, null, createMockContext());
    expect(calls).toBe(0);
  });

  it("reports WHICH exit it is reporting", async () => {
    // The three exits are not interchangeable to a caller releasing a resource.
    // `returned` and `threw` both hand off to a downstream step that still has
    // work to do — a recorder, a `.rescue()` handler — and this hook fires
    // before that step runs. Only `suspended` has nothing downstream at all.
    // A caller that cannot tell them apart must either release too early on two
    // paths or leak on the third.
    const outcomes: string[] = [];
    const hook = { onSettled: (_ctx: unknown, outcome: string) => outcomes.push(outcome) };

    await runForTest(
      sequencer({ name: "a", inputSchema: z.unknown() }).step(reportsAbort, hook as never),
      null,
      createMockContext()
    );
    await expect(
      runForTest(
        sequencer({ name: "b", inputSchema: z.unknown() }).step(throws, hook as never),
        null,
        createMockContext()
      )
    ).rejects.toThrow("boom");
    await expect(
      runForTest(
        sequencer({ name: "c", inputSchema: z.unknown() }).step(suspends, hook as never),
        null,
        createMockContext()
      )
    ).rejects.toBeInstanceOf(SuspensionError);

    expect(outcomes).toEqual(["returned", "threw", "suspended"]);
  });

  it("reports the outcome on .stepIf too", async () => {
    const outcomes: string[] = [];
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ go: true }))
      .stepIf((out: { go: boolean }) => out.go, suspends, {
        onSettled: (_ctx, outcome) => outcomes.push(outcome),
      });

    await expect(runForTest(seq, null, createMockContext())).rejects.toBeInstanceOf(
      SuspensionError
    );
    expect(outcomes).toEqual(["suspended"]);
  });

  it("is recognised as an options bag on its own, without abortSignal", async () => {
    // The two members are independent; discriminating on only one would make
    // an `onSettled`-only bag get read as a block or a connector.
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      onSettled: () => {
        calls += 1;
      },
    });

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
    expect(calls).toBe(1);
  });
});

describe("an EMPTY step-options bag", () => {
  // Both members are optional, so `.step(block, {})` type-checks — and it is
  // what conditional assembly produces on the branch where neither option
  // applies. Read as anything but options it promotes the block to a connector
  // and hands `{}` to the child slot, which dies on `block.config` while the
  // sequencer is still being composed. So a call the types accept takes down
  // the pattern that contains it, at import time, before anything runs.

  it("runs .step(block, {}) exactly as .step(block)", async () => {
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {});

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
  });

  it("runs .stepIf(cond, block, {}) exactly as .stepIf(cond, block)", async () => {
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ go: true }))
      .stepIf((out: { go: boolean }) => out.go, reportsAbort, {});

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
  });

  it("still resolves the connector in .step(connector, block, {})", async () => {
    // The empty bag is peeled off the trailing slot, so the two arguments in
    // front of it keep the meaning they always had.
    const seen: unknown[] = [];
    const echo = handler({
      name: "echo",
      inputSchema: z.unknown(),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: async (input) => {
        seen.push(input);
        return { ok: true };
      },
    });

    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ n: 7 }))
      .step((out: { n: number }) => out.n, echo, {});

    expect(await runForTest(seq, null, createMockContext())).toEqual({ ok: true });
    expect(seen).toEqual([7]);
  });

  it("handles a bag assembled conditionally down to nothing", async () => {
    // The way this reaches real code: the caller spreads in whichever options
    // apply, and on some paths none of them do.
    const resolver: (() => AbortSignal | undefined) | undefined = undefined;
    const hook: (() => void) | undefined = undefined;
    const options = {
      ...(resolver !== undefined ? { abortSignal: resolver } : {}),
      ...(hook !== undefined ? { onSettled: hook } : {}),
    };

    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(
      reportsAbort,
      options
    );

    expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
  });
});


describe("a THROWING onSettled hook cannot change the step's outcome", () => {
  // The hook runs in a `finally`, and a synchronous throw out of a `finally`
  // replaces whatever the block was completing with. All three exits are at
  // risk, and the third is the serious one: suspension is control flow, it is
  // the exit this hook exists to catch, and a cleanup bug there would turn a
  // parked request into a crash.
  //
  // Every case runs on `.step` AND `.stepIf`. The two dispatch paths carry
  // their own copy of this `finally`, so a guard added to one and not the other
  // reads as fixed while half the surface is untouched.

  const boom = () => {
    throw new Error("cleanup exploded");
  };

  function silenceErrors() {
    const seen: unknown[][] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      seen.push(args);
    };
    return {
      seen,
      restore: () => {
        console.error = original;
      },
    };
  }

  it(".step — a returned value survives the hook throwing", async () => {
    const log = silenceErrors();
    try {
      const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
        onSettled: boom,
      });
      expect(await runForTest(seq, null, createMockContext())).toEqual({ aborted: false });
    } finally {
      log.restore();
    }
    expect(log.seen).toHaveLength(1);
  });

  it(".step — the ORIGINAL error survives, not the hook's", async () => {
    const log = silenceErrors();
    try {
      const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(throws, {
        onSettled: boom,
      });
      await expect(runForTest(seq, null, createMockContext())).rejects.toThrow("boom");
    } finally {
      log.restore();
    }
    expect(log.seen).toHaveLength(1);
  });

  it(".step — a SUSPENSION survives, so cleanup cannot crash a parked request", async () => {
    const log = silenceErrors();
    try {
      const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(suspends, {
        onSettled: boom,
      });
      await expect(runForTest(seq, null, createMockContext())).rejects.toBeInstanceOf(
        SuspensionError
      );
    } finally {
      log.restore();
    }
    expect(log.seen).toHaveLength(1);
  });

  it(".stepIf — same three, on the other dispatch path", async () => {
    const log = silenceErrors();
    try {
      const go = (out: { go: boolean }) => out.go;
      const returned = sequencer({ name: "a", inputSchema: z.unknown() })
        .map(() => ({ go: true }))
        .stepIf(go, reportsAbort, { onSettled: boom });
      expect(await runForTest(returned, null, createMockContext())).toEqual({
        aborted: false,
      });

      const threw = sequencer({ name: "b", inputSchema: z.unknown() })
        .map(() => ({ go: true }))
        .stepIf(go, throws, { onSettled: boom });
      await expect(runForTest(threw, null, createMockContext())).rejects.toThrow("boom");

      const suspended = sequencer({ name: "c", inputSchema: z.unknown() })
        .map(() => ({ go: true }))
        .stepIf(go, suspends, { onSettled: boom });
      await expect(
        runForTest(suspended, null, createMockContext())
      ).rejects.toBeInstanceOf(SuspensionError);
    } finally {
      log.restore();
    }
    expect(log.seen).toHaveLength(3);
  });

  it("reports the hook's failure rather than swallowing it", async () => {
    // The hook releases something. A release that fails in silence is how a
    // mechanism goes on running with nothing left to say so.
    const log = silenceErrors();
    try {
      const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
        onSettled: boom,
      });
      await runForTest(seq, null, createMockContext());
    } finally {
      log.restore();
    }

    expect(log.seen).toHaveLength(1);
    const message = String(log.seen[0][0]);
    expect(message).toContain("reports-abort");
    expect(message).toContain("returned");
    expect(String(log.seen[0][1])).toContain("cleanup exploded");
  });
});


describe("a REPLAYED step does not settle", () => {
  // On a durable resume, `executeBlock` injects a completed child's recorded
  // output instead of running it — no body, no emit, no state mutation. There
  // was never a dispatch, so there is nothing to settle, and firing the hook
  // anyway re-runs cleanup for work that ran once. A request that re-enters
  // five times would release a semaphore five times.
  //
  // The hook cannot defend itself here: it receives `(ctx, outcome)` and would
  // see `"returned"`, indistinguishable from a real dispatch. `ctx._replayLog`
  // only says the REQUEST is a resume, not that THIS step was injected — a step
  // that genuinely re-executes during a resume carries it too. So the contract
  // is only implementable if the dispatch site makes the distinction.

  /** A replay log that reports `path` as already completed with `value`. */
  function replayLogFor(path: string, value: unknown) {
    return {
      // Keys are `${requestId}:${blockPath}` — match the trailing path segment.
      getCompletedOutput: (key: string) =>
        key.endsWith(`/${path}`) || key.endsWith(`:${path}`)
          ? { kind: "inline" as const, value }
          : undefined,
    };
  }

  function ctxWithReplay(path: string, value: unknown) {
    const ctx = createMockContext() as Record<string, unknown>;
    ctx._replayLog = replayLogFor(path, value);
    return ctx as unknown as ReturnType<typeof createMockContext>;
  }

  it("skips onSettled for a step whose output is injected", async () => {
    let calls = 0;
    let ran = 0;
    const body = handler({
      name: "counts-runs",
      inputSchema: z.unknown(),
      outputSchema: z.object({ n: z.number() }),
      execute: async () => {
        ran += 1;
        return { n: 1 };
      },
    });

    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(body, {
      onSettled: () => {
        calls += 1;
      },
    });

    // Sanity: a real dispatch runs the body and settles once.
    await runForTest(seq, null, createMockContext());
    expect(ran).toBe(1);
    expect(calls).toBe(1);

    // Now the same step under a replay log that already holds its output.
    const replayed = await runForTest(seq, null, ctxWithReplay("step[0]", { n: 99 }));

    expect(replayed).toEqual({ n: 99 });
    expect(ran).toBe(1); // body did NOT re-run
    expect(calls).toBe(1); // and the hook did NOT fire again
  });

  it("skips it on .stepIf too", async () => {
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ go: true }))
      .stepIf((out: { go: boolean }) => out.go, reportsAbort, {
        onSettled: () => {
          calls += 1;
        },
      });

    await runForTest(seq, null, ctxWithReplay("stepIf[1]", { aborted: false }));

    expect(calls).toBe(0);
  });

  it("still settles a step that genuinely runs during a resume", async () => {
    // The guard against over-suppressing: being inside a resumed request is not
    // the same as being replayed. A step with no recorded output executes
    // normally and must settle normally.
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      onSettled: () => {
        calls += 1;
      },
    });

    await runForTest(seq, null, ctxWithReplay("some-other-path[7]", { n: 1 }));

    expect(calls).toBe(1);
  });
});


describe("the CONNECTOR runs under the step's composed signal", () => {
  // `.step(connector, block, { abortSignal })` documents that the step runs
  // under either signal. The connector is part of that dispatch — it is where
  // an async projection or a fetch would sit — so handing it the original
  // context means it keeps running after the extra signal fires, or blocks
  // forever on one that had already fired before the step began.

  it("sees an already-aborted extra signal", async () => {
    const extra = new AbortController();
    extra.abort();
    let seen: boolean | undefined;

    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ n: 1 }))
      .step(
        (out: { n: number }, ctx) => {
          seen = ctx.signal?.aborted === true;
          return out.n;
        },
        reportsAbort,
        { abortSignal: () => extra.signal }
      );

    await runForTest(seq, null, createMockContext());
    expect(seen).toBe(true);
  });

  it("is released when the extra signal fires while it is awaiting", async () => {
    // The shape that hangs without this: a connector that waits on its signal.
    const extra = new AbortController();
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ n: 1 }))
      .step(
        async (out: { n: number }, ctx) =>
          new Promise<number>((resolve) => {
            if (ctx.signal?.aborted === true) return resolve(out.n);
            ctx.signal?.addEventListener("abort", () => resolve(out.n), { once: true });
            setTimeout(() => resolve(-1), 3_000);
          }),
        reportsAbort,
        { abortSignal: () => extra.signal }
      );

    const running = runForTest(seq, null, createMockContext());
    setTimeout(() => extra.abort(), 10);

    expect(await running).toEqual({ aborted: true });
  }, 10_000);

  it("still sees the request's signal when no extra one is supplied", async () => {
    // The unchanged path: no options bag, connector runs on the caller's ctx.
    const request = new AbortController();
    request.abort();
    let seen: boolean | undefined;

    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ n: 1 }))
      .step((out: { n: number }, ctx) => {
        seen = ctx.signal?.aborted === true;
        return out.n;
      }, reportsAbort);

    await runForTest(seq, null, createMockContext({ signal: request.signal }));
    expect(seen).toBe(true);
  });
});

describe("the abortSignal RESOLVER is skipped on replay too", () => {
  // Gating only the settle hook left half the problem. The resolver reads live
  // runtime state — which claim this iteration holds — and on a resume that
  // state belongs to the original run. Calling it can throw where the cached
  // output would have been returned, and a resolver that is not a pure read
  // runs again on every re-entry.

  function ctxWithReplay(path: string, value: unknown) {
    const ctx = createMockContext() as Record<string, unknown>;
    ctx._replayLog = {
      getCompletedOutput: (key: string) =>
        key.endsWith(`/${path}`) || key.endsWith(`:${path}`)
          ? { kind: "inline" as const, value }
          : undefined,
    };
    return ctx as unknown as ReturnType<typeof createMockContext>;
  }

  it("does not call it for a replayed .step", async () => {
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      abortSignal: () => {
        calls += 1;
        return undefined;
      },
    });

    await runForTest(seq, null, createMockContext());
    expect(calls).toBe(1); // a real dispatch resolves once

    await runForTest(seq, null, ctxWithReplay("step[0]", { aborted: false }));
    expect(calls).toBe(1); // the replayed one did not
  });

  it("does not call it for a replayed .stepIf", async () => {
    let calls = 0;
    const seq = sequencer({ name: "s", inputSchema: z.unknown() })
      .map(() => ({ go: true }))
      .stepIf((out: { go: boolean }) => out.go, reportsAbort, {
        abortSignal: () => {
          calls += 1;
          return undefined;
        },
      });

    await runForTest(seq, null, ctxWithReplay("stepIf[1]", { aborted: false }));
    expect(calls).toBe(0);
  });

  it("a resolver that THROWS does not break a resume", async () => {
    // The concrete failure: the resolver reaches for state the original run
    // owned. On a resume that state is gone, and the cached output should still
    // come back.
    const seq = sequencer({ name: "s", inputSchema: z.unknown() }).step(reportsAbort, {
      abortSignal: () => {
        throw new Error("no live claim on resume");
      },
    });

    expect(
      await runForTest(seq, null, ctxWithReplay("step[0]", { aborted: false }))
    ).toEqual({ aborted: false });
  });
});
