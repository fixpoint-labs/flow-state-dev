/**
 * Thinking-style identifiers — the discrete pattern-dispatch labels produced
 * by intent classification (FIX-421) and consumed by router blocks that pick
 * an execution pipeline per turn.
 *
 * These live in core (not in a downstream app) because both `IntentResult`
 * (`./skill`) and the kitchen-sink chat-agent flow refer to the same value
 * space, and threading the schema through every consumer is more friction
 * than the small surface bump from owning it here.
 *
 * The literal set is intentionally narrow — adding a new style means adding
 * a corresponding pipeline somewhere downstream, so churn is low.
 */

import { z } from "zod";

/** All recognized thinking-style identifiers, in declaration order. */
export const thinkingStyleValues = [
  "plan-and-execute",
  "supervisor",
  "blackboard",
  "reactive-blackboard",
  "default",
] as const;

/**
 * Zod schema covering the full set of thinking-style identifiers. Use this
 * as the `outputSchema` for any block whose contract is "produces a
 * resolved thinking style".
 */
export const thinkingStyleSchema = z.enum(thinkingStyleValues);

/** TypeScript type for a resolved thinking style. */
export type ThinkingStyle = z.infer<typeof thinkingStyleSchema>;
