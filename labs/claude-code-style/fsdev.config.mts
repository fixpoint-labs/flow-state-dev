/**
 * What `fsdev dev --app @flow-state-dev/claude-code-style` serves beside the
 * pages: the lab's workers, read from `workforce/`, on a durable store.
 *
 *     fsdev dev --config labs/claude-code-style/fsdev.config.mts --app @flow-state-dev/claude-code-style
 *
 * - `desk.main`, the session-mode main worker, is on the built-in `agent`
 *   flow with `answerAgain: true`: a background result that settles while its
 *   turn runs is taken into that turn (epic D2). The lab writes no block for it.
 * - `desk.researcher` and `desk.thread` are on `agent` too; `desk.lead` is on
 *   the built-in `coordinator` flow.
 * - The `agent` flow carries `projectSourceCapability` over the same host the
 *   coding runs use, so a worker whose file names its `read` preset
 *   (`desk.main`, `desk.researcher`) reads the session's project itself, from
 *   the host's clone at the default branch, with no coding run.
 * - `desk.coder` and `desk.thread-coder` are on the lab's one coding flow,
 *   `harness-thread`; only `desk.thread-coder` waits for your review.
 * - `projects` lists and creates the projects a session works in, and `pins`
 *   keeps the threads you pinned.
 * - `harness-readiness` reads which coding harnesses can run on this machine
 *   (harness-manager's `harnessReadiness`, one check per harness from its
 *   integration): logged as a table at start, and returned by its `read`
 *   action, which `{ refresh: true }` reads again.
 *
 * The host is durable: a thread's review or question waits on you, and a
 * coding run's review needs durable execution.
 *
 * A coding run works in a git worktree of its project's repository, on its
 * own branch, when that repository is one the lab may cut from: those named in
 * `CLAUDE_CODE_STYLE_REPOSITORIES` (paths, `:`-separated), or by default the
 * repository the lab is started in. The worktree lives under the data folder
 * and its branch in the repository. A project on any other repository runs in
 * a clone of it under the data folder.
 *
 * Settings, all optional: `CLAUDE_CODE_STYLE_MODEL` (default
 * `openai/gpt-5.4`, through the AI Gateway), `CLAUDE_CODE_STYLE_DATA`
 * (default `.fsdev/claude-code-style` under the working directory: the
 * SQLite file and each coding run's worktree or clone), `CLAUDE_CODE_STYLE_USER` (default
 * `u_lab`). `CLAUDE_CODE_STYLE_ANSWER_AGAIN=off` leaves `answerAgain` off the
 * main worker's flow: the goal check's control. `CLAUDE_CODE_STYLE_HARNESS=stub`
 * runs every coding task on harness-manager's scripted coder, no model, one
 * step every `CLAUDE_CODE_STYLE_HARNESS_STEP_MS` (default 2000): for a goal
 * check of what the lab does around a run, such as its task actions.
 *
 * A coding run is done only when its project's checks pass (the project row's
 * `checks`; none named runs nothing). `CLAUDE_CODE_STYLE_SETUP`, one command
 * such as `pnpm install --frozen-lockfile`, runs in each fresh worktree before
 * its run starts, so the checks find what they need; it runs with no shell,
 * and a command that needs one stops the lab at start. Unset, nothing runs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { formatHarnessReadiness } from "@flow-state-dev/harness-manager";
import { checkoutCommandProblem, splitCheckoutCommand, type WorkspaceSetup } from "@flow-state-dev/workspace";
import { openLab } from "./host.mts";

const data = resolve(process.env.CLAUDE_CODE_STYLE_DATA ?? ".fsdev/claude-code-style");
mkdirSync(data, { recursive: true });

/** The repository the lab is started in, or none outside one. */
const startedIn = () => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
};
/** The command `CLAUDE_CODE_STYLE_SETUP` names, split like a project check. */
const setup = ((value: string | undefined): WorkspaceSetup | undefined => {
  if (value === undefined || value.trim() === "") return undefined;
  const problem = checkoutCommandProblem(value.trim());
  if (problem !== undefined) throw new Error(`CLAUDE_CODE_STYLE_SETUP: ${problem}`);
  return { command: splitCheckoutCommand(value.trim()) as [string, ...string[]] };
})(process.env.CLAUDE_CODE_STYLE_SETUP);

const { flowState, readiness } = await openLab({
  data,
  userId: process.env.CLAUDE_CODE_STYLE_USER ?? "u_lab",
  model: process.env.CLAUDE_CODE_STYLE_MODEL ?? "openai/gpt-5.4",
  utilityModel: process.env.CLAUDE_CODE_STYLE_UTILITY_MODEL ?? "openai/gpt-6-luna",
  answerAgain: process.env.CLAUDE_CODE_STYLE_ANSWER_AGAIN !== "off",
  ...(process.env.CLAUDE_CODE_STYLE_HARNESS === "stub" ? { scriptedStepMs: Number(process.env.CLAUDE_CODE_STYLE_HARNESS_STEP_MS ?? 2_000) } : {}),
  // The repositories a run works in a worktree of, by their real paths.
  repositories: (process.env.CLAUDE_CODE_STYLE_REPOSITORIES ?? startedIn()).split(delimiter).filter((path) => path !== "" && existsSync(path)).map((path) => realpathSync(path)),
  ...(setup === undefined ? {} : { setup }),
});
// At start, never awaited: a missing sign-in never stops the server.
void readiness.read().then((rows) => console.log(formatHarnessReadiness(rows)));

export default flowState;
