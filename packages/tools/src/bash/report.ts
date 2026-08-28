/**
 * Turning a flush report into the console diagnostics the bash tool emits.
 *
 * Lives on its own because there are two entry points — `createBashBlocks`
 * and `createBashTool` — and a refused write that one of them reports and the
 * other swallows is a write the caller believes succeeded.
 */
import type { FlushOutcome } from "@flow-state-dev/workspace";

/**
 * Warn about every outcome a caller cannot act on without being told.
 *
 * The clean ones are deliberately silent: a written file being where it
 * should be is not news, and saying so would make the interesting lines the
 * ones you have to filter for.
 */
export function warnUnsettled(outcomes: readonly FlushOutcome[], tmpDir?: string): void {
  const orphans = outcomes.filter((o) => o.kind === "orphan").map((o) => o.path);
  if (orphans.length > 0) {
    // The scratch directory is named only where one exists. `createBashTool`
    // has no scratch convention, and pointing its callers at a directory the
    // tool never creates would be advice that cannot be followed.
    const scratch = tmpDir === undefined ? "" : ` (or ./${tmpDir}/)`;
    console.warn(
      `[bash] dropped ${orphans.length} orphan file(s) not under any mounted collection${scratch}: ${orphans.join(", ")}`,
    );
  }

  const conflicts = outcomes.filter(
    (o): o is Extract<FlushOutcome, { kind: "conflict" }> => o.kind === "conflict",
  );
  if (conflicts.length > 0) {
    console.warn(
      `[bash] ${conflicts.length} file(s) changed in their collection while this run held them, and were NOT overwritten: ${conflicts
        .map((c) => (c.ours === null ? `${c.path} (deleted here)` : c.path))
        .join(", ")}`,
    );
  }

  // Named separately from conflicts, because the fix is different. A conflict
  // is somebody who already wrote — you reconcile it. A contested path is
  // somebody writing right now, so the answer is usually to run the two runs
  // against different paths, and knowing WHICH path is what makes that
  // possible.
  const contested = outcomes.filter((o) => o.kind === "contested").map((o) => o.path);
  if (contested.length > 0) {
    console.warn(
      `[bash] ${contested.length} file(s) are being written by another run and were NOT overwritten: ${contested.join(", ")}`,
    );
  }
}
