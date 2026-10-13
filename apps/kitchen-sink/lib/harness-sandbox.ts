/**
 * Whether the coding harness modes run inside their harness's sandbox, which
 * is the default, or without it because the person starting the server asked.
 *
 * Server only, read by every harness mode. Each mode's run asks its harness
 * for a sandbox that confines writes to the session's worktree, and the
 * mode's check reports the mode unavailable when that sandbox can't start
 * here. `KITCHEN_SINK_HARNESS_UNSANDBOXED=1` turns both off for every harness
 * mode: the check no longer asks about the sandbox, and each run starts
 * without one. The run then writes wherever the server's OS user can, the
 * repository's `.git` and the rest of the disk included, and runs commands
 * with no confinement. There is never a fallback to it: without the variable,
 * a host whose sandbox can't start gets no run at all.
 */

/** The variable that runs every harness mode without its sandbox. */
export const HARNESS_UNSANDBOXED_VAR = "KITCHEN_SINK_HARNESS_UNSANDBOXED";

/** Whether this server runs the harness modes without their sandbox. Only `1` turns it on. */
export function harnessUnsandboxed(env: Record<string, string | undefined> = process.env): boolean {
  return env[HARNESS_UNSANDBOXED_VAR] === "1";
}

/** What an available harness mode's card says when it runs without its sandbox. */
export function unsandboxedNote(harness: string): string {
  return `Runs without ${harness}'s sandbox (${HARNESS_UNSANDBOXED_VAR}=1): its writes are not confined to the session's worktree.`;
}
