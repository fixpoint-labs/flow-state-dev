/**
 * The account question behind `probeClaudeCodeAccount()`, asked of the
 * environment exactly as given: `askClaudeCodeAccount()`.
 *
 * Kept apart from `./account-probe` so `./auth-preference` can ask it for
 * `prefer-login` without importing the module that applies the preference.
 */
import type { ClaudeCodeAccountProbe, ProbeClaudeCodeAccountOptions } from "./account-probe";
import { runIdleQuery } from "./idle-query";

/** The part of the SDK's query handle the probe uses. */
interface AccountQuery {
  accountInfo(): Promise<{ apiKeySource?: unknown; tokenSource?: unknown; email?: unknown; subscriptionType?: unknown }>;
  close?: () => void;
}

/** {@link ProbeClaudeCodeAccountOptions.timeoutMs}'s default. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Ask Claude Code whether it has a credential in exactly `options.env`.
 * `FSD_CLAUDE_CODE_AUTH` is not applied: that is the caller's.
 *
 * @param options The environment to start Claude Code with, and how long to wait.
 * @returns `account`, `none` with a reason, or `sdk-missing`. Never throws for any of those.
 */
export async function askClaudeCodeAccount(options: ProbeClaudeCodeAccountOptions): Promise<ClaudeCodeAccountProbe> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const asked = await runIdleQuery<AccountQuery, Awaited<ReturnType<AccountQuery["accountInfo"]>>>(
    {
      env: options.env,
      timeoutMs,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.importSdk === undefined ? {} : { importSdk: options.importSdk }),
    },
    (handle) => handle.accountInfo(),
  );
  if (asked.status === "sdk-missing") return { status: "sdk-missing", reason: asked.reason };
  if (asked.status === "timeout") return { status: "none", reason: `Claude Code did not report an account within ${timeoutMs} ms`, unanswered: true };
  if (asked.status === "error") return { status: "none", reason: `Claude Code could not be asked for its account: ${asked.reason}`, unanswered: true };
  const info = asked.value;
  const apiKeySource = typeof info.apiKeySource === "string" && info.apiKeySource !== "none" ? info.apiKeySource : undefined;
  const tokenSource = typeof info.tokenSource === "string" && info.tokenSource !== "none" ? info.tokenSource : undefined;
  // A subscription sign-in names no key or token source: it comes back as who
  // is signed in and on what plan. "Claude API" is the no-plan label, not a sign-in.
  const email = typeof info.email === "string" && info.email !== "" ? info.email : undefined;
  const subscriptionType =
    typeof info.subscriptionType === "string" && info.subscriptionType !== "" && info.subscriptionType !== "Claude API"
      ? info.subscriptionType
      : undefined;
  if (apiKeySource === undefined && tokenSource === undefined && email === undefined && subscriptionType === undefined) {
    return { status: "none", reason: "Claude Code found no API key and no sign-in" };
  }
  return {
    status: "account",
    ...(apiKeySource === undefined ? {} : { apiKeySource }),
    ...(tokenSource === undefined ? {} : { tokenSource }),
    ...(email === undefined ? {} : { email }),
    ...(subscriptionType === undefined ? {} : { subscriptionType }),
  };
}
