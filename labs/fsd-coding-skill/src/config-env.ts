/**
 * Reading the host environment for `fsdev.config.ts`.
 *
 * Harness, checkout, model, and Codex-only permissions are host answers
 * (BP-031). They are never taken from action input. `--session` is the
 * fsdev flag that reuses filesystemStores session state across invocations.
 */
import { delimiter } from "node:path";
import type { HostHarness } from "./schemas";

export interface HostEnvOptions {
  harness: HostHarness;
  cwd: string;
  model?: string;
  networkAccess?: boolean;
  additionalDirectories?: string[];
}

/**
 * Host-selected adapter. Omitted or empty defaults to Cursor.
 */
export function readHarness(env: NodeJS.ProcessEnv = process.env): HostHarness {
  const raw = env.FSD_CODING_HARNESS;
  if (raw === undefined || raw === "") return "cursor";
  if (raw === "codex" || raw === "cursor") return raw;
  throw new Error(
    `FSD_CODING_HARNESS="${raw}" is invalid; expected codex or cursor`,
  );
}

/**
 * Checkout the harness works in. Absent is a configuration error, not a
 * default: falling back to the lab directory would aim the agent at this
 * package instead of the repo under development.
 */
export function requireCwd(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.FSD_CODING_CWD;
  if (raw === undefined || raw.trim() === "") {
    throw new Error(
      "FSD_CODING_CWD is not set. It names the checkout the harness works in, " +
        "and there is no safe default: this process's directory is the lab, not the repo.",
    );
  }
  return raw;
}

/**
 * Optional host model override. Whitespace-only is refused.
 */
export function readModel(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const raw = env.FSD_CODING_MODEL;
  if (raw === undefined) return undefined;
  if (raw.trim() === "") {
    throw new Error("FSD_CODING_MODEL needs a value");
  }
  return raw;
}

/**
 * Codex-only sandbox network permission. Cursor cannot honor it.
 */
export function readNetworkAccess(
  harness: HostHarness,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.FSD_CODING_NETWORK_ACCESS;
  const on = raw === "1" || raw === "true";
  if (on && harness !== "codex") {
    throw new Error(
      "FSD_CODING_NETWORK_ACCESS is only supported with FSD_CODING_HARNESS=codex",
    );
  }
  return on;
}

/**
 * Codex-only extra writable directories (PATH-style, `path.delimiter`).
 * Cursor cannot honor them.
 */
export function readAdditionalDirectories(
  harness: HostHarness,
  env: NodeJS.ProcessEnv = process.env,
): string[] | undefined {
  const raw = env.FSD_CODING_ADD_DIR;
  if (raw === undefined || raw === "") return undefined;
  const dirs = raw.split(delimiter).map((part) => part.trim()).filter((part) => part !== "");
  if (dirs.length === 0) return undefined;
  if (harness !== "codex") {
    throw new Error(
      "FSD_CODING_ADD_DIR is only supported with FSD_CODING_HARNESS=codex",
    );
  }
  return dirs;
}

/**
 * All host options `fsdev.config.ts` needs to build the flow.
 */
export function readHostOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): HostEnvOptions {
  const harness = readHarness(env);
  const model = readModel(env);
  const networkAccess = readNetworkAccess(harness, env);
  const additionalDirectories = readAdditionalDirectories(harness, env);
  return {
    harness,
    cwd: requireCwd(env),
    ...(model === undefined ? {} : { model }),
    ...(networkAccess ? { networkAccess } : {}),
    ...(additionalDirectories === undefined ? {} : { additionalDirectories }),
  };
}
