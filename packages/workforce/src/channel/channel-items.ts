/**
 * The items a channel keeps on its session, written and read back: each post's
 * line (`channel-post`) and each route's record (`channel-route`).
 *
 * A leaf beside `channel-post-line.ts` and `channel-route.ts`, so the channel
 * flow and `routeByPurpose` both reach the items without the route importing
 * the flow for them. Both writes use the awaited emitter and fail when the
 * write does: a line, or a record, that nothing can confirm was kept is a
 * failure, never a fall back to the fire-and-forget emitter.
 *
 * The reads see the request's history window only (50 requests by default),
 * so on a busy channel they return the recent items.
 */

import type { BlockContext } from "@flow-state-dev/core/types";
import type { z } from "zod";
import { CHANNEL_POST_COMPONENT, channelTranscriptLineSchema, type ChannelTranscriptLine } from "./channel-post-line";
import { CHANNEL_ROUTE_COMPONENT, channelRouteRecordSchema, type ChannelRouteRecord } from "./channel-route";

/**
 * Keep a post's line as its `channel-post` item, and resolve only once the
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
export async function emitChannelPostLine(ctx: BlockContext, line: Record<string, unknown>): Promise<void> {
  const emit = ctx._emitComponentAwaited;
  if (emit === undefined) {
    throw new Error("channel post: this context cannot confirm a line was kept, so it posts nothing");
  }
  await emit.call(ctx, CHANNEL_POST_COMPONENT, line);
}

/**
 * Keep a route's record on the channel's session, resolving once it is stored,
 * by {@link emitChannelPostLine}'s rule: the next post's route reads it back,
 * so a record nobody can confirm was kept is a failure. Not re-exported from
 * the package root.
 */
export async function emitChannelRouteRecord(ctx: BlockContext, record: ChannelRouteRecord): Promise<void> {
  const emit = ctx._emitComponentAwaited;
  if (emit === undefined) {
    throw new Error("channel route: this context cannot confirm the route was recorded, so it routes nobody");
  }
  await emit.call(ctx, CHANNEL_ROUTE_COMPONENT, record);
}

/**
 * The posted lines inside this request's history window, oldest first.
 *
 * Inside a block every item arrives wrapped, so the component name and its
 * data sit under `payload`. A malformed `channel-post` item is skipped rather
 * than failing the read: the transcript is what parses as a line.
 *
 * @param ctx The reading block's context.
 * @param schema The line schema of the kind reading them.
 * @returns Each `channel-post` item's data that parses under `schema`.
 */
export function readChannelPostLines<T>(ctx: BlockContext, schema: z.ZodType<T>): T[] {
  const lines: T[] = [];
  for (const { component, data } of channelComponents(ctx)) {
    if (component !== CHANNEL_POST_COMPONENT) continue;
    const parsed = schema.safeParse(data);
    if (parsed.success) lines.push(parsed.data);
  }
  return lines;
}

/**
 * The posted lines and the route records inside this request's history window,
 * each oldest first, from one walk over the session's items. A malformed item
 * of either kind is skipped, as {@link readChannelPostLines} skips a line. Not
 * re-exported from the package root.
 *
 * @param ctx The route's block context, on the channel's session.
 */
export function readChannelHistory(ctx: BlockContext): {
  lines: ChannelTranscriptLine[];
  records: ChannelRouteRecord[];
} {
  const lines: ChannelTranscriptLine[] = [];
  const records: ChannelRouteRecord[] = [];
  for (const { component, data } of channelComponents(ctx)) {
    if (component === CHANNEL_POST_COMPONENT) {
      const line = channelTranscriptLineSchema.safeParse(data);
      if (line.success) lines.push(line.data);
    } else if (component === CHANNEL_ROUTE_COMPONENT) {
      const record = channelRouteRecordSchema.safeParse(data);
      if (record.success) records.push(record.data);
    }
  }
  return { lines, records };
}

/** Each component item on the session, unwrapped to its name and data, oldest first. */
function channelComponents(ctx: BlockContext): Array<{ component: unknown; data: unknown }> {
  return ctx.session.items.all({ itemTypes: ["component"] }).map((item) => {
    const payload = item.payload as { component?: unknown; data?: unknown } | undefined;
    return { component: payload?.component, data: payload?.data };
  });
}
