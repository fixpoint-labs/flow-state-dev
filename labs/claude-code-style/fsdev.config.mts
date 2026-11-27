/** What `fsdev dev --app @flow-state-dev/claude-code-style` serves: `openClaudeCodeStyle` (`host.mts`) on the settings the README's "Run it" lists. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { setupCommandFrom } from "@flow-state-dev/workspace";
import { operatorGitHubToken } from "@flow-state-dev/workforce";
import { checkCommands, openClaudeCodeStyle } from "./host.mts";

const env = process.env;
const data = resolve(env.CLAUDE_CODE_STYLE_DATA ?? ".fsdev/claude-code-style");
mkdirSync(data, { recursive: true });
/** The repository the lab is started in, or none outside one (git answers nothing there). */
const startedIn = () => spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).stdout?.trim() ?? "";
const setup = setupCommandFrom(env.CLAUDE_CODE_STYLE_SETUP, "CLAUDE_CODE_STYLE_SETUP");

const { flowState } = await openClaudeCodeStyle({
  data,
  userId: env.CLAUDE_CODE_STYLE_USER ?? "u_lab",
  model: env.CLAUDE_CODE_STYLE_MODEL ?? "openai/gpt-5.4",
  utilityModel: env.CLAUDE_CODE_STYLE_UTILITY_MODEL ?? "openai/gpt-6-luna",
  answerAgain: env.CLAUDE_CODE_STYLE_ANSWER_AGAIN !== "off",
  ...(env.CLAUDE_CODE_STYLE_HARNESS === "stub" ? { scriptedStepMs: Number(env.CLAUDE_CODE_STYLE_HARNESS_STEP_MS ?? 2_000) } : {}),
  repositories: (env.CLAUDE_CODE_STYLE_REPOSITORIES ?? startedIn()).split(delimiter).filter((path) => path !== "" && existsSync(path)).map((path) => realpathSync(path)),
  ...(setup === undefined ? {} : { setup }),
  checks: checkCommands(env.CLAUDE_CODE_STYLE_CHECKS),
  ...(env.CLAUDE_CODE_STYLE_STALE_THRESHOLD_MS === undefined ? {} : { staleThresholdMs: Number(env.CLAUDE_CODE_STYLE_STALE_THRESHOLD_MS) }),
  // A goal check's controls and its own flows: never set otherwise.
  checkRepository: env.GOAL_CONTROL !== "no-repository-check",
  ignoreSessionRepository: env.GOAL_CONTROL === "first-repository",
  ...(env.GOAL_FLOWS ? { goalFlows: env.GOAL_FLOWS } : {}),
  githubToken: operatorGitHubToken(),
});

export default flowState;
