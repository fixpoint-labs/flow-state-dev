/**
 * A workstream's transcript: its channel's `channel-post` lines, read a page
 * at a time, followed live over one session stream, and posted to through the
 * channel's own `post` action.
 *
 * Nothing here draws a line the channel has not kept. A post resolves when its
 * request has finished; the line itself reaches the screen only from a read of
 * the session or its stream (BR-19).
 */
import { compareItemOrder } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { CHANNEL_POST_COMPONENT, type ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import type { LabClients } from "./connection";
import { describeFailure } from "./reads";

/** Lines per page. */
export const TRANSCRIPT_PAGE = 50;

/** One page of the transcript, oldest first. */
export type TranscriptPage = {
  lines: ChannelTranscriptLine[];
  /** The item offset this page starts at; `0` means there is nothing older. */
  offset: number;
  /** Where a stream that follows this read starts. */
  at?: number;
  sessionCreatedAt?: number;
};

/** The line inside a `channel-post` component item, or `undefined`. */
export function lineOf(item: OutputItem): ChannelTranscriptLine | undefined {
  const component = item as { type: string; component?: string; data?: unknown };
  if (component.type !== "component" || component.component !== CHANNEL_POST_COMPONENT) return undefined;
  const data = component.data as Partial<ChannelTranscriptLine> | undefined;
  return typeof data?.id === "string" && typeof data.body === "string" ? (data as ChannelTranscriptLine) : undefined;
}

/** Who a line names: its author claim, else the server's principal. */
export function lineLabel(line: Pick<ChannelTranscriptLine, "author" | "principal">): string {
  return line.author ?? line.principal ?? "unattributed";
}

/** Merge lines, each id once, oldest first. */
export function mergeLines(...groups: ReadonlyArray<readonly ChannelTranscriptLine[]>): ChannelTranscriptLine[] {
  const byId = new Map<string, ChannelTranscriptLine>();
  for (const line of groups.flat()) if (!byId.has(line.id)) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

async function readAt(clients: LabClients, channelId: string, offset: number, limit: number) {
  const state = await clients.sessions.getSessionState(channelId, {
    includeItems: true,
    itemTypes: ["component"],
    offset,
    limit,
  });
  const items = [...(state.items ?? [])].sort(compareItemOrder);
  return { state, lines: items.flatMap((item) => lineOf(item) ?? []) };
}

/**
 * The newest page, or the page before `before` (an offset a page returned).
 * The newest page costs a second read only when the transcript is longer than
 * one page, to learn where it ends.
 */
export async function readTranscriptPage(clients: LabClients, channelId: string, before?: number): Promise<TranscriptPage> {
  if (before !== undefined) {
    const offset = Math.max(0, before - TRANSCRIPT_PAGE);
    const { lines } = await readAt(clients, channelId, offset, before - offset);
    return { lines, offset };
  }
  const first = await readAt(clients, channelId, 0, TRANSCRIPT_PAGE);
  const total = first.state.pagination?.total ?? 0;
  if (total <= TRANSCRIPT_PAGE) {
    return { lines: first.lines, offset: 0, at: first.state.at, sessionCreatedAt: first.state.sessionCreatedAt };
  }
  const offset = total - TRANSCRIPT_PAGE;
  const last = await readAt(clients, channelId, offset, TRANSCRIPT_PAGE);
  return { lines: last.lines, offset, at: last.state.at, sessionCreatedAt: last.state.sessionCreatedAt };
}

/**
 * Post a line through the channel's own `post` action and wait for the request
 * to settle. Resolves when the channel kept the line; rejects, with the Lab's
 * own words where it gave any, when it did not.
 */
export async function postLine(
  clients: LabClients,
  channel: { id: string; kind: string },
  body: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const actions = clients.actions(channel.kind);
  let requestId: string;
  try {
    requestId = (await actions.sendAction("post", { body }, { sessionId: channel.id })).request.id;
  } catch (error) {
    throw new Error(describeFailure(error).message);
  }
  const until = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const status = await actions.getRequestStatus(requestId);
    if (status.status === "completed") return;
    if (status.status !== "in_progress") {
      throw new Error(`The channel did not keep the line: the post ended ${status.status}.`);
    }
    if (Date.now() > until) throw new Error("The channel did not confirm the line in time; it may not have been kept.");
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250));
  }
}
