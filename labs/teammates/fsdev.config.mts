/**
 * The Teammates lab's server, as `fsdev dev --app @flow-state-dev/teammates` loads it from this folder.
 * Everything is read from the environment: the README's "Run it" says what each variable sets, and "The
 * host" what it builds. `GOAL_HARNESS=stub` is for goal checks only: every coding worker runs on a scripted
 * harness whose steps are `GOAL_HARNESS_STEP_MS` apart (default 2000), and `GOAL_STALE_THRESHOLD_MS` sets
 * how long a silent request waits before the server takes it as interrupted.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gitHubAccountFrom } from "@flow-state-dev/core/harness";
import { operatorGitHubToken } from "@flow-state-dev/workforce";
import { checkCommands, defaultStore, openTeammates, runTimeout, setupCommand } from "./host.mts";

/** The repository this lab lives in: the working folder when `TEAMMATES_WORKDIR` is unset. */
const PROJECT_ROOT = fileURLToPath(new URL("../..", import.meta.url));

const store = process.env.TEAMMATES_STORE ?? defaultStore();
mkdirSync(dirname(store), { recursive: true });

export default await openTeammates({
  store,
  model: process.env.TEAMMATES_MODEL ?? "openai/gpt-6-luna",
  models: process.env.TEAMMATES_MODELS?.split(",").map((m) => m.trim()).filter((m) => m !== ""),
  userId: process.env.TEAMMATES_USER ?? "you",
  workdir: process.env.TEAMMATES_WORKDIR ?? PROJECT_ROOT,
  runsRoot: process.env.TEAMMATES_RUNS ?? join(dirname(store), "teammates-runs"),
  runTimeoutMs: runTimeout(process.env.TEAMMATES_RUN_TIMEOUT_MS),
  setup: setupCommand(process.env.TEAMMATES_SETUP),
  checks: checkCommands(process.env.TEAMMATES_CHECKS),
  githubToken: operatorGitHubToken(),
  agentGitHub: gitHubAccountFrom(process.env, { token: "TEAMMATES_AGENT_GITHUB_TOKEN", name: "TEAMMATES_AGENT_GIT_NAME", email: "TEAMMATES_AGENT_GIT_EMAIL" }),
  ...(process.env.TEAMMATES_TREE === undefined ? {} : { tree: process.env.TEAMMATES_TREE }),
  ...(process.env.TEAMMATES_HARNESS === undefined ? {} : { harness: process.env.TEAMMATES_HARNESS }),
  ...(process.env.GOAL_HARNESS === "stub" ? { scriptedHarnessStepMs: Number(process.env.GOAL_HARNESS_STEP_MS ?? 2_000) } : {}),
  ...(process.env.GOAL_HARNESS === "stub" && process.env.GOAL_STALE_THRESHOLD_MS !== undefined ? { staleThresholdMs: Number(process.env.GOAL_STALE_THRESHOLD_MS) } : {}),
});
