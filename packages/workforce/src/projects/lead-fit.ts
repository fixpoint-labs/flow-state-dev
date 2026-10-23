/**
 * A worker's pick of lead, checked against the work before its workstream
 * opens, by the one fit check best fit also routes by (`../fit-check.ts`).
 * It is asked about the chosen lead, by the lead's own description, with two
 * more choices beside it: *none fits* and *the work doesn't say its sort*. It
 * refuses the open `lead-doesnt-fit` only on *none fits*.
 *
 * It is a backstop for clear misfits, not a router: a lead whose description
 * is broad is picked, and work that doesn't say what sort it is, such as a
 * bare name, can't be a clear misfit, so it passes. Picking the best lead
 * stays with whoever calls `listLeads`.
 *
 * A check that can't answer, or answers something that is no choice, lets the
 * open through, so a model outage never stops a workstream opening, and says
 * why in the open's record (`leadFit`), so a check that has stopped answering
 * shows up there rather than nowhere.
 */

import { handler, sequencer } from "@flow-state-dev/core";
import { z } from "zod";
import { defineFitCheck, fitOutcome } from "../fit-check";
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
 * and why (`already-open`, `no-description`, or `unanswered: <why>`). A
 * refused open has no record: it throws.
 */
export const leadFitRecordSchema = z.union([
  z.object({ checked: z.literal(true) }),
  z.object({ checked: z.literal(false), why: z.string() })
]);

/** @see leadFitRecordSchema */
export type LeadFitRecord = z.infer<typeof leadFitRecordSchema>;

export const leadFitStateSchema = z.object({ [LEAD_FIT_STATE]: leadFitRecordSchema.optional() });

/**
 * The fit check's block name on a lead vet. **Pinned**: a scripted model
 * resolves the evaluator by it, and its language-model ask by `<name>-ask`.
 */
const LEAD_FIT_CHECK = "workstream-lead-fit";

/**
 * The two choices beside the lead. **Pinned**: a scripted model answers them.
 * A worker id can't start with `~`, so neither is ever a lead's.
 */
const NONE_FITS = "~none-fits";
const SORT_UNSAID = "~sort-unsaid";

// A backstop for clear misfits, not a router: don't tighten it into picking the best lead.
const LEAD_FIT_QUESTION =
  "Does this worker fit the work below, as its lead? A lead never does the work itself: it hands the work to " +
  "the workers under it, so judge only what sort of work this is. Pick the worker when the work, such as a " +
  "feature, research or planning, is the sort its description says it leads or handles, or when its " +
  `description is broad. Pick ${NONE_FITS} only when its description says it handles a different sort of work. ` +
  `Pick ${SORT_UNSAID} when the work doesn't say what sort of work it is, such as a bare name or "the requested work".`;

/**
 * The lead vet: the one fit check, then its verdict, which refuses a clear
 * misfit and records the rest.
 *
 * @param model The model the check runs on.
 */
export function defineLeadFitCheck(model: string) {
  const fit = defineFitCheck({
    name: LEAD_FIT_CHECK,
    model,
    inputSchema: leadFitCaseSchema,
    question: LEAD_FIT_QUESTION,
    candidates: ({ lead, description }: LeadFitCase) => ({
      [lead]: description,
      [NONE_FITS]: "None fits: the worker's description says it handles a different sort of work than this.",
      [SORT_UNSAID]: "The work doesn't say what sort of work it is."
    }),
    state: ({ title, objectives }: LeadFitCase) => ({ work: { title, objectives } }),
    work: ({ title, objectives }: LeadFitCase) =>
      [`The work: ${title}`, ...objectives.map((objective) => `- ${objective}`)].join("\n")
  });

  const verdict = handler({
    name: "workstream-lead-fit-verdict",
    inputSchema: z.unknown(),
    outputSchema: z.object({}),
    requestStateSchema: leadFitStateSchema,
    execute: async (answer: unknown, ctx) => {
      const fitCase = leadFitCaseSchema.parse(ctx.parent?.input);
      const outcome = fitOutcome(answer);
      if ("failed" in outcome) {
        await ctx.request.patchState({ [LEAD_FIT_STATE]: { checked: false, why: `unanswered: ${outcome.failed}` } });
        return {};
      }
      if (outcome.choice === NONE_FITS) {
        throw new ProjectRefusedError(
          "lead-doesnt-fit",
          `Worker "${fitCase.lead}" doesn't do this work: its description says "${fitCase.description}". ` +
            "Pick a lead from listLeads whose description says it does this work. If none does, nobody on " +
            "the roster does it yet: open nothing, and say a worker for it has to be hired first."
        );
      }
      if (outcome.choice !== fitCase.lead && outcome.choice !== SORT_UNSAID) {
        await ctx.request.patchState({
          [LEAD_FIT_STATE]: { checked: false, why: `unanswered: answered ${JSON.stringify(outcome.choice)}, which is not a choice` }
        });
        return {};
      }
      await ctx.request.patchState({ [LEAD_FIT_STATE]: { checked: true } });
      return {};
    }
  });

  return sequencer({ name: "workstream-lead-fit-vet", inputSchema: leadFitCaseSchema }).step(fit).step(verdict);
}
