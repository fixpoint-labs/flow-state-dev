/**
 * Control `optimistic-post`: a workstream composer that draws its line itself
 * and sends nothing.
 *
 * Built into the control page in place of both modules the workstream
 * composer sends through: `src/lib/transcript.ts` (a plain line, posted to the
 * channel) and `src/lib/send.ts` (an `@worker` line, sent through the seat's
 * door). One module stands in for both, so the control removes the
 * composer's send whichever way a line goes.
 *
 * - `postLine` sends nothing and keeps the line in this page's memory, and the
 *   newest page of every transcript read is merged with those lines, so the
 *   screen shows the post as though the channel had kept it. The goal must
 *   fail at "the post is in the stored transcript".
 * - `sendTurn` resolves at once and sends nothing, so an `@worker` line reads
 *   delivered while no session holds it. `send.ts` is the one send path, so
 *   the task composer, Inbox's reply and Chief of Staff read delivered the
 *   same way; none of this goal's legs sends through them.
 */
import type { ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import {
  mergeLines,
  readTranscriptPage as readAsWritten,
  type TranscriptPage,
} from "../../../../labs/shift-manager/src/lib/transcript.ts";

export * from "../../../../labs/shift-manager/src/lib/transcript.ts";
export { TurnNotDelivered, type TurnTarget } from "../../../../labs/shift-manager/src/lib/send.ts";

const drawn = new Map<string, ChannelTranscriptLine[]>();

/** Keep the line locally; the Lab is never asked. */
export async function postLine(_clients: unknown, channel: { id: string; kind: string }, body: string): Promise<void> {
  const lines = drawn.get(channel.id) ?? [];
  lines.push({ id: `local-${lines.length}`, body, at: Date.now(), author: "you" } as ChannelTranscriptLine);
  drawn.set(channel.id, lines);
}

/** The real read, with this page's own lines added to the newest page. */
export async function readTranscriptPage(
  clients: Parameters<typeof readAsWritten>[0],
  channelId: string,
  before?: number,
): Promise<TranscriptPage> {
  const page = await readAsWritten(clients, channelId, before);
  return before === undefined ? { ...page, lines: mergeLines(page.lines, drawn.get(channelId) ?? []) } : page;
}

/** Read the line as delivered; the seat's door is never called. */
export async function sendTurn(): Promise<{ requestId: string }> {
  return { requestId: "never-sent" };
}
