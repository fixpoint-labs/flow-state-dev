/**
 * The per-stage Claude Code dispatch — the orchestrator's "hands."
 *
 * Each stage delegates its work to a Claude Code cloud task via
 * `claudeRemoteDispatch` (fire-and-forget; the orchestrator detects completion
 * by polling Linear/GitHub, not the agent). This module builds the dispatch
 * block and the instruction string. The instruction is a *hybrid* form
 * (decision Q1): prose that names the workflow with the repo slash command
 * embedded, so a cloud agent that treats a leading slash command as a skill
 * trigger and one that reads it as prose both do the right thing. Whether the
 * bare slash form alone would suffice is the spec's load-bearing open question;
 * the hybrid hedges it and stays a one-line change if the answer lands.
 */
import { claudeRemoteDispatch } from "@flow-state-dev/claude-code/cli";
import type { ResolveClaudeCli } from "@flow-state-dev/claude-code/cli";
import type { OrchestrationStage } from "../types";

/** The slash command each stage invokes (also used to mark in-flight dispatches). */
function stageCommand(stage: OrchestrationStage): string {
  switch (stage) {
    case "spec":
      return "/create-spec";
    case "implement":
      return "/implement-issue";
    case "review":
      return "/code-review";
  }
}

/**
 * A stable substring identifying a dispatch for a given (stage, issue), used to
 * detect an already-in-flight dispatch in persisted `claudeRemoteTasks` so a
 * restart between dispatch and the next checkpoint does not double-dispatch.
 */
export function stageCommandMarker(stage: OrchestrationStage, issueId: string): string {
  return `${stageCommand(stage)} ${issueId}`;
}

/**
 * The hybrid instruction string sent to `claude --remote` for a stage. Names
 * the workflow in prose and embeds the slash command + issue id, then states
 * the board transition that is the completion signal so the dispatched agent
 * knows when it is "done."
 */
export function stageInstruction(stage: OrchestrationStage, issueId: string): string {
  switch (stage) {
    case "spec":
      return (
        `Run ${stageCommandMarker("spec", issueId)} — invoke the create-spec skill ` +
        `(.claude/skills/create-spec). Research the issue, write the implementation spec, ` +
        `attach it to the issue, and advance the issue to In Spec Review.`
      );
    case "implement":
      return (
        `Run ${stageCommandMarker("implement", issueId)} — invoke the implement-issue skill ` +
        `(.claude/skills/implement-issue). Implement the approved spec, open a pull request, ` +
        `and advance the issue to In Review.`
      );
    case "review":
      return (
        `Run ${stageCommandMarker("review", issueId)} — review the open pull request for this ` +
        `issue and post findings as review comments. Do not merge.`
      );
  }
}

/** Options for the per-stage dispatch block. */
export interface DispatchStageOptions {
  /** Working directory for the dispatch (the host repo root). */
  cwd: string;
  /** Host hook resolving how to run `claude`. Tests inject a stub; production uses PATH. */
  resolveClaudeCli?: ResolveClaudeCli;
  /** Block name (distinguishes the dispatch step per stage in traces). */
  name?: string;
}

/**
 * Build the dispatch block for a stage. The instruction string is supplied by
 * the calling sequencer via the `{ instructions }` input (a `.map` connector),
 * so this block stays a thin, reusable wrapper around `claudeRemoteDispatch`.
 */
export function dispatchStage(options: DispatchStageOptions) {
  return claudeRemoteDispatch({
    name: options.name ?? "dispatch-stage",
    cwd: options.cwd,
    resolveClaudeCli: options.resolveClaudeCli,
  });
}
