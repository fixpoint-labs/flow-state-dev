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
 * - **Not committable.** `git add -A` does not stage a gitignored path, so the
 *   marker is safe exactly where git already ignores it — and **provisioning
 *   asks git whether it does**, in the checkout, before the agent runs
 *   (`assertAskMarkerIgnored` in `./workspace`). *Rejected: clearing the marker
 *   before each invocation* — a step a crash can interrupt, leaving the
 *   stale-marker stall.
 *
 * `.fsdev/` rather than `.orchestration/`: a double-star `.fsdev` rule matches
 * at **any depth**, while `/.orchestration/` is root-anchored and would
 * silently stop covering the marker if the path ever nested. `.fsdev/` is also
 * the framework's own namespace.
 *
 * **Which repository's rule, which is where this was wrong.** The guarantee was
 * written against THIS repository's `.gitignore` — the one dispatching the run.
 * The marker lands in the product checkout, a worktree of `sourceRepo`, which
 * this lab requires be a different repository, and a target that never adopted
 * the pattern has no such rule. So the rule is now checked where the marker
 * lands rather than assumed from where the code lives, and a repository that
 * lacks it is refused with the line to add.
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
