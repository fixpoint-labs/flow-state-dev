/**
 * Best fit's ladder: where a post goes when one evaluator call picks who
 * answers it. Shared by the mailbox's route (`routeByPurpose`) and the
 * coordinator's `best-fit` policy, so a fix to the order reaches both.
 *
 * The order, and nothing else:
 *
 * 1. **Held.** The person's last post went to someone who hasn't answered
 *    since, and that someone can still be reached: this post goes there too,
 *    with no model call.
 * 2. **Evaluated.** The one call picked one of the options.
 * 3. **Fallback.** The call failed, or picked something that is not an option,
 *    or there was nothing to pick from: the fallback takes the post, when one
 *    is set and can be reached.
 * 4. **None.** Nobody takes it here. What happens next is the caller's: the
 *    mailbox records the route failed; the coordinator hands the post to its
 *    own judgment turn first.
 *
 * Each caller words its own reasons, so the ladder returns why a pick was not
 * used as a value ({@link BestFitMiss}), never a sentence.
 */
import { handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";

/** What a best-fit post is placed from. */
export interface BestFitCase {
  /** Who is still on the person's last post, when that one can be reached. */
  held?: string;
  /** Everyone this post can go to. The fallback and the holder must be among them to take it. */
  reachable: readonly string[];
  /** The evaluator's choices: each reachable candidate with something to pick it by. */
  options: Readonly<Record<string, string>>;
  /** Who takes a post the call can't place, when one is set. */
  fallback?: string;
}

/** Why the evaluator's pick was not used. */
export type BestFitMiss =
  /** Nobody can be reached. */
  | { readonly kind: "none-reachable" }
  /** Somebody can be reached, but nobody has anything to pick them by. */
  | { readonly kind: "none-described" }
  /** The call itself failed. */
  | { readonly kind: "evaluation-failed"; readonly message: string }
  /** The call answered with something that is not one of the options. */
  | { readonly kind: "not-an-option"; readonly choice: unknown };

/** Where the ladder put the post. */
export type BestFitPlacement =
  | { readonly by: "held"; readonly member: string }
  | { readonly by: "evaluated"; readonly member: string }
  | { readonly by: "fallback"; readonly member: string; readonly miss: BestFitMiss }
  | { readonly by: "none"; readonly miss: BestFitMiss; readonly fallbackUnreachable: boolean };

/** What a failed evaluator call leaves: the reason, as a value. */
export const failedEvaluationSchema = z.object({ failed: z.string() });

/** What an answered call leaves, as far as the ladder reads it: the `member` question's choice. */
const answeredEvaluationSchema = z.object({ answers: z.object({ member: z.object({ choice: z.unknown() }) }) });

/**
 * Whether the ladder needs the evaluator call at all: nothing is held, and
 * there is something to pick from.
 */
export function needsBestFitCall(bestFit: BestFitCase): boolean {
  return bestFit.held === undefined && Object.keys(bestFit.options).length > 0;
}

/**
 * What the evaluator step left, read one way: the call's own failure, or what
 * it chose for `member` (anything; {@link placeBestFit} checks it against the options).
 */
function evaluationOutcome(answer: unknown): { failed: string } | { choice: unknown } {
  const failed = failedEvaluationSchema.safeParse(answer);
  if (failed.success) return failed.data;
  const answered = answeredEvaluationSchema.safeParse(answer);
  return { choice: answered.success ? answered.data.answers.member.choice : undefined };
}

/**
 * Place a post on the ladder.
 *
 * @param bestFit Who can be reached, the options, the holder and the fallback.
 * @param answer What the evaluator step left: its answers, a {@link failedEvaluationSchema}
 *   value, or nothing when the call was skipped.
 */
export function placeBestFit(bestFit: BestFitCase, answer: unknown): BestFitPlacement {
  if (bestFit.held !== undefined) return { by: "held", member: bestFit.held };

  let miss: BestFitMiss;
  if (bestFit.reachable.length === 0) {
    miss = { kind: "none-reachable" };
  } else if (Object.keys(bestFit.options).length === 0) {
    miss = { kind: "none-described" };
  } else {
    const outcome = evaluationOutcome(answer);
    if ("failed" in outcome) {
      miss = { kind: "evaluation-failed", message: outcome.failed };
    } else if (typeof outcome.choice === "string" && Object.hasOwn(bestFit.options, outcome.choice)) {
      return { by: "evaluated", member: outcome.choice };
    } else {
      miss = { kind: "not-an-option", choice: outcome.choice };
    }
  }

  if (bestFit.fallback !== undefined && bestFit.reachable.includes(bestFit.fallback)) {
    return { by: "fallback", member: bestFit.fallback, miss };
  }
  return { by: "none", miss, fallbackUnreachable: bestFit.fallback !== undefined };
}

/**
 * The block that turns the evaluator call's own failure into a value the
 * ladder reads, for `evaluator.rescue([{ block }])`. Nothing else is caught:
 * a cancelled request is not a failed call, so its error goes on up.
 *
 * @param name The block's name, distinct per caller.
 */
export function bestFitEvaluationFailed(name: string): BlockDefinition<z.ZodUnknown, typeof failedEvaluationSchema> {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: failedEvaluationSchema,
    execute: (error: unknown, ctx) => {
      if (ctx.signal.aborted) throw error;
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  });
}
