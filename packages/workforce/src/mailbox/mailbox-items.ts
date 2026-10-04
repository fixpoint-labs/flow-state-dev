/**
 * The items a mailbox keeps on its session, written and read back: each post's
 * line (`mailbox-post`) and each route's record (`mailbox-route`).
 *
 * A leaf beside `mailbox-post-line.ts` and `mailbox-route.ts`, so the mailbox
 * flow and `routeByPurpose` both reach the items without the route importing
 * the flow for them. Both writes use the awaited emitter and fail when the
 * write does: a line, or a record, that nothing can confirm was kept is a
 * failure, never a fall back to the fire-and-forget emitter.
 *
 * The read sees the request's history window only (50 requests by default),
 * so on a busy mailbox it returns the recent lines. The route reads its own
 * ledger instead (`mailbox-route.ts`).
 */

import type { BlockContext } from "@flow-state-dev/core/types";
import type { z } from "zod";
import { MAILBOX_POST_COMPONENT } from "./mailbox-post-line";
import { MAILBOX_ROUTE_COMPONENT, type MailboxRouteRecord } from "./mailbox-route";

/**
 * Keep a post's line as its `mailbox-post` item, and resolve only once the
 * item is stored.
 *
 * The item is the only copy of the line, so this uses the awaited emitter and
 * rejects when the write does. `ctx.emit.component` drops its write's outcome,
 * which would let a post hand back a line no read will ever show. A context
 * without the awaited emitter cannot confirm the line was kept, so that is a
 * failure too, never a fall back to the fire-and-forget emitter.
 *
 * @param ctx The post's block context.
 * @param line The line, exactly as `read` and a page should see it.
 */
export async function emitMailboxPostLine(ctx: BlockContext, line: Record<string, unknown>): Promise<void> {
  const emit = ctx._emitComponentAwaited;
  if (emit === undefined) {
    throw new Error("mailbox post: this context cannot confirm a line was kept, so it posts nothing");
  }
  await emit.call(ctx, MAILBOX_POST_COMPONENT, line);
}

/**
 * Keep a route's record on the mailbox's session, resolving once it is stored,
 * by {@link emitMailboxPostLine}'s rule: the next post's route reads it back,
 * so a record nobody can confirm was kept is a failure. Not re-exported from
 * the package root.
 */
export async function emitMailboxRouteRecord(ctx: BlockContext, record: MailboxRouteRecord): Promise<void> {
  const emit = ctx._emitComponentAwaited;
  if (emit === undefined) {
    throw new Error("mailbox route: this context cannot confirm the route was recorded, so it routes nobody");
  }
  await emit.call(ctx, MAILBOX_ROUTE_COMPONENT, record);
}

/**
 * The posted lines inside this request's history window, oldest first.
 *
 * Inside a block every item arrives wrapped, so the component name and its
 * data sit under `payload`. A malformed `mailbox-post` item is skipped rather
 * than failing the read: the transcript is what parses as a line.
 *
 * @param ctx The reading block's context.
 * @param schema The line schema of the kind reading them.
 * @returns Each `mailbox-post` item's data that parses under `schema`.
 */
export function readMailboxPostLines<T>(ctx: BlockContext, schema: z.ZodType<T>): T[] {
  return ctx.session.items.all({ itemTypes: ["component"] }).flatMap((item) => {
    const payload = item.payload as { component?: unknown; data?: unknown } | undefined;
    if (payload?.component !== MAILBOX_POST_COMPONENT) return [];
    const line = schema.safeParse(payload.data);
    return line.success ? [line.data] : [];
  });
}

