/**
 * The one reader of `KITCHEN_SINK_HARNESS_WORKSPACE`: the git checkout the
 * coding harness modes work on, or why there is none on this host.
 *
 * Server only. The harness gate (`lib/harness-gate.ts`) calls it to decide
 * whether harness modes can run at all, and a harness mode's session resolver
 * calls it for the repository each session's worktree is made from. Both read
 * the setting through this function so they can never disagree.
 *
 * The rules, in order:
 * - On Vercel (`VERCEL` set), off. The setting does not override it.
 * - Set: it must name the top level of an existing git checkout, else off,
 *   naming the path and what is wrong with it.
 * - Unset, not in production: the top level of the checkout the server runs
 *   from, or off when it runs outside one.
 * - Unset in production: off, naming the setting.
 *
 * It creates nothing and runs no git: a checkout's top level is the directory
 * that holds its `.git` (a directory, or a file in a linked worktree).
 *
 * The two settings beside it are read here too, by {@link readHarnessTrust}:
 * whether the operator trusts that repository (`KITCHEN_SINK_HARNESS_TRUSTED`),
 * and the names of the keys a trusted run is handed (`KITCHEN_SINK_HARNESS_PASS`).
 * Each mode builds its harness's options from that one reader, and a name that
 * is not a variable name turns the harness modes off here, with the reason.
 * Trust comes only from the server's environment: no request, session input or
 * session state sets it.
 */
import { existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** The host setting that names the repository. */
export const HARNESS_WORKSPACE_SETTING = "KITCHEN_SINK_HARNESS_WORKSPACE";

/** The host setting that marks the repository as trusted: `1` turns it on. */
const HARNESS_TRUSTED_SETTING = "KITCHEN_SINK_HARNESS_TRUSTED";

/** The host setting that names, comma-separated, the keys a trusted run is handed. */
const HARNESS_PASS_SETTING = "KITCHEN_SINK_HARNESS_PASS";

/**
 * Whether the operator trusts the repository, and the keys a trusted run gets.
 * Untrusted, `pass` is empty: the names are read only when trusted, so with the
 * setting off nothing changes.
 */
export interface HarnessTrust {
  readonly trusted: boolean;
  /** Names of the server's variables each harness run is handed, beyond its package's own list. */
  readonly pass: readonly string[];
}

/** The repository harness modes work on, or why there is none. */
export type HarnessWorkspace =
  | { readonly ok: true; readonly repository: string }
  | { readonly ok: false; readonly reason: string };

/** The environment the reader looks at. */
export type HarnessWorkspaceEnv = Readonly<Record<string, string | undefined>>;

/** A variable name a pass list can carry. */
const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Not trusted: what an unset setting, and Vercel, read as. */
const UNTRUSTED: HarnessTrust = { trusted: false, pass: [] };

/**
 * Read the trust settings. Off on Vercel, whatever they say. Only `1` turns
 * trust on. A name in `KITCHEN_SINK_HARNESS_PASS` that is not a variable name
 * is a mistake to say, not one to skip: it comes back as `reason`, untrusted,
 * and {@link readHarnessWorkspace} turns the harness modes off with it.
 *
 * @param env The environment to read; the process's own by default.
 */
export function readHarnessTrust(env: HarnessWorkspaceEnv = process.env): HarnessTrust & { readonly reason?: string } {
  if (env.VERCEL || env[HARNESS_TRUSTED_SETTING] !== "1") return UNTRUSTED;
  const names = (env[HARNESS_PASS_SETTING] ?? "").split(",").map((name) => name.trim()).filter((name) => name !== "");
  const bad = names.filter((name) => !VARIABLE_NAME.test(name));
  if (bad.length > 0) {
    return {
      ...UNTRUSTED,
      reason: `${HARNESS_PASS_SETTING} names ${bad.map((name) => JSON.stringify(name)).join(", ")}, which ${bad.length === 1 ? "is not a variable name" : "are not variable names"}. List variable names, separated by commas.`,
    };
  }
  return { trusted: true, pass: [...new Set(names)] };
}

/** The top level of the git checkout `dir` is in, or `undefined` when it is in none. */
function checkoutTop(dir: string): string | undefined {
  for (let current = dir; ; current = dirname(current)) {
    if (existsSync(join(current, ".git"))) return current;
    if (dirname(current) === current) return undefined;
  }
}

/**
 * Read the setting.
 *
 * @param env The environment to read; the process's own by default.
 * @param cwd The directory the server runs from, used when the setting is unset in development.
 */
export function readHarnessWorkspace(
  env: HarnessWorkspaceEnv = process.env,
  cwd: string = process.cwd(),
): HarnessWorkspace {
  if (env.VERCEL) {
    return { ok: false, reason: "Runs on a local machine. Coding harnesses are off on Vercel." };
  }
  const trust = readHarnessTrust(env);
  if (trust.reason !== undefined) return { ok: false, reason: trust.reason };
  const named = env[HARNESS_WORKSPACE_SETTING];
  if (named === undefined || named === "") {
    if (env.NODE_ENV === "production") {
      return {
        ok: false,
        reason: `Off on a production server. Set ${HARNESS_WORKSPACE_SETTING} to the top level of a git checkout to turn it on.`,
      };
    }
    const top = checkoutTop(resolve(cwd));
    return top === undefined
      ? {
          ok: false,
          reason: `The server is not running in a git checkout. Set ${HARNESS_WORKSPACE_SETTING} to the top level of one.`,
        }
      : { ok: true, repository: top };
  }
  const path = resolve(cwd, named);
  if (!existsSync(path)) {
    return {
      ok: false,
      reason: `${HARNESS_WORKSPACE_SETTING} names ${path}, which does not exist. Set it to the top level of a git checkout.`,
    };
  }
  const top = statSync(path).isDirectory() ? checkoutTop(path) : undefined;
  if (top === undefined) {
    return {
      ok: false,
      reason: `${HARNESS_WORKSPACE_SETTING} names ${path}, which is not a git repository. Set it to the top level of a git checkout.`,
    };
  }
  if (top !== path) {
    return {
      ok: false,
      reason: `${HARNESS_WORKSPACE_SETTING} names ${path}, which is inside the checkout at ${top}, not its top level. Set it to ${top}.`,
    };
  }
  return { ok: true, repository: path };
}
