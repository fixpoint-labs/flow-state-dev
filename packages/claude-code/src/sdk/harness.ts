/**
 * `claudeCodeHarness()`: Claude Code as one harness value, for the harness
 * kit's `harnesses` slot, the same way Codex and Cursor are filled.
 *
 * Each run gets only Claude Code's environment (`harnessEnv` over
 * `CLAUDE_CODE_PASS`), records its work, may read, write, edit and run
 * commands by default (hosts can replace that tool list), and reads the working
 * folder's own settings with every hook and inline skill shell command off:
 * a turn could write a hook into `.claude/settings.json` that would run by
 * itself on the next one. `acceptEdits` is its permission mode; with
 * `plan: true` the value is `claude-code-plan`, in `plan` mode, for workers
 * that only plan.
 *
 * The collections a run records its work into are declared on the agent block
 * (`recordWork`), so the flow that runs it installs them.
 */
import { harnessEnv, type Harness } from "@flow-state-dev/core/harness";
import { checkClaudeCodeReadiness } from "./account-probe";
import { claudeCodeAgent } from "./agent";
import { CLAUDE_CODE_PASS } from "./env-pass";
import { listClaudeCodeModels } from "./model-list";
import type { ClaudeCodeSettingSource } from "./types";
import { readClaudeCodeUsage } from "./usage";

const DEFAULT_ALLOWED_TOOLS = ["Read", "Write", "Edit", "Bash"] as const;
const DEFAULT_SETTING_SOURCES = ["project"] as const satisfies readonly ClaudeCodeSettingSource[];

/** Options for {@link claudeCodeHarness}. */
export interface ClaudeCodeHarnessOptions {
  /**
   * Plan only: the value is `claude-code-plan` ("Claude Code (plan)"), whose
   * runs work in `plan` permission mode. Fill both values for an app that has
   * workers of each kind.
   */
  plan?: boolean;
  /**
   * Tools the run may use without asking. Replaces the kit default
   * (`Read`, `Write`, `Edit`, `Bash`) when set; the agent block still adds
   * Claude Code's to-do tools. Applies in both `acceptEdits` and `plan` mode;
   * the SDK still enforces the selected mode. Name `Skill`, `Grep` and `Glob`
   * explicitly to offer them. Pre-approving search skips path prompts,
   * including for paths outside the working directory; this is no sandbox.
   */
  allowedTools?: string[];
  /**
   * Which settings layers the run loads (`CLAUDE.md`, skills, plugins). Replaces
   * the kit default (`project`) when set. Hooks and inline skill shell execution
   * stay off via the harness's fixed `settings`.
   */
  settingSources?: ClaudeCodeSettingSource[];
}

/**
 * Claude Code as a harness value.
 *
 * @example
 *   createFlowState({
 *     kits: [workforce({ … }), harnesses({ workspace })],
 *     fill: { [harnesses.slots.harnesses]: [claudeCodeHarness(), claudeCodeHarness({ plan: true })] },
 *   });
 */
export function claudeCodeHarness(options: ClaudeCodeHarnessOptions = {}): Harness {
  const plan = options.plan === true;
  const allowedTools = options.allowedTools ?? [...DEFAULT_ALLOWED_TOOLS];
  const settingSources = options.settingSources ?? [...DEFAULT_SETTING_SOURCES];
  const env = () => harnessEnv({ pass: CLAUDE_CODE_PASS });
  return {
    id: plan ? "claude-code-plan" : "claude-code",
    label: plan ? "Claude Code (plan)" : "Claude Code",
    agent: (feeds) =>
      claudeCodeAgent({
        ...feeds,
        env: env(),
        detached: true,
        recordWork: true,
        allowedTools,
        permissionMode: plan ? "plan" : "acceptEdits",
        settingSources,
        settings: { disableAllHooks: true, disableSkillShellExecution: true },
      }),
    readiness: (check) => checkClaudeCodeReadiness({ env: env(), ...(check?.signal === undefined ? {} : { signal: check.signal }) }),
    pass: CLAUDE_CODE_PASS,
    usage: (read) => readClaudeCodeUsage({ env: env(), ...(read?.signal === undefined ? {} : { signal: read.signal }) }),
    models: () => listClaudeCodeModels({ env: env() }),
  };
}