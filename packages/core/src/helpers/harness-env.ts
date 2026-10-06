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
