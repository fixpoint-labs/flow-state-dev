/**
 * Server-side, for `host.mts`: the lab's coding harnesses, and the pieces that
 * make the coding agents act on GitHub as their own account when the host has
 * one (`TEAMMATES_AGENT_*`). The page never imports it.
 */
import { claudeCodeHarness } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { gitHubAccountEnv, type GitHubAccount } from "@flow-state-dev/core/harness";
import { cursorHarness } from "@flow-state-dev/cursor";

/**
 * The coding agents as `account`, or as the operator when there is none:
 * then every piece is empty and the harnesses are the lab's defaults.
 * `workspace` spreads into `localRepoWorkspaceHost` (the account a pull request
 * is pushed and opened as), `github` into `operatorGitHub` (the account a
 * follow takes as its own), and `harnesses()` is Claude Code, Codex and
 * Cursor, each run committing, pushing and running `gh` as the account.
 */
export function codingAgents(account: GitHubAccount | undefined) {
  const runAs = account === undefined ? {} : { extraEnv: gitHubAccountEnv(account) };
  return {
    workspace: account === undefined ? {} : { pullRequestsAs: { token: account.token } },
    github: account === undefined ? {} : { agentToken: account.token },
    harnesses: () => [claudeCodeHarness(runAs), codexHarness({ recordPlan: true, ...runAs }), cursorHarness({ model: "composer-2.5", recordPlan: true, ...runAs })],
  };
}
