/**
 * `runClaudeHeadless` — the blocking, unattended Agent SDK run.
 *
 * The behaviour worth pinning is not the option list; it is that this function
 * **settles rather than throws** on every way a run can go wrong, because
 * callers keep a ledger off the returned value and a thrown error would skip
 * the record entirely. Each failure mode below is one of those ways.
 *
 * The other pinned behaviours are the two SDK defaults that are *not* Claude
 * Code's defaults: with `settingSources` omitted the SDK loads no `CLAUDE.md`
 * and no project settings, and with `systemPrompt` omitted it runs with an
 * empty system prompt. A run dispatched into a repository silently loses both,
 * so this module opts back in and the tests hold it to that.
 */
import { describe, expect, it, vi } from "vitest";
import { runClaudeHeadless } from "../../src/sdk/headless";
import { createResolveClaudeAgentQuery } from "../../src/sdk/sdk-client";
import type {
  ClaudeAgentQueryOptions,
  ResolveClaudeAgentQuery,
  SdkMessageLike,
} from "../../src/sdk/types";

/** A terminal `result` message, success by default. */
const result = (extra: Partial<Extract<SdkMessageLike, { type: "result" }>> = {}) =>
  ({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "done",
    session_id: "sess-abc",
    total_cost_usd: 1.25,
    usage: { input_tokens: 900, output_tokens: 120 },
    ...extra,
  }) satisfies SdkMessageLike;

/** A resolver whose `query` replays `messages`, recording the options it got. */
function scriptedAgent(messages: readonly SdkMessageLike[]) {
  const query = vi.fn(async function* (_args: {
    prompt: string | AsyncIterable<unknown>;
    options?: ClaudeAgentQueryOptions;
  }): AsyncGenerator<SdkMessageLike> {
    for (const message of messages) yield message;
  });
  const resolveAgent: ResolveClaudeAgentQuery = () => ({ query });
  return { query, resolveAgent };
}

/**
 * A stream that never yields and never rejects — the wedged SDK iterator, or an
 * injected one that ignores `abortController`.
 *
 * Deliberately hand-rolled rather than an `async function*` awaiting a timer:
 * fake timers would fire that one, and the test would prove nothing. Its `next()`
 * promise genuinely never settles.
 */
const wedgedStream = (): AsyncIterable<SdkMessageLike> => ({
  [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
});

/** The options the scripted `query` was called with. */
const optionsOf = (query: ReturnType<typeof scriptedAgent>["query"]): ClaudeAgentQueryOptions =>
  vi.mocked(query).mock.calls[0]![0].options!;

describe("runClaudeHeadless", () => {
  it("runs the prompt in the directory it was given", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "do the thing", cwd: "/repo/wt", resolveAgent });

    expect(query).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0]![0].prompt).toBe("do the thing");
    expect(optionsOf(query).cwd).toBe("/repo/wt");
  });

  it("loads the project's settings and CLAUDE.md, which the SDK does not do on its own", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent });

    // `project` is the source that carries CLAUDE.md; omitting settingSources
    // entirely would have run the agent blind to the repository it is editing.
    expect(optionsOf(query).settingSources).toContain("project");
    expect(optionsOf(query).settingSources).toEqual(["user", "project", "local"]);
  });

  it("asks for Claude Code's system prompt, which the SDK also does not do on its own", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(optionsOf(query).systemPrompt).toEqual({ type: "preset", preset: "claude_code" });
  });

  it("lets a caller isolate a run from the filesystem and replace the prompt", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      settingSources: [],
      systemPrompt: "You are a linter.",
      resolveAgent,
    });
    expect(optionsOf(query).settingSources).toEqual([]);
    expect(optionsOf(query).systemPrompt).toBe("You are a linter.");
  });

  it("passes model, turn and budget ceilings only when set, so the SDK's defaults stand", async () => {
    const bare = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent: bare.resolveAgent });
    expect(optionsOf(bare.query).model).toBeUndefined();
    expect(optionsOf(bare.query).maxTurns).toBeUndefined();
    expect(optionsOf(bare.query).maxBudgetUsd).toBeUndefined();

    const configured = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      model: "opus",
      maxTurns: 40,
      maxBudgetUsd: 5,
      resolveAgent: configured.resolveAgent,
    });
    expect(optionsOf(configured.query).model).toBe("opus");
    expect(optionsOf(configured.query).maxTurns).toBe(40);
    expect(optionsOf(configured.query).maxBudgetUsd).toBe(5);
  });

  it("merges extra environment over the host's rather than replacing it", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", env: { CONDUCTOR_PHASE: "IMPLEMENTATION" }, resolveAgent });

    const env = optionsOf(query).env!;
    expect(env.CONDUCTOR_PHASE).toBe("IMPLEMENTATION");
    // The SDK's `env` is the *whole* environment, so passing the caller's map
    // through would run the agent without PATH, HOME, or its credentials.
    expect(env.PATH).toBe(process.env.PATH);
  });

  it("leaves the environment alone when the caller sets none", async () => {
    const { query, resolveAgent } = scriptedAgent([result()]);
    await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(optionsOf(query).env).toBeUndefined();
  });

  it("carries the explicit-intent flag the SDK demands alongside bypassPermissions", async () => {
    const bypass = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      permissionMode: "bypassPermissions",
      resolveAgent: bypass.resolveAgent,
    });
    expect(optionsOf(bypass.query).allowDangerouslySkipPermissions).toBe(true);

    // Every other mode must not carry it — it is a confirmation, not a default.
    const edits = scriptedAgent([result()]);
    await runClaudeHeadless({
      prompt: "p",
      permissionMode: "acceptEdits",
      resolveAgent: edits.resolveAgent,
    });
    expect(optionsOf(edits.query).allowDangerouslySkipPermissions).toBeUndefined();
  });

  it("reports the final message, session, cost, usage and subtype of a successful run", async () => {
    const { resolveAgent } = scriptedAgent([result()]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run).toEqual({
      ok: true,
      error: null,
      finalMessage: "done",
      sessionId: "sess-abc",
      costUsd: 1.25,
      subtype: "success",
      usage: { inputTokens: 900, outputTokens: 120 },
    });
  });

  it("fails on an error subtype, naming the class so the caller can tell a ceiling from a crash", async () => {
    const { resolveAgent } = scriptedAgent([
      result({
        subtype: "error_max_turns",
        is_error: true,
        result: undefined,
        errors: ["ran out of turns"],
      }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.subtype).toBe("error_max_turns");
    expect(run.error).toContain("ran out of turns");
    expect(run.error).toContain("error_max_turns");
    // Cost and usage are real when the run failed — the tokens were spent.
    expect(run.costUsd).toBe(1.25);
    expect(run.usage).toEqual({ inputTokens: 900, outputTokens: 120 });
  });

  it("fails when the SDK flags a success result as an error", async () => {
    const { resolveAgent } = scriptedAgent([result({ is_error: true, result: "hit a wall" })]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("hit a wall");
    expect(run.costUsd).toBe(1.25);
  });

  it("fails a run the harness refused a tool, which the SDK still reports as a success", async () => {
    // The shape that cost an investigation: the agent asked to push, the harness
    // refused it, the model was told to try something else, and the run ended
    // `subtype: "success"`. Read as a completion, that is a dispatch recorded as
    // done whose branch was never pushed.
    const { resolveAgent } = scriptedAgent([
      result({
        permission_denials: [
          { tool_name: "Bash", tool_use_id: "call-1", tool_input: { command: "git push" } },
        ],
      }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    // The reason has to say *refused*, not just "failed": an operator reading the
    // ledger acts on a missing permission differently than on a broken agent.
    expect(run.error).toContain("refused");
    expect(run.error).toContain("Bash");
    expect(run.error).toContain("git push");
    // Cost, session and usage survive — the tokens were spent either way.
    expect(run.costUsd).toBe(1.25);
    expect(run.sessionId).toBe("sess-abc");
  });

  it("keeps a failed run's own reason and adds what it was refused, so both diagnoses survive", async () => {
    const { resolveAgent } = scriptedAgent([
      result({
        subtype: "error_max_turns",
        is_error: true,
        result: undefined,
        errors: ["ran out of turns"],
        permission_denials: [
          { tool_name: "Bash", tool_use_id: "call-1", tool_input: { command: "pnpm test" } },
        ],
      }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    // Burning the turn ceiling and being refused a tool are one story, not two:
    // the refusals are usually why the turns went.
    expect(run.error).toContain("ran out of turns");
    expect(run.error).toContain("error_max_turns");
    expect(run.error).toContain("pnpm test");
  });

  it("reports every refusal, not just the first, so a missing permission is not read as one command", async () => {
    const { resolveAgent } = scriptedAgent([
      result({
        permission_denials: [
          { tool_name: "Bash", tool_use_id: "c1", tool_input: { command: "git commit -m 'x'" } },
          { tool_name: "Edit", tool_use_id: "c2", tool_input: { file_path: "/etc/hosts" } },
        ],
      }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("git commit");
    expect(run.error).toContain("/etc/hosts");
  });

  it("leaves a run that was refused nothing alone, so an empty denial list is not a failure", async () => {
    const { resolveAgent } = scriptedAgent([result({ permission_denials: [] })]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(true);
    expect(run.error).toBeNull();
  });

  it("fails on a subtype it does not recognize, rather than reading a future failure as success", async () => {
    const { resolveAgent } = scriptedAgent([
      result({ subtype: "error_something_new", is_error: true, result: undefined }),
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.subtype).toBeNull();
    expect(run.error).toContain("error_something_new");
  });

  it("settles as failed when the SDK is not installed, instead of throwing past the caller's ledger", async () => {
    const resolveAgent = createResolveClaudeAgentQuery(() => {
      throw new Error("Cannot find module '@anthropic-ai/claude-agent-sdk'");
    });
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("@anthropic-ai/claude-agent-sdk");
    expect(run.costUsd).toBeNull();
  });

  it("settles as failed when the run throws mid-stream, keeping the session it had reached", async () => {
    const resolveAgent: ResolveClaudeAgentQuery = () => ({
      query: async function* (): AsyncGenerator<SdkMessageLike> {
        yield { type: "system", subtype: "init", session_id: "sess-partial" };
        throw new Error("stream closed unexpectedly");
      },
    });
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("stream closed unexpectedly");
    expect(run.sessionId).toBe("sess-partial");
  });

  it("settles as failed when the run exceeds its time budget, and aborts the agent", async () => {
    let abortedSignal: AbortSignal | undefined;
    const resolveAgent: ResolveClaudeAgentQuery = () => ({
      query: async function* (args): AsyncGenerator<SdkMessageLike> {
        abortedSignal = args.options?.abortController?.signal;
        yield { type: "system", subtype: "init", session_id: "sess-slow" };
        await new Promise<void>((_resolve, reject) => {
          abortedSignal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      },
    });
    const run = await runClaudeHeadless({ prompt: "p", timeoutMs: 10, resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("10 ms budget");
    expect(run.sessionId).toBe("sess-slow");
    expect(abortedSignal?.aborted).toBe(true);
  });

  it("settles as failed when the SDK never finishes loading, rather than hanging past its budget", async () => {
    vi.useFakeTimers();
    try {
      // A promise that genuinely never settles — the stalled `import()` or the
      // wedged custom resolver. Deliberately NOT a promise resolved on a timer:
      // fake timers would fire that one and the test would prove nothing.
      const resolveAgent: ResolveClaudeAgentQuery = () => new Promise<never>(() => {});
      const pending = runClaudeHeadless({ prompt: "p", timeoutMs: 30_000, resolveAgent });
      await vi.advanceTimersByTimeAsync(30_000);

      // A hang here is the failure this pins: no result means no dispatch_failed
      // signal, no ledger row, and an entity parked at a gate with no evidence.
      const run = await pending;
      expect(run.ok).toBe(false);
      expect(run.error).toContain("30000 ms");
      // The diagnosis has to name *resolution*: "the harness never loaded" and
      // "the run overran its budget" send a human to different places.
      expect(run.error).toMatch(/did not finish loading/);
      expect(run.error).not.toMatch(/run exceeded/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles as failed when the agent ignores the abort, rather than hanging past its budget", async () => {
    vi.useFakeTimers();
    try {
      // The case `abortController` cannot reach: an iterator that took the
      // signal and does nothing with it. Aborting and *waiting* for this one to
      // reject waits forever, so the call has to leave without it.
      const resolveAgent: ResolveClaudeAgentQuery = () => ({
        query: () => wedgedStream(),
      });
      const pending = runClaudeHeadless({ prompt: "p", timeoutMs: 30_000, resolveAgent });
      await vi.advanceTimersByTimeAsync(30_000);

      const run = await pending;
      expect(run.ok).toBe(false);
      expect(run.error).toContain("30000 ms");
      // Named as the *run* overrunning, not as the harness failing to load.
      expect(run.error).toMatch(/exceeded/);
      // And honestly: nothing here could stop it, so it may still be spending.
      expect(run.error).toMatch(/may still be running/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not report a run that ignored the abort and succeeded late as a success", async () => {
    vi.useFakeTimers();
    try {
      // Yields nothing until released, then reports a clean success — the run
      // that blew its budget by an hour and then finished. Reported as `ok`, a
      // caller's ledger records a normal completion and the overrun vanishes.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const messages: SdkMessageLike[] = [result()];
      const resolveAgent: ResolveClaudeAgentQuery = () => ({
        query: async function* (): AsyncGenerator<SdkMessageLike> {
          await gate;
          for (const message of messages) yield message;
        },
      });
      const pending = runClaudeHeadless({ prompt: "p", timeoutMs: 30_000, resolveAgent });
      await vi.advanceTimersByTimeAsync(30_000);

      release();
      const run = await pending;
      expect(run.ok).toBe(false);
      expect(run.error).toContain("30000 ms");
      expect(run.finalMessage).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes the stream on the deadline when the SDK offers a way to, and says so", async () => {
    vi.useFakeTimers();
    try {
      // The real `query()` handle is an async generator with a `close()` that
      // tears the agent process down. Given one, the deadline is a real stop
      // rather than an abandonment — and the reason says the run was stopped.
      const close = vi.fn();
      const resolveAgent: ResolveClaudeAgentQuery = () => ({
        query: () => Object.assign(wedgedStream(), { close }),
      });
      const pending = runClaudeHeadless({ prompt: "p", timeoutMs: 30_000, resolveAgent });
      await vi.advanceTimersByTimeAsync(30_000);

      const run = await pending;
      expect(run.ok).toBe(false);
      expect(close).toHaveBeenCalledTimes(1);
      expect(run.error).toContain("30000 ms");
      expect(run.error).not.toMatch(/may still be running/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves no timer armed after a run that finished inside its budget", async () => {
    vi.useFakeTimers();
    try {
      const { resolveAgent } = scriptedAgent([result()]);
      const run = await runClaudeHeadless({ prompt: "p", timeoutMs: 30_000, resolveAgent });
      expect(run.ok).toBe(true);
      // A deadline timer left armed holds the event loop open for its full
      // budget — a 30-minute dispatch would keep a finished process alive.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("settles as failed when the SDK seam rejects with a non-Error, rather than throwing out of its own catch", async () => {
    // `null` and `undefined` are what a badly-behaved seam or a rejected
    // `Promise.reject()` actually carries. Reading `.message` off one throws a
    // fresh TypeError *from the handler that exists to settle the failure*, so
    // the caller's ledger loses the dispatch entirely instead of recording it.
    const resolveAgent: ResolveClaudeAgentQuery = () => Promise.reject(null);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("null");
    expect(run.error).toContain("Claude Agent SDK");
  });

  it("settles as failed when the run rejects mid-stream with a non-Error", async () => {
    const resolveAgent: ResolveClaudeAgentQuery = () => ({
      query: async function* (): AsyncGenerator<SdkMessageLike> {
        yield { type: "system", subtype: "init", session_id: "sess-partial" };
        // Not `new Error(...)` — a string is the case the `.message` read misses.
        throw "the harness rejected with a string";
      },
    });
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("the harness rejected with a string");
    expect(run.sessionId).toBe("sess-partial");
  });

  it("settles as failed when the stream ends without a terminal result", async () => {
    const { resolveAgent } = scriptedAgent([
      { type: "system", subtype: "init", session_id: "sess-truncated" },
    ]);
    const run = await runClaudeHeadless({ prompt: "p", resolveAgent });
    expect(run.ok).toBe(false);
    expect(run.error).toContain("without a terminal result");
    expect(run.sessionId).toBe("sess-truncated");
  });

  /**
   * A `timeoutMs` no timer can hold.
   *
   * `setTimeout` does not reject a delay it cannot represent — it coerces `NaN`,
   * a negative, and anything past 2^31-1 to **1 ms**. Left unchecked that turns
   * the ceiling this module spent two fixes getting right into an instant
   * failure, reported in the caller's ledger as *the run overran its budget*:
   * the one reading of it that sends a human to look at the agent instead of at
   * the number they passed.
   *
   * So each case below asserts the two things a ledger reader needs, and both
   * are observable from the returned value alone:
   *
   * - the reason names the **option and the value**, and does *not* read as an
   *   overrun — otherwise the diagnosis points at the wrong half of the system;
   * - `query` was **never called** — so the failure is honest that no agent was
   *   started, meaning nothing was spent and nothing was left running.
   */
  describe("rejects a timeoutMs no timer can hold", () => {
    /** The largest delay a timer can actually hold, and the boundary asserted below. */
    const MAX = 2_147_483_647;

    const cases: readonly (readonly [string, number])[] = [
      // Silent: Node emits no warning for these two, so nothing marks the coercion.
      ["NaN", NaN],
      ["a negative budget", -1],
      // Warn on stderr only — lost in an unattended dispatch that logs a result.
      ["Infinity", Infinity],
      // The finding's case: a 30-day ceiling computed arithmetically, which is
      // 2_592_000_000 ms and comfortably past the ~24.8-day limit.
      ["a 30-day budget past the 32-bit timer range", 2_592_000_000],
      // `undefined` is already how a caller says "no ceiling"; reading `0` as a
      // second spelling of that would fail *open* on an exhausted computed
      // budget — an unbounded run where an instant refusal was wanted.
      ["zero", 0],
    ];

    for (const [label, timeoutMs] of cases) {
      it(`settles as caller misuse on ${label}, without starting an agent`, async () => {
        const { query, resolveAgent } = scriptedAgent([result()]);
        const run = await runClaudeHeadless({ prompt: "p", timeoutMs, resolveAgent });

        expect(run.ok).toBe(false);
        // Names the option and the value, so the ledger says "you passed a bad
        // number" rather than "the harness is broken".
        expect(run.error).toContain("timeoutMs");
        expect(run.error).toContain(String(timeoutMs));
        // And must NOT be dressed as the run overrunning — that is the exact
        // misdiagnosis the ~1 ms coercion produces today.
        expect(run.error).not.toMatch(/exceeded/);
        expect(run.error).not.toMatch(/may still be running/);
        // Nothing was started, so there is no spend and no agent to go kill.
        expect(query).not.toHaveBeenCalled();
        expect(run.costUsd).toBeNull();
        expect(run.sessionId).toBeNull();
      });
    }

    it("does not blame a working run for an overrun when the budget was the thing at fault", async () => {
      // The regression in its natural habitat. The cases above use an instant
      // agent, where a 1 ms deadline never gets to bite; a run doing real work
      // is where it does. Measured before the guard: this settled in 3 ms with
      // "exceeded its 2592000000 ms budget ... may still be running" — a run
      // that was fine, reported as the agent's fault, pointing whoever read the
      // ledger at the harness instead of at the number.
      const resolveAgent: ResolveClaudeAgentQuery = () => ({
        query: async function* (): AsyncGenerator<SdkMessageLike> {
          await new Promise<void>((r) => setTimeout(r, 60));
          yield result();
        },
      });
      const run = await runClaudeHeadless({ prompt: "p", timeoutMs: 2_592_000_000, resolveAgent });
      expect(run.ok).toBe(false);
      expect(run.error).toContain("timeoutMs");
      expect(run.error).not.toMatch(/exceeded/);
      expect(run.error).not.toMatch(/may still be running/);
    });

    it("accepts the largest budget a timer can hold, so the ceiling is rejected only past the real limit", async () => {
      // Guards the boundary in the useful direction: a validator that is off by
      // one here refuses a legitimate budget, which is its own silent failure.
      const { query, resolveAgent } = scriptedAgent([result()]);
      const run = await runClaudeHeadless({ prompt: "p", timeoutMs: MAX, resolveAgent });
      expect(run.ok).toBe(true);
      expect(query).toHaveBeenCalledTimes(1);
    });

    it("does not fail a run whose budget is merely generous", async () => {
      // The regression the over-range rejection must not cause: a large but
      // representable ceiling has to still be a ceiling, not an instant refusal.
      const resolveAgent: ResolveClaudeAgentQuery = () => ({
        query: async function* (): AsyncGenerator<SdkMessageLike> {
          await new Promise<void>((r) => setTimeout(r, 25));
          yield result();
        },
      });
      const run = await runClaudeHeadless({ prompt: "p", timeoutMs: 60_000, resolveAgent });
      expect(run.ok).toBe(true);
    });
  });

  /**
   * A `maxTurns` or `maxBudgetUsd` that is not a ceiling.
   *
   * The same class as the `timeoutMs` block above, on this surface's other two
   * numbers, and the reason it is worth its own guard is that here the failure
   * is **open** rather than fast — a ceiling that is not one lets a paid run go
   * further, not less far.
   *
   * Checked against the pinned Agent SDK (0.1.77). Its transport forwards
   * `maxBudgetUsd` as `--max-budget-usd` whenever the value is not `undefined`,
   * and the bundled CLI parses that flag as
   * `let x = Number(s); if (isNaN(x) || x <= 0) throw`. `Infinity` clears both
   * tests, so a computed `Infinity` reaches a paid run **as no ceiling at all**
   * — the caller believes they capped their spend and did not. `NaN` and a
   * negative are rejected, but only by the agent process after it has been
   * spawned, so they arrive in the ledger as a run that failed rather than as
   * the number that was wrong.
   *
   * `maxTurns` fails open in two directions: the transport gates it on
   * truthiness (`if (maxTurns)`), so `0` and `NaN` are dropped and the run is
   * unbounded; and the CLI parses `--max-turns` with a bare `Number`, no
   * validation at all, so `Infinity` and a negative are accepted as written.
   *
   * The assertions are the ones a ledger reader needs, and each is observable
   * from the returned value alone: the reason names the **option and the
   * value**, it does not read as an overrun, and `query` was **never called**,
   * so the failure is honest that nothing was spent.
   */
  describe("rejects a spend or turn ceiling that is not a ceiling", () => {
    const cases: readonly (readonly [string, "maxTurns" | "maxBudgetUsd", number])[] = [
      // The finding, and the only one that costs money: accepted by the SDK all
      // the way through, and it means unbounded spending on a paid run.
      ["an unbounded spend ceiling", "maxBudgetUsd", Infinity],
      // Rejected downstream, but only after an agent process exists, and
      // diagnosed there as the run failing rather than as caller misuse.
      ["a spend ceiling that is not a number", "maxBudgetUsd", NaN],
      ["a negative spend ceiling", "maxBudgetUsd", -1],
      // `undefined` is already how a caller says "no ceiling"; reading `0` as a
      // second spelling of it would fail open on an exhausted computed budget.
      ["a spent-out spend ceiling", "maxBudgetUsd", 0],
      // The twin. Unbounded turns is unbounded spend by another route.
      ["an unbounded turn ceiling", "maxTurns", Infinity],
      // Dropped by the transport's truthiness gate, so the run has no ceiling.
      ["a turn ceiling that is not a number", "maxTurns", NaN],
      ["a spent-out turn ceiling", "maxTurns", 0],
      ["a negative turn ceiling", "maxTurns", -1],
    ];

    for (const [label, option, value] of cases) {
      it(`settles as caller misuse on ${label}, without starting an agent`, async () => {
        const { query, resolveAgent } = scriptedAgent([result()]);
        const run = await runClaudeHeadless({ prompt: "p", [option]: value, resolveAgent });

        expect(run.ok).toBe(false);
        // Names the option and the value, so the ledger says "you passed a bad
        // number" rather than "the agent misbehaved".
        expect(run.error).toContain(option);
        expect(run.error).toContain(String(value));
        // And must not be dressed as the run overrunning a ceiling it was
        // never given — the misdiagnosis that sends a human to the agent.
        expect(run.error).not.toMatch(/exceeded/);
        expect(run.error).not.toMatch(/may still be running/);
        // Nothing was started, so there is no spend and no agent to go kill.
        expect(query).not.toHaveBeenCalled();
        expect(run.costUsd).toBeNull();
        expect(run.sessionId).toBeNull();
      });
    }

    it("still accepts a spend ceiling smaller than a dollar", async () => {
      // The regression the guard must not cause. `maxBudgetUsd` is dollars, so
      // sub-unit and fractional ceilings are ordinary; a validator that reached
      // for an integer check would refuse the most cautious budgets there are.
      const { query, resolveAgent } = scriptedAgent([result()]);
      const run = await runClaudeHeadless({ prompt: "p", maxBudgetUsd: 0.25, resolveAgent });

      expect(run.ok).toBe(true);
      expect(optionsOf(query).maxBudgetUsd).toBe(0.25);
    });

    it("still accepts ceilings that are merely large, since neither has a real upper bound", async () => {
      // Unlike `timeoutMs`, nothing downstream caps these, so a big budget is a
      // budget. Only the values that mean "no ceiling" are refused.
      const { query, resolveAgent } = scriptedAgent([result()]);
      const run = await runClaudeHeadless({
        prompt: "p",
        maxTurns: 10_000,
        maxBudgetUsd: 5_000,
        resolveAgent,
      });

      expect(run.ok).toBe(true);
      expect(optionsOf(query).maxTurns).toBe(10_000);
      expect(optionsOf(query).maxBudgetUsd).toBe(5_000);
    });
  });
});
