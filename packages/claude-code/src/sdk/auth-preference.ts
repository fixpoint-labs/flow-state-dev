/**
 * Which credential a Claude Code process signs in with when the server holds
 * both an `ANTHROPIC_API_KEY` and a `claude` sign-in: `FSD_CLAUDE_CODE_AUTH`.
 *
 * Claude Code always takes a key it finds in its environment over a sign-in,
 * so a server that keeps a key for calling models directly would bill every
 * harness run to that key. The setting decides whether the key reaches the
 * harness at all:
 *
 * - `api-key` (default): the key is passed when set, so it wins.
 * - `prefer-login`: the key is dropped when Claude Code finds a sign-in
 *   without it, and passed when it finds none. Asked once per environment per
 *   process (about half a second), so a `claude` sign-in made after the server
 *   started is seen on restart.
 * - `login-only`: the key is never passed; a run with no sign-in fails to
 *   sign in rather than fall back to the key.
 *
 * Applied wherever a Claude Code process starts (a run, the account probe, the
 * model list), so readiness reports the account the run will use.
 */
import { askClaudeCodeAccount } from "./account-query";
import type { ClaudeCodeSdkImporter } from "./sdk-client";

/** The values of {@link CLAUDE_CODE_AUTH_VAR}. */
export type ClaudeCodeAuthPreference = "api-key" | "prefer-login" | "login-only";

/** The server variable that sets {@link ClaudeCodeAuthPreference}. */
export const CLAUDE_CODE_AUTH_VAR = "FSD_CLAUDE_CODE_AUTH";

const PREFERENCES: readonly ClaudeCodeAuthPreference[] = ["api-key", "prefer-login", "login-only"];
const KEY = "ANTHROPIC_API_KEY";

/**
 * Read {@link CLAUDE_CODE_AUTH_VAR}.
 *
 * @param source Where to read it. Default: the server's `process.env`.
 * @returns The preference; `api-key` when unset or empty.
 * @throws When it is set to anything else, so a typo never silently bills the key.
 */
export function readClaudeCodeAuthPreference(
  source: Record<string, string | undefined> = typeof process !== "undefined" ? process.env : {},
): ClaudeCodeAuthPreference {
  const raw = source[CLAUDE_CODE_AUTH_VAR]?.trim();
  if (raw === undefined || raw === "") return "api-key";
  if ((PREFERENCES as readonly string[]).includes(raw)) return raw as ClaudeCodeAuthPreference;
  throw new Error(`${CLAUDE_CODE_AUTH_VAR}="${raw}" is not one of: ${PREFERENCES.join(", ")}`);
}

/** Options for {@link applyClaudeCodeAuthPreference}. */
export interface ApplyClaudeCodeAuthPreferenceOptions {
  /** Default: {@link readClaudeCodeAuthPreference}`()`. */
  preference?: ClaudeCodeAuthPreference;
  /**
   * Whether Claude Code finds a sign-in in this key-less environment, for
   * `prefer-login`. `undefined` means it could not tell, and the key is kept.
   * Default: the account probe. A seam for tests.
   */
  hasLogin?: (env: Record<string, string>) => Promise<boolean | undefined>;
  /** How the probe loads the SDK. A seam for tests. */
  importSdk?: ClaudeCodeSdkImporter;
}

/** `prefer-login` answers by key-less environment, for the life of the process. */
const loginFound = new Map<string, Promise<boolean | undefined>>();

/**
 * The environment a Claude Code process starts with, under the preference.
 *
 * @param env The environment it would start with.
 * @returns `env` itself when the key stays, else a copy without `ANTHROPIC_API_KEY`.
 */
export async function applyClaudeCodeAuthPreference<E extends Record<string, string | undefined>>(
  env: E,
  options: ApplyClaudeCodeAuthPreferenceOptions = {},
): Promise<E> {
  if (!Object.hasOwn(env, KEY)) return env;
  const preference = options.preference ?? readClaudeCodeAuthPreference();
  if (preference === "api-key") return env;
  const { [KEY]: _key, ...rest } = env;
  const withoutKey = rest as E;
  if (preference === "login-only") return withoutKey;

  const hasLogin = options.hasLogin ?? ((e: Record<string, string>) => probeLogin(e, options.importSdk));
  const cacheKey = JSON.stringify(Object.entries(withoutKey).sort(([a], [b]) => a.localeCompare(b)));
  let found = loginFound.get(cacheKey);
  if (found === undefined) {
    const probed = Object.fromEntries(Object.entries(withoutKey).filter((e): e is [string, string] => typeof e[1] === "string"));
    found = hasLogin(probed);
    loginFound.set(cacheKey, found);
    // An unanswered probe is not remembered: the next start asks again.
    void found.then((answer) => {
      if (answer === undefined) loginFound.delete(cacheKey);
    });
  }
  return (await found) === true ? withoutKey : env;
}

/** Forget every `prefer-login` answer. For tests. */
export function resetClaudeCodeAuthPreferenceCache(): void {
  loginFound.clear();
}

async function probeLogin(env: Record<string, string>, importSdk?: ClaudeCodeSdkImporter): Promise<boolean | undefined> {
  // Asked of the key-less environment as is: the preference is not applied again.
  const probe = await askClaudeCodeAccount({ env, ...(importSdk === undefined ? {} : { importSdk }) });
  if (probe.status === "account") return true;
  if (probe.status === "none" && probe.unanswered !== true) return false;
  return undefined;
}
