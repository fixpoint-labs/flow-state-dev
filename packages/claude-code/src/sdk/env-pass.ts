/** The environment pass-list a Claude Code run needs: `CLAUDE_CODE_PASS`. */

/**
 * The only variables of the server's environment a Claude Code run needs, for
 * `harnessEnv({ pass: CLAUDE_CODE_PASS })` from `@flow-state-dev/core`.
 * Without a list, a run inherits the server's whole `process.env` — every key,
 * token and connection string in it — and its model has a shell.
 *
 * `PATH` (its shell commands and git are found through it), `HOME`, `USER`
 * and `SHELL` (its sign-in, git identity and Bash tool), `TMPDIR`, the two
 * ways it can be given a credential (`ANTHROPIC_API_KEY`,
 * `CLAUDE_CODE_OAUTH_TOKEN`), and the proxy and CA settings a proxied network
 * needs. The proxy names come in both cases because the tools a run shells out
 * to disagree: curl reads only lowercase `http_proxy`, git and most others
 * take either.
 *
 * It filters what a run starts with, not what it can read: a command the run
 * starts as the server's OS user can still read the server's own environment
 * (on Linux, from `/proc`). Pass the same environment to `probeClaudeAccount`,
 * `listClaudeModels` and `readClaudeUsage`, so they see the account the run
 * sees. A host that needs more passes its own list.
 */
export const CLAUDE_CODE_PASS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "ANTHROPIC_API_KEY",
  "CLAUDE_CODE_OAUTH_TOKEN",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
] as const;
