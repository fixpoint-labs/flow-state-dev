/**
 * `claudeCodeDispatcher` — the first {@link Dispatcher}, backed by Claude Code.
 *
 * One invocation per phase, run in the worktree conductor provisioned, waited on
 * to completion, and reduced to a {@link DispatchResult}. How that invocation
 * happens — the agent loop, the harness it loads, the terminal result — is not
 * conductor's knowledge and does not live here: it is `runClaudeHeadless` from
 * `@flow-state-dev/claude-code/sdk`, the repo's one Claude Code integration and
 * the only package that imports the vendor SDK. This file is the adapter
 * between that and the seam in `./types`, which stays vendor-neutral: conductor
 * decides isolation, branch policy, the prompt, and what a result means to the
 * ledger.
 */

import { runClaudeHeadless, type ResolveClaudeAgentQuery } from "@flow-state-dev/claude-code/sdk";
import { renderBrief } from "./brief";
import type { DispatchResult, Dispatcher, PhaseBrief } from "./types";

export interface ClaudeCodeDispatcherOptions {
  /** Model alias or id. Omitted when unset, so the vendor's default applies. */
  readonly model?: string;
  /**
   * Permission mode. Default `"acceptEdits"`: a dispatched phase edits files
   * unattended, and a mode that prompts would hang forever with no terminal.
   */
  readonly permissionMode?: string;
  /** Ceiling on conversation turns for one dispatch. No ceiling when unset. */
  readonly maxTurns?: number;
  /** Vendor-side spend ceiling in USD for one dispatch. No ceiling when unset. */
  readonly maxBudgetUsd?: number;
  /** Hard ceiling on one dispatch. Default 30 minutes. */
  readonly timeoutMs?: number;
  /** Extra environment for the agent process. */
  readonly env?: Record<string, string>;
  /** How to load the vendor SDK. Default: the real one. Injected so tests run nothing. */
  readonly resolveAgent?: ResolveClaudeAgentQuery;
  /** Turns the brief into the prompt. Default {@link renderBrief}. */
  readonly renderPrompt?: (brief: PhaseBrief) => string;
  /** Clock, injected so timestamps are assertable. */
  readonly now?: () => Date;
}

/**
 * Create a dispatcher backed by Claude Code.
 *
 * Declares `isolation: "worktree"` — the agent edits whatever directory it runs
 * in, so two concurrent phases sharing one need a dedicated tree each.
 *
 * The result reports the branch as what it produced and nothing else. Whether a
 * PR was opened is a structural fact conductor reads from GitHub; parsing it out
 * of an agent's prose would make the agent a second authority on it.
 */
export function claudeCodeDispatcher(
  options: ClaudeCodeDispatcherOptions = {},
): Dispatcher {
  const {
    model,
    permissionMode = "acceptEdits",
    maxTurns,
    maxBudgetUsd,
    timeoutMs = 30 * 60 * 1000,
    env,
    resolveAgent,
    renderPrompt = renderBrief,
    now = () => new Date(),
  } = options;

  return {
    vendor: "claude-code",
    isolation: "worktree",

    async run(brief: PhaseBrief): Promise<DispatchResult> {
      const startedAt = now().toISOString();
      const settle = (
        outcome: "completed" | "failed",
        extra: Partial<DispatchResult> = {},
      ): DispatchResult => ({
        dispatchId: brief.dispatchId,
        outcome,
        produced: brief.branch ? { branch: brief.branch } : {},
        costUsd: null,
        vendorRunId: null,
        error: null,
        startedAt,
        settledAt: now().toISOString(),
        ...extra,
      });

      if (!brief.workspacePath) {
        return settle("failed", {
          produced: {},
          error:
            "claudeCodeDispatcher declares isolation \"worktree\" but the brief carries no workspace path.",
        });
      }

      // `runClaudeHeadless` settles rather than throwing on every vendor failure
      // — an uninstalled SDK, a timeout, a crash mid-run, an error-subtype
      // result — which is what keeps the transition in the ledger instead of
      // skipping past it.
      const run = await runClaudeHeadless({
        prompt: renderPrompt(brief),
        cwd: brief.workspacePath,
        model,
        permissionMode,
        maxTurns,
        maxBudgetUsd,
        timeoutMs,
        env,
        ...(resolveAgent ? { resolveAgent } : {}),
      });

      return settle(run.ok ? "completed" : "failed", {
        costUsd: run.costUsd,
        vendorRunId: run.sessionId,
        error: run.error,
      });
    },
  };
}
