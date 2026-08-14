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
 * catch. The mirror of that rule: cost and usage are reported on failed runs
 * too, because the tokens were still spent.
 */
import { ClaudeAgentSdkNotInstalledError } from "./errors";
import { defaultResolveClaudeAgentQuery } from "./sdk-client";
import type {
  ClaudeAgentQuery,
  ClaudeAgentQueryOptions,
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

/** Token usage for one run, as the SDK reported it. */
export interface ClaudeHeadlessUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

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
   * Vendor-reported cost in USD, `null` when unreported. Populated on a failed
   * run too — the tokens were still spent.
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
   * Tokens spent, `null` when unreported. Reported on failed runs too, and the
   * only spend signal at all when the credentials in play bill no dollar cost.
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
  /** Wall-clock ceiling on the run. No ceiling when unset. */
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

/** Terminal subtypes this package recognizes, in the SDK's spelling. */
const KNOWN_SUBTYPES = new Set<string>([
  "success",
  "error_max_turns",
  "error_max_budget_usd",
  "error_during_execution",
  "error_max_structured_output_retries",
]);

/** Normalize the SDK's terminal subtype string to a known value or `null`. */
function normalizeSubtype(raw: string | undefined): SdkResultSubtype | null {
  return raw !== undefined && KNOWN_SUBTYPES.has(raw) ? (raw as SdkResultSubtype) : null;
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
 * Reduce the SDK's terminal `result` message to a {@link ClaudeHeadlessResult}.
 *
 * A run failed if its subtype is anything but `success` — **including a subtype
 * this package does not recognize**, which is how a future SDK failure mode
 * reports itself and must not be read as a completion. `is_error` is honoured
 * alongside it, for a `success` result the SDK itself flagged.
 */
function reduceResult(msg: Extract<SdkMessageLike, { type: "result" }>): ClaudeHeadlessResult {
  const rawSubtype = msg.subtype;
  const subtype = normalizeSubtype(rawSubtype);
  const finalMessage = typeof msg.result === "string" ? msg.result : null;
  const sessionId = msg.session_id ?? null;
  const costUsd = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null;
  const usage =
    msg.usage && (msg.usage.input_tokens !== undefined || msg.usage.output_tokens !== undefined)
      ? { inputTokens: msg.usage.input_tokens ?? 0, outputTokens: msg.usage.output_tokens ?? 0 }
      : null;

  const ok = rawSubtype === "success" && msg.is_error !== true;
  if (ok) {
    return { ok: true, error: null, finalMessage, sessionId, costUsd, subtype, usage };
  }

  // Error-subtype results carry `errors[]` and no `result`; a flagged success
  // carries `result` and no `errors`. Take whichever is there, and always name
  // the subtype so the failure class survives into the caller's plain-text
  // reason without the caller having to read a Claude-shaped field.
  const detail = msg.errors && msg.errors.length > 0 ? msg.errors.join("; ") : finalMessage;
  const label = rawSubtype ?? "unknown subtype";
  return {
    ok: false,
    error: detail ? `${detail} (${label})` : `Claude Code run failed (${label}).`,
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
 * Never throws. The SDK being absent, the run exceeding `timeoutMs`, the stream
 * throwing mid-run, and a run that ends without a terminal result all settle as
 * failures naming what happened.
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

  let query: ClaudeAgentQuery;
  try {
    ({ query } = await resolveAgent());
  } catch (error) {
    const message =
      error instanceof ClaudeAgentSdkNotInstalledError
        ? error.message
        : `Could not load the Claude Agent SDK: ${(error as Error).message}`;
    return failed(message);
  }

  const abortController = new AbortController();
  let timedOut = false;
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          abortController.abort();
        }, timeoutMs);

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
          // did-you-mean-it check. A caller who named that mode did mean it, so
          // it is derived rather than asked for again.
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
    for await (const message of query({ prompt, options: queryOptions })) {
      sessionId ??= message.session_id ?? null;
      if (message.type === "result") result = message;
    }
    if (result === null) {
      return failed("The Claude Code run ended without a terminal result.", { sessionId });
    }
    return { ...reduceResult(result), sessionId: result.session_id ?? sessionId };
  } catch (error) {
    // Whatever went wrong, stop the agent rather than leaving it running behind
    // a rejected iterator. Aborting an already-finished run is a no-op.
    abortController.abort();
    if (timedOut) {
      return failed(`The Claude Code run exceeded its ${timeoutMs} ms budget and was stopped.`, {
        sessionId,
      });
    }
    return failed(`The Claude Code run failed: ${(error as Error).message}`, { sessionId });
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
