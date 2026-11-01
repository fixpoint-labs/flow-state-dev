/**
 * Who talked to whom (FIX-1989), from the user's message log.
 * A message makes no task row, so nothing here is on Tasks.
 *
 * A message that asks for a reply (FIX-2310) says where its answer is:
 * waiting, answered, or, when its sender waited (FIX-2318), answered after
 * the wait ended.
 */
import { useMemo } from "react";
import { EmptyState, Meta, ScreenTitle, SectionFailure } from "../components/ui";
import { workerLabel, type LoadedSnapshot } from "../lib/derive";
import { firstLine, exchangesOf, useMessages, type WorkerMessageRow } from "../lib/messages";
import { projectReaderOf } from "../lib/projects";
import { RouteLink } from "../components/RouteLink";
import { clockTime } from "../lib/shell";

function Side({ worker, sessionId, testId }: { worker: string; sessionId: string; testId: string }) {
  return (
    <RouteLink
      className="font-mono text-[11.5px] font-medium underline-offset-2 hover:underline"
      to={{ level: "session", sessionId }}
      data-testid={testId}
      data-session-id={sessionId}
      title={`Open ${workerLabel(worker)}'s session`}
    >
      {workerLabel(worker)}
    </RouteLink>
  );
}

function statusNote(row: WorkerMessageRow): string | null {
  if (row.status === "refused") return "not delivered";
  if (row.status === "undeliverable") return "couldn't be delivered";
  if (row.status === "unconfirmed") return "on its way";
  return null;
}

/** Where a reply request's answer is, or `null` for a plain message or one that ended undelivered. */
function replyNote(row: WorkerMessageRow): string | null {
  if (row.replyRequested !== true || row.status === "refused" || row.status === "undeliverable") return null;
  if (row.answeredBy === undefined) return row.queuedBehind === "user" ? "reply · waiting on the user" : "reply · waiting";
  return row.waitEndedAt !== undefined ? "reply · answered late" : "reply · answered";
}

function MessageLine({ row }: { row: WorkerMessageRow }) {
  const note = statusNote(row);
  const reply = replyNote(row);
  return (
    <li
      className="grid grid-cols-[max-content_max-content_1fr] items-baseline gap-x-3 py-1.5"
      data-testid="message"
      data-message-id={row.id}
      data-from={row.from}
      data-to={row.to}
      data-status={row.status}
    >
      <Meta className="text-muted-foreground" testId="message-when">
        {clockTime(row.at)}
      </Meta>
      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <Side worker={row.from} sessionId={row.fromSession} testId="message-from" />
        <span className="text-muted-foreground" aria-hidden>
          →
        </span>
        <Side worker={row.to} sessionId={row.toSession} testId="message-to" />
      </span>
      <span className="min-w-0 truncate text-sm" data-testid="message-text" title={row.text}>
        {firstLine(row.text)}
        {reply === null ? null : (
          <Meta className="ml-2 text-muted-foreground" testId="message-reply-state">
            {reply}
          </Meta>
        )}
        {note === null ? null : (
          <Meta className="ml-2 text-destructive" testId="message-status">
            {note}
          </Meta>
        )}
      </span>
    </li>
  );
}

export function Messages({ snapshot }: { snapshot: LoadedSnapshot }) {
  const reader = projectReaderOf(snapshot.sessions);
  const { rows, failure, reread } = useMessages(reader, snapshot.readAt);
  const exchanges = useMemo(() => (rows === undefined ? [] : exchangesOf(rows)), [rows]);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="messages">
      <header className="border-b border-foreground/20 px-[22px] py-3.5" data-testid="messages-header">
        <ScreenTitle>Messages</ScreenTitle>
        <Meta role="control" className="mt-1 block text-muted-foreground" testId="messages-summary">
          {rows === undefined ? "Reading…" : `${rows.length} ${rows.length === 1 ? "message" : "messages"} between your workers, newest first`}
        </Meta>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-3">
        {failure !== undefined ? (
          <SectionFailure what="Messages" failure={failure} onRetry={reread} testId="messages-failure" />
        ) : reader === null ? (
          <EmptyState title="No messages" testId="messages-empty">
            This Lab keeps no roster for you, so your workers have no one to message.
          </EmptyState>
        ) : rows === undefined ? (
          <p className="text-sm text-muted-foreground" data-testid="messages-reading">
            Reading messages…
          </p>
        ) : exchanges.length === 0 ? (
          <EmptyState title="No messages yet" testId="messages-empty">
            When one of your workers messages another, it shows here.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-3" data-testid="message-exchanges">
            {exchanges.map((exchange) => (
              <li key={exchange.id} className="border-l-2 border-foreground/20 pl-3" data-testid="message-exchange" data-exchange-id={exchange.id}>
                <ol>
                  {exchange.messages.map((row) => (
                    <MessageLine key={row.id} row={row} />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
