/**
 * `claudeCode()`: Claude Code as a small kit, beside the harness kit.
 *
 * Codex and Cursor are plain harness values, since they install nothing. Claude
 * Code installs pieces of its own, the collections a run records its work into
 * (`claudeCodeWorkRecorderResources`, `claudeCodeWorkspaceResources`), so it is
 * a kit: it requires the harness kit, serves those collections on a flow of
 * its own, and fills the harness kit's `harnesses` slot with Claude Code.
 *
 * Each run gets only Claude Code's environment (`harnessEnv` over
 * `CLAUDE_CODE_PASS`), records its work, may read, write, edit and run
 * commands, and reads the working folder's own settings with every hook off:
 * a turn could write a hook into `.claude/settings.json` that would run by
 * itself on the next one. `acceptEdits` is its permission mode; with
 * `plan: true` the kit fills a second harness, `claude-code-plan`, in `plan`
 * mode, for workers that only plan.
 *
 * An app switches Claude Code off with
 * `claudeCode().without(harnesses.slots.harnesses, "claude-code")`, and a
 * goal check fills a scripted harness under the same id instead.
 */
import { defineFlow, defineKit } from "@flow-state-dev/core";
import { harnessEnv, type HarnessBlock } from "@flow-state-dev/core/harness";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { Harness } from "@flow-state-dev/harness-manager";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { z } from "zod";
import { checkClaudeCodeReadiness } from "./account-probe";
import { claudeCodeAgent } from "./agent";
import { CLAUDE_CODE_PASS } from "./env-pass";
import { listClaudeCodeModels } from "./model-list";
import { readClaudeCodeUsage } from "./usage";
import { claudeCodeWorkRecorderResources } from "./work-collections";
import { claudeCodeWorkspaceResources } from "./workspace-collections";

/** The flow the kit serves Claude Code's collections on. */
export const CLAUDE_CODE_FLOW = "claude-code";

/** The permission modes a coding run works in with nobody to approve a tool call. */
type PermissionMode = "acceptEdits" | "plan";

/** Claude Code in one permission mode, as a harness value. */
function claudeCodeHarness(id: string, label: string, permissionMode: PermissionMode): Harness {
  const env = () => harnessEnv({ pass: CLAUDE_CODE_PASS });
  return {
    id,
    label,
    agent: (feeds) =>
      claudeCodeAgent({
        ...feeds,
        env: env(),
        detached: true,
        recordWork: true,
        allowedTools: ["Read", "Write", "Edit", "Bash"],
        permissionMode,
        settingSources: ["project"],
        settings: { disableAllHooks: true },
      } as never) as unknown as HarnessBlock,
    readiness: (check) => checkClaudeCodeReadiness({ env: env(), ...(check?.signal === undefined ? {} : { signal: check.signal }) }),
    pass: CLAUDE_CODE_PASS,
    usage: (read) => readClaudeCodeUsage({ env: env(), ...(read?.signal === undefined ? {} : { signal: read.signal }) }),
    models: () => listClaudeCodeModels({ env: env() }),
  };
}

/**
 * Claude Code, as a kit. Requires the harness kit.
 *
 * @example
 *   createFlowState({ kits: [workforce({ … }), harnesses({ workspace }), claudeCode()] });
 */
export const claudeCode = defineKit({
  name: "claude-code",
  requires: [harnesses],
  config: z.object({ plan: z.boolean().optional() }).strict(),
  contributes: ({ config }) => ({
    [harnesses.slots.harnesses]: [
      claudeCodeHarness("claude-code", "Claude Code", "acceptEdits"),
      ...(config.plan === true ? [claudeCodeHarness("claude-code-plan", "Claude Code (plan)", "plan")] : []),
    ],
  }),
  install: () => ({
    flows: [
      defineFlow({
        kind: CLAUDE_CODE_FLOW,
        resources: { ...claudeCodeWorkRecorderResources, ...claudeCodeWorkspaceResources },
      } as never)({ id: CLAUDE_CODE_FLOW } as never) as unknown as FlowInstance,
    ],
  }),
});
