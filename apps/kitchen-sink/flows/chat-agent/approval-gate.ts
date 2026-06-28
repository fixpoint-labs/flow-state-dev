/**
 * Durable human-in-the-loop approval gate (FIX-140 / FIX-141 / FIX-811 demo).
 *
 * A durable action that pauses for a human decision and showcases how a
 * same-request continuation resumes. The pipeline is intentionally multi-step
 * so the resume semantics are visible end to end:
 *
 *   prepareApproval  .step    — runs ONCE; on resume it is replayed (injected
 *                               from the durable log, NOT re-executed), so the
 *                               approvalId it mints stays identical across the
 *                               suspend/resume boundary and its message is not
 *                               re-emitted.
 *   approvalGate     .step    — emits the prompt and calls ctx.suspend(); this
 *                               is the block that re-runs on resume. Returns a
 *                               structured decision so the sequencer can branch.
 *   executeApproved  .tapIf   — post-approval work; runs ONLY when approved.
 *   finalizeApproved .tapIf   — more post-approval work, to show the pipeline
 *                               continuing in depth past the gate.
 *   recordRejection  .tapIf   — runs ONLY when rejected; the post-approval
 *                               blocks above are skipped.
 *
 * The branch blocks are `.tapIf` (side-effect/emit only) rather than `.stepIf`
 * so they don't rewrite the threaded value — every branch condition reads the
 * same gate decision (BP-036: conditional step variants, no wrapper sequencer).
 * Kept off the main `run` pipeline so ordinary chat turns stay transient.
 */
import { handler, sequencer, SuspensionRejectedError } from "@flow-state-dev/core";
import { z } from "zod";

const approvalGateInputSchema = z.object({
  /** Human-readable description of the action awaiting approval. */
  request: z.string().min(1),
});

/** Optional note the operator can attach when resolving from the DevTool. */
const approvalResumeSchema = z.object({
  note: z.string().optional(),
});

/** Output of `prepareApproval`, threaded through the gate and branch steps. */
const preparedApprovalSchema = z.object({
  request: z.string(),
  /**
   * Id minted once, before the gate. On resume `prepareApproval` is injected
   * from the log (not re-run), so this stays identical across suspend/resume —
   * the visible proof that completed blocks don't re-execute on continuation.
   */
  approvalId: z.string(),
});

/** The gate's decision, threaded to the branch steps. */
const approvalDecisionSchema = preparedApprovalSchema.extend({
  approved: z.boolean(),
  note: z.string().nullable(),
});

// Pre-suspension step. Mints a stable approval id and announces the request.
// Replayed (not re-run) on resume — see the section header.
const prepareApproval = handler({
  name: "prepare-approval",
  inputSchema: approvalGateInputSchema,
  outputSchema: preparedApprovalSchema,
  execute: async (input, ctx) => {
    const approvalId = `appr_${crypto.randomUUID().slice(0, 8)}`;
    ctx.emit.message(`Preparing approval ${approvalId} for: "${input.request}"`);
    return { request: input.request, approvalId };
  },
});

const approvalGateStep = handler({
  name: "approval-gate",
  inputSchema: preparedApprovalSchema,
  outputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    // `ctx.suspend` is only present in a durable action running inside a
    // sequencer. On first run it throws a SuspensionError the sequencer catches
    // at this step boundary. On resume the operator's *action* decides the
    // outcome: "approve" makes ctx.suspend RETURN the resume data; "reject"
    // makes it THROW SuspensionRejectedError. Reaching past ctx.suspend means
    // approved — return a structured decision so the sequencer can branch.
    //
    // Emit the prompt directly — do NOT wrap it in ctx.runOnce. On resume the
    // gate re-runs from the top and re-emits this; the canonical item-log view
    // (collapseToCanonicalLog) drops the superseded run-1 copy so history /
    // useSession / the DevTool stream show it once. runOnce is for *awaited*
    // side effects (e.g. "charge the card once"), not emits.
    try {
      ctx.emit.message(`Approval ${input.approvalId} requested: "${input.request}"`);
      const data = (await ctx.suspend!({
        reason: "human_approval",
        message: `Approve action: "${input.request}"?`,
        resumeSchema: approvalResumeSchema,
      })) as z.infer<typeof approvalResumeSchema> | undefined;
      return { ...input, approved: true, note: data?.note ?? null };
    } catch (err) {
      if (err instanceof SuspensionRejectedError) {
        const note = (err.rejectionData as { note?: string } | undefined)?.note;
        return { ...input, approved: false, note: note ?? null };
      }
      throw err;
    }
  },
});

// Post-approval work — runs ONLY when approved. Emit-only, so `.tapIf` keeps the
// gate decision threaded for the later branch conditions.
const executeApproved = handler({
  name: "execute-approved",
  inputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    ctx.emit.message(
      `Executing approved action ${input.approvalId}: "${input.request}"…`
    );
  },
});

const finalizeApproved = handler({
  name: "finalize-approved",
  inputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    ctx.emit.message(
      `Done. "${input.request}" completed${input.note ? ` — ${input.note}` : ""} (approval ${input.approvalId}).`
    );
  },
});

// Rejection branch — runs ONLY when rejected. The post-approval blocks are
// skipped entirely.
const recordRejection = handler({
  name: "record-rejection",
  inputSchema: approvalDecisionSchema,
  execute: async (input, ctx) => {
    ctx.emit.message(
      `Rejected${input.note ? ` — ${input.note}` : ""}. "${input.request}" was not performed (approval ${input.approvalId}).`
    );
  },
});

// Exported (with its input schema) so the durable resume / approve-vs-reject
// branching can be driven in a focused test against the real runtime.
export const approvalGateInput = approvalGateInputSchema;
export const approvalGate = sequencer({
  name: "approval-gate-seq",
  inputSchema: approvalGateInputSchema,
  durable: true,
})
  .step(prepareApproval)
  .step(approvalGateStep)
  .tapIf((decision) => decision.approved, executeApproved)
  .tapIf((decision) => decision.approved, finalizeApproved)
  .tapIf((decision) => !decision.approved, recordRejection);
