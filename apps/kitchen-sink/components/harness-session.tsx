"use client";

/**
 * A harness session, picked in a harness mode's rail: the model it runs and
 * the conversation it is bound to, the conversation with the harness's own items, a composer whose stop control stops the turn, the
 * notice for the latest turn, and the plan panel beside it, which shows the
 * bound conversation's plan.
 *
 * Every item shown is the harness's own, through the app's ordinary
 * renderers. The notice and the bound conversation are read from session
 * state (`lib/harness-turn.ts`), and the panel from the plan record. Nothing
 * here writes an item, a plan row or the binding, and nothing names a
 * harness: the label is data from the mode list.
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  FlowProvider,
  useResourceCollectionList,
  useResourceManifest,
  useSession,
  type SessionView,
} from "@flow-state-dev/react";
import {
  OBSERVED_PLAN,
  OBSERVED_PLAN_LIST,
  harnessConversationNamespace,
  planRowsPrefix,
  readPlanTarget,
} from "@flow-state-dev/core/types";

import { chatAssistantRenderers } from "@/components/flow-state/chat-assistant";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
  ScrollOnNewRequest,
} from "@/components/flow-state/conversation";
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/flow-state/prompt-input";
import { RequestGroupRenderer } from "@/components/flow-state/request-group";
import { PlanRowLine } from "@/components/plan-row";
import { SessionConversationLoading } from "@/components/session-conversation-loading";
import { SessionItemsProvider } from "@/components/flow-state/session-items-context";
import type { ModelChoices } from "@/lib/harness-models";
import { pageGoalControl } from "@/lib/goal-control";
import { KITCHEN_SINK_USER_ID } from "@/lib/kitchen-sink-principal";
import {
  earliestTurnOf,
  latestTurn,
  planPanelState,
  turnNotice,
  turnNumbers,
  type HarnessSessionState,
  type PlanMarkerItem,
  type PlanRowItem,
  type TurnNotice,
} from "@/lib/harness-turn";
import { useSessionDraft } from "@/lib/use-session-draft";

export interface HarnessSessionViewProps {
  /** The mode's label, from the mode list. */
  readonly label: string;
  /** The mode's session flow kind. */
  readonly flowKind: string;
  readonly sessionId: string;
  /** The mode's models, for the name of the session's. */
  readonly models: ModelChoices;
  /** Called when the session's title arrives or changes, so the rail can pick it up. */
  readonly onTitled?: () => void;
}

/** One harness session's conversation and plan. */
export function HarnessSessionView({ label, flowKind, sessionId, models, onTitled }: HarnessSessionViewProps) {
  return (
    <FlowProvider flowKind={flowKind} userId={KITCHEN_SINK_USER_ID} baseUrl="" renderers={chatAssistantRenderers}>
      <SessionBody label={label} sessionId={sessionId} models={models} onTitled={onTitled} />
    </FlowProvider>
  );
}

function SessionBody({
  label,
  sessionId,
  models,
  onTitled,
}: {
  label: string;
  sessionId: string;
  models: ModelChoices;
  onTitled?: () => void;
}) {
  const session = useSession(sessionId, { items: true, autoResume: true });
  const [message, setMessage] = useSessionDraft(sessionId);
  const messageRef = useRef(message);
  messageRef.current = message;

  // Session state is read from the snapshot, which a turn's end alone does
  // not refresh: re-read it when a turn stops streaming.
  const wasStreaming = useRef(false);
  const { refresh } = session;
  useEffect(() => {
    if (wasStreaming.current && !session.isStreaming) void refresh();
    wasStreaming.current = session.isStreaming;
  }, [session.isStreaming, refresh]);

  // The rail lists sessions by title. The flow sets it in a session's first
  // turn, so re-read the rail when it arrives.
  const title = session.detail?.title;
  useEffect(() => {
    if (title !== undefined) onTitled?.();
  }, [title, onTitled]);

  const state = (session.snapshot?.clientData.session ?? {}) as Partial<HarnessSessionState>;
  const bound = state.binding?.confirmed ?? null;
  const { items, isStreaming, latestRequest } = session;
  const turn = useMemo(
    () => latestTurn({ items, streaming: isStreaming, request: latestRequest }),
    [items, isStreaming, latestRequest],
  );
  const turnsByRequest = useMemo(() => turnNumbers(items), [items]);
  const notice = turn === null ? null : turnNotice(state.turns?.[turn.requestId] ?? null, turn.status, bound);

  const handleSubmit = useCallback(
    async (msg: PromptInputMessage) => {
      const prompt = msg.text.trim();
      if (prompt.length === 0) return;
      try {
        await session.sendAction("turn", { prompt }, { userMessage: prompt });
        if (messageRef.current.trim() === prompt) setMessage("");
      } catch {
        // Keep the persisted draft so a failed send can be retried.
      }
    },
    [session, setMessage],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row" data-testid="harness-session">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b px-4 py-2 text-xs text-muted-foreground">
          {session.snapshot !== null && <SessionModel model={state.model} models={models} label={label} />}
          Conversation:{" "}
          <span className="font-mono" data-testid="bound-conversation">
            {bound ?? "none yet"}
          </span>
        </div>
        <Conversation className="min-h-0 flex-1" data-testid="conversation">
          <SessionItemsProvider value={session.items}>
            <ConversationContent className="mx-auto w-full max-w-3xl px-3 sm:px-4">
              {session.isLoading ? (
                <SessionConversationLoading />
              ) : (
                <>
                  <ScrollOnNewRequest items={session.items} />
                  {session.items.length === 0 && (
                    <ConversationEmptyState title={label} description={`Each turn continues the same ${label} conversation.`} />
                  )}
                  <RequestGroupRenderer
                    items={session.items}
                    isStreaming={session.isStreaming}
                    isFinishing={session.isFinishing}
                    showWorkedFor
                    latestCompletedAtMs={latestRequest?.completedAtMs ?? latestRequest?.failedAtMs}
                    statusMessage={session.statusMessage}
                  />
                </>
              )}
            </ConversationContent>
          </SessionItemsProvider>
          <ConversationScrollButton />
        </Conversation>
        <div className="border-t">
          {notice !== null && <Notice notice={notice} label={label} />}
          <div className="mx-auto max-w-3xl px-3 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 sm:px-4 sm:pb-4">
            <PromptInput onSubmit={handleSubmit}>
              <PromptInputTextarea
                name="message"
                placeholder={`Ask ${label}…`}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <PromptInputSubmit
                className="mr-2 sm:mr-4"
                status={session.isStreaming ? "streaming" : "ready"}
                disabled={!session.isStreaming && message.trim().length === 0}
                onStop={session.abortRequest}
              />
            </PromptInput>
          </div>
        </div>
      </section>
      <PlanPanel
        session={session}
        label={label}
        turn={turn}
        ended={turn !== null && turn.status !== "running"}
        bound={bound}
        turnsByRequest={turnsByRequest}
        records={state.turns ?? null}
      />
    </div>
  );
}

function SessionModel({ model, models, label }: { model: string | undefined; models: ModelChoices; label: string }) {
  const named = model ?? models.fallbackId;
  const name = named === null ? null : (models.models.find((m) => m.id === named)?.label ?? null);
  const text =
    named === null
      ? `${label}'s own default (this session predates the model picker)`
      : `${name !== null && name !== named ? `${name} · ` : ""}${named}${model === undefined ? ` (${label} mode's default; this session predates the model picker)` : ""}`;
  return (
    <p className="mb-1">
      Model:{" "}
      <span className="font-mono" data-testid="session-model" data-model-id={model ?? ""}>
        {text}
      </span>
    </p>
  );
}

/** The latest turn's notice, worded for a person. */
function Notice({ notice, label }: { notice: TurnNotice; label: string }) {
  const text = (() => {
    switch (notice.kind) {
      case "started":
        return `${label} started conversation ${notice.conversation}. Later turns continue it.`;
      case "continued":
        return `Continued conversation ${notice.conversation}.`;
      case "moved":
        return `${label} started a new conversation, ${notice.conversation}, instead of continuing ${notice.previous}. The session follows the new one.`;
      case "refused":
        return `${label} did not continue conversation ${notice.conversation}${notice.error === null ? "." : `: ${notice.error}`} The session keeps it, and your next turn asks for it again. Start a new session to begin a new conversation.`;
      case "error":
        return `This turn failed${notice.error === null ? "." : `: ${notice.error}`} ${notice.conversation === null ? "" : `The session stays on conversation ${notice.conversation}.`}`;
      case "stopped":
        return `Stopped. ${notice.conversation === null ? "" : `The session stays on conversation ${notice.conversation}, and your next turn continues it.`}`;
    }
  })();
  const warn = notice.kind === "refused" || notice.kind === "error";
  return (
    <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-4">
      <p
        className={`break-words rounded-md border px-3 py-2 text-sm ${warn ? "border-destructive/40 bg-destructive/10 text-destructive" : "text-muted-foreground"}`}
        data-testid="turn-notice"
        data-kind={notice.kind}
        role={warn ? "alert" : "status"}
      >
        {text.trim()}
      </p>
    </div>
  );
}

/** The patterns the plan record and its markers are declared under. */
const PLAN_PATTERN = `${OBSERVED_PLAN}/**`;
const MARKER_PATTERN = `${OBSERVED_PLAN_LIST}/**`;

/** The most rows a conversation's plan is read with: the list route's ceiling. */
const PLAN_ROW_LIMIT = 200;

interface PanelProps {
  readonly session: SessionView;
  readonly label: string;
  readonly turn: { readonly requestId: string; readonly number: number } | null;
  readonly ended: boolean;
  /** The conversation the session is bound to. */
  readonly bound: string | null;
  /** Each turn's number by its request id. */
  readonly turnsByRequest: ReadonlyMap<string, number>;
  /** The session's turn records, by request id. */
  readonly records: HarnessSessionState["turns"];
}

/** What the run recorded of the plan, for the conversation the session's latest turn is in. Read-only. */
function PlanPanel({ session, label, turn, ended, bound, turnsByRequest, records }: PanelProps) {
  const { manifest, error } = useResourceManifest(session);
  const refs = useMemo(() => {
    const find = (pattern: string) =>
      manifest?.resources.find((r) => r.kind === "collection" && r.pattern === pattern && r.client.state?.read === true)?.ref;
    return { plan: find(PLAN_PATTERN), marker: find(MARKER_PATTERN) };
  }, [manifest]);

  let body;
  if (manifest === undefined) {
    body = <p className="text-sm text-muted-foreground">{error === undefined ? "Loading…" : `The plan can't be read: ${error.message}`}</p>;
  } else if (refs.plan === undefined) {
    body = <PanelState state={planPanelState({ declared: false, label, turn: null, ended, rows: [], markers: [] })} />;
  } else if (turn === null) {
    body = <PanelState state={planPanelState({ declared: true, label, turn: null, ended, rows: [], markers: [] })} />;
  } else {
    body = (
      <TurnPlan
        key={turn.requestId}
        session={session}
        label={label}
        turn={turn}
        ended={ended}
        bound={bound}
        turnsByRequest={turnsByRequest}
        records={records}
        planRef={refs.plan}
        markerRef={refs.marker}
      />
    );
  }

  return (
    <aside
      className="flex max-h-[40dvh] shrink-0 flex-col overflow-y-auto border-t p-4 lg:max-h-none lg:w-80 lg:border-l lg:border-t-0 lg:bg-inspector"
      aria-label="Plan"
      data-testid="plan-panel"
    >
      <h2 className="mb-2 text-sm font-medium">Plan</h2>
      {body}
    </aside>
  );
}

type TurnPlanProps = Omit<PanelProps, "turn"> & {
  turn: { requestId: string; number: number };
  planRef: string;
  markerRef: string | undefined;
};

/**
 * Finds the latest turn's plan and shows it. The turn's run leaves a pointer
 * to its conversation's plan; a running turn that has not written it yet reads
 * the bound conversation's. A turn with neither (a session from before plans
 * were kept by conversation) shows the rows stored under the turn itself.
 */
function TurnPlan(props: TurnPlanProps) {
  const { session, turn, ended, bound, markerRef } = props;
  const legacy = (markers: readonly PlanMarkerItem[]) => (
    <PlanRows {...props} rowsPrefix={planRowsPrefix(turn.requestId)} markers={markers} conversation={null} />
  );
  // A flow that declares the rows but no markers has no marker, and no pointer, to read.
  if (markerRef === undefined) return legacy([]);
  return (
    <MarkersUnder
      session={session}
      markerRef={markerRef}
      prefix={planRowsPrefix(turn.requestId, OBSERVED_PLAN_LIST)}
      render={(runMarkers) => {
        const target = readPlanTarget(turn.requestId, runMarkers);
        const namespace =
          target.kind === "conversation" ? target.namespace : !ended && bound !== null ? harnessConversationNamespace(bound) : null;
        if (namespace === null) return legacy(runMarkers);
        return <ConversationPlan key={namespace} {...props} markerRef={markerRef} namespace={namespace} />;
      }}
    />
  );
}

/**
 * A conversation's plan: its rows and its one list marker, read by the
 * conversation's key and kept live. When the conversation's earliest recorded
 * turn left no pointer, that turn predates plans kept by conversation, and the
 * plan may be missing what it recorded.
 */
function ConversationPlan(props: TurnPlanProps & { markerRef: string; namespace: string }) {
  const { session, turn, records, turnsByRequest, markerRef, namespace } = props;
  const earliest = earliestTurnOf(records, (id) => harnessConversationNamespace(id) === namespace);
  const rowsPrefix = `${OBSERVED_PLAN}/${namespace}/`;
  const show = (markers: readonly PlanMarkerItem[], predates: boolean) => (
    <PlanRows
      {...props}
      rowsPrefix={rowsPrefix}
      markers={markers.filter((m) => m.topic === namespace)}
      conversation={{ turns: turnsByRequest, predates }}
    />
  );
  return (
    <MarkersUnder
      session={session}
      markerRef={markerRef}
      prefix={`${OBSERVED_PLAN_LIST}/${namespace}`}
      render={(markers) =>
        earliest === null || earliest === turn.requestId ? (
          show(markers, false)
        ) : (
          <MarkersUnder
            session={session}
            markerRef={markerRef}
            prefix={planRowsPrefix(earliest, OBSERVED_PLAN_LIST)}
            render={(first) => show(markers, readPlanTarget(earliest, first).kind !== "conversation")}
          />
        )
      }
    />
  );
}

/** The rows under one prefix, kept live, and the panel's state for them. */
function PlanRows({
  session,
  label,
  turn,
  ended,
  planRef,
  rowsPrefix,
  markers,
  conversation,
}: TurnPlanProps & {
  rowsPrefix: string;
  markers: readonly PlanMarkerItem[];
  conversation: { turns: ReadonlyMap<string, number>; predates: boolean } | null;
}) {
  // The goal's control: show only what the latest turn wrote, as a plan kept per turn would.
  const perTurn = pageGoalControl(useSearchParams()) === "plan-per-turn";
  const rows = useResourceCollectionList<{ title?: string | null; status?: string | null; requestId?: string | null }>(
    session,
    planRef,
    { topicPrefix: rowsPrefix, limit: PLAN_ROW_LIMIT },
  );
  if (rows.error !== undefined) {
    return <p className="text-sm text-destructive">The plan can't be read: {rows.error.message}</p>;
  }
  const rowItems: PlanRowItem[] = rows.items
    .filter((item) => ownTopic(rowsPrefix, item.topic))
    .map((item) => ({
      topic: item.topic,
      title: item.clientData?.title ?? null,
      status: item.clientData?.status ?? null,
      requestId: item.clientData?.requestId ?? null,
    }))
    .filter((row) => !perTurn || conversation === null || row.requestId === turn.requestId);
  return (
    <PanelState
      state={planPanelState({ declared: true, label, turn: turn.number, ended, rows: rowItems, markers, conversation })}
    />
  );
}

/**
 * Whether a listed topic (under its collection) is under `prefix`. A live
 * change can surface a topic from outside the window read, so each is checked.
 */
function ownTopic(prefix: string, topic: string): boolean {
  return `${prefix.split("/")[0] ?? ""}/${topic}`.startsWith(prefix);
}

/** The list markers under a key prefix, kept live. */
function MarkersUnder({
  session,
  markerRef,
  prefix,
  render,
}: {
  session: SessionView;
  markerRef: string;
  prefix: string;
  render: (markers: readonly PlanMarkerItem[]) => ReactNode;
}) {
  const markers = useResourceCollectionList<{
    status?: string | null;
    count?: number | null;
    reason?: string | null;
    conversation?: string | null;
  }>(session, markerRef, { topicPrefix: prefix });
  return render(
    markers.items
      .filter((item) => ownTopic(prefix, item.topic))
      .map((item) => ({
        topic: item.topic,
        status: item.clientData?.status ?? null,
        count: item.clientData?.count ?? null,
        reason: item.clientData?.reason ?? null,
        conversation: item.clientData?.conversation ?? null,
      })),
  );
}

function PanelState({ state }: { state: ReturnType<typeof planPanelState> }) {
  switch (state.kind) {
    case "undeclared":
      return <Line state={state.kind}>{state.label} reports no plan.</Line>;
    case "no-turn":
      return <Line state={state.kind}>No turn yet.</Line>;
    case "none":
      return (
        <Line state={state.kind} scope={state.scope} turn={state.turn}>
          {state.scope === "conversation" ? "No plan recorded in this conversation." : "No plan recorded for this turn."}
        </Line>
      );
    case "empty":
      return (
        <Line state={state.kind} scope={state.scope} turn={state.turn}>
          {state.scope === "conversation" ? "The plan is empty." : "This turn's plan is empty."}
        </Line>
      );
    case "rows":
      return (
        <div data-plan-state={state.incomplete === null ? "rows" : "incomplete"} data-plan-scope={state.scope}>
          <TurnLabel scope={state.scope} turn={state.turn} />
          {state.incomplete !== null && (
            <p className="mb-2 text-xs text-destructive" data-testid="plan-incomplete">
              This plan may be incomplete{state.incomplete.reason === null ? "." : `: ${state.incomplete.reason}`}
            </p>
          )}
          <ol className="space-y-2 text-sm">
            {state.rows.map((row) => (
              <PlanRowLine key={row.key} rowKey={row.key} title={row.title} status={row.status} />
            ))}
          </ol>
        </div>
      );
  }
}

/** The turn a plan is labelled with: the turn itself, or for a conversation's plan the turn that last changed it. */
function TurnLabel({ scope, turn }: { scope: string; turn: number | null }) {
  if (turn === null) return null;
  return (
    <p className="mb-2 text-xs text-muted-foreground" data-testid="plan-turn">
      {scope === "conversation" ? `Last changed in turn ${turn}` : `Turn ${turn}`}
    </p>
  );
}

function Line({ state, scope, turn, children }: { state: string; scope?: string; turn?: number | null; children: ReactNode }) {
  return (
    <div data-plan-state={state} data-plan-scope={scope}>
      {scope !== undefined && turn !== undefined && <TurnLabel scope={scope} turn={turn} />}
      <p className="text-sm text-muted-foreground" data-testid="plan-message">
        {children}
      </p>
    </div>
  );
}
