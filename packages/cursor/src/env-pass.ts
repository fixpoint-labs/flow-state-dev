/** The environment pass-list a Cursor run needs: `CURSOR_PASS`. */

/**
 * The only variables of the server's environment Cursor's runtime is handed,
 * for `env: harnessEnv({ pass: CURSOR_PASS })` with `harnessEnv` from
 * `@flow-state-dev/core`. Without `env`, Cursor's runtime runs in the server's
 * process and every command it starts inherits the server's whole
 * `process.env`.
 *
 * `PATH` (its shell finds commands through it), `HOME` (Cursor keeps its
 * agents and its stored login there, so a resumed agent is found only with the
 * same `HOME`), `USER`, `SHELL` and `TMPDIR` (its shell), `CURSOR_API_KEY`, and
 * the proxy and CA settings a proxied network needs, in upper and lower case.
 *
 * It filters what a run starts with, not what it can read: see
 * `CursorAgentOptions.env`. Pass the same environment to `cursorSignIn`, so it
 * sees the login the run sees. A host that needs more passes its own list.
 */
export const CURSOR_PASS = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "CURSOR_API_KEY",
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
