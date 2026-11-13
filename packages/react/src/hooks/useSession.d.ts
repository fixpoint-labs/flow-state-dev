import { type ExecuteActionResponse, type SessionDetail, type SessionRequestSummary, type SessionStateSnapshotResponse, type ChildSessionSummary } from "@flow-state-dev/client";
import type { ContentAudioDeltaEvent, FileContent, ItemVisibility, OutputItem } from "@flow-state-dev/core/items";
import type { ResumeAction } from "@flow-state-dev/core/types";
/**
 * The request a view shows last, as {@link SessionView.followedRequest}
 * reports it: the fields of a request summary its status needs.
 */
export type FollowedRequest = Pick<SessionRequestSummary, "id" | "status" | "startedAtMs" | "completedAtMs" | "failedAtMs">;
/** Options for {@link SessionView.refresh}. */
export type SessionRefreshOptions = {
    /**
     * `false` re-reads the session's state, detail and background work, and no
     * item history: one state read, whatever the history's length. The items on
     * screen stay as they are. Default `true`: the whole view.
     */
    items?: boolean;
};
/**
 * The background-work read asks for one page, never for the whole history.
 *
 * The axis is re-read on every interaction, so paging to exhaustion would make
 * an ordinary turn cost a number of requests that grows with the
 * conversation's history. Rows come back newest-first, so what a longer
 * history loses off the end is the oldest finished work, never work that just
 * started.
 *
 * How large that page is belongs to the **server**, which is why no default
 * appears here. The route's maximum is configurable per deployment and the
 * hook cannot see it, so a number hardcoded on this side would be rejected
 * outright by any deployment that set a smaller ceiling — turning an ordinary
 * mount into a 400 and an empty axis. Sending nothing lets the route apply its
 * own default, which is always within its own bounds. An app that wants a
 * specific page says so with `childSessions: { limit }` and owns the result.
 */
/**
 * Items subscription configuration for useSession.
 */
export type SessionItemsOptions = boolean | {
    includeTransient?: boolean;
    itemTypes?: string[];
};
/**
 * Background-work list configuration for useSession.
 */
export type SessionChildSessionsOptions = {
    /**
     * Rows each read asks for, newest first. Omitted by default, which lets the
     * server apply its own page size.
     *
     * Set it when a conversation runs more background work than that page holds
     * — the list is all-time history, not just what is currently running, so it
     * grows with everything the conversation has ever started, and anything past
     * one page is not reachable from the hook.
     *
     * The server caps this and rejects a larger value with a 400, which surfaces
     * as `childSessionsStale` rather than rows. The cap defaults to 100 and is
     * raised with `maxChildSessionListLimit` on the server, so a value above what
     * the deployment permits is a misconfiguration on the app's side, not a
     * silent truncation.
     */
    limit?: number;
};
/**
 * Options for useSession.
 */
export type UseSessionHookOptions = {
    flowKind?: string;
    userId?: string;
    baseUrl?: string;
    items?: SessionItemsOptions;
    childSessions?: SessionChildSessionsOptions;
    /**
     * When true, on mount the hook checks if the session has an in-progress
     * request and re-attaches to its stream using cursor-based continuation.
     * Default: false.
     */
    autoResume?: boolean;
    /**
     * When true, the view also hears requests it didn't send: another tab,
     * another person, an agent answering in the same session. The hook opens one
     * stream for the session after its first snapshot, and each finished item
     * any request keeps joins `items` about a second later, in the order a
     * reload shows. `childSessions` is re-read whenever a run under the session
     * starts or finishes, and keeps an unfinished run the page lacks.
     *
     * The stream holds a connection open while the view is mounted, and the
     * server reads the session about once a second for it. Leave it off for a
     * view only one person writes to: the request stream already carries
     * everything there. A server without the stream, or one that refuses it,
     * leaves the view as it is without `live`, with no error. Once the stream
     * has named the runs, losing it (a reconnect that fails, a refusal, the
     * session gone) keeps the rows and raises `childSessionsStale`.
     *
     * A live view also hears changes other sessions make to the scopes it reads:
     * its session's resources, and its user's and organization's state and
     * resources. On a notice it reads state again without its item history,
     * and passes a resource change to the resource hooks, which read again as
     * they do for the view's own. A change this view's own request made is
     * skipped: its own stream already carried it. On a host that can't push,
     * the view reads its state every few seconds instead.
     * Default: false.
     */
    live?: boolean;
    /**
     * Threshold in milliseconds before the in-flight request is treated as
     * stuck. The watchdog tracks the most recent SSE event or heartbeat and
     * trips when the gap exceeds this value while a request is in flight (or
     * was, before an `onError`). Should be ≥ 2× the server's wire heartbeat
     * to avoid false positives during long pauses (e.g. an LLM thinking).
     * Default: 30000 (30 seconds).
     */
    stuckThresholdMs?: number;
};
/**
 * Mid-stream resource_change notice. Mirrors the fields a downstream hook
 * (e.g., `useResourceCollection`) needs to decide whether a change touches
 * its ref — without leaking the full transient SSE item shape.
 */
export type ResourceChangeNotice = {
    readonly resourcePath: string;
    readonly changeType: "created" | "updated" | "deleted";
    readonly seq: number;
};
/**
 * Reactive session view returned by useSession.
 */
export type SessionView = {
    readonly flowKind: string;
    readonly sessionId?: string;
    readonly userId: string;
    /**
     * Org id the session is bound to, mirrored from `detail.orgId` once the
     * session record has loaded. `undefined` for unbound sessions.
     */
    readonly orgId?: string;
    /**
     * True while this session's snapshot is being read. Starts true on the
     * first paint when a session id is given, so a transcript can hide
     * itself instead of flashing empty.
     */
    readonly isLoading: boolean;
    readonly isStreaming: boolean;
    /** True when the main execution chain has completed but background work tasks are still running. */
    readonly isFinishing: boolean;
    /**
     * True when the SSE stream has gone silent for longer than
     * `stuckThresholdMs` while a request is (or was) in flight. Surfaces a
     * "connection lost" affordance when the stream drops without producing
     * a terminal event. Cleared on the next terminal status, successful
     * dismiss, or new `sendAction`.
     */
    readonly isStuck: boolean;
    /** True when the session can accept a new sendAction call (not blocked by an in-flight request). */
    readonly canSendAction: boolean;
    /**
     * Request-scoped status slot — the most recent value passed to
     * `ctx.emit.status()` during the in-flight request. Empty string when no
     * block has emitted a status yet (or when a block explicitly cleared it).
     * Resets to `""` when the request terminates.
     */
    readonly statusMessage: string;
    readonly error: Error | null;
    readonly detail: SessionDetail | null;
    readonly snapshot: SessionStateSnapshotResponse | null;
    /**
     * Most recent request on this session, regardless of status. `null` until
     * the first list fetch resolves or when the session has no requests yet.
     * Refreshed on mount and whenever an SSE stream reaches a terminal state.
     */
    readonly latestRequest: SessionRequestSummary | null;
    /**
     * The request the view shows last: the one the newest item in `items`
     * belongs to, so a request sent beside it that adds no items, such as a
     * steered line, doesn't take its place. `null` until `items` holds one, and
     * always with `items: false`.
     *
     * While its stream runs, `status` comes from the stream. When it ends, or
     * once it is shown after a reload, its record is read: from the
     * `latestRequest` read when it is the newest request, else with one status
     * read (`GET /:flowKind/requests/:requestId/status`).
     */
    readonly followedRequest: FollowedRequest | null;
    readonly items: OutputItem[];
    /**
     * Mid-stream resource_change notices, in arrival order. Independent of the
     * `items` filter — these are surfaced even when transients are filtered out
     * of `items`, so subscribers (e.g., `useResourceCollection`) can react to
     * in-flight resource mutations without setting `includeTransient: true` on
     * the caller's `useSession` call.
     */
    readonly resourceChanges: ReadonlyArray<ResourceChangeNotice>;
    /**
     * Background work running under this session — one entry per body of work,
     * not per attempt, and finished work stays listed. Empty for a session that
     * never launched any.
     *
     * Separate from `items` on purpose: background work is not part of the
     * conversation, and nothing here is folded into the transcript. An app that
     * wants "here's what came back" to appear in the chat writes that itself.
     *
     * Current as of the last thing the user did: re-read on mount, at the start
     * of every action, and whenever the app calls `refresh()`. With `live: true`
     * it is also re-read whenever a run starts or finishes, and an unfinished
     * run older than the page stays listed until it finishes.
     *
     * One page of the most recent entries, newest first, sized by the server
     * unless the app names a page with `childSessions: { limit }`. This is
     * all-time history rather than only what is running now, so it grows with
     * everything the conversation has ever started; past one page the oldest
     * finished work falls off the end and is not reachable from here.
     *
     * A row's `status` is absent until its work has run anything, and `"active"`
     * means only *not finished*. Without `live`, the list may be stale: never
     * render `"active"` as "running", "working" or "thinking", and never treat
     * it as proof a worker is alive. With `live: true` the list is re-read as
     * runs start and finish, so `"active"` may read as "working", which clears
     * when the run ends; a paused or stopped run reads the same.
     */
    readonly childSessions: ReadonlyArray<ChildSessionSummary>;
    /**
     * True when the most recent attempt to re-read `childSessions` failed. The
     * rows already read are kept rather than cleared, so this is the difference
     * between "this is the current list" and "this is the last list we could
     * get" — without it a job that has since failed renders as still running.
     * Cleared by the next successful read.
     *
     * With `live: true`, also true while the session stream, having named the
     * runs, is not following the session: once a reconnect has failed, until a
     * connection names the runs again, and for good once the stream is refused
     * or the session is gone. The rows are kept either way.
     */
    readonly childSessionsStale: boolean;
    /** Returns items owned by a container scope (items where `ownedBy === blockInstanceId`). */
    getOwnedItems: (ownedBy: string) => OutputItem[];
    /** Returns items stamped with the given `agentName`. Useful for rendering per-agent panels. */
    getItemsByAgent: (agentName: string) => OutputItem[];
    /** Returns items matching the given visibility predicate. */
    getItemsByVisibility: (predicate: Partial<ItemVisibility>) => OutputItem[];
    /**
     * Send an action on this session. `userMessage` shows the person's line at
     * once, before the server's copy arrives. `attachments` are the message's
     * files, as `upload` returned them, sent beside the input: the line shown
     * at once holds them after the text, as the server's will.
     */
    sendAction: (action: string, input: unknown, options?: {
        metadata?: Record<string, unknown>;
        userMessage?: string;
        attachments?: FileContent[];
    }) => Promise<ExecuteActionResponse>;
    /** Abort the currently in-flight request. No-op if nothing is in flight. */
    abortRequest: () => Promise<void>;
    /**
     * Dismiss a stuck request without requiring a live SSE connection.
     * Sends the abort signal to the server, closes any local stream
     * handle, injects a synthetic abort item so the user sees the prior
     * request was stopped, and refreshes the latest server snapshot.
     *
     * The target id is resolved in this order: explicit argument →
     * captured-on-error id → active stream id → `latestRequest.id`. No-op
     * (with a console warning) if no id can be resolved.
     */
    dismissRequest: (requestId?: string) => Promise<void>;
    /**
     * Re-dispatch the most recent request and attach to the new stream.
     * No-op when there is no latest request, or when its status is not one
     * that the server will retry (`interrupted` or `failed`).
     */
    resumeLatestRequest: () => Promise<void>;
    /**
     * Answer a pending stop (approve, reject, submit or skip) and stream the
     * continuation back into this session's `items`. A user's stop
     * (`ctx.suspendForUser`, or a raw `user_approval` / `user_input`) is
     * answered through the client's `answer`, whatever started its run, a
     * task's or a webhook's included; a developer's own `ctx.suspend` with a
     * custom reason through `resume`. The reason is read off the suspension
     * item in `items`; a stop not there is answered as a user's.
     *
     * The POST carries `Accept: text/event-stream`, so the continuation streams
     * from the POST response on the same instance that handled it: the output
     * after the stop renders live, with no page refresh, even on serverless
     * (where a separate GET reconnect couldn't reach the in-flight
     * continuation). Falls back to a GET re-attach and a snapshot refresh when
     * the server returns a 202 instead of SSE.
     *
     * `requestId` is the stopped request's id (carried on the suspension item).
     * The continuation re-enters that same id, so its items merge into the
     * existing stream rather than creating a new request. Who answered is the
     * signed-in caller, set by the server.
     */
    answerSuspension: (args: {
        suspensionId: string;
        requestId: string;
        action: ResumeAction;
        data?: unknown;
    }) => Promise<void>;
    /**
     * Continue a crash-interrupted request under its OWN id and stream
     * the re-entry's items back into this session's `items`. Unlike
     * `resumeLatestRequest` (which re-dispatches the session's most recent
     * request via `/retry` under a NEW id), this targets a specific `requestId`
     * — the caller resolves which interrupted request to continue, this does
     * not assume "latest".
     *
     * POSTs inline with `Accept: text/event-stream` so the continuation streams
     * from the same POST response on the instance that handled it (mirrors
     * `answerSuspension`'s inline-streaming rationale — essential on
     * serverless). If the server instead returns a 202 (no inline streaming
     * support), the continuation has already been accepted server-side — this
     * does NOT re-POST `/continue` (the record has left `interrupted`, so a
     * second POST would 409/race). It cancels the unused body and reconnects
     * via a GET stream instead.
     */
    continueRequest: (requestId: string) => Promise<void>;
    /**
     * Follow a request of this session that was sent without the hook: stream
     * its items into `items`, from the start, and make it the request
     * `abortRequest` stops. The stream followed now is closed. Followed again
     * after its stream dropped, it picks up after the last event the view had,
     * so state changes already applied are not applied twice. Returns `false`
     * and follows nothing for a request the person stopped or dismissed: it is
     * not picked back up, even while the server still lists it as running.
     *
     * For a request sent beside the one the page follows, so the page stays on
     * that one until it ends: a turn that waits for the running turn, say, sent
     * through the client and followed once the running turn is over. Sends
     * nothing.
     */
    followRequest: (requestId: string) => boolean;
    /**
     * Re-read the view: the snapshot with its whole item history, and the
     * background work. `refresh({ items: false })` re-reads state, detail and
     * background work only, and leaves the items as they are; use it when only
     * state changed, such as after a request sent beside the one the view
     * follows. A state read never rewinds state a newer read already set.
     *
     * The hook re-reads state itself after a stop and when a request it
     * follows ends without completing; a completed request gets the full read,
     * which settles its items.
     */
    refresh: (options?: SessionRefreshOptions) => Promise<void>;
    /**
     * Subscribe to streaming TTS audio chunks. Chunks are live-only
     * and not retained in session item state — the durable representation is
     * the eventual `OutputAudioContent` snapshot delivered via `items`. The
     * returned function unsubscribes. Used by `useVoice` for gapless playback;
     * external consumers can attach a custom handler when implementing their
     * own player.
     */
    subscribeAudioDelta: (handler: (event: ContentAudioDeltaEvent) => void) => () => void;
};
export declare function useSession(sessionId: string | undefined, options?: UseSessionHookOptions): SessionView;
//# sourceMappingURL=useSession.d.ts.map