/**
 * Server only. There is never a fallback to an unsandboxed run: without
 * `KITCHEN_SINK_HARNESS_UNSANDBOXED=1`, a host whose sandbox can't start
 * gets no run.
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
