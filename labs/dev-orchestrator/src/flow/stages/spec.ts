/**
 * The spec stage: a durable sequencer of single-suspend steps.
 *
 * Shape (one `ctx.suspend()` per step — never two in one block, or a resume
 * would consume the wrong suspension):
 *
 *   seed issueId → (conditionally) dispatch /create-spec
 *     → park until the board reaches In Spec Review  (suspend: external_event)
 *     → human spec-approval gate                     (suspend: human_approval)
 *     → record/transition                            (.tap, side-effect only)
 *
 * The driver owns all polling; this stage only *describes* what each wait is for
 * (in the suspension `data`) and performs the one forward write at the end. The
 * dispatch step is skipped when the agent is already running (`skipDispatch`,
 * set by the driver when it enters at In Spec Dev) or when a dispatch for this
 * issue is already recorded in `claudeRemoteTasks` (restart guard).
 */
import { handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import { z } from "zod";
import { CLAUDE_REMOTE_TASKS_KEY } from "@flow-state-dev/claude-code/cli";
import type { ClaudeRemoteHandle, ResolveClaudeCli } from "@flow-state-dev/claude-code/cli";
import type { LinearStatusClient } from "../../signals/linear";
import {
  completionSignalSchema,
  gateResultSchema,
  gateResumeSchema,
  type CompletionSignal,
} from "../../types";
import { dispatchStage, stageCommandMarker, stageInstruction } from "../dispatch";

/** Board states this stage waits on / writes. Constants for the spec stage. */
const SPEC_PARK_TARGET = "In Spec Review";
const SPEC_APPROVE_STATE = "Spec Approved";
const SPEC_REJECT_STATE = "In Spec Dev";

/** Caller input for the spec action. */
export const specStageInputSchema = z.object({
  issueId: z.string(),
  /** Skip the dispatch step (the driver entered while the agent is already running). */
  skipDispatch: z.boolean().default(false),
});

/** Sequencer-scoped state — carries issueId across the dispatch step (which maps it away). */
const specStageStateSchema = z.object({
  issueId: z.string().default(""),
});

export interface SpecStageOptions {
  /** Deterministic Linear client for the final record/transition write. */
  linear: LinearStatusClient;
  /** Host repo root passed to the dispatch. */
  repoRoot: string;
  /** Injected `claude` resolver (tests stub it; production uses PATH). */
  resolveClaudeCli?: ResolveClaudeCli;
}

/** True when `claudeRemoteTasks` already holds a dispatch for this (stage, issue). */
function hasInFlightDispatch(
  ctx: { session?: { state?: Record<string, unknown> } },
  marker: string,
): boolean {
  const raw = ctx.session?.state?.[CLAUDE_REMOTE_TASKS_KEY];
  if (!Array.isArray(raw)) return false;
  return raw.some((task) => {
    const instructions = (task as ClaudeRemoteHandle)?.instructions;
    return typeof instructions === "string" && instructions.includes(marker);
  });
}

/** Build the durable spec stage sequencer with its dependencies injected. */
export function buildSpecStage(options: SpecStageOptions) {
  const { linear } = options;

  // Suspend #1: park until /create-spec advances the board. The driver polls
  // Linear and resumes with the observed CompletionSignal.
  const parkForSpecCompletion = handler({
    name: "park-spec-completion",
    inputSchema: z.any(),
    outputSchema: completionSignalSchema,
    execute: async (_input, ctx): Promise<CompletionSignal> => {
      return (await ctx.suspend!({
        reason: "external_event",
        message: `Waiting for /create-spec to reach ${SPEC_PARK_TARGET}`,
        data: {
          watch: {
            kind: "linear-state",
            target: SPEC_PARK_TARGET,
            branch: null,
            requireChecks: false,
          },
        },
      })) as CompletionSignal;
    },
  });

  // Suspend #2 (separate step): the human spec-approval gate. Approve returns the
  // resume payload; reject throws SuspensionRejectedError, which becomes a
  // `rejected` result that bounces the issue back.
  const specApprovalGate = handler({
    name: "spec-approval-gate",
    inputSchema: z.any(),
    outputSchema: gateResultSchema,
    execute: async (_input, ctx) => {
      try {
        const data = (await ctx.suspend!({
          reason: "human_approval",
          message: "Spec ready. Approve to proceed to implementation?",
          resumeSchema: gateResumeSchema,
          data: { gate: "spec-approval" },
        })) as { note?: string | null } | undefined;
        return { gate: "approved" as const, note: data?.note ?? null };
      } catch (err) {
        if (err instanceof SuspensionRejectedError) {
          const note = (err.rejectionData as { note?: string | null } | undefined)?.note ?? null;
          return { gate: "rejected" as const, note };
        }
        throw err;
      }
    },
  });

  // Forward record/transition (.tap — side-effect only, BP-012). Per decision
  // Q4 the human signals approval by advancing the board; the orchestrator
  // records it. The record write is idempotent `transitionTo(Spec Approved)`: a
  // no-op under the poll-Linear gate (the human already advanced the board,
  // which is what made the gate ready), and the necessary advance under
  // `--attended` (the human approved on stdin and the board hasn't moved) — so
  // the board ends at Spec Approved either way and the next tick doesn't re-run
  // the stage. The reject path bounces the issue back one state.
  const transitionAfterSpec = handler({
    name: "transition-after-spec",
    inputSchema: gateResultSchema,
    sequencerStateSchema: specStageStateSchema,
    execute: async (input, ctx) => {
      const issueId = (ctx.sequencer!.state as z.infer<typeof specStageStateSchema>).issueId;
      const note = input.note ? `: ${input.note}` : "";
      if (input.gate === "approved") {
        await linear.transitionTo(issueId, SPEC_APPROVE_STATE);
        await linear.comment(issueId, `✅ Spec approved${note}. Proceeding to implementation.`);
      } else {
        await linear.transitionTo(issueId, SPEC_REJECT_STATE);
        await linear.comment(issueId, `↩️ Spec rejected${note}. Bounced to ${SPEC_REJECT_STATE}.`);
      }
    },
  });

  const dispatch = dispatchStage({
    cwd: options.repoRoot,
    resolveClaudeCli: options.resolveClaudeCli,
    name: "dispatch-spec",
  });

  return sequencer({
    name: "spec-stage-seq",
    inputSchema: specStageInputSchema,
    stateSchema: specStageStateSchema,
    durable: true,
  })
    // Seed issueId into sequencer state before the dispatch step maps it away.
    .tap((input, ctx) => {
      ctx.sequencer!.patchState({ issueId: input.issueId });
    })
    // Idempotent dispatch: skip when entering mid-stage or already dispatched.
    .stepIf(
      (input: z.infer<typeof specStageInputSchema>, ctx) =>
        !input.skipDispatch && !hasInFlightDispatch(ctx, stageCommandMarker("spec", input.issueId)),
      (input: z.infer<typeof specStageInputSchema>) => ({
        instructions: stageInstruction("spec", input.issueId),
      }),
      dispatch,
    )
    .step(parkForSpecCompletion)
    .step(specApprovalGate)
    .tap(transitionAfterSpec);
}
