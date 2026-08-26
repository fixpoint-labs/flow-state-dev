/**
 * How a run surfaces a question — a file in its own checkout, at a path that
 * carries the attempt.
 *
 * ## Why a file at all
 *
 * **The harness offers no seam for a question, and that was checked rather
 * than assumed.** `claudeCodeAgent`'s options are `model`, `systemPrompt`,
 * `allowedTools`, `disallowedTools`, `permissionMode`, `agents`, `maxTurns`,
 * `includePartialMessages`, `onToolApproval`, `detached`, `recordWork`, plus
 * LAB-138's per-run working directory. There is no MCP-server option and no
 * way to hand the run an FSD tool, so a conductor-owned "ask" tool the model
 * calls cannot be built without widening the framework — which LAB-138's
 * decision 3 rules out.
 *
 * So the question travels as a file the implement prompt names, written before
 * the run opens the PR. That is why the ask is **forced** rather than
 * spontaneous: a property of the harness surface, not a shortcut.
 *
 * *The alternative channel is the run's final message*, parsed for a marker.
 * Not chosen: it is absent on a thrown exit and is the one field a summarising
 * model most likes to reword.
 *
 * ## Why the path carries the attempt
 *
 * A retry inherits the previous attempt's checkout — that is the whole
 * economics of keeping a failed attempt's work. So last attempt's question
 * file is still sitting there when the next attempt starts. **A single fixed
 * path means an attempt that quietly did nothing looks exactly like an attempt
 * that asked**: the manager reads the stale file, writes a new row under the
 * new attempt's key, and parks instead of taking the no-question failure path.
 * The run stalls on a question nobody asked.
 *
 * The attempt is server-derived (the board's own counter, off the worker
 * input), so nothing the model writes decides which file is read (BP-031).
 *
 * ## Why `<checkout>/.fsdev/ask/`, and not somewhere tidier
 *
 * Two constraints meet here and this path satisfies both with no step.
 *
 * - **Writable.** Inside `cwd` is the only place it is. Measured, not assumed:
 *   under exactly the config every call site uses today — no `permissionMode`,
 *   no `onToolApproval` — an out-of-tree Write is denied with
 *   `decision_reason_type: "workingDir"`, and the SDK's `additionalDirectories`
 *   is exposed nowhere in conductor's options. Reaching it would be a framework
 *   change. **What makes that fatal rather than annoying is that the run's
 *   result subtype stays `"success"`** — a refused ask is indistinguishable
 *   from an attempt that never asked.
 * - **Not committable.** `git add -A` does not stage a gitignored path, and
 *   the repo's own `.gitignore` carries a double-star `.fsdev` rule — so it is
 *   already there on every fresh clone and every worktree, with nothing to set
 *   up, remember, or crash between. *Rejected: a per-worktree
 *   `.git/info/exclude` entry* (a step at worktree-prep time) and *rejected:
 *   clearing the marker before each invocation* (a step a crash can interrupt,
 *   leaving the stale-marker stall).
 *
 * `.fsdev/` rather than `.orchestration/`, checked rather than assumed:
 * a double-star `.fsdev` rule matches at **any depth**, while `/.orchestration/` is
 * root-anchored and would silently stop covering the marker if the path ever
 * nested. `.fsdev/` is also the framework's own namespace.
 *
 * **The trade-off, stated rather than hidden:** the guarantee is now coupled to
 * that `.gitignore` entry staying accurate. Narrow the pattern or rename the
 * directory without updating it and the leak comes back silently.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** The directory, relative to the checkout, the marker lives in. */
export const ASK_MARKER_DIR = join(".fsdev", "ask");

/** Where THIS attempt must write a question, if it has one. */
export function askMarkerPath(workspacePath: string, attempt: number): string {
  return join(workspacePath, ASK_MARKER_DIR, `${attempt}.md`);
}

/**
 * Read this attempt's question, or `undefined` when it did not ask one.
 *
 * **Only an absent file reads as "no question".** Anything else — a permission
 * error, a directory where the marker should be — is re-thrown, so it takes
 * the ordinary failed-attempt path and is written to the row. Swallowing it
 * would make an unreadable question indistinguishable from an attempt that
 * never asked, which is the same silent stall the park arm exists to close.
 *
 * A marker that is present but blank is not a question: a run told to write
 * one only if it has one can leave an empty file behind, and holding the board
 * for it would park a run on nothing.
 */
export async function readAskMarker(
  workspacePath: string,
  attempt: number,
): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(askMarkerPath(workspacePath, attempt), "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw err;
  }
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
}
