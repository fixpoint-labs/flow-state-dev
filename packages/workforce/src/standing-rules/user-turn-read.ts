/**
 * The reads of the user's-turn mark `markUserTurn` sets: whether this
 * request is a turn a user's own message started, and what that message said.
 *
 * A leaf: it imports nothing from the board, so a module the board reaches
 * (the filing's link stamp) can read the mark without an import cycle back
 * through `user-turn.ts`, whose marking reaches the board.
 */
import type { BlockContext } from "@flow-state-dev/core/types";

/** The request-state field the mark is kept in. */
export const USER_TURN_STATE = "workforceUserTurn";

/** Whether this request is a turn a user's own message started. */
export function isUserTurn(ctx: BlockContext): boolean {
  return ctx.request.state[USER_TURN_STATE] === true;
}

/**
 * The text of the message the user typed to start this request, or
 * `undefined` when no user's message started it. Read it only on a turn
 * {@link isUserTurn} marks: a delivered message lands as a user-role message
 * too, and only the mark tells the two apart.
 */
export function typedMessageOf(ctx: BlockContext): string | undefined {
  const item = ctx.session.items
    .all()
    .find((candidate) => candidate.type === "message" && candidate.role === "user" && candidate.requestId === ctx.request.identity.id);
  // Recorded as the text itself, or as a message whose content is text or text parts.
  const payload = item?.payload;
  const content = typeof payload === "string" ? payload : (payload as { content?: unknown } | undefined)?.content;
  const parts = typeof content === "string" ? [content] : Array.isArray(content) ? content.map((part) => (part as { text?: unknown }).text) : [];
  const text = parts.filter((part): part is string => typeof part === "string").join("\n");
  return text.trim() === "" ? undefined : text;
}
