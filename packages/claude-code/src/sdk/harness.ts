/**
 * `claudeCodeHarness()`: Claude Code as one harness value, for the harness
 * kit's `harnesses` slot, the same way Codex and Cursor are filled.
 *
 * Each run gets only Claude Code's environment (`harnessEnv` over
 * `CLAUDE_CODE_PASS`), records its work, may read, write, edit and run
 * commands, and reads the working folder's own settings with every hook off:
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
import { readClaudeCodeUsage } from "./usage";

/** Options for {@link claudeCodeHarness}. */
export interface ClaudeCodeHarnessOptions {
  /**
   * Plan only: the value is `claude-code-plan` ("Claude Code (plan)"), whose
   * runs work in `plan` permission mode. Fill both values for an app that has
   * workers of each kind.
   */
  plan?: boolean;
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
        allowedTools: ["Read", "Write", "Edit", "Bash"],
        permissionMode: plan ? "plan" : "acceptEdits",
        settingSources: ["project"],
        settings: { disableAllHooks: true },
      }),
    readiness: (check) => checkClaudeCodeReadiness({ env: env(), ...(check?.signal === undefined ? {} : { signal: check.signal }) }),
    pass: CLAUDE_CODE_PASS,
    usage: (read) => readClaudeCodeUsage({ env: env(), ...(read?.signal === undefined ? {} : { signal: read.signal }) }),
    models: () => listClaudeCodeModels({ env: env() }),
  };
}
