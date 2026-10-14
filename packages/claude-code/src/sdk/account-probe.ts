/**
 * Ask Claude Code, before anything is started on it, whether it has a
 * credential to run on: `probeClaudeAccount()`.
 *
 * A host that runs Claude Code calls it once at start, so a person with no
 * credential is told then rather than at their first run. It opens one
 * streaming-input `query()` whose input never yields, so no user message is
 * sent and no model turn starts, asks the SDK's `accountInfo()`, and closes.
 * About half a second on Linux.
 *
 * A sign-in is found the way the run finds it (a file under the home folder,
 * or the keychain on macOS), which is why this asks Claude Code instead of
 * checking variables. Hand it the same environment the run gets, so the two
 * see one account. It checks where a credential would come from, not that the
 * credential works: a key that is set but rejected reads as `account`.
 */
import { defaultSdkImporter, type SdkImporter } from "./sdk-client";

/** What {@link probeClaudeAccount} found. */
export type ClaudeAccountProbe =
  /**
   * A credential source came back: the SDK's `apiKeySource`, its `tokenSource`,
   * or a sign-in (`email`, `subscriptionType`). A subscription login (the
   * keychain or `~/.claude`) is reported by the last pair alone.
   */
  | { status: "account"; apiKeySource?: string; tokenSource?: string; email?: string; subscriptionType?: string }
  /** No credential source, or no answer in time. `reason` says which, for a message to a person. */
  | { status: "none"; reason: string }
  /** `@anthropic-ai/claude-agent-sdk` could not be loaded. `reason` carries the load error. */
  | { status: "sdk-missing"; reason: string };

/** Options for {@link probeClaudeAccount}. */
export interface ProbeClaudeAccountOptions {
  /**
   * The environment Claude Code is started with. Pass the one the run gets
   * (for example `harnessEnv({ pass })`), so a credential the run can't see
   * isn't counted.
   */
  env: Record<string, string>;
  /** How long to wait for Claude Code's answer before reading it as `none`. Default 10 000 ms. */
  timeoutMs?: number;
  /** How the SDK module is loaded. A seam for tests; the default imports the installed SDK. */
  importSdk?: SdkImporter;
}

/** The part of the SDK's query handle the probe uses. */
interface AccountQuery {
  accountInfo(): Promise<{ apiKeySource?: unknown; tokenSource?: unknown; email?: unknown; subscriptionType?: unknown }>;
  close?: () => void;
}

/** {@link ProbeClaudeAccountOptions.timeoutMs}'s default. */
const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Ask Claude Code whether it has a credential, without a model turn.
 *
 * @param options The environment to start Claude Code with, and how long to wait.
 * @returns `account` with the source(s) the SDK named, `none` with a reason,
 *   or `sdk-missing`. Never throws for any of those.
 */
export async function probeClaudeAccount(options: ProbeClaudeAccountOptions): Promise<ClaudeAccountProbe> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let query: (args: { prompt: AsyncIterable<never>; options: { env: Record<string, string> } }) => AccountQuery;
  try {
    const mod = await (options.importSdk ?? defaultSdkImporter)();
    if (typeof mod.query !== "function") throw new Error("the module has no `query` export");
    query = mod.query as typeof query;
  } catch (error) {
    return { status: "sdk-missing", reason: `@anthropic-ai/claude-agent-sdk could not be loaded: ${messageOf(error)}` };
  }

  // The input stays open until the answer is in, then ends, so no message is ever sent.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  async function* noMessages(): AsyncGenerator<never> {
    await held;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let handle: AccountQuery | undefined;
  try {
    handle = query({ prompt: noMessages(), options: { env: options.env } });
    const timedOut = new Promise<"timeout">((resolve) => (timer = setTimeout(() => resolve("timeout"), timeoutMs)));
    const info = await Promise.race([handle.accountInfo(), timedOut]);
    if (info === "timeout") return { status: "none", reason: `Claude Code did not report an account within ${timeoutMs} ms` };
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
  } catch (error) {
    return { status: "none", reason: `Claude Code could not be asked for its account: ${messageOf(error)}` };
  } finally {
    clearTimeout(timer);
    release();
    try {
      handle?.close?.();
    } catch {
      // Already closed: nothing is left running either way.
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
