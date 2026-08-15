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

/**
 * Where an unexpected throw came from. Not a vendor concept and not part of the
 * seam — it exists only so the reason can name whose bug it is.
 */
type ThrowSite = "prompt" | "harness";

/**
 * Turn an unexpected throw into a reason a human can act on.
 *
 * The site matters more than the message. `renderPrompt` is project-supplied, so
 * its bugs are debugged nowhere near the CLI or the model, and the reason string
 * is the only thing that reaches the ledger — an unattributed "dispatch failed"
 * sends someone looking at the wrong layer.
 */
function reasonFor(site: ThrowSite, cause: unknown): string {
  const detail = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
  return site === "prompt"
    ? `The configured renderPrompt threw, so no agent ran — the bug is in the project's prompt renderer, not in Claude Code: ${detail}`
    : `The Claude Code harness threw instead of settling: ${detail}`;
}

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
      // Taken defensively for the same reason the body is wrapped below: `now`
      // is configuration too, and a result conductor cannot even stamp is a
      // transition the ledger never sees. A real clock beats no record.
      const stamp = (): string => {
        try {
          return now().toISOString();
        } catch {
          return new Date().toISOString();
        }
      };

      const startedAt = stamp();
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
        settledAt: stamp(),
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
      // skipping past it. That guarantee stops at its own boundary, though: the
      // arguments handed to it are evaluated first, and `renderPrompt` is
      // project-supplied. A throw anywhere in here would reject `run`, and a
      // rejected dispatch produces no `dispatch_failed` signal, so `decide`
      // never escalates and nothing is written down — the transition vanishes
      // rather than being recorded as failed. So the whole adapter settles, and
      // `site` carries which half broke into the reason.
      let site: ThrowSite = "prompt";
      try {
        const prompt = renderPrompt(brief);
        site = "harness";

        const run = await runClaudeHeadless({
          prompt,
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
      } catch (cause) {
        return settle("failed", { error: reasonFor(site, cause) });
      }
    },
  };
}
