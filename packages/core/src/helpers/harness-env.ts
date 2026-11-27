/**
 * The environment a coding harness's child process is started with.
 *
 * A harness (Claude Code, Codex) starts its coding agent as a child process.
 * Left to its default, that child inherits the server's **entire**
 * `process.env` — every API key, database URL and token the server was started
 * with, readable by a model that can run shell commands. The harness
 * adapters' `env` option replaces that environment rather than adding to it,
 * so it is the one place to narrow it; {@link harnessEnv} builds a value for it
 * out of names, so a host lists what the agent may see instead of what it may
 * not.
 */

/**
 * The variables every harness's child process needs, whatever the vendor: the
 * shell's own (`PATH`, `HOME`, `USER`, `SHELL`, `TMPDIR`) and the proxy
 * settings a proxied network needs, in upper and lower case, since the tools
 * a run shells out to disagree on which they read. No credential: each
 * harness package's pass-list is this base plus its own keys and
 * certificates, and a host adds its own after it:
 *
 * ```ts
 * env: harnessEnv({ pass: [...HARNESS_BASE_PASS, "MY_KEY"] }),
 * ```
 */
export const HARNESS_BASE_PASS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
] as const;

/** Options for {@link harnessEnv}. */
export interface HarnessEnvOptions {
  /**
   * The variables the child may see, by exact name. Nothing else is passed:
   * not `PATH`, not `HOME`, not the harness's own credential, unless it is
   * named here. A name that is unset in the source is left out rather than
   * passed empty.
   */
  pass: readonly string[];
  /**
   * Where the values are read from. Default: `process.env` where there is a
   * `process`, and an empty source where there is none (a browser or edge
   * runtime), so calling this there returns `{}` instead of throwing.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Build a harness child's environment from an allowlist of variable names.
 *
 * Pass the result as the harness adapter's `env` option:
 *
 * ```ts
 * claudeCodeAgent({
 *   env: harnessEnv({ pass: ["PATH", "HOME", "ANTHROPIC_API_KEY"] }),
 * });
 * ```
 *
 * The values are read when this is called — when the block is built — so a
 * variable set after that is not seen. Only the source's own string-valued
 * entries count: a name such as `toString` or `constructor` is not "set"
 * because every object inherits one.
 *
 * @param options The names to pass, and optionally the source to read them from.
 * @returns A new null-prototype object holding exactly the named variables
 *   that are set.
 */
export function harnessEnv(options: HarnessEnvOptions): Record<string, string> {
  const source = options.env ?? (typeof process !== "undefined" ? process.env : {});
  const env = Object.create(null) as Record<string, string>;
  for (const name of options.pass) {
    if (!Object.hasOwn(source, name)) continue;
    const value = source[name];
    if (typeof value === "string") env[name] = value;
  }
  return env;
}

/** A GitHub account a coding run acts as, when it isn't the person whose machine runs it. */
export interface GitHubAccount {
  /** A token of the account: what `gh` sends, and the password git sends to github.com over https. */
  readonly token: string;
  /** The name its commits are authored and committed under. */
  readonly name: string;
  /** The email its commits carry, such as the account's `<id>+<login>@users.noreply.github.com`. */
  readonly email: string;
}

/**
 * A {@link GitHubAccount} from three settings a host reads, such as its
 * environment, by the names it gives each: all three set (trimmed) is the
 * account, none set (or all blank) is `undefined`.
 *
 * @throws When only some are set, naming the ones that aren't: a token with
 *   no name would commit as the person and push as the account.
 */
export function gitHubAccountFrom(
  settings: Readonly<Record<string, string | undefined>>,
  names: { readonly token: string; readonly name: string; readonly email: string },
): GitHubAccount | undefined {
  const keys = [names.token, names.name, names.email];
  const values = keys.map((key) => settings[key]?.trim() || undefined);
  const missing = keys.filter((_, i) => values[i] === undefined);
  if (missing.length === keys.length) return undefined;
  if (missing.length > 0) throw new Error(`A GitHub account needs ${keys.join(", ")}; ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set.`);
  return { token: values[0]!, name: values[1]!, email: values[2]! };
}

/**
 * The git credential helper that answers with `$GH_TOKEN`, as GitHub's
 * `x-access-token` user. The token is read from the environment when git
 * asks, so it is never written into a config value or a command line.
 */
export const GH_TOKEN_CREDENTIAL_HELPER = '!f() { test "$1" = get && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f';

/**
 * The variables that make a run's git and `gh` act on github.com as
 * `account`, set over a harness's pass-list (they are values to set, not
 * names to pass):
 *
 * - `GH_TOKEN` and `GITHUB_TOKEN`: `gh`, and anything else that reads either.
 * - `GIT_AUTHOR_*` and `GIT_COMMITTER_*`: every commit is the account's.
 * - git config, through `GIT_CONFIG_COUNT`: github.com's credential helpers
 *   cleared and {@link GH_TOKEN_CREDENTIAL_HELPER} named instead, and
 *   `git@github.com:` and `ssh://git@github.com/` remotes reached over
 *   `https://github.com/`, since an ssh remote would use the person's key.
 *   Another host's remotes and helpers are left alone.
 *
 * A run's model can read its own environment, so the token is the account's
 * to lose: give it no more than the repository needs.
 */
export function gitHubAccountEnv(account: GitHubAccount): Record<string, string> {
  const config: Array<readonly [string, string]> = [
    // An empty helper clears the ones read before it, the person's own included.
    ["credential.https://github.com.helper", ""],
    ["credential.https://github.com.helper", GH_TOKEN_CREDENTIAL_HELPER],
    ["url.https://github.com/.insteadOf", "git@github.com:"],
    ["url.https://github.com/.insteadOf", "ssh://git@github.com/"],
  ];
  return {
    GH_TOKEN: account.token,
    GITHUB_TOKEN: account.token,
    GIT_AUTHOR_NAME: account.name,
    GIT_AUTHOR_EMAIL: account.email,
    GIT_COMMITTER_NAME: account.name,
    GIT_COMMITTER_EMAIL: account.email,
    GIT_CONFIG_COUNT: String(config.length),
    ...Object.fromEntries(config.flatMap(([key, value], i) => [[`GIT_CONFIG_KEY_${i}`, key], [`GIT_CONFIG_VALUE_${i}`, value]])),
  };
}
