/**
 * `runClaudeHeadless` — one blocking, unattended Agent SDK run.
 *
 * The package's other surfaces wrap Claude Code for *flows*: `./cli` hands work
 * to a cloud session as a block, and `claudeCodeAgent` runs the SDK loop while
 * emitting FSD items into a session. This is the third thing a caller can want —
 * run the agent in a directory, wait for it to finish, and get back what it did
 * and what it cost — with no `BlockContext`, no session state, and no emissions.
 * It is a plain async function, so an orchestrator, a script, or a test harness
 * can use it; a caller who wants it inside a flow wraps it themselves.
 *
 * It goes through `query()` rather than shelling out to `claude -p`, so the run
 * gets the harness the SDK maintains — the tool loop, context management,
 * permission modes, sub-agents — instead of a hand-rolled equivalent, and the
 * terminal result arrives as structured data (`subtype`, `usage`) rather than
 * as text this package would have to parse back out of stdout.
 *
 * **It settles; it does not throw.** An uninstalled SDK, a timeout, a crash
 * mid-stream, and an error-subtype result all come back as `ok: false` with a
 * reason. Callers whose bookkeeping runs off the returned value (a ledger, a
 * retry budget) would lose the record to a thrown error, so there is nothing to
 * catch. A `timeoutMs` no timer can hold settles the same way, and it is the
 * one failure that is the caller's own mistake rather than the run's — the
 * contract holds anyway, because the value of a settled failure is the reason
 * it carries into the ledger, and "you passed a bad number" is precisely the
 * diagnosis a throw would delete rather than deliver.
 *
 * **Cost and usage come from the terminal result, so a run that never reached
 * one reports neither.** An error-subtype result still carries what it spent,
 * and that is reported like any other — the failure does not suppress it. But a
 * timeout or a mid-stream throw leaves `costUsd` and `usage` `null`: the tokens
 * were real and the SDK simply never told us how many. A caller totalling spend
 * has to treat those runs as unknown rather than as free.
 */
import { ClaudeAgentSdkNotInstalledError, describeThrown } from "./errors";
import { readTerminalResult, type SdkTokenUsage } from "./result";
import { defaultResolveClaudeAgentQuery } from "./sdk-client";
import type {
  ClaudeAgentQuery,
  ClaudeAgentQueryOptions,
  ClaudeAgentStream,
  ClaudeSettingSource,
  ClaudeSystemPrompt,
  ResolveClaudeAgentQuery,
  SdkMessageLike,
  SdkResultSubtype,
} from "./types";

/**
 * What a run in a checked-out repository needs loaded to behave the way the
 * `claude` binary does there.
 *
 * The SDK loads **no** filesystem settings when `settingSources` is omitted —
 * that is its isolation default, and it means no `CLAUDE.md`, no project
 * settings, and no project skills. A dispatched phase working in a repo depends
 * on exactly those, so this module opts back in and lets a caller narrow it.
 */
const REPO_SETTING_SOURCES: readonly ClaudeSettingSource[] = ["user", "project", "local"];

/**
 * Claude Code's own system prompt.
 *
 * Also not the SDK's default: omitting `systemPrompt` yields an **empty** one.
 * A headless run is meant to be Claude Code working in a directory, so the
 * preset is what this module asks for unless the caller replaces it.
 */
const CLAUDE_CODE_SYSTEM_PROMPT: ClaudeSystemPrompt = { type: "preset", preset: "claude_code" };

/**
 * Token usage for one run, as the SDK reported it. The package-wide shape under
 * this surface's own name — the terminal result is read in one place
 * (`./result`), and this is what that reading yields here.
 */
export type ClaudeHeadlessUsage = SdkTokenUsage;

/** What one headless run settled to. */
export interface ClaudeHeadlessResult {
  /** `true` only for a `success` result the SDK did not itself mark as an error. */
  readonly ok: boolean;
  /** Why it failed, in plain terms. `null` when `ok`. */
  readonly error: string | null;
  /** The agent's final answer, or `null` when the run reported none. */
  readonly finalMessage: string | null;
  /** The session id, for a human to resume or open. `null` when unreported. */
  readonly sessionId: string | null;
  /**
   * Vendor-reported cost in USD, `null` when unreported. Read from the terminal
   * result, so a *failed* run reports it — the tokens were still spent — but a
   * run that never reached a terminal result (a timeout, a mid-stream throw)
   * has nothing to read and reports `null` despite having spent.
   */
  readonly costUsd: number | null;
  /**
   * How the run ended, in the SDK's own vocabulary — `error_max_turns` and
   * `error_max_budget_usd` are ceilings the caller set and can raise, while
   * `error_during_execution` is not. `null` when the run never reached a
   * terminal result, or ended on a subtype this package does not recognize
   * (a future SDK failure mode), in which case `error` still carries the raw
   * value.
   */
  readonly subtype: SdkResultSubtype | null;
  /**
   * Tokens spent, `null` when unreported — and, like {@link costUsd}, `null`
   * for a run that ended before its terminal result. Reported on error-subtype
   * runs, and the only spend signal at all when the credentials in play bill no
   * dollar cost.
   */
  readonly usage: ClaudeHeadlessUsage | null;
}

/** How to run one headless invocation. */
export interface RunClaudeHeadlessOptions {
  /** The instruction the run starts from. */
  readonly prompt: string;
  /** Directory the agent runs in. It edits whatever it is pointed at. */
  readonly cwd?: string;
  /** Model alias or id. Omitted when unset, so the SDK's default applies. */
  readonly model?: string;
  /**
   * Permission mode. Omitted when unset. An unattended caller should pass a
   * non-prompting mode — with no terminal, a mode that asks will never be
   * answered — but which one is the caller's policy, not this module's.
   * `"bypassPermissions"` carries the SDK's explicit-intent flag automatically.
   */
  readonly permissionMode?: string;
  /** Ceiling on conversation turns. No ceiling when unset. */
  readonly maxTurns?: number;
  /** Vendor-side spend ceiling in USD. No ceiling when unset. */
  readonly maxBudgetUsd?: number;
  /**
   * Wall-clock ceiling on the whole call, **loading the SDK included** — the
   * clock starts before `resolveAgent` is called, so a harness that never loads
   * settles as a failure instead of hanging. No ceiling when unset.
   *
   * It bounds *this call*, not the agent. The deadline aborts the run and
   * closes the stream where the SDK allows it, then returns whether or not the
   * run acknowledged; an agent that ignores both is left running, and the
   * failure reason says so rather than implying it was killed.
   *
   * Must be a positive number of milliseconds no greater than
   * {@link MAX_TIMEOUT_MS} (about 24.8 days), the longest delay a timer can
   * hold. Anything else — `NaN`, a negative, `0`, or a computed budget past
   * that limit — settles immediately as a failure naming this option, rather
   * than being quietly clamped to a ceiling the caller did not ask for.
   */
  readonly timeoutMs?: number;
  /**
   * Extra environment for the agent process, **merged over** the host's rather
   * than replacing it. The SDK's own `env` replaces `process.env` outright,
   * which would take `PATH`, `HOME` and the agent's credentials with it.
   */
  readonly env?: Record<string, string>;
  /**
   * Filesystem settings to load. Defaults to all three, so a run behaves like
   * `claude` does in the same directory; pass `[]` for an isolated run that
   * reads no `CLAUDE.md` and no project settings.
   */
  readonly settingSources?: readonly ClaudeSettingSource[];
  /**
   * System prompt. Defaults to Claude Code's own; pass a string to replace it,
   * or `{ type: "preset", preset: "claude_code", append }` to extend it.
   */
  readonly systemPrompt?: ClaudeSystemPrompt;
  /** How to load the SDK. Default: the real one; injected so tests run nothing. */
  readonly resolveAgent?: ResolveClaudeAgentQuery;
}

/**
 * Sentinel for "the wall-clock deadline fired before this settled", raced
 * against the SDK resolution. A unique symbol, so no value a resolver could
 * legitimately return can be mistaken for it.
 */
const DEADLINE_EXPIRED = Symbol("claude-headless-deadline-expired");

/**
 * The longest delay a timer can actually hold: 2^31-1 ms, about 24.8 days.
 *
 * Node stores a timer's delay in a 32-bit signed integer. Past this it does not
 * overflow into a longer wait and does not fail — it silently resets the delay
 * to **1 ms**, so the more generous the budget a caller asks for, the sooner
 * their run dies. Hence a validated ceiling rather than a number worked around.
 */
const MAX_TIMEOUT_MS = 2_147_483_647;

/**
 * Reject a `timeoutMs` no timer can honour, before anything is armed.
 *
 * `setTimeout` does not refuse a delay it cannot represent. `NaN`, a negative,
 * and anything above {@link MAX_TIMEOUT_MS} all become **1 ms** — the first two
 * silently, the rest behind a stderr warning that an unattended dispatch never
 * shows anyone. The run then fails almost instantly *as a timeout*, which is
 * the one reading that sends a human to inspect the agent instead of the number
 * they passed. A caller computing a budget arithmetically hits this with no
 * signal at all: a 30-day ceiling is 2_592_000_000 ms, comfortably over.
 *
 * **Out of range is rejected, not clamped.** Clamping would hand back a quieter
 * version of the same bug — a ceiling shorter than the one asked for, with
 * nothing said about it — and this surface's whole job is to be honest about
 * what its bound does and does not stop. A deadline past 24.8 days needs
 * chained timers this does not have, and a caller who wants one should be told
 * that rather than silently given something else.
 *
 * **`0` is invalid, not "no ceiling".** Omitting the option is already how a
 * caller says unbounded; reading `0` as a second spelling of it would fail
 * *open* on an exhausted computed budget, granting an unlimited run on exactly
 * the input that should refuse fastest.
 *
 * @returns the reason the value is unusable, or `null` when it is fine.
 */
function unusableTimeout(timeoutMs: number): string | null {
  // Two comparisons cover every `number`, non-finite ones included: `NaN` fails
  // both (every relational comparison against it is false) and `Infinity` fails
  // the upper bound. An explicit finiteness check would read well and never be
  // reachable, so the range is stated once and left to do the whole job.
  if (timeoutMs > 0 && timeoutMs <= MAX_TIMEOUT_MS) return null;

  // The reason has one job: let whoever reads the ledger tell "you passed a bad
  // value" from "the agent misbehaved". So it names the option, echoes the
  // value, states the rule, and says plainly that no run was started — which is
  // also the answer to the question a timeout reason would have raised, namely
  // whether an agent is still out there spending.
  return (
    `runClaudeHeadless was given timeoutMs=${String(timeoutMs)}, which is not a usable wall-clock ` +
    `budget: it must be a positive number of milliseconds no greater than ${MAX_TIMEOUT_MS} ` +
    `(about 24.8 days), the longest delay a timer can hold. No Claude Code run was started.`
  );
}

/** Build a failure with nothing the SDK never told us invented. */
function failed(error: string, partial: Partial<ClaudeHeadlessResult> = {}): ClaudeHeadlessResult {
  return {
    ok: false,
    error,
    finalMessage: null,
    sessionId: null,
    costUsd: null,
    subtype: null,
    usage: null,
    ...partial,
  };
}

/**
 * Best-effort stop of a run whose deadline fired, and an honest answer about
 * whether it worked.
 *
 * The signal has already been aborted by the timer; that is a *request*, and
 * this is the follow-up for a run that has not acted on it yet. `close()` is
 * the SDK's own teardown — it releases the agent process rather than asking it
 * to finish — so a stream that has one is stopped for certain. Anything else
 * gets the iterator protocol's `return()`, which runs a cooperative generator's
 * `finally` blocks and does nothing at all for one that is wedged.
 *
 * Nothing here is awaited. Both terminators can hang on exactly the run this
 * exists to escape, and waiting on them would give the budget back the hole it
 * just closed. `return()`'s eventual rejection is swallowed so an abandoned
 * teardown cannot resurface as an unhandled rejection.
 *
 * @returns `true` only when the stop is **confirmed**. `false` covers both a
 *   run that ignored the abort and one that would have honoured it a moment
 *   later — reaching here means the deadline settled first, which is not
 *   evidence either way, so the reason must not claim to know which.
 */
function stopAgent(
  stream: ClaudeAgentStream,
  iterator: AsyncIterator<SdkMessageLike>,
): boolean {
  if (typeof stream.close === "function") {
    try {
      stream.close();
    } catch {
      // A teardown that throws has still had its chance; the caller is leaving
      // either way, and a failure to close must not replace the timeout reason.
      return false;
    }
    return true;
  }
  void iterator.return?.().catch(() => {});
  return false;
}

/**
 * The plain-text reason for a run that outlived `timeoutMs`.
 *
 * Both halves name the budget, so a caller reading the ledger sees the same
 * failure class either way. What differs is the part only this function knows:
 * whether the agent is accounted for, or was left behind and may still be
 * spending. Naming a possible leak is the difference between a cost a human can
 * go and kill and one that vanishes.
 *
 * The unconfirmed half says *abandoned before it acknowledged the stop* rather
 * than "it ignored the abort", because that is all that is known: the deadline
 * settled first, which does not distinguish a wedged run from one that was
 * about to comply.
 */
function overranBudget(timeoutMs: number, stopped: boolean): string {
  return stopped
    ? `The Claude Code run exceeded its ${timeoutMs} ms budget and was stopped.`
    : `The Claude Code run exceeded its ${timeoutMs} ms budget and was abandoned before it acknowledged the stop, so the agent may still be running.`;
}

/**
 * Reduce the SDK's terminal `result` message to a {@link ClaudeHeadlessResult}.
 *
 * A run failed if its subtype is anything but `success` — **including a subtype
 * this package does not recognize**, which is how a future SDK failure mode
 * reports itself and must not be read as a completion. `is_error` is honoured
 * alongside it, for a `success` result the SDK itself flagged.
 */
function reduceResult(msg: Extract<SdkMessageLike, { type: "result" }>): ClaudeHeadlessResult {
  const { subtype, subtypeLabel, succeeded, isError, finalMessage, errorDetail, sessionId, usage, costUsd } =
    readTerminalResult(msg);

  // `is_error` is honoured alongside the subtype here, and only here: this
  // surface's whole contract is a settled ok/not-ok value, so a `success` the
  // SDK itself flagged must not come back `ok`. See `./result`.
  if (succeeded && !isError) {
    return { ok: true, error: null, finalMessage, sessionId, costUsd, subtype, usage };
  }

  // Error-subtype results carry `errors[]` and no `result`; a flagged success
  // carries `result` and no `errors`. Take whichever is there, and always name
  // the subtype so the failure class survives into the caller's plain-text
  // reason without the caller having to read a Claude-shaped field.
  const detail = errorDetail ?? finalMessage;
  return {
    ok: false,
    error: detail
      ? `${detail} (${subtypeLabel})`
      : `Claude Code run failed (${subtypeLabel}).`,
    finalMessage,
    sessionId,
    costUsd,
    subtype,
    usage,
  };
}

/**
 * Run the Claude Code agent to completion and reduce it to a
 * {@link ClaudeHeadlessResult}.
 *
 * Never throws, and never hangs when given a `timeoutMs`. The SDK being absent,
 * the SDK never *loading*, the run exceeding `timeoutMs`, the stream throwing
 * mid-run, a `timeoutMs` no timer can hold, and a run that ends without a
 * terminal result all settle as failures naming what happened — and the
 * timeouts name themselves apart, since "the harness never loaded", "the work
 * overran" and "that budget was never valid" are three different diagnoses.
 *
 * The ceiling binds the call, not the agent: neither phase can be cancelled
 * outright, so on the deadline this abandons what it cannot stop rather than
 * waiting on it. A resolution left pending is inert, but an abandoned *run* may
 * still be executing, and the failure reason distinguishes a run that was
 * stopped from one that was left behind. Callers that must not leak agent
 * processes should treat that reason as an alert, not as a clean failure.
 */
export async function runClaudeHeadless(
  options: RunClaudeHeadlessOptions,
): Promise<ClaudeHeadlessResult> {
  const {
    prompt,
    cwd,
    model,
    permissionMode,
    maxTurns,
    maxBudgetUsd,
    timeoutMs,
    env,
    settingSources = REPO_SETTING_SOURCES,
    systemPrompt = CLAUDE_CODE_SYSTEM_PROMPT,
    resolveAgent = defaultResolveClaudeAgentQuery,
  } = options;

  // Checked before anything is armed, resolved or awaited, so the failure can
  // say truthfully that no run was started: nothing was spent, and there is no
  // agent anyone needs to go and find. See `unusableTimeout` for why a value
  // out of range is rejected rather than clamped, and why `0` is not a spelling
  // of "unbounded".
  if (timeoutMs !== undefined) {
    const unusable = unusableTimeout(timeoutMs);
    if (unusable !== null) return failed(unusable);
  }

  // The deadline is armed before anything is awaited, and covers loading the SDK
  // as well as running the agent. `timeoutMs` is documented as a ceiling on the
  // run, and resolution is part of getting a run done: a `resolveAgent` that
  // never settles — a stalled dynamic `import()`, a wedged caller-supplied
  // resolver — would otherwise hang this call forever, which is worse than any
  // failure it could report. A settled failure becomes a `dispatch_failed`
  // signal and an escalation; a hang produces no result, no ledger row, and no
  // evidence that anything went wrong.
  //
  // One budget, not two. A separate (shorter) resolution bound would fail
  // runs on a slow cold `import()` for no gain: the *common* absent-SDK case
  // rejects immediately rather than hanging, so a second knob would buy speed
  // only in the pathological case while making every caller reason about two
  // ceilings. What the two phases do get is two different diagnoses.
  const abortController = new AbortController();
  let timedOut = false;
  let expireDeadline: () => void = () => {};
  const deadline =
    timeoutMs === undefined
      ? null
      : new Promise<typeof DEADLINE_EXPIRED>((resolve) => {
          expireDeadline = () => resolve(DEADLINE_EXPIRED);
        });
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          abortController.abort();
          expireDeadline();
        }, timeoutMs);

  // One try, so the timer is cleared on every path out — including the two
  // early returns below. An armed timer holds the event loop open for the rest
  // of its budget after a run that already finished.
  try {
    let query: ClaudeAgentQuery;
    try {
      // Raced, not awaited. Nothing can *cancel* a resolution — the seam takes
      // no signal, and a dynamic `import()` is not abortable — so a resolver
      // that never settles is abandoned here: its promise stays pending until
      // the process exits, and whatever it eventually yields is dropped.
      // `race` has already attached handlers to it, so a late rejection cannot
      // resurface as an unhandled one.
      const resolved =
        deadline === null ? await resolveAgent() : await Promise.race([resolveAgent(), deadline]);
      if (resolved === DEADLINE_EXPIRED) {
        // Named as a *resolution* failure. A human reading the ledger needs to
        // tell "the harness never loaded" from "the work overran its budget" —
        // one points at the install or the seam, the other at the task.
        return failed(
          `The Claude Agent SDK did not finish loading within the ${timeoutMs} ms budget, so the Claude Code run never started.`,
        );
      }
      ({ query } = resolved);
    } catch (error) {
      const message =
        error instanceof ClaudeAgentSdkNotInstalledError
          ? error.message
          : `Could not load the Claude Agent SDK: ${describeThrown(error)}`;
      return failed(message);
    }

    const queryOptions: ClaudeAgentQueryOptions = {
      cwd,
      systemPrompt,
      settingSources,
      abortController,
      ...(model ? { model } : {}),
      ...(permissionMode
        ? {
            permissionMode,
            // The SDK requires this alongside `bypassPermissions` as a
            // did-you-mean-it check. A caller who named that mode did mean it,
            // so it is derived rather than asked for again.
            ...(permissionMode === "bypassPermissions"
              ? { allowDangerouslySkipPermissions: true }
              : {}),
          }
        : {}),
      ...(maxTurns === undefined ? {} : { maxTurns }),
      ...(maxBudgetUsd === undefined ? {} : { maxBudgetUsd }),
      // Merged, not passed through: the SDK treats `env` as the whole environment.
      ...(env ? { env: { ...process.env, ...env } } : {}),
    };

    // Hoisted out of the try so a run that times out or throws mid-stream still
    // reports the session a human can open.
    let sessionId: string | null = null;
    try {
      let result: Extract<SdkMessageLike, { type: "result" }> | null = null;
      // Stepped by hand rather than with `for await`, so each step can be raced
      // against the deadline. `for await` can only *wait* for the iterator, and
      // the abort it waits on is a request the iterator is free to ignore: an
      // injected one that never yields, or an SDK wedged on a subprocess that
      // stopped reading its signal, hangs this call exactly as an unbounded
      // resolution used to. The budget has to be able to end the call without
      // the iterator's cooperation.
      const stream = query({ prompt, options: queryOptions });
      const iterator = stream[Symbol.asyncIterator]();
      for (;;) {
        const step =
          deadline === null ? await iterator.next() : await Promise.race([iterator.next(), deadline]);
        if (step === DEADLINE_EXPIRED) {
          // Abandoning a live iterator is the cost of keeping the ceiling, and
          // it is the lesser one: a hang produces no ledger row at all, and a
          // late `ok: true` records the overrun as a normal completion. What is
          // owed in exchange is an honest reason — `stopAgent` says whether the
          // agent was actually stopped or merely left behind.
          return failed(overranBudget(timeoutMs as number, stopAgent(stream, iterator)), {
            sessionId,
          });
        }
        if (step.done === true) break;
        const message = step.value;
        sessionId ??= message.session_id ?? null;
        if (message.type === "result") result = message;
      }
      if (result === null) {
        return failed("The Claude Code run ended without a terminal result.", { sessionId });
      }
      return { ...reduceResult(result), sessionId: result.session_id ?? sessionId };
    } catch (error) {
      // Whatever went wrong, stop the agent rather than leaving it running
      // behind a rejected iterator. Aborting an already-finished run is a no-op.
      abortController.abort();
      if (timedOut) {
        // The iterator rejected on the abort, so it did stop — the honest
        // reading of `stopAgent`'s `true`, reached by cooperation rather than
        // by `close()`.
        return failed(overranBudget(timeoutMs as number, true), { sessionId });
      }
      return failed(`The Claude Code run failed: ${describeThrown(error)}`, { sessionId });
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
