/**
 * Building a phase brief, and rendering it for a harness that reads prose.
 *
 * Both halves are vendor-neutral on purpose. The brief is a struct every
 * dispatcher receives; the rendering is markdown, which is the interop surface
 * layer 3 already reads (§6 — "the filesystem is the interop surface"). A vendor
 * that prefers a structured payload ignores {@link renderBrief} entirely and
 * reads the fields.
 */

import type { DispatchAction } from "../model/actions";
import type { ConductorEntity } from "../driver/derive-gate";
import type { PhaseBrief } from "./types";

/** Everything about a dispatch that does not come from the entity or the action. */
export interface BriefContext {
  readonly dispatchId: string;
  /** The phase's branch, per conductor's branch policy. */
  readonly branch: string | null;
  /** Where the work runs, per the dispatcher's isolation model. */
  readonly workspacePath: string | null;
  /**
   * Repo-relative guidance paths for *this* phase. Deliberately supplied by the
   * caller rather than defaulted here: which documents govern which phase is a
   * property of the project conductor is running, not of conductor.
   */
  readonly guidancePaths?: readonly string[];
  /** What the work item asks for, when a connector knows it. */
  readonly summary?: string | null;
}

/**
 * Assemble the brief for one dispatch action.
 *
 * The entity supplies who and where in the process; the action supplies what and
 * why; the context supplies the workspace. Nothing is inferred — a brief that is
 * missing a branch is a phase that has none, not a lookup that failed.
 */
export function briefFor(
  entity: ConductorEntity,
  action: DispatchAction,
  context: BriefContext,
): PhaseBrief {
  return {
    dispatchId: context.dispatchId,
    entityId: entity.id,
    entityKind: entity.kind,
    phase: entity.phase,
    action: action.kind,
    branch: context.branch,
    workspacePath: context.workspacePath,
    guidancePaths: context.guidancePaths ?? [],
    because: action.because ?? null,
    summary: context.summary ?? null,
  };
}

/** One-line statement of what each dispatch action is asking for. */
const ACTION_INTENT: Record<DispatchAction["kind"], string> = {
  draftSpec: "Write the implementation spec for this work item.",
  reviseSpec: "Revise the spec to address the review feedback on its PR.",
  answerQuestion: "Answer the question asked on the PR. Do not change the work to do it.",
  implement: "Implement this work item and open a pull request for it.",
  addressFeedback: "Address the outstanding feedback on the pull request.",
  resolveConflict: "Resolve the merge conflict between this branch and its base.",
  rebaseOnBase: "Rebase this branch onto its base, now that the base is green.",
  runGoalCheck: "Verify on the real path that the merged change does what the item asked.",
  retrospect: "Write the retrospective for this work.",
  polishDocs: "Run an editorial pass over the documentation this work touched.",
  reExamineOpenPrs: "Re-examine the open pull requests against the guidance that changed.",
};

/**
 * Render a brief as markdown for a harness that takes a prompt.
 *
 * The closing paragraph is load-bearing, not politeness: conductor learns what a
 * dispatch produced by reading GitHub, so a harness reporting it back in prose
 * would be inventing a second authority for a fact the structural read already
 * owns.
 */
export function renderBrief(brief: PhaseBrief): string {
  const lines: string[] = [
    `# ${brief.action} — ${brief.entityId}`,
    "",
    ACTION_INTENT[brief.action],
    "",
  ];

  if (brief.summary) lines.push(`## The work item`, "", brief.summary, "");

  lines.push(`**Phase:** ${brief.phase}`);
  if (brief.branch) {
    lines.push(
      brief.workspacePath
        ? `**Branch:** \`${brief.branch}\` — already checked out in your working directory.`
        : `**Branch:** \`${brief.branch}\` — do your work on it.`,
    );
  }
  if (brief.because) lines.push(`**Why now:** ${brief.because}`);
  lines.push("");

  if (brief.guidancePaths.length > 0) {
    lines.push("## Read before you start", "");
    for (const path of brief.guidancePaths) lines.push(`- \`${path}\``);
    lines.push("");
  }

  lines.push(
    "## What is expected back",
    "",
    "Commit your work on this branch and push it. Conductor reads GitHub for what",
    "you produced, so there is nothing to report back in prose.",
  );

  return lines.join("\n");
}
