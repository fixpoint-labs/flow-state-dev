/**
 * `claudeCodeDispatcher` — the first {@link Dispatcher}, backed by the local
 * `claude` CLI in headless mode.
 *
 * One invocation per phase, run in the worktree conductor provisioned, waited on
 * to completion, and reduced to a {@link DispatchResult}. The invocation itself
 * — the flags, the JSON envelope, the cost field, the spawn — is not conductor's
 * knowledge and does not live here: it is `runClaudeHeadless` from
 * `@flow-state-dev/claude-code/cli`, the repo's one Claude CLI integration. This
 * file is the adapter between that and the seam in `./types`, which stays
 * vendor-neutral: conductor decides isolation, branch policy, the prompt, and
 * what a result means to the ledger.
 */

import { runClaudeHeadless, type ClaudeCliExec } from "@flow-state-dev/claude-code/cli";
import { renderBrief } from "./brief";
import type { DispatchResult, Dispatcher, PhaseBrief } from "./types";

export interface ClaudeCodeDispatcherOptions {
  /** Path to the binary. Default `"claude"` (resolved on `PATH`). */
  readonly bin?: string;
  /** Model alias or id for `--model`. Omitted when unset, so the CLI's default applies. */
  readonly model?: string;
  /**
   * `--permission-mode`. Default `"acceptEdits"`: a dispatched phase edits files
   * unattended, and a mode that prompts would hang forever with no terminal.
   */
  readonly permissionMode?: string;
  /** Hard ceiling on one dispatch. Default 30 minutes. */
  readonly timeoutMs?: number;
  /** Extra environment for the child process. */
  readonly env?: Record<string, string>;
  /** How to run the binary. Default: a real spawn. Injected so tests spawn nothing. */
  readonly exec?: ClaudeCliExec;
  /** Turns the brief into the prompt. Default {@link renderBrief}. */
  readonly renderPrompt?: (brief: PhaseBrief) => string;
  /** Clock, injected so timestamps are assertable. */
  readonly now?: () => Date;
}

/**
 * Create a dispatcher backed by the local `claude` CLI.
 *
 * Declares `isolation: "worktree"` — the CLI edits whatever directory it runs
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
    bin,
    model,
    permissionMode = "acceptEdits",
    timeoutMs = 30 * 60 * 1000,
    env,
    exec,
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
      // — a missing binary, a timeout, a crash, a non-zero exit — which is what
      // keeps the transition in the ledger instead of skipping past it.
      const run = await runClaudeHeadless({
        prompt: renderPrompt(brief),
        cwd: brief.workspacePath,
        bin,
        model,
        permissionMode,
        timeoutMs,
        env,
        exec,
      });

      return settle(run.ok ? "completed" : "failed", {
        costUsd: run.costUsd,
        vendorRunId: run.sessionId,
        error: run.error,
      });
    },
  };
}
