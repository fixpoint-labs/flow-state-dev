/**
 * What `fsdev dev --app @flow-state-dev/claude-code-style` serves beside the
 * pages: the lab's workers, read from `workforce/`, on a durable store.
 *
 *     fsdev dev --config labs/claude-code-style/fsdev.config.mts --app @flow-state-dev/claude-code-style
 *
 * The server itself (the workers, their flows, the lab's small flows and the
 * store) is built by `openLab` in `host.mts`; this file reads the settings
 * below and calls it. The contract tests call `openLab` too, with a scripted model.
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
 * check of what the lab does around a run, such as its task actions. With it,
 * `CLAUDE_CODE_STYLE_STALE_THRESHOLD_MS` sets how long a silent request waits
 * before the server takes it as interrupted (default one minute), so a goal can
 * read a dead run's row before the board takes it back.
 *
 * A coding run is done only when its project's checks pass (the project entry's
 * `checks`; none named runs nothing). `CLAUDE_CODE_STYLE_SETUP`, one command
 * such as `pnpm install --frozen-lockfile`, runs in each fresh worktree before
 * its run starts, so the checks find what they need; it runs with no shell,
 * and a command that needs one stops the lab at start. Unset, nothing runs.
 *
 * A session asked to follow a GitHub pull request reads GitHub with
 * `GITHUB_TOKEN`, or what `gh auth token` answers at start, for
 * `CLAUDE_CODE_STYLE_USER` alone. With neither, a GitHub routine is refused,
 * naming the variable; clock routines still run.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { checkoutCommandProblem, splitCheckoutCommand, type WorkspaceSetup } from "@flow-state-dev/workspace";
import { openLab, operatorGitHubToken } from "./host.mts";

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

const { flowState } = await openLab({
  data,
  userId: process.env.CLAUDE_CODE_STYLE_USER ?? "u_lab",
  model: process.env.CLAUDE_CODE_STYLE_MODEL ?? "openai/gpt-5.4",
  utilityModel: process.env.CLAUDE_CODE_STYLE_UTILITY_MODEL ?? "openai/gpt-6-luna",
  answerAgain: process.env.CLAUDE_CODE_STYLE_ANSWER_AGAIN !== "off",
  ...(process.env.CLAUDE_CODE_STYLE_HARNESS === "stub" ? { scriptedStepMs: Number(process.env.CLAUDE_CODE_STYLE_HARNESS_STEP_MS ?? 2_000) } : {}),
  // The repositories a run works in a worktree of, by their real paths.
  repositories: (process.env.CLAUDE_CODE_STYLE_REPOSITORIES ?? startedIn()).split(delimiter).filter((path) => path !== "" && existsSync(path)).map((path) => realpathSync(path)),
  ...(setup === undefined ? {} : { setup }),
  ...(process.env.CLAUDE_CODE_STYLE_STALE_THRESHOLD_MS === undefined ? {} : { staleThresholdMs: Number(process.env.CLAUDE_CODE_STYLE_STALE_THRESHOLD_MS) }),
  // `GOAL_CONTROL=no-repository-check` leaves the project repository check off, for the goal check's control.
  checkRepository: process.env.GOAL_CONTROL !== "no-repository-check",
  // `GOAL_FLOWS` names a module of a goal check's own flows (a goal's delivered message). Never set otherwise.
  ...(process.env.GOAL_FLOWS ? { goalFlows: process.env.GOAL_FLOWS } : {}),
  githubToken: operatorGitHubToken(),
});

export default flowState;
