/**
 * The Teammates lab's server, as `fsdev dev --app @flow-state-dev/teammates`
 * loads it from this folder. Everything is read from the environment:
 *
 * - `TEAMMATES_MODEL`: the model Lead, researcher and writer answer on
 *   (default `openai/gpt-6-luna`).
 * - `TEAMMATES_WORKDIR`: the working folder, an absolute path to a git
 *   checkout (default: the root of the repository this lab lives in). Coding
 *   runs work in worktrees of it, and the workers read it. Missing or not a
 *   checkout, and the lab fails to start.
 * - `TEAMMATES_STORE`: the SQLite file (default `.fsdev/teammates.sqlite` here).
 * - `TEAMMATES_USER`: who the page acts as (default `you`).
 * - `TEAMMATES_TREE`: the workers' tree (default `workforce/` here).
 * - `TEAMMATES_HARNESS`: the harness a coding worker whose file names none runs
 *   on, `claude-code`, `codex` or `cursor` (the default).
 * - `TEAMMATES_RUNS`: the folder coding runs' worktrees go in (default
 *   `teammates-runs/` beside the store).
 * - `TEAMMATES_RUN_TIMEOUT_MS`: the wall-clock budget for one coding run, in
 *   milliseconds (default 20 minutes). A value that isn't a positive whole
 *   number a timer can hold stops the lab at start.
 * - `TEAMMATES_SETUP`: a command each fresh worktree runs before its coding
 *   run starts, such as `pnpm install --frozen-lockfile` (default: none).
 * - `TEAMMATES_CHECKS`: the commands a coding run's worktree must pass before
 *   its task is done, `;`-separated, such as `pnpm typecheck; pnpm test`
 *   (default: none). A red one sends the run back with the command's output.
 *   Neither runs through a shell, so `&&`, `|` and redirects stop the lab at
 *   start.
 * - `GITHUB_TOKEN`: the token a routine that follows a GitHub pull request or
 *   repository reads GitHub with, for `TEAMMATES_USER` alone (default: what
 *   `gh auth token` answers at start). With neither, a GitHub routine is
 *   refused, naming the variable; clock routines still run.
 * - `GOAL_HARNESS=stub`: for goal checks only. Every coding worker runs on a
 *   scripted harness, no model and no sign-in, whose five steps are
 *   `GOAL_HARNESS_STEP_MS` apart (default 2000). `GOAL_STALE_THRESHOLD_MS`
 *   then sets how long a silent request waits before the server takes it as
 *   interrupted (default one minute), so a goal can read a dead run's row
 *   before the board takes it back.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkCommands, defaultStore, openTeammates, operatorGitHubToken, runTimeout, setupCommand } from "./host.mts";

/** The repository this lab lives in: the working folder when `TEAMMATES_WORKDIR` is unset. */
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const store = process.env.TEAMMATES_STORE ?? defaultStore();
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: process.env.TEAMMATES_MODEL ?? "openai/gpt-6-luna",
  userId: process.env.TEAMMATES_USER ?? "you",
  workdir: process.env.TEAMMATES_WORKDIR ?? PROJECT_ROOT,
  runsRoot: process.env.TEAMMATES_RUNS ?? join(dirname(store), "teammates-runs"),
  runTimeoutMs: runTimeout(process.env.TEAMMATES_RUN_TIMEOUT_MS),
  setup: setupCommand(process.env.TEAMMATES_SETUP),
  checks: checkCommands(process.env.TEAMMATES_CHECKS),
  githubToken: operatorGitHubToken(),
  ...(process.env.TEAMMATES_TREE === undefined ? {} : { tree: process.env.TEAMMATES_TREE }),
  ...(process.env.TEAMMATES_HARNESS === undefined ? {} : { harness: process.env.TEAMMATES_HARNESS }),
  ...(process.env.GOAL_HARNESS === "stub" ? { scriptedHarnessStepMs: Number(process.env.GOAL_HARNESS_STEP_MS ?? 2_000) } : {}),
  ...(process.env.GOAL_HARNESS === "stub" && process.env.GOAL_STALE_THRESHOLD_MS !== undefined
    ? { staleThresholdMs: Number(process.env.GOAL_STALE_THRESHOLD_MS) }
    : {}),
});
