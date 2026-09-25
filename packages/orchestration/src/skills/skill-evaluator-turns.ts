/**
 * The earlier turns `skillEvaluator(model, { recentMessages })` asks for, and
 * how the evaluator tier reads them.
 *
 * The helper records how many turns its block wants; the tier looks that up
 * and, only when the evaluator is about to run, reads the turns from the
 * session. Both sides import this module, which holds no core evaluator
 * values, so the tier still reaches the helper module by type only.
 *
 * A turn is one completed earlier request: the user's message and every user
 * or assistant message it kept in history. Only what was said is read: tool
 * calls, tool results and reasoning are left out, and the request running now
 * is excluded (its message is handed over separately).
 */

import { z } from "zod";
import type { SessionItemViews } from "@flow-state-dev/core/types";

/** One message of an earlier turn, as the evaluator reads it. */
export type RecentMessage = {
  role: "user" | "assistant";
  text: string;
};

/** Runtime schema for {@link RecentMessage}. */
export const recentMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
});

const askedTurns = new WeakMap<object, number>();

/** Record that `block` wants the last `turns` earlier turns. */
export function rememberRecentTurns(block: object, turns: number): void {
  askedTurns.set(block, turns);
}

/**
 * How many earlier turns `block` asked for: `0` for a block not built by
 * `skillEvaluator(model, { recentMessages })`, which is handed none.
 */
export function recentTurnsFor(block: object): number {
  return askedTurns.get(block) ?? 0;
}

/**
 * Read the messages of up to the last `turns` completed earlier turns, oldest
 * first, through the session's history view: the same visibility, transient
 * filter and history window the generator's history applies.
 */
export async function readRecentMessages(
  ctx: { session: { items: Pick<SessionItemViews, "history"> } },
  turns: number,
): Promise<RecentMessage[]> {
  const messages = await ctx.session.items.history({
    includeInFlight: false,
    limit: turns,
    itemTypes: ["message"],
    roles: ["user", "assistant"],
  });
  const out: RecentMessage[] = [];
  for (const m of messages) {
    if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string") {
      out.push({ role: m.role, text: m.content });
    }
  }
  return out;
}
