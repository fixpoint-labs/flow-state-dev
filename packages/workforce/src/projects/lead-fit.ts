/**
 * A worker's pick of lead, checked against the work before its workstream
 * opens: one small model call asks whether the lead's own description says it
 * leads this sort of work, and a clear no refuses the open `lead-doesnt-fit`.
 *
 * It is a backstop for clear misfits, not a router: it answers yes unless the
 * description says the lead handles a different sort of work, so a lead whose
 * description is broad passes. Picking the best lead stays with whoever calls
 * `listLeads`.
 *
 * A check that can't answer lets the open through, so a model outage never
 * stops a workstream opening, and says why in the open's record (`leadFit`),
 * so a check that has stopped answering shows up there rather than nowhere.
 */

import { generator, handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { ProjectRefusedError } from "./project-refusal";

/** What the check judges: the lead, its own description, and the work. */
export const leadFitCaseSchema = z.object({
  lead: z.string(),
  description: z.string(),
  title: z.string(),
  objectives: z.array(z.string())
});

/** @see leadFitCaseSchema */
export type LeadFitCase = z.infer<typeof leadFitCaseSchema>;

/** Request state: what became of the check on this open. */
export const LEAD_FIT_STATE = "leadFit";

/**
 * What became of the check on one open: checked and passed, or not checked
 * and why (`already-open`, `no-description`, or `unanswered: <error>`). A
 * refused open has no record: it throws.
 */
export const leadFitRecordSchema = z.union([
  z.object({ checked: z.literal(true) }),
  z.object({ checked: z.literal(false), why: z.string() })
]);

/** @see leadFitRecordSchema */
export type LeadFitRecord = z.infer<typeof leadFitRecordSchema>;

export const leadFitStateSchema = z.object({ [LEAD_FIT_STATE]: leadFitRecordSchema.optional() });

/** The judge's answer, or why it gave none. */
const judgedSchema = z.union([z.object({ fits: z.boolean() }), z.object({ unanswered: z.string() })]);

type Judged = z.infer<typeof judgedSchema>;

/**
 * The check: the judge's one call, then its verdict, which refuses a misfit
 * and records the rest.
 *
 * @param model The model the judge runs on.
 */
export function defineLeadFitCheck(model: string) {
  /** A failed call answers nothing, and says why. A cancelled request is not a failed call. */
  const unanswered = handler({
    name: "workstream-lead-fit-unanswered",
    inputSchema: z.unknown(),
    outputSchema: judgedSchema,
    execute: (error: unknown, ctx): Judged => {
      if (ctx.signal.aborted) throw error;
      return { unanswered: error instanceof Error ? error.message : String(error) };
    }
  });

  const judge = generator({
    name: "workstream-lead-fit",
    model,
    inputSchema: leadFitCaseSchema,
    outputSchema: z.object({ fits: z.boolean() }),
    itemVisibility: { client: false, history: false },
    repair: { coerce: false },
    // A backstop for clear misfits, not a router: don't tighten it into picking the best lead.
    prompt: () =>
      [
        "You check whether a worker is the right one to lead a workstream.",
        "A lead never does the work itself: it hands the work to the workers under it. So judge only what sort of work this is.",
        "Answer `fits: true` when the work, such as a feature, research or planning, is the sort the worker's description says it leads or handles.",
        "Answer `fits: false` only when its description says it handles a different sort of work."
      ].join("\n"),
    user: ({ lead, description, title, objectives }: LeadFitCase) =>
      [`The worker, ${lead}: ${description}`, "", `The work: ${title}`, ...objectives.map((objective) => `- ${objective}`)].join(
        "\n"
      )
  }).rescue([{ block: unanswered }]);

  const verdict = handler({
    name: "workstream-lead-fit-verdict",
    inputSchema: judgedSchema,
    outputSchema: z.object({}),
    requestStateSchema: leadFitStateSchema,
    execute: async (judged: Judged, ctx) => {
      if ("unanswered" in judged) {
        await ctx.request.patchState({ [LEAD_FIT_STATE]: { checked: false, why: `unanswered: ${judged.unanswered}` } });
        return {};
      }
      if (!judged.fits) {
        const fitCase = leadFitCaseSchema.parse(ctx.parent?.input);
        throw new ProjectRefusedError(
          "lead-doesnt-fit",
          `Worker "${fitCase.lead}" doesn't do this work: its description says "${fitCase.description}". ` +
            "Pick a lead from listLeads whose description says it does this work. If none does, nobody on " +
            "the roster does it yet: open nothing, and say a worker for it has to be hired first."
        );
      }
      await ctx.request.patchState({ [LEAD_FIT_STATE]: { checked: true } });
      return {};
    }
  });

  return sequencer({ name: "workstream-lead-fit-check", inputSchema: leadFitCaseSchema }).step(judge).step(verdict);
}
