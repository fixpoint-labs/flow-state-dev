/**
 * A workstream's transcript: its mailbox's `mailbox-post` lines, read a page
 * at a time, followed live over one session stream, and posted to through the
 * mailbox's own `post` action.
 *
 * Nothing here draws a line the mailbox has not kept. A post resolves when its
 * request has finished; the line itself reaches the screen only from a read of
 * the session or its stream (BR-19).
 */
import { compareItemOrder } from "@flow-state-dev/client";
import type { OutputItem } from "@flow-state-dev/core/items";
import { MAILBOX_POST_COMPONENT, type MailboxTranscriptLine } from "@flow-state-dev/workforce/browser";
import type { LabClients } from "./connection";
import { describeFailure } from "./reads";

/** Lines per page. */
export const TRANSCRIPT_PAGE = 50;

/** One page of the transcript, oldest first. */
export type TranscriptPage = {
  lines: MailboxTranscriptLine[];
  /** The item offset this page starts at; `0` means there is nothing older. */
  offset: number;
  /** Where a stream that follows this read starts. */
  at?: number;
  sessionCreatedAt?: number;
};

/** The line inside a `mailbox-post` component item, or `undefined`. */
export function lineOf(item: OutputItem): MailboxTranscriptLine | undefined {
  const component = item as { type: string; component?: string; data?: unknown };
  if (component.type !== "component" || component.component !== MAILBOX_POST_COMPONENT) return undefined;
  const data = component.data as Partial<MailboxTranscriptLine> | undefined;
  return typeof data?.id === "string" && typeof data.body === "string" ? (data as MailboxTranscriptLine) : undefined;
}

/** Who a line names: its author claim, else the server's principal. */
export function lineLabel(line: Pick<MailboxTranscriptLine, "author" | "principal">): string {
  return line.author ?? line.principal ?? "unattributed";
}

/** Merge lines, each id once, oldest first. */
export function mergeLines(...groups: ReadonlyArray<readonly MailboxTranscriptLine[]>): MailboxTranscriptLine[] {
  const byId = new Map<string, MailboxTranscriptLine>();
  for (const line of groups.flat()) if (!byId.has(line.id)) byId.set(line.id, line);
  return [...byId.values()].sort((a, b) => a.at - b.at);
}

async function readAt(clients: LabClients, mailboxId: string, offset: number, limit: number) {
  const state = await clients.sessions.getSessionState(mailboxId, {
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
export async function readTranscriptPage(clients: LabClients, mailboxId: string, before?: number): Promise<TranscriptPage> {
  if (before !== undefined) {
    const offset = Math.max(0, before - TRANSCRIPT_PAGE);
    const { lines } = await readAt(clients, mailboxId, offset, before - offset);
    return { lines, offset };
  }
  const first = await readAt(clients, mailboxId, 0, TRANSCRIPT_PAGE);
  const total = first.state.pagination?.total ?? 0;
  if (total <= TRANSCRIPT_PAGE) {
    return { lines: first.lines, offset: 0, at: first.state.at, sessionCreatedAt: first.state.sessionCreatedAt };
  }
  const offset = total - TRANSCRIPT_PAGE;
  const last = await readAt(clients, mailboxId, offset, TRANSCRIPT_PAGE);
  return { lines: last.lines, offset, at: last.state.at, sessionCreatedAt: last.state.sessionCreatedAt };
}

/**
 * Post a line through the mailbox's own `post` action and wait for the request
 * to settle. Resolves when the mailbox kept the line; rejects, with the Lab's
 * own words where it gave any, when it did not.
 */
export async function postLine(
  clients: LabClients,
  mailbox: { id: string; kind: string },
  body: string,
  options: { timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const actions = clients.actions(mailbox.kind);
  let requestId: string;
  try {
    requestId = (await actions.sendAction("post", { body }, { sessionId: mailbox.id })).request.id;
  } catch (error) {
    throw new Error(describeFailure(error).message);
  }
  const until = Date.now() + (options.timeoutMs ?? 30_000);
  for (;;) {
    const status = await actions.getRequestStatus(requestId);
    if (status.status === "completed") return;
    if (status.status !== "in_progress") {
      throw new Error(`The mailbox did not keep the line: the post ended ${status.status}.`);
    }
    if (Date.now() > until) throw new Error("The mailbox did not confirm the line in time; it may not have been kept.");
    await new Promise((resolve) => setTimeout(resolve, options.pollMs ?? 250));
  }
}
