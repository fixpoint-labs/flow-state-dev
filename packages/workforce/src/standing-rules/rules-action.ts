/**
 * The rules action (FIX-1945 S5): how a page reads and edits a worker's
 * standing rules for the signed-in user, on the worker's own flow.
 *
 * Declared on the `agent` and `coordinator` flows and run in the user's own
 * session with that worker, because the record's storage belongs to the
 * worker's flow copy: the roster flow can't open it. The worker is the one the
 * session was verified to run as, and the user is the request's own; the
 * input names neither, and a key it doesn't declare is refused
 * (BP-031). Writes go through the same validator as the rule tools, and a
 * refusal fails the request with its reason, storing nothing.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { STANDING_RULES_ACTION } from "./keys";
import { numberedRules, type StandingRules } from "./rules-list";
import { STANDING_RULES_RESOURCE, readStandingRules, standingRulesCollection, writeStandingRules } from "./rules-record";

/** What the action takes: a read, or one write naming the version of the list it read. */
export const standingRulesActionInputSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("read") }).strict(),
  z.object({ op: z.literal("add"), version: z.number().int().min(0), text: z.string() }).strict(),
  z
    .object({
      op: z.literal("change"),
      version: z.number().int().min(0),
      number: z.number().int(),
      current: z.string(),
      text: z.string()
    })
    .strict(),
  z
    .object({ op: z.literal("remove"), version: z.number().int().min(0), number: z.number().int(), current: z.string() })
    .strict()
]);

export type StandingRulesActionInput = z.infer<typeof standingRulesActionInputSchema>;

/** What the action answers: the list as it stands after the call, and the line a write produced. */
export const standingRulesActionOutputSchema = z.object({
  version: z.number(),
  rules: z.array(
    z.object({ number: z.number(), text: z.string(), addedAt: z.number(), sessionId: z.string().nullable() })
  ),
  line: z.string().optional()
});

export type StandingRulesActionOutput = z.infer<typeof standingRulesActionOutputSchema>;

const answer = (list: StandingRules, line?: string): StandingRulesActionOutput => ({
  version: list.version,
  rules: numberedRules(list),
  ...(line === undefined ? {} : { line })
});

/** The action's block. */
export const standingRulesActionBlock = handler({
  name: "standing-rules-action",
  inputSchema: standingRulesActionInputSchema,
  outputSchema: standingRulesActionOutputSchema,
  resources: { [STANDING_RULES_RESOURCE]: standingRulesCollection },
  execute: async (input, ctx) => {
    if (input.op === "read") return answer(await readStandingRules(ctx as never));
    const { version, ...edit } = input;
    // Added here, not in a conversation: the page shows it as "added here".
    const outcome = await writeStandingRules(ctx as never, version, edit, null);
    if (!outcome.ok) throw new Error(`Refused: ${outcome.reason}.`);
    return answer(outcome.list, outcome.line);
  }
});

export { STANDING_RULES_ACTION };

/** The action, as a worker flow declares it. */
export const standingRulesAction = { inputSchema: standingRulesActionInputSchema, block: standingRulesActionBlock };
