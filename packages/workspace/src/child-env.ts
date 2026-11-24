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
 * config lives, its identity (git's `GIT_AUTHOR_*` / `GIT_COMMITTER_*` and
 * its `EMAIL` fallback), and `GIT_CONFIG_COUNT` with the numbered
 * `GIT_CONFIG_KEY_<n>` / `GIT_CONFIG_VALUE_<n>` pairs it counts, less any
 * that can carry a credential (see {@link childEnv}). No credential.
 */
export const HOST_GIT_PASS = [
  "GIT_CONFIG_GLOBAL",
  "GIT_CONFIG_SYSTEM",
  "GIT_CONFIG_NOSYSTEM",
  "GIT_CONFIG_COUNT",
  "XDG_CONFIG_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
  "EMAIL",
] as const;

/**
 * What the host's remote calls read their credentials and transport settings
 * from, beyond {@link HOST_GIT_PASS}: gh's tokens and config, the ssh agent,
 * the cache directory `credential-cache` keeps its socket in, and git's own
 * TLS and HTTP variables (a corporate CA, a client certificate, a proxy's).
 * The person's credential helpers come from their git config, which
 * {@link HOST_GIT_PASS} already points at. Not passed: a password prompt
 * program, which the remote calls turn off, and `GIT_SSL_NO_VERIFY`, which
 * would turn certificate checks off for every remote the host reaches.
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
  "XDG_CACHE_HOME",
  "GIT_SSL_CAINFO",
  "GIT_SSL_CAPATH",
  "GIT_SSL_CERT",
  "GIT_SSL_KEY",
  "GIT_SSL_CERT_PASSWORD_PROTECTED",
  "GIT_SSL_VERSION",
  "GIT_SSL_CIPHER_LIST",
  "GIT_HTTP_PROXY_AUTHMETHOD",
  "GIT_PROXY_SSL_CERT",
  "GIT_PROXY_SSL_KEY",
  "GIT_PROXY_SSL_CERT_PASSWORD_PROTECTED",
  "GIT_PROXY_SSL_CAINFO",
  "GIT_HTTP_USER_AGENT",
  "GIT_HTTP_LOW_SPEED_LIMIT",
  "GIT_HTTP_LOW_SPEED_TIME",
] as const;

/** Options for {@link childEnv}. */
export interface ChildEnvOptions {
  /** Names to pass from the host's environment beyond {@link WORKSPACE_BASE_PASS}, when set there. */
  pass?: readonly string[];
  /**
   * Pass the host's `GIT_CONFIG_KEY_<n>` pairs whose settings can carry a
   * credential ({@link carriesCredential}). Only the host's remote calls set
   * it; without it those pairs are dropped and the rest renumbered.
   */
  gitCredentials?: boolean;
  /**
   * Variables to set on the child, over anything passed. These are not
   * filtered: a name set here reaches the child whatever lane `pass` names,
   * so never copy a credential into it for a local call.
   */
  env?: Record<string, string>;
}

/**
 * Whether a git config key is in a section that can carry a credential:
 * `http.*` (an `extraHeader`, a proxy URL with a password), `credential.*`
 * (helpers, usernames), `url.*` (a rewrite to a URL with a token in it) or
 * `remote.*` (a remote's URL with a token in it). All four matter only when
 * git talks to a remote, so a local status, checkout or add loses nothing
 * without them.
 */
function carriesCredential(key: string): boolean {
  const dot = key.indexOf(".");
  const section = (dot < 0 ? key : key.slice(0, dot)).toLowerCase();
  return section === "http" || section === "credential" || section === "url" || section === "remote";
}

/**
 * A child's whole environment: {@link WORKSPACE_BASE_PASS} and `pass`, read
 * from this process's environment when called, then `env` over them. Passing
 * `GIT_CONFIG_COUNT` passes the numbered pairs it counts too: every one with
 * `gitCredentials`, else only those {@link carriesCredential} doesn't flag,
 * renumbered from 0 with the count to match.
 */
export function childEnv(options: ChildEnvOptions = {}): Record<string, string> {
  const pass = [...WORKSPACE_BASE_PASS, ...(options.pass ?? [])];
  const env = harnessEnv({ pass: pass.filter((name) => name !== "GIT_CONFIG_COUNT") });
  const count = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? "", 10);
  if (pass.includes("GIT_CONFIG_COUNT") && Number.isInteger(count) && count >= 0) {
    let kept = 0;
    for (let i = 0; i < count; i++) {
      const key = process.env[`GIT_CONFIG_KEY_${i}`];
      const value = process.env[`GIT_CONFIG_VALUE_${i}`];
      if (key !== undefined && options.gitCredentials !== true && carriesCredential(key)) continue;
      // A missing half stays missing, so git refuses the count as it would have.
      if (key !== undefined) env[`GIT_CONFIG_KEY_${kept}`] = key;
      if (value !== undefined) env[`GIT_CONFIG_VALUE_${kept}`] = value;
      kept++;
    }
    env.GIT_CONFIG_COUNT = String(kept);
  }
  return { ...env, ...options.env };
}
