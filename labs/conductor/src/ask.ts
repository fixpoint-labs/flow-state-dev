/**
 * How a run surfaces a question — a file in its own checkout, at a path that
 * carries the attempt.
 *
 * ## Why a file at all
 *
 * **The harness offers no seam for a question, and that was checked rather
 * than assumed.** The coding step is the workspace-agent chain, which
 * forwards every `claudeCodeAgent` option except `cwd` (it owns the
 * directory). There is still no MCP-server option and no way to hand the
 * run an FSD tool, so a conductor-owned "ask" tool the model calls cannot
 * be built without widening the framework — which LAB-138's decision 3
 * rules out.
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
 *   under the trusted-checkout config (in-tree tools are auto-approved) an
 *   out-of-tree Write is still denied with `decision_reason_type: "workingDir"`,
 *   and the SDK's `additionalDirectories` is exposed nowhere in conductor's
 *   options. Reaching it would be a framework change. **What makes that fatal
 *   rather than annoying is that the run's result subtype stays `"success"`** —
 *   a refused ask is indistinguishable from an attempt that never asked.
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
 * lands rather than assumed from where the code lives. A repository that
 * lacks the directory rule is healed on the work branch; a marker that is
 * already tracked is still refused.
 */
import { readFile } from "node:fs/promises";
import { join, sep } from "node:path";

/** The directory, relative to the checkout, the marker lives in. */
export const ASK_MARKER_DIR = join(".fsdev", "ask");

/**
 * The `.gitignore` line a target repository needs, spelled once.
 *
 * It appears in the refusal a run gets, in the test fixture's repository, and
 * in the assertions on both — three copies that have to agree, and a refusal
 * naming a rule the fixture does not use is a message that has been wrong
 * without anything failing.
 *
 * Double-star rather than root-anchored: it matches at any depth, so the rule
 * keeps covering the marker if the checkout layout ever nests.
 */
export const ASK_MARKER_IGNORE_RULE = "**/.fsdev/";

/** Where THIS attempt must write a question, if it has one. */
export function askMarkerPath(workspacePath: string, attempt: number): string {
  return join(workspacePath, ASK_MARKER_DIR, `${attempt}.md`);
}

/**
 * Is `gitPath` one of THIS module's markers — as `git ls-files` prints a path,
 * `/`-separated and relative to the repository root?
 *
 * **Requires a listing already restricted to {@link ASK_MARKER_DIR}**, which is
 * why it checks the shape and depth of the path rather than re-testing the
 * directory prefix. That is not a shortcut: **the caller's pathspec knows the
 * checkout's case rules and this function cannot.** On a case-folding
 * filesystem git resolves `.FSDEV/ask/1.md` and `.fsdev/ask/1.md` to one file,
 * so `ls-files -- .fsdev/ask` lists the index's spelling — and a
 * case-*sensitive* prefix test here would then drop the very entry the run is
 * about to collide with, accepting a checkout whose marker is already tracked.
 * Re-deriving the prefix means re-deriving `core.ignorecase` with it, and a
 * second answer to that question is a second answer that can be wrong.
 *
 * **Beside {@link askMarkerPath} because it is the same rule read backwards.**
 * A caller asking "would a run ever write this file?" is asking about the
 * naming above, and a second spelling of it somewhere else is a spelling that
 * drifts.
 *
 * The distinction earns its keep because **tracked and ignored are independent**
 * — measured, not reasoned about. A repository can carry `**\/.fsdev\/` and still
 * track something inside the directory it excludes, and what happens next
 * depends entirely on whether that something is a marker:
 *
 * - A tracked `.fsdev/ask/.gitkeep` forces git to descend into the directory,
 *   and `git add -A` **still leaves an untracked `1.md` ignored**. Nothing is
 *   at risk, so refusing such a repository refuses a safe one — and a negation
 *   does not re-open the directory either, so the descent buys an attacker
 *   nothing.
 * - A tracked `.fsdev/ask/1.md` is staged the moment the run rewrites it,
 *   whatever the rules say. That is the case the tracked check exists for.
 *
 * **Deliberately shape-based, not attempt-aware.** `007.md` is refused though
 * attempt 7 writes `7.md`: a name that looks like a marker is treated as one,
 * because the caller is checking a repository it will run many attempts in and
 * cannot know which numbers those will be.
 */
export function isAskMarkerPath(gitPath: string): boolean {
  const segments = gitPath.split("/");
  // Direct children only — nothing writes a marker into a subdirectory, so a
  // tracked `.fsdev/ask/notes/1.md` is somebody else's file.
  if (segments.length !== ASK_MARKER_DIR.split(sep).length + 1) return false;
  return /^\d+\.md$/.test(segments[segments.length - 1]!);
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
