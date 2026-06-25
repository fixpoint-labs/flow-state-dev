/**
 * Durable non-binary human-in-the-loop demos.
 *
 * Where `approval-gate.ts` showcases the binary approve/reject pause, these
 * actions showcase the richer resolution shapes a durable flow can pause for:
 *
 *   askQuestion   — a clarifying question. Suspends for a free-text answer and
 *                   threads the typed string back into the run.
 *   collectForm   — a small structured form (a flat object of a free-text field,
 *                   a single-choice enum, and a checkbox). The submitted payload
 *                   is validated against the schema before it re-enters the run.
 *                   The step is optional: a skip returns the SUSPENSION_SKIPPED
 *                   sentinel and the run continues with a default.
 *   chooseOption  — a single-choice selection from a fixed set.
 *
 * Each is a one-step durable sequencer so the suspend → submit/skip → continue
 * lifecycle is easy to drive from `fsdev run` or the DevTool. The default UI
 * renders each shape automatically (question box / form / radios) by reason and
 * resumeSchema shape; no custom renderer is needed for these flat schemas.
 */
import { handler, sequencer, SUSPENSION_SKIPPED } from "@flow-state-dev/core";
import { z } from "zod";

// ---------------------------------------------------------------------------
// askQuestion — clarifying question (free-text answer)
// ---------------------------------------------------------------------------

const askQuestionInput = z.object({ question: z.string().min(1) });

const askQuestionStep = handler({
  name: "ask-question",
  inputSchema: askQuestionInput,
  outputSchema: z.object({ answer: z.string() }),
  execute: async (input, ctx) => {
    // The `message` IS the question — it renders once as the card heading. Don't
    // emit a separate "we're about to ask…" line or wrap the question in a
    // meta-question; that just restates it. A single-string resumeSchema renders
    // a free-text box; the default `allow` for `human_input` is `["submit"]`.
    const answer = (await ctx.suspend!({
      reason: "human_input",
      message: input.question,
      resumeSchema: z.string().min(1),
    })) as string;
    ctx.emit.message(`Got it: ${answer}`);
    return { answer };
  },
});

export const askQuestionInputSchema = askQuestionInput;
export const askQuestion = sequencer({
  name: "ask-question-seq",
  inputSchema: askQuestionInput,
  durable: true,
}).step(askQuestionStep);

// ---------------------------------------------------------------------------
// collectForm — flat form, optional (skippable)
// ---------------------------------------------------------------------------

const collectFormInput = z.object({ subject: z.string().min(1) });

/**
 * A flat object: a free-text field, a single-choice enum, and a checkbox.
 * Each field uses `.describe()` so the rendered form shows context under the
 * label — the human can answer without scrolling back through the conversation.
 */
const feedbackSchema = z.object({
  comments: z
    .string()
    .describe("A sentence or two on what you observed. Shared with the reviewer verbatim."),
  priority: z
    .enum(["low", "medium", "high"])
    .describe("High is handled now; medium next business day; low is best-effort."),
  urgent: z
    .boolean()
    .describe("Check only if end users are currently affected — this escalates past the queue."),
});

const collectFormStep = handler({
  name: "collect-form",
  inputSchema: collectFormInput,
  outputSchema: z.object({
    skipped: z.boolean(),
    feedback: feedbackSchema.nullable(),
  }),
  execute: async (input, ctx) => {
    // `allow: ["submit", "skip"]` makes the step optional. On skip,
    // `ctx.suspend()` returns the SUSPENSION_SKIPPED sentinel instead of a
    // payload, so the run continues with a default rather than aborting.
    const result = await ctx.suspend!({
      reason: "human_input",
      message: `Share feedback on "${input.subject}" (optional)`,
      resumeSchema: feedbackSchema,
      allow: ["submit", "skip"],
    });
    if (result === SUSPENSION_SKIPPED) {
      ctx.emit.message("Feedback skipped — continuing with defaults.");
      return { skipped: true, feedback: null };
    }
    const feedback = result as z.infer<typeof feedbackSchema>;
    ctx.emit.message(`Thanks — priority noted as "${feedback.priority}".`);
    return { skipped: false, feedback };
  },
});

export const collectFormInputSchema = collectFormInput;
export const collectForm = sequencer({
  name: "collect-form-seq",
  inputSchema: collectFormInput,
  durable: true,
}).step(collectFormStep);

// ---------------------------------------------------------------------------
// chooseOption — single-choice selection
// ---------------------------------------------------------------------------

const chooseOptionInput = z.object({ question: z.string().min(1) });

const chooseOptionStep = handler({
  name: "choose-option",
  inputSchema: chooseOptionInput,
  outputSchema: z.object({ choice: z.string() }),
  execute: async (input, ctx) => {
    // A top-level enum renders as a single-choice selection card.
    const choice = (await ctx.suspend!({
      reason: "human_input",
      message: input.question,
      resumeSchema: z.enum(["yes", "no", "not sure"]),
    })) as string;
    ctx.emit.message(`Selected: ${choice}`);
    return { choice };
  },
});

export const chooseOptionInputSchema = chooseOptionInput;
export const chooseOption = sequencer({
  name: "choose-option-seq",
  inputSchema: chooseOptionInput,
  durable: true,
}).step(chooseOptionStep);
