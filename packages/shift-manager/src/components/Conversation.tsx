/**
 * A conversation with a seat, as one component any view can draw: the seat's
 * session as a feed, and a composer under it that sends into that session.
 *
 *     <Conversation seat={seat} sessions={snapshot.sessions} gaps={gaps} name="Shift Coordinator" />
 *
 * That is the whole of it: the read, the feed (the registry's renderers, with
 * tool calls as quiet lines), following the latest turn, the working line, the
 * composer, and the one send path. A view varies it by props, never by a fork:
 * the name over the seat's messages, the text for an empty conversation, what
 * sits above the feed (`lead`), a line to hand in (`autoSend`), suggestions,
 * the composer's `scale`, and `renderItem` to draw an item its own way (read
 * the session's other items with `useSessionItems()`).
 *
 * {@link ConversationFrame} is the scrolling column with the composer pinned
 * under it. It is exported for a screen that shows a named state in the same
 * column; split the feed or the composer out when a second view needs them apart.
 */
import { useMemo, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { SessionSummary } from "@flow-state-dev/client";
import { buildItemRenderStream, FlowProvider, ItemRenderer } from "@flow-state-dev/react";
import type { Gaps } from "../gaps";
import { SessionItemsProvider } from "./flow-state/session-items-context";
import { shiftManagerRenderers, ToolLineGroup } from "./ToolLine";
import { SectionFailure } from "./ui";
import { TurnComposer } from "./TurnComposer";
import { openConversation, useSeatConversation } from "../lib/conversation";
import { useFollowLatest } from "../lib/follow";
import { useLab } from "../lib/lab-data";
import type { Seat } from "../lib/reads";
import { sendTurn } from "../lib/send";
import { clockTime } from "../lib/shell";

/** v2's scrolling column (v2:122-180): padded 36/32, `max-w-[720px]`, with the composer pinned under it. */
export function ConversationFrame({
  children,
  composer,
  feed,
  testId = "conversation",
}: {
  children: ReactNode;
  composer?: ReactNode;
  /** The ref that makes the column follow the latest turn ({@link useFollowLatest}). */
  feed?: (node: HTMLElement | null) => void;
  /** Prefix for the frame's test ids: `cos` gives `cos` and `cos-feed`. */
  testId?: string;
}) {
  return (
    <div className="flex h-full flex-col" data-testid={testId}>
      <div ref={feed} className="min-h-0 flex-1 overflow-y-auto px-8 pt-9 pb-3" data-testid={`${testId}-feed`} data-look="conversation-feed">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6" data-look="conversation-column">
          {children}
        </div>
      </div>
      {composer === undefined ? null : (
        <div className="px-8 pt-2.5 pb-[22px]">
          <div className="mx-auto w-full max-w-[720px]">{composer}</div>
        </div>
      )}
    </div>
  );
}

/** A conversation with `seat`: the feed and the composer under it. See the file's header. */
export function Conversation({
  seat,
  sessions,
  gaps,
  name,
  lead,
  emptyText,
  working = false,
  startWork,
  suggestions,
  autoSend,
  onAutoSend,
  renderItem,
  scale = "default",
  testId = "conversation",
}: {
  seat: Seat;
  sessions: readonly SessionSummary[];
  gaps: Gaps;
  /** What the shell calls the seat: over its messages, and in the composer. */
  name: string;
  /** Drawn above the feed, in the same scrolling column. */
  lead?: ReactNode;
  /** Shown before a first line. */
  emptyText?: string;
  /** A line from this page is in flight: say the seat has it. */
  working?: boolean;
  /** Called as a line goes out; returns the call that says it settled. */
  startWork?: () => () => void;
  suggestions?: readonly string[];
  /** A line handed in from elsewhere (the palette): sent as if typed, once the composer isn't blocked. */
  autoSend?: string | null;
  onAutoSend?: () => void;
  /** Draw an item its own way; return `undefined` to leave it to the registry. */
  renderItem?: (item: OutputItem) => ReactNode | undefined;
  /** The composer's size: `cos` is the larger one the Shift Coordinator's screen uses. */
  scale?: "default" | "cos";
  /** Prefix for every test id inside: `cos` gives `cos`, `cos-conversation`, `cos-item`. */
  testId?: string;
}) {
  const { clients, refresh } = useLab();
  const conversation = useSeatConversation(seat, sessions);
  // The feed opens where it starts, and follows once the person reaches the end or sends a line.
  const feed = useFollowLatest({ startAtEnd: false });
  const { sessionId, opened, read, failure, reread } = conversation;

  // A run of tool calls stays one segment: the feed draws it as one quiet line.
  const shown = useMemo(() => (read === undefined ? [] : buildItemRenderStream(read.items, shiftManagerRenderers)), [read]);

  // Nothing is sent into a conversation the screen hasn't read, or to a seat with no door.
  const blocked =
    seat.door === null || seat.kind === null
      ? `${seat.id} ${gaps.turn.noDoor}`
      : failure !== undefined
        ? "The conversation didn't load, so nothing can be sent until it does."
        : sessionId !== null && sessionId !== opened && read === undefined
          ? "Reading the conversation first…"
          : null;

  const composer = (
    <TurnComposer
      testId={`${testId}-composer`}
      scale={scale}
      label={`Message ${name}`}
      placeholder={`Message ${name}…`}
      blocked={blocked}
      suggestions={suggestions}
      autoSend={autoSend}
      onAutoSend={onAutoSend}
      send={async (message, held) => {
        const target = conversation.target();
        const settled = startWork?.();
        feed.follow();
        try {
          // A first line opens its session naming the seat's worker before the door's request runs in it.
          if (sessionId === null) await openConversation(clients, { id: seat.id, kind: seat.kind! }, target);
          const sent = await sendTurn(clients, { sessionId: target, flowId: seat.kind!, door: seat.door! }, message, {
            onHeld: () => {
              // The session holds the line: read it back now, so it is drawn while the reply is in flight.
              conversation.open(target);
              reread();
              held();
            },
          });
          // `sendTurn` can resolve without calling `onHeld`, so the session is opened here too.
          conversation.open(target);
          return sent;
        } finally {
          // Read the Lab again however it ended. Stopped short, it may have raised an ask Inbox
          // should list; finished, it may have changed the organization, such as a project it
          // created; failed, the Lab may have opened the session anyway, and the listing says so.
          void refresh();
          settled?.();
          reread();
        }
      }}
    />
  );

  return (
    <ConversationFrame testId={testId} feed={feed.ref} composer={composer}>
      {lead}
      <section
        aria-label={`Conversation with ${name}`}
        className="flex flex-col gap-6"
        data-testid={`${testId}-conversation`}
        data-seat-id={seat.id}
        data-session-id={sessionId ?? ""}
      >
        {failure !== undefined ? (
          <SectionFailure what="The conversation" failure={failure} onRetry={reread} testId={`${testId}-conversation-failure`} />
        ) : sessionId === null ? (
          <p className="text-sm text-muted-foreground" data-testid={`${testId}-conversation-empty`}>
            {emptyText ?? `You haven't talked with ${name} yet. Your first line starts the conversation.`}
          </p>
        ) : read === undefined ? (
          <p className="text-sm text-muted-foreground" data-testid={`${testId}-conversation-reading`}>
            Reading the conversation…
          </p>
        ) : (
          <FlowProvider renderers={shiftManagerRenderers}>
            <SessionItemsProvider value={read.items}>
              {read.truncated ? (
                <p className="text-xs text-muted-foreground" data-testid={`${testId}-truncated`}>
                  More than shown: this conversation holds more than one read returns.
                </p>
              ) : null}
              <ol className="flex flex-col gap-2.5" data-testid={`${testId}-items`}>
                {shown.map((segment) => {
                  if (segment.kind === "group") {
                    const first = segment.items[0]!;
                    return (
                      <li
                        key={`${first.requestId}/${first.id}`}
                        data-testid={`${testId}-item`}
                        data-item-id={first.id}
                        data-request-id={first.requestId}
                        data-item-type="tool_output"
                        data-role=""
                      >
                        <ToolLineGroup items={segment.items} />
                      </li>
                    );
                  }
                  const item = segment.item;
                  const role = (item as { role?: string }).role ?? "";
                  const own = renderItem?.(item);
                  return (
                    <li
                      key={`${item.requestId}/${item.id}`}
                      data-testid={`${testId}-item`}
                      data-item-id={item.id}
                      data-request-id={item.requestId}
                      data-item-type={item.type}
                      data-role={role}
                    >
                      {item.type === "message" && role === "assistant" ? (
                        // v2's label over each of the seat's messages: its name and the time it was written (v2:135).
                        <p className="mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground" data-look="message-label">
                          {name.toUpperCase()}
                          <span className="tracking-normal" data-look="message-time">
                            {clockTime(item.ts)}
                          </span>
                        </p>
                      ) : null}
                      {own !== undefined ? (
                        own
                      ) : (
                        <div data-look="registry-item">
                          <ItemRenderer item={item} />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ol>
            </SessionItemsProvider>
          </FlowProvider>
        )}
        {working ? (
          // v2's thinking line (v2:167-169), saying only what is true: the seat has the line.
          <p className="flex items-center gap-2 font-mono text-[11.5px] font-medium text-muted-foreground" data-testid={`${testId}-working`}>
            <span className="size-[7px] shrink-0 bg-info" data-look="working" aria-hidden />
            {name} is working on it…
          </p>
        ) : null}
      </section>
    </ConversationFrame>
  );
}
