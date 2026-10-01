/**
 * Control `optimistic-post`: a composer that draws the line itself.
 *
 * Built into the control page in place of `src/lib/transcript.ts`. `postLine`
 * sends nothing and keeps the line in this page's memory, and the newest page
 * of every transcript read is merged with those lines, so the screen shows the
 * post as though the channel had kept it. The goal must fail at "the post is
 * in the stored transcript".
 */
import type { ChannelTranscriptLine } from "@flow-state-dev/workforce/browser";
import {
  mergeLines,
  readTranscriptPage as readAsWritten,
  type TranscriptPage,
} from "../../../../labs/shift-manager/src/lib/transcript.ts";

export * from "../../../../labs/shift-manager/src/lib/transcript.ts";

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
