/** The environment pass-list a Codex run needs: `CODEX_PASS`. */

/**
 * The only variables of the server's environment a Codex run needs, for
 * `client: { env: harnessEnv({ pass: CODEX_PASS }) }` with `harnessEnv` from
 * `@flow-state-dev/core`. Without a list, the Codex CLI inherits the server's
 * whole `process.env`, every key, token and connection string in it.
 *
 * `PATH` (its shell finds commands through it), `HOME` and `CODEX_HOME` (Codex
 * keeps its sign-in and its threads there, so a thread is found again only
 * under the same home), `USER`, `SHELL` and `TMPDIR` (its shell),
 * `CODEX_API_KEY`, and the proxy and CA settings a proxied network needs, in
 * upper and lower case.
 *
 * It filters what a run starts with, not what it can read: a command the run
 * starts as the server's OS user can still read the server's own environment.
 * Pass the same environment to `probeCodexAccount`, `listCodexModels` and
 * `readCodexUsage`, so they see the account the run sees. A host that needs
 * more passes its own list.
 */
export const CODEX_PASS = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "CODEX_API_KEY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
] as const;
