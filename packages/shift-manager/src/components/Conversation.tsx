/**
 * A conversation with a worker, as one component any view can draw: the worker's
 * session as a feed, and a composer under it that sends into that session.
 *
 *     <Conversation worker={worker} sessions={snapshot.sessions} gaps={gaps} name="Shift Coordinator" />
 *
 * That is the whole of it: the read, the feed (the registry's renderers, with
 * tool calls as quiet lines), the jump to the latest turn, the working line, the
 * composer, and the one send path. A view varies it by props, never by a fork:
 * the session it is (`session`, for one a view found itself: a project
 * coordinator's, a workstream's lead's; otherwise the user's conversation
 * with the worker, at its derived address), the name over the worker's messages, the text for an empty conversation, what
 * sits above the feed (`lead`), a line to hand in (`autoSend`), the
 * composer's `scale`, and `renderItem` to draw an item its own way (read
 * the session's other items with `useSessionItems()`).
 *
 * {@link ConversationFrame} is the scrolling column with the composer pinned
 * under it. It is exported for a screen that shows a named state in the same
 * column; split the feed or the composer out when a second view needs them apart.
 */
import { useEffect, useMemo, type ReactNode } from "react";
import type { OutputItem } from "@flow-state-dev/core/items";
import { RECEIVED_MESSAGE_COMPONENT } from "@flow-state-dev/workforce/browser";
import type { SessionSummary } from "@flow-state-dev/client";
import { buildItemRenderStream, FlowProvider, ItemRenderer, useJumpToLatest, type JumpToLatest } from "@flow-state-dev/react";
import type { Gaps } from "../gaps";
import { callRuns, shiftManagerRenderers, ToolLineGroup } from "./ToolLine";
import { JumpToLatestButton, SectionFailure } from "./ui";
import { TurnComposer } from "./TurnComposer";
import { knownWorkers, senderOf, useWorkerConversation } from "../lib/conversation";
import { workerLabel } from "../lib/derive";
import { SessionScope } from "./TaskBoardMeta";
import { useLab } from "../lib/lab-data";
import type { Worker } from "../lib/reads";
import { sendTurn } from "../lib/send";
import { clockTime } from "../lib/shell";

/**
 * Items the feed never draws: `ItemRenderer` paints nothing for them. Keep in step with
 * `NON_RENDERABLE_TYPES` in `@flow-state-dev/react`'s `ItemRenderer.ts`.
 */
const UNDRAWN = new Set<string>(["state_change", "resource_change", "suspension_resume", "continuation"]);

/** v2's scrolling column (v2:122-180): padded 36/32, `max-w-[720px]`, with the composer pinned under it. */
export function ConversationFrame({
  children,
  composer,
  feed,
  testId = "conversation",
}: {
  children: ReactNode;
  composer?: ReactNode;
  /** Where the column scrolls to, and its jump-to-latest arrow ({@link useJumpToLatest}). */
  feed?: JumpToLatest;
  /** Prefix for the frame's test ids: `shift-coordinator` gives `shift-coordinator` and `shift-coordinator-feed`. */
  testId?: string;
}) {
  return (
    <div className="flex h-full flex-col" data-testid={testId}>
      <div ref={feed?.ref} className="min-h-0 flex-1 overflow-y-auto px-8 pt-9 pb-3" data-testid={`${testId}-feed`} data-look="conversation-feed">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-6" data-look="conversation-column">
          {children}
        </div>
        {feed === undefined ? null : <JumpToLatestButton feed={feed} />}
      </div>
      {composer === undefined ? null : (
        <div className="px-8 pt-2.5 pb-[22px]">
          <div className="mx-auto w-full max-w-[720px]">{composer}</div>
        </div>
      )}
    </div>
  );
}

/** A conversation with `worker`: the feed and the composer under it. See the file's header. */
export function Conversation({
  worker,
  session,
  sessions,
  gaps,
  name,
  lead,
  emptyText,
  working = false,
  startWork,
  autoSend,
  onAutoSend,
  renderItem,
  scale = "default",
  testId = "conversation",
  startAtEnd = false,
  readOnly,
}: {
  worker: Worker;
  /** The session this conversation is, when the view found it: every line goes there. Absent, the user's conversation with the worker, at its derived address. */
  session?: string;
  sessions: readonly SessionSummary[];
  gaps: Gaps;
  /** What the shell calls the worker: over its messages, and in the composer. */
  name: string;
  /** Drawn above the feed, in the same scrolling column. */
  lead?: ReactNode;
  /** Shown before a first line. */
  emptyText?: string;
  /** A line from this page is in flight: say the worker has it. */
  working?: boolean;
  /** Called as a line goes out; returns the call that says it settled. */
  startWork?: () => () => void;
  /** A line handed in from elsewhere (the palette): sent as if typed, once the composer isn't blocked. */
  autoSend?: string | null;
  onAutoSend?: () => void;
  /** Draw an item its own way; return `undefined` to leave it to the registry. */
  renderItem?: (item: OutputItem) => ReactNode | undefined;
  /** The composer's size: `shift-coordinator` is the larger one the Shift Coordinator's screen uses. */
  scale?: "default" | "shift-coordinator";
  /** Prefix for every test id inside: `shift-coordinator` gives `shift-coordinator`, `shift-coordinator-conversation`, `shift-coordinator-item`. */
  testId?: string;
  /**
   * Open on the latest turn rather than at the top. A view
   * with a `lead` above the feed leaves this off so it opens on the lead.
   */
  startAtEnd?: boolean;
  /** Why nothing can be sent here, whatever the worker: the session is read, never written to. */
  readOnly?: string;
}) {
  const { client, refresh, answered, snapshot } = useLab();
  const conversation = useWorkerConversation(worker, sessions, session);
  const inventory = snapshot !== undefined && "inventory" in snapshot && snapshot.inventory?.ok ? snapshot.inventory.value.workers : undefined;
  const known = useMemo(() => knownWorkers(inventory ?? [], sessions), [inventory, sessions]);
  // The feed opens where it starts; with `startAtEnd`, on the latest turn, and again on each
  // conversation it is shown. What arrives after stays below the arrow, except the user's own line.
  const feed = useJumpToLatest({ startAtEnd, resetKey: conversation.sessionId });
  const { sessionId, opened, read, failure, reread } = conversation;

  // An ask in this conversation answered in Inbox or the summary: read the conversation back.
  const answeredHere = answered !== undefined && answered.sessionId === sessionId ? answered.count : undefined;
  useEffect(() => {
    if (answeredHere !== undefined) reread();
  }, [answeredHere, reread]);

  // A run of tool calls stays one segment: the feed draws it as one quiet line. Items it never draws
  // are left out, so a session holding only those (a standing-rules read writes a state change into
  // it before any line is sent) counts as empty.
  const shown = useMemo(
    () =>
      read === undefined
        ? []
        : callRuns(
            buildItemRenderStream(
              read.items.filter((item) => !UNDRAWN.has(item.type)),
              shiftManagerRenderers,
              { groupToolCalls: true },
            ),
          ),
    [read],
  );

  // Nothing is sent into a conversation the screen hasn't read, or to a worker with no door.
  const blocked =
    readOnly !== undefined
      ? readOnly
      : worker.door === null || worker.kind === null
      ? `${workerLabel(worker.id)} ${gaps.turn.noDoor}`
      : failure !== undefined
        ? "The conversation didn't load, so nothing can be sent until it does."
        : conversation.resolving || (sessionId !== null && sessionId !== opened && read === undefined)
          ? "Reading the conversation first…"
          : null;

  const composer = (
    <TurnComposer
      testId={`${testId}-composer`}
      scale={scale}
      label={`Message ${name}`}
      placeholder={`Message ${name}…`}
      blocked={blocked}
      autoSend={autoSend}
      onAutoSend={onAutoSend}
      send={async (message, held) => {
        const settled = startWork?.();
        feed.sent();
        try {
          // A first line opens the conversation at the worker's derived address before the door's request runs in it.
          const target = await conversation.ensure();
          return await sendTurn(client, { sessionId: target, flowId: worker.kind!, door: worker.door! }, message, {
            onHeld: () => {
              // The session holds the line: read it back now, so it is drawn while the reply is in flight.
              reread();
              held();
            },
          });
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
    <ConversationFrame testId={testId} feed={feed} composer={composer}>
      {lead}
      <section
        aria-label={`Conversation with ${name}`}
        className="flex flex-col gap-6"
        data-testid={`${testId}-conversation`}
        data-worker-id={worker.id}
        data-session-id={sessionId ?? ""}
      >
        {failure !== undefined ? (
          <SectionFailure what="The conversation" failure={failure} onRetry={reread} testId={`${testId}-conversation-failure`} />
        ) : (sessionId === null && !conversation.resolving) || (read !== undefined && shown.length === 0 && !read.truncated) ? (
          // No conversation at its worked-out address, a session the view opened before a first line (a project's
          // Stream), or one whose whole read holds nothing the feed draws, reads empty: say so, never draw nothing.
          // A cut-short read may hold more, and while the address is still being worked out it isn't known yet.
          <p className="text-sm text-muted-foreground" data-testid={`${testId}-conversation-empty`}>
            {emptyText ?? `You haven't talked with ${name} yet. Your first line starts the conversation.`}
          </p>
        ) : sessionId === null || read === undefined ? (
          <p className="text-sm text-muted-foreground" data-testid={`${testId}-conversation-reading`}>
            Reading the conversation…
          </p>
        ) : (
          <FlowProvider renderers={shiftManagerRenderers}>
            <SessionScope sessionId={sessionId} flow={worker.kind} items={read.items}>
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
                  // Another worker's message is drawn by the registry on every view, under its sender's name.
                  const received = item.type === "component" && (item as { component?: string }).component === RECEIVED_MESSAGE_COMPONENT;
                  const own = received ? undefined : renderItem?.(item);
                  const sender = item.type === "message" && role === "assistant" ? senderOf(worker, item, known) : undefined;
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
                        // v2's label over each of the worker's messages: its name and the time it was written (v2:135).
                        <p className="mb-2.5 flex items-baseline gap-2 font-mono text-[10.5px] font-medium tracking-[0.12em] text-muted-foreground" data-look="message-label">
                          {(sender ?? name).toUpperCase()}
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
            </SessionScope>
          </FlowProvider>
        )}
        {working ? (
          // v2's thinking line (v2:167-169), saying only what is true: the worker has the line.
          <p className="flex items-center gap-2 font-mono text-[11.5px] font-medium text-muted-foreground" data-testid={`${testId}-working`}>
            <span className="size-[7px] shrink-0 bg-info" data-look="working" aria-hidden />
            {name} is working on it…
          </p>
        ) : null}
      </section>
    </ConversationFrame>
  );
}
