/**
 * The environment every child process this package starts begins with.
 *
 * A host is started with its secrets exported: a GitHub token, a model
 * gateway key, a cron secret. Left to the default, every child inherits all
 * of them, including a setup command, a project check, and any program the
 * repository's own code or config runs. So a child starts from an allowlist
 * instead, built the way core's `harnessEnv` builds a coding harness's: the
 * base a shell needs, plus the names its caller passes, plus what its caller
 * sets. A secret reaches a child only when a caller names it.
 *
 * Three lists name the lanes this package uses:
 *
 * - {@link WORKSPACE_BASE_PASS}: every child. Commands from the repository
 *   (setup, checks) get this and nothing more of the host's.
 * - {@link HOST_GIT_PASS}: the host's own git, which reads its config from
 *   these. No credential: a local git call runs in a tree the run can
 *   configure.
 * - {@link HOST_REMOTE_PASS}: the host's remote calls (fetch, push,
 *   `ls-remote`, `gh`), which run with nothing in config that starts a
 *   program, and so are the calls that may hold the host's credentials.
 */
import { HARNESS_BASE_PASS, harnessEnv } from "@flow-state-dev/core/harness";

/**
 * What every child starts with: core's harness base (`PATH`, `HOME`, the
 * shell's own, the proxy settings), plus locale, terminal, time zone, CA
 * bundle settings, and the variables a process needs to start on Windows. No
 * credential.
 */
export const WORKSPACE_BASE_PASS = [
  ...HARNESS_BASE_PASS,
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "TZ",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "SystemRoot",
  "PATHEXT",
  "COMSPEC",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
] as const;

/**
 * What the host's own git reads its settings from, beyond the base: where its
 * config lives, its identity, and `GIT_CONFIG_COUNT` with each numbered
 * `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` pair it counts. No credential.
 */
export const HOST_GIT_PASS = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_COUNT",
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
] as const;

/**
 * What the host's remote calls read their credentials from, beyond
 * {@link HOST_GIT_PASS}: gh's tokens and config, and the ssh agent. The
 * person's credential helpers come from their git config, which
 * {@link HOST_GIT_PASS} already points at. No password prompt program is
 * passed: the remote calls turn those off.
 */
export const HOST_REMOTE_PASS = [
  ...HOST_GIT_PASS,
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "GH_HOST",
  "GH_CONFIG_DIR",
  "SSH_AUTH_SOCK",
] as const;

/** Options for {@link childEnv}. */
export interface ChildEnvOptions {
  /** Names to pass from the host's environment beyond {@link WORKSPACE_BASE_PASS}, when set there. */
  pass?: readonly string[];
  /** Variables to set on the child, over anything passed. */
  env?: Record<string, string>;
}

/**
 * A child's whole environment: {@link WORKSPACE_BASE_PASS} and `pass`, read
 * from this process's environment when called, then `env` over them. Passing
 * `GIT_CONFIG_COUNT` passes the numbered pairs it counts too.
 */
export function childEnv(options: ChildEnvOptions = {}): Record<string, string> {
  const pass: string[] = [...WORKSPACE_BASE_PASS, ...(options.pass ?? [])];
  const count = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? "", 10);
  if (pass.includes("GIT_CONFIG_COUNT") && Number.isInteger(count) && count > 0) {
    for (let i = 0; i < count; i++) pass.push(`GIT_CONFIG_KEY_${i}`, `GIT_CONFIG_VALUE_${i}`);
  }
  return { ...harnessEnv({ pass }), ...options.env };
}
