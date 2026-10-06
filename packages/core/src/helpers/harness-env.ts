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
   * named here. A name that is unset in the server's environment is left out
   * rather than passed empty.
   */
  pass: readonly string[];
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
 * The values are read from `process.env` when this is called — when the block
 * is built — so a variable set after that is not seen.
 *
 * @param options The names to pass.
 * @returns A new object holding exactly the named variables that are set.
 */
export function harnessEnv(options: HarnessEnvOptions): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of options.pass) {
    const value = process.env[name];
    if (value !== undefined) env[name] = value;
  }
  return env;
}
