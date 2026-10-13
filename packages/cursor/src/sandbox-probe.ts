/**
 * Whether Cursor's local sandbox can start on this host, in Cursor's own
 * words, for a host check to read before it offers a sandboxed run.
 *
 * The SDK decides sandbox support only when a run prepares its workspace, and
 * fails the run when it can't start one. `probeCursorSandbox` asks the same
 * question ahead of time, in a process started the way the runtime's process
 * is (see `runtime/cursor-sandbox-probe.mjs`), so its answer is the one a run
 * would get. No agent and no run is started.
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** The probe script, beside the runtime's child script (one directory up from `src/` or `dist/`). */
const PROBE_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "runtime", "cursor-sandbox-probe.mjs");

/** How long the probe gets before it counts as failed. */
const PROBE_TIMEOUT_MS = 30_000;

/** Whether Cursor's sandbox can start here, and if not, Cursor's reason. */
export type CursorSandboxSupport = { readonly supported: true } | { readonly supported: false; readonly reason: string };

/** Options for {@link probeCursorSandbox}. */
export interface CursorSandboxProbeOptions {
  /** The directory a run would work in. */
  cwd: string;
  /** The probe process's whole environment: pass the one the run is handed. */
  env: Record<string, string>;
  /** The module the probe loads the SDK from. Default `@cursor/sdk`. A test seam. */
  sdkModule?: string;
}

/**
 * Ask Cursor's SDK whether its local sandbox can start for a run in `cwd`.
 * Synchronous, and takes about a second: call it once, from a host check.
 */
export function probeCursorSandbox(options: CursorSandboxProbeOptions): CursorSandboxSupport {
  const probe = spawnSync(process.execPath, [PROBE_SCRIPT, options.sdkModule ?? "@cursor/sdk", options.cwd], {
    env: { ...options.env },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PROBE_TIMEOUT_MS,
  });
  if (probe.error !== undefined) return { supported: false, reason: `the sandbox probe could not run: ${probe.error.message}` };
  const line = probe.stdout.trim().split("\n").at(-1) ?? "";
  try {
    const answer = JSON.parse(line) as { supported?: unknown; reason?: unknown };
    if (answer.supported === true) return { supported: true };
    if (answer.supported === false && typeof answer.reason === "string") return { supported: false, reason: answer.reason };
  } catch {
    // Not the probe's answer: fall through to what the process said.
  }
  const how = probe.signal !== null ? `was ended by ${probe.signal}` : `exited with code ${String(probe.status)}`;
  const said = probe.stderr.trim().slice(-500);
  return { supported: false, reason: `the sandbox probe ${how} without an answer${said === "" ? "" : `: ${said}`}` };
}
