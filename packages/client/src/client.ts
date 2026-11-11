/**
 * `createClient`: the one client for a flow-state-dev server.
 *
 * Built from a user and a transport (a `baseUrl` over HTTP, or a `fetcher`
 * such as the engine's `createInProcessFetch`). Its namespaces follow how the
 * server addresses its routes: the root is the user's (flows, sessions,
 * resources, interrupted requests, change subscriptions); `flow(address)` holds a
 * flow's actions; a request handle holds one request's lifecycle. Every call
 * and stream goes through the one transport built here.
 */
import type { ResumeAction, WireTopic } from "@flow-state-dev/contracts";
import type { FileContent } from "@flow-state-dev/contracts/items";
import type { ActionConfig, FlowActionInput, RequestStatusSnapshot } from "@flow-state-dev/core/types";
import { clientError, createTransport, requireValue, seg, topicPath, type Transport } from "./internal/http";
import { pause } from "./internal/pause";
import {
  openRequestStream,
  openSessionStream,
  type SessionStreamOptions,
  type StreamResumeOptions
} from "./stream-client/streams";
import { createPushHub, type SubscribeOptions, type Subscription } from "./subscribe/push-hub";
import type {
  ChildSessionSummary,
  ClientFetch,
  CollectionResourceState,
  CollectionListPage,
  DebugCollectionResourcesResponse,
  DebugResourcesResponse,
  DebugSuspensionsResponse,
  ExecuteActionRequestBody,
  ExecuteActionResponse,
  FlowCapabilities,
  FlowListEntry,
  ListDebugCollectionResourcesOptions,
  ListDebugSuspensionsOptions,
  QueryValue,
  RequestSSECallbacks,
  RequestStreamHandle,
  ResourceManifest,
  SessionDetail,
  SessionRequestSummary,
  SessionStateSnapshotResponse,
  SessionStreamHandle,
  SessionSummary
} from "./types";

// ---------------------------------------------------------------------------
// Options and shapes
// ---------------------------------------------------------------------------

/** Options for {@link createClient}. */
export type CreateClientOptions = {
  /**
   * The user every call acts as. Sent as caller input, never trusted: with
   * sign-in, the server authenticates the request's credentials instead.
   */
  userId: string;
  /**
   * Where the server answers, e.g. `"http://localhost:3000"`; `""` for the
   * page's own origin. Required without a `fetcher`.
   */
  baseUrl?: string;
  /**
   * Where the server mounts the flow API, after `baseUrl`. Default
   * `"/api/flows"`. Set it to the server's mount when that differs, such as
   * the Node host's `basePath`.
   */
  apiPath?: string;
  /**
   * The fetch every call and stream goes through. Pass the engine's
   * `createInProcessFetch(flowState)` to reach an engine in this process with
   * no web server, or a wrapper that adds credentials. Default: the global
   * `fetch`.
   */
  fetcher?: ClientFetch;
};

/** What a session listing can add to its rows ({@link ListSessionsOptions.include}). */
export type SessionListInclude = "dispatch-runs" | "status";

/** Query options for {@link Client.sessions}`.list`. */
export type ListSessionsOptions = {
  flowKind?: string;
  /** Exact owning instance. Narrower than `flowKind` for a collection flow. */
  flowId?: string;
  /**
   * Whose sessions to list. Default: the client's own user. With sign-in on,
   * the server narrows any listing to the signed-in user.
   */
  userId?: string;
  limit?: number;
  offset?: number;
  /**
   * What the listing adds, one value or several:
   *
   * - `"dispatch-runs"`: also return the sessions a dispatcher ran work in.
   *   Off by default: a listing without it returns the sessions the user
   *   started. It widens parentage only; a run of another principal,
   *   organization or tenant stays absent. A row that came in this way
   *   carries {@link SessionSummary.parentSessionId}.
   * - `"status"`: each row's {@link SessionSummary.requestStatus}, the state
   *   of its latest request, read on the server.
   */
  include?: SessionListInclude | readonly SessionListInclude[];
  /**
   * Only the sessions whose readonly state fields hold these values: a field
   * the flow's session `stateSchema` declares `.readonly()`, set when the
   * session was created. Needs `flowKind` or `flowId`; the server refuses a
   * field that isn't readonly on that flow.
   */
  state?: Readonly<Record<string, string>>;
};

/** Query options for listing the requests in one session. */
export type ListSessionRequestsOptions = {
  status?: SessionRequestSummary["status"];
  limit?: number;
  offset?: number;
  /** Return each summary's full item log (`include_items=true`). Off by default. */
  includeItems?: boolean;
  /** Return each finished request's `result.output`. Off by default. */
  includeResultOutput?: boolean;
};

/**
 * Paging for the background work under one conversation. There is no filter:
 * which work a caller may see is the server's call, from the stored parent.
 */
export type ListChildSessionsOptions = {
  /** 1–100. The server returns 25 rows when this is absent. */
  limit?: number;
  /** 0–10000. */
  offset?: number;
};

/** Query options for reading a session's state snapshot. */
export type GetSessionStateOptions = {
  includeItems?: boolean;
  clientData?: string[];
  itemTypes?: string[];
  offset?: number;
  limit?: number;
};

/** What a new session starts with. The flow and user come from the handle and client. */
export type CreateSessionOptions = {
  sessionId?: string;
  title?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  state?: Record<string, unknown>;
};

/** Fields of a session's metadata to replace. */
export type UpdateSessionMetadataOptions = {
  title?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

/** A resource's rendered content, alone or in a collection. */
export type ResourceContentResponse = {
  ref: string;
  topic?: string;
  content: string;
};

/** A new resource in a collection. */
export type CreateCollectionResourceOptions = {
  topic: string;
  content?: string;
};

/** New content for a resource, alone or in a collection. */
export type UpdateResourceContentOptions = {
  content: string;
};

/** Paging for one collection's resources. */
export type ListCollectionResourcesOptions = {
  limit?: number;
  cursor?: string;
  topicPrefix?: string;
};

/** Audio to transcribe. */
export type TranscribeRequest = {
  audio: Uint8Array | Blob;
  mediaType?: string;
  language?: string;
};

/** A transcription. */
export type TranscribeResponse = {
  text: string;
  language?: string;
};

/** One file to attach: its bytes, its type (a `Blob`'s own type when omitted), and the name a person sees. */
export type UploadRequest = {
  data: Uint8Array | Blob;
  mediaType?: string;
  filename?: string;
};

/** How a send is addressed and labelled. */
export type SendOptions = {
  sessionId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
  /**
   * The message's files, each as `upload` returned it (`data` is its
   * `fsd-blob:` reference, never the bytes), in the order attached. They ride
   * beside the input: the model gets them on the person's turn, and the
   * conversation shows them on that line. The action must write a user
   * message (`userMessage`) and the session must be named. Over the limits
   * (10 images, 5 documents) the server refuses the send by name.
   */
  attachments?: FileContent[];
};

/**
 * The answer that resolves a pending suspension. Who resolved it is the
 * signed-in caller (the request's owner when the app does not authenticate),
 * set by the server.
 */
export type ResumeSuspensionBody = {
  /** Id of the pending suspension to resolve. */
  suspensionId: string;
  /**
   * How the suspension resolves: `approve`/`reject`, `submit` with `data`
   * validated against the suspension's `resumeSchema`, or `skip` for an
   * optional step. It must be in the suspension's `allow` set, or the server
   * answers 409.
   */
  action: ResumeAction;
  /** Resume payload validated against the suspension's `resumeSchema`. */
  data?: unknown;
};

/**
 * The answer to a suspension that waits for a user ({@link RequestHandle.answer}).
 * Who answered is the signed-in caller, set by the server: there is no `resumedBy`.
 */
export type AnswerSuspensionBody = {
  /** Id of the pending suspension to answer. */
  suspensionId: string;
  /**
   * The answer: `approve` or `reject` for an approval, `submit` with `data`
   * for a review or an input. Must be in the suspension's `allow` set (409 otherwise).
   */
  action: ResumeAction;
  /** The answer's payload, validated against the suspension's `resumeSchema`. */
  data?: unknown;
};

/** Ask for an SSE response instead of JSON: the call resolves to the raw `Response`. */
export type StreamOption = {
  /**
   * `true` returns the server's SSE `Response` from the POST itself, so a
   * serverless host with no shared pub/sub still streams the run live. A
   * server that can't stream inline answers 202 JSON instead; read the
   * response's `content-type`.
   */
  stream: true;
};

/** Options for {@link RequestHandle.stream}. */
export type RequestStreamOptions = RequestSSECallbacks &
  StreamResumeOptions & {
    /** Also deliver trace items (`block_trace`, `router_decision`, `state_snapshot`). */
    includeTrace?: boolean;
  };

/** A flow whose actions type-check `send`, as `typeof myFlow` gives it. Types only. */
export type TypedFlow = { actions: Record<string, ActionConfig> };

/** The flow type `flow()` uses when none is given: any action name, any input. */
export type UntypedFlow = { actions: Record<string, never> };

/** The action names `send` takes for a flow type. */
export type ActionNameOf<TFlow extends TypedFlow> = TFlow extends UntypedFlow
  ? string
  : keyof TFlow["actions"] & string;

/** The input `send` takes for one action of a flow type. */
export type ActionInputOf<TFlow extends TypedFlow, TAction extends string> = TFlow extends UntypedFlow
  ? unknown
  : TAction extends keyof TFlow["actions"]
    ? FlowActionInput<TFlow["actions"][TAction]>
    : never;

/** How {@link RequestHandle.wait} and {@link RequestHandle.result} wait. */
export type WaitOptions = {
  /** How often the status is read, in ms. Default 250. */
  pollMs?: number;
  /** Reject with a `ClientHttpError` of status 0 past this many ms. Default: never. */
  timeoutMs?: number;
  /** Stop waiting when this aborts. Stops the wait only, never the run. */
  signal?: AbortSignal;
};

/**
 * A settled request, as {@link RequestHandle.result} reads it: its status,
 * plus what the record stored for it.
 *
 * | `status` | also |
 * |---|---|
 * | `completed` / `incomplete` | `output`, absent when the action returned nothing |
 * | `failed` | `error`, plus `output` when the action answered before a completion hook failed the request |
 * | any of those, output not storable as JSON | `outputNotRecorded: true` in place of `output` |
 * | `suspended` / `aborted` / `interrupted` | nothing |
 */
export type RequestResult = {
  /** How the request settled. */
  status: RequestStatusSnapshot["status"];
  /** The action's return value, as stored (JSON). */
  output?: unknown;
  /** The action returned a value that could not be stored as JSON; distinct from returning nothing. */
  outputNotRecorded?: true;
  /** Why the request failed. */
  error?: { code: string; message: string };
};

/**
 * One request, found by a send, by id, or in the interrupted list. Its
 * lifecycle lives on it, with the flow and session its routes need.
 */
export interface RequestHandle {
  /** The request's id. */
  readonly id: string;
  /** The flow address its routes take: a singleton's kind, or an instance's id. */
  readonly flow: string;
  /** Its lifecycle state now. */
  status(): Promise<RequestStatusSnapshot>;
  /**
   * Resolves with the status once the request has settled: it is not
   * `in_progress` and the server holds no live run of it, so a request just
   * continued or resumed is waited for rather than read back as it was. A run
   * that stops for a person settles at `suspended`. Reads every `pollMs`
   * (default 250); past `timeoutMs` (default: never) it rejects with a
   * `ClientHttpError` of status 0. When `signal` aborts it rejects with the
   * signal's reason; the run carries on.
   */
  wait(options?: WaitOptions): Promise<RequestStatusSnapshot>;
  /**
   * What the request answered: `wait()`'s polls of this request by its id,
   * each asking for its stored result, and the read that finds it settled is
   * the one returned. Resolves for every way a request settles
   * and says which, so branch on `status`: `output` is the action's return
   * value on `completed` or `incomplete`, `error` says why on `failed`, and a
   * run that stops for a person resolves `suspended` with neither. Rejects
   * only as `wait()` does: past `timeoutMs`, on a transport error, or when
   * `signal` aborts, which never stops the run.
   */
  result(options?: WaitOptions): Promise<RequestResult>;
  /** Ask the server to stop it. A finished request answers 409. */
  abort(): Promise<void>;
  /**
   * Carry on a crash-interrupted request under its own id: completed blocks
   * replay from the durable log and the one in flight runs again. Resolves to
   * this handle. Needs the request's session; a request with none rejects
   * before any call.
   */
  continue(): Promise<RequestHandle>;
  continue(options: StreamOption & { includeTrace?: boolean }): Promise<Response>;
  /**
   * Run the request again as a new request in the same session, with its
   * original input or `input`. Resolves to the new request.
   */
  retry(options?: { input?: unknown }): Promise<RequestHandle>;
  /**
   * Answer a pending suspension of this request. The run carries on under the
   * same request id; this resolves to its handle.
   */
  resume(body: ResumeSuspensionBody): Promise<RequestHandle>;
  resume(body: ResumeSuspensionBody, options: StreamOption): Promise<Response>;
  /**
   * Answer a suspension of this request that waits for a user
   * (`ctx.suspendForUser`, or a raw `user_approval` / `user_input` stop),
   * whatever started its run, a task's included, which `resume` refuses.
   * The server checks the caller owns the request before it reads the stop,
   * resolves it once, and continues the same request; this resolves to its
   * handle. Rejects with a `ClientHttpError`: 404 for a stop that is not the
   * caller's or not a user's, 409 for one already resolved (an answer, a
   * cancel, a deadline or a stop got there first), 410 past its deadline,
   * 400 for an answer that fails the stop's schema. With `{ stream: true }`
   * it resolves to the route's SSE `Response` instead, so the continuation
   * streams from the POST itself, as `resume` and `continue` do.
   */
  answer(body: AnswerSuspensionBody): Promise<RequestHandle>;
  answer(body: AnswerSuspensionBody, options: StreamOption): Promise<Response>;
  /**
   * Follow the request's events. When the server ends the stream before the
   * request ends (it cuts off a reader that falls too far behind), the stream
   * resumes after the last event it delivered; after five connections in a
   * row that deliver nothing it gives up with `onError`.
   */
  stream(options: RequestStreamOptions): RequestStreamHandle;
}

/** A request a send started, with the server's answer to the send. */
export interface SentRequest extends RequestHandle {
  /** The server's answer to the send: status, request and session. */
  readonly response: ExecuteActionResponse;
}

/** An interrupted request, as {@link Client.requests}`.interrupted()` lists it. */
export interface InterruptedRequest extends RequestHandle {
  readonly sessionId?: string;
  readonly flowKind: string;
  readonly actionName: string;
  /** When it was marked interrupted, in ms since epoch. */
  readonly interruptedAt: number;
}

/** One flow's actions and requests. Typed by `flow<typeof myFlow>(…)`. */
export interface FlowHandle<TFlow extends TypedFlow = UntypedFlow> {
  /** The address every route of this handle takes. */
  readonly address: string;
  /** Run an action. Resolves to the request it started. */
  send<TAction extends ActionNameOf<TFlow>>(
    action: TAction,
    input: ActionInputOf<TFlow, TAction>,
    options?: SendOptions
  ): Promise<SentRequest>;
  send<TAction extends ActionNameOf<TFlow>>(
    action: TAction,
    input: ActionInputOf<TFlow, TAction>,
    options: SendOptions & StreamOption
  ): Promise<Response>;
  /**
   * Run one of the flow's reads (`defineFlow({ reads })`) on a session, as the
   * client's user, and resolve to its answer. Nothing is stored: no request,
   * no items, no write. For watching a view the flow computes, polled or
   * called when a push says something changed. Rejects with a
   * `ClientHttpError`: 404 for an unknown read or a session the user can't
   * run in, 400 for input its schema refuses, 409 `read_only` for a read
   * that tried to write.
   */
  read<TOutput = unknown>(name: string, input: unknown, options: { sessionId: string }): Promise<TOutput>;
  /** Start a session on this flow, as the client's user. */
  createSession(options?: CreateSessionOptions): Promise<SessionDetail>;
  /**
   * Upload one file to attach to this flow's messages, checked by this flow's
   * own sign-in, so the file is held for the user its sends resolve. Use this
   * when the flow authenticates its own callers; otherwise `client.upload` is
   * the same.
   */
  upload(request: UploadRequest): Promise<FileContent>;
  /** A request of this flow, by id. Reads nothing until a method is called. */
  request(id: string): RequestHandle;
}

/** The user's sessions. */
export interface SessionsApi {
  /** Sessions, newest first. Default: the client's own user's ({@link ListSessionsOptions.userId}). */
  list(options?: ListSessionsOptions): Promise<SessionSummary[]>;
  get(sessionId: string): Promise<SessionDetail>;
  /** The requests run in one session. */
  requests(sessionId: string, options?: ListSessionRequestsOptions): Promise<SessionRequestSummary[]>;
  /**
   * The background work running under one conversation. Each row carries the
   * state its work reached; `requests(row.id)` shows what it has done. A
   * conversation with none returns an empty list.
   */
  children(parentSessionId: string, options?: ListChildSessionsOptions): Promise<ChildSessionSummary[]>;
  /** The session's state snapshot. */
  state(sessionId: string, options?: GetSessionStateOptions): Promise<SessionStateSnapshotResponse>;
  updateMetadata(sessionId: string, options: UpdateSessionMetadataOptions): Promise<SessionDetail>;
  delete(sessionId: string): Promise<void>;
  /**
   * Follow a whole session: every finished item any request in it keeps, and
   * a notice whenever its unfinished runs change. Reconnects with backoff; a
   * 401, 403, 404, 409 or 501 stops it for good (`onStop`).
   */
  stream(sessionId: string, options?: SessionStreamOptions): SessionStreamHandle;
  /**
   * Privileged reads for the DevTool. The server must opt in
   * (`debugEndpointsEnabled` / `FSDEV_DEBUG_ENDPOINTS=1`); otherwise 403.
   */
  debug: {
    listResources(sessionId: string): Promise<DebugResourcesResponse>;
    listSuspensions(sessionId: string, options?: ListDebugSuspensionsOptions): Promise<DebugSuspensionsResponse>;
    listCollectionResources(
      sessionId: string,
      ref: string,
      options?: ListDebugCollectionResourcesOptions
    ): Promise<DebugCollectionResourcesResponse>;
    fetchResourceContent(sessionId: string, ref: string): Promise<string>;
    fetchCollectionResourceContent(sessionId: string, ref: string, topic: string): Promise<string>;
  };
}

/** A session's resources. */
export interface ResourcesApi {
  getResourceContent(sessionId: string, ref: string): Promise<ResourceContentResponse>;
  getCollectionResourceContent(sessionId: string, ref: string, topic: string): Promise<ResourceContentResponse>;
  createCollectionResource(sessionId: string, ref: string, options: CreateCollectionResourceOptions): Promise<{ topic: string }>;
  updateResourceContent(
    sessionId: string,
    ref: string,
    topic: string,
    options: UpdateResourceContentOptions
  ): Promise<void>;
  deleteCollectionResource(sessionId: string, ref: string, topic: string): Promise<void>;
  /** One page of a collection; pass `nextCursor` back as `cursor` for the next. */
  listCollectionResources(sessionId: string, ref: string, options?: ListCollectionResourcesOptions): Promise<CollectionListPage>;
  /** One item's state, or `null` when the topic is absent. */
  getCollectionResourceState(sessionId: string, ref: string, topic: string): Promise<CollectionResourceState | null>;
  /** The public resources a session's flow declares. Deterministic per flow kind. */
  getResourceManifest(sessionId: string): Promise<ResourceManifest>;
}

/** The one client. */
export interface Client {
  /** The user every call acts as. */
  readonly userId: string;
  /** The flows the server hosts. */
  flows(): Promise<FlowListEntry[]>;
  /** What the server supports. */
  capabilities(): Promise<FlowCapabilities>;
  /**
   * One flow, by address: a singleton flow's kind, or a collection
   * instance's id. Pass `typeof myFlow` (a type import) to type-check
   * `send`'s action name and input.
   */
  flow<TFlow extends TypedFlow = UntypedFlow>(address: string): FlowHandle<TFlow>;
  sessions: SessionsApi;
  resources: ResourcesApi;
  requests: {
    /**
     * The user's interrupted requests: a request a host lost in a crash or a
     * restart. Asks the server to sweep stale ones first, then reads every
     * interrupted record, so a request an earlier sweep marked is listed too,
     * on every call, until it is continued or removed.
     * `staleThresholdMs` can only widen the server's own threshold.
     */
    interrupted(options?: { staleThresholdMs?: number }): Promise<InterruptedRequest[]>;
  };
  /**
   * Hear that something under `topics` changed, and read again in
   * `onChange`. A notice says when, never what: `onChange` gets the notice
   * (or `null` for a connect, a reconnect or a timer tick) and makes the read
   * the screen already makes. One socket per client, minted through this
   * client's fetcher, on a host with push; `pollIntervalMs` reads on a timer
   * wherever push can miss a change. Build topics with `topic.session(id)`,
   * `topic.user()` and `topic.org()`.
   */
  subscribe(topics: readonly WireTopic[], options: SubscribeOptions): Subscription;
  /** Transcribe audio on the server. */
  transcribe(request: TranscribeRequest): Promise<TranscribeResponse>;
  /**
   * Upload one file to attach, once. Resolves to the file in reference form
   * (`data` is `fsd-blob:<id>`), held for this user until a message that
   * names it is sent. Send that, never the bytes.
   */
  upload(request: UploadRequest): Promise<FileContent>;
}

// ---------------------------------------------------------------------------
// createClient
// ---------------------------------------------------------------------------

const RESUME_ACTIONS: readonly ResumeAction[] = ["approve", "reject", "submit", "skip"];
const JSON_HEADERS = { "content-type": "application/json" };
const SSE_HEADERS = { accept: "text/event-stream" };

/** Build the one client. Another user or another server is another client. */
export function createClient(options: CreateClientOptions): Client {
  const userId = requireValue(options.userId, "userId");
  const t = createTransport(options);

  const sessions: SessionsApi = {
    list: async (listOptions = {}) => {
      const { state, include, ...rest } = listOptions;
      // The client's own user unless the call names another: a host without
      // sign-in narrows nothing, so no filter would list every user's.
      const query: Record<string, QueryValue> = {
        ...rest,
        userId: rest.userId ?? userId,
        include: typeof include === "string" || include === undefined ? include : include.join(",") || undefined
      };
      for (const [field, value] of Object.entries(state ?? {})) query[`state.${field}`] = value;
      const payload = await t.json<{ sessions: SessionSummary[] }>("/api/flows/sessions", undefined, query);
      return payload.sessions;
    },
    get: async (sessionId) =>
      (await t.json<{ session: SessionDetail }>(`/api/flows/sessions/${sid(sessionId)}`)).session,
    requests: async (sessionId, listOptions) =>
      (
        await t.json<{ requests: SessionRequestSummary[] }>(`/api/flows/sessions/${sid(sessionId)}/requests`, undefined, {
          status: listOptions?.status,
          limit: listOptions?.limit,
          offset: listOptions?.offset,
          include_items: listOptions?.includeItems,
          include_result_output: listOptions?.includeResultOutput
        })
      ).requests,
    children: async (parentSessionId, listOptions) => {
      const parentId = requireValue(parentSessionId, "parentSessionId");
      const payload = await t.json<{ children: ChildSessionSummary[] }>(
        `/api/flows/sessions/${seg(parentId)}/children`,
        undefined,
        { limit: listOptions?.limit, offset: listOptions?.offset }
      );
      // These rows are about to be shown as this conversation's background
      // work; a row the server did not file under it is dropped.
      return payload.children.filter((child) => {
        if (child.parentSessionId === parentId) return true;
        warnParentMismatchOnce(
          `${parentId}:${child.id}`,
          `sessions.children("${parentId}") dropped row "${child.id}" whose ` +
            `parentSessionId is "${child.parentSessionId}", not the requested parent.`
        );
        return false;
      });
    },
    state: (sessionId, stateOptions) =>
      t.json<SessionStateSnapshotResponse>(`/api/flows/sessions/${sid(sessionId)}/state`, undefined, {
        include_items: stateOptions?.includeItems,
        clientData: joined(stateOptions?.clientData),
        item_types: joined(stateOptions?.itemTypes),
        offset: stateOptions?.offset,
        limit: stateOptions?.limit
      }),
    updateMetadata: async (sessionId, update) =>
      (
        await t.json<{ session: SessionDetail }>(`/api/flows/sessions/${sid(sessionId)}/metadata`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(update)
        })
      ).session,
    delete: async (sessionId) => {
      await t.raw(`/api/flows/sessions/${sid(sessionId)}`, { method: "DELETE" });
    },
    stream: (sessionId, streamOptions = {}) => {
      const path = `/api/flows/sessions/${sid(sessionId)}/stream`;
      return openSessionStream({ fetcher: t.fetcher, url: (query) => t.url(path, query) }, streamOptions);
    },
    debug: {
      listResources: (sessionId) =>
        t.json<DebugResourcesResponse>(`/api/flows/sessions/${sid(sessionId)}/debug/resources`),
      listSuspensions: (sessionId, listOptions) =>
        t.json<DebugSuspensionsResponse>(`/api/flows/sessions/${sid(sessionId)}/debug/suspensions`, undefined, {
          status: listOptions?.status,
          flowKind: listOptions?.flowKind,
          userId: listOptions?.userId,
          limit: listOptions?.limit
        }),
      listCollectionResources: (sessionId, ref, listOptions) =>
        t.json<DebugCollectionResourcesResponse>(
          `/api/flows/sessions/${sid(sessionId)}/debug/resources/${seg(requireValue(ref, "ref"))}/items`,
          undefined,
          { limit: listOptions?.limit, cursor: listOptions?.cursor ?? undefined, topic: listOptions?.topic }
        ),
      fetchResourceContent: async (sessionId, ref) =>
        (await t.raw(`/api/flows/sessions/${sid(sessionId)}/debug/resources/${seg(requireValue(ref, "ref"))}/content`)).text(),
      fetchCollectionResourceContent: async (sessionId, ref, topic) =>
        (
          await t.raw(
            `/api/flows/sessions/${sid(sessionId)}/debug/resources/${seg(requireValue(ref, "ref"))}/${topicPath(topic)}/content`
          )
        ).text()
    }
  };

  const resourcePath = (sessionId: string, ref: string): string =>
    `/api/flows/sessions/${sid(sessionId)}/resources/${seg(requireValue(ref, "ref"))}`;

  const resources: ResourcesApi = {
    getResourceContent: (sessionId, ref) => t.json(`${resourcePath(sessionId, ref)}/content`),
    getCollectionResourceContent: (sessionId, ref, topic) =>
      t.json(`${resourcePath(sessionId, ref)}/${topicPath(topic)}/content`),
    createCollectionResource: (sessionId, ref, item) =>
      t.json(resourcePath(sessionId, ref), { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(item) }),
    updateResourceContent: async (sessionId, ref, topic, update) => {
      await t.raw(`${resourcePath(sessionId, ref)}/${topicPath(topic)}/content`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify(update)
      });
    },
    deleteCollectionResource: async (sessionId, ref, topic) => {
      await t.raw(`${resourcePath(sessionId, ref)}/${topicPath(topic)}`, { method: "DELETE" });
    },
    listCollectionResources: (sessionId, ref, listOptions = {}) =>
      t.json(resourcePath(sessionId, ref), undefined, {
        limit: listOptions.limit,
        cursor: listOptions.cursor,
        topicPrefix: listOptions.topicPrefix
      }),
    getCollectionResourceState: (sessionId, ref, topic) => t.json(`${resourcePath(sessionId, ref)}/${topicPath(topic)}`),
    getResourceManifest: (sessionId) => t.json(`/api/flows/sessions/${sid(sessionId)}/manifest`)
  };

  const capabilities = (): Promise<FlowCapabilities> => t.json<FlowCapabilities>("/api/flows/capabilities");
  const push = createPushHub({ transport: t, userId, capabilities });

  const client: Client = {
    userId,
    flows: async () => (await t.json<{ flows: FlowListEntry[] }>("/api/flows")).flows,
    capabilities,
    flow: <TFlow extends TypedFlow = UntypedFlow>(address: string) => flowHandle<TFlow>(t, userId, address),
    sessions,
    resources,
    requests: {
      interrupted: async (interruptedOptions) => {
        const userPath = `/api/flows/users/${seg(userId)}`;
        // The poke sweeps what is stale now; the read is the answer, so a
        // request an earlier sweep marked is listed too.
        await t.raw(`${userPath}/check-interrupted`, { method: "POST" }, {
          staleThresholdMs: interruptedOptions?.staleThresholdMs
        });
        const payload = await t.json<{
          interrupted: Array<{
            requestId: string;
            sessionId?: string;
            flowKind: string;
            flowId?: string;
            actionName: string;
            interruptedAt: number;
          }>;
        }>(`${userPath}/interrupted-requests`);
        return payload.interrupted.map((entry) =>
          Object.assign(
            requestHandle(t, entry.flowId ?? entry.flowKind, entry.requestId, entry.sessionId ?? null),
            {
              ...(entry.sessionId !== undefined ? { sessionId: entry.sessionId } : {}),
              flowKind: entry.flowKind,
              actionName: entry.actionName,
              interruptedAt: entry.interruptedAt
            }
          )
        );
      }
    },
    subscribe: (topics, subscribeOptions) => push.subscribe(topics, subscribeOptions),
    transcribe: (request) => {
      const mediaType = request.mediaType ?? "audio/webm";
      const body =
        request.audio instanceof Blob
          ? request.audio
          : new Blob([request.audio as Uint8Array<ArrayBuffer>], { type: mediaType });
      return t.json<TranscribeResponse>(
        "/api/flows/transcribe",
        { method: "POST", headers: { "content-type": mediaType }, body },
        { userId, language: request.language }
      );
    },
    upload: (request) => uploadTo(t, "/api/flows/blobs", userId, request)
  };
  return client;
}

/** POST one file's raw bytes to an upload route and resolve to its reference. */
async function uploadTo(t: Transport, path: string, userId: string, request: UploadRequest): Promise<FileContent> {
  const mediaType = request.mediaType ?? (request.data instanceof Blob ? request.data.type : "");
  const body =
    request.data instanceof Blob ? request.data : new Blob([request.data as Uint8Array<ArrayBuffer>], { type: mediaType });
  const answer = await t.json<{ attachment: FileContent }>(
    path,
    { method: "POST", headers: { "content-type": mediaType }, body },
    { userId, filename: request.filename }
  );
  return answer.attachment;
}

// ---------------------------------------------------------------------------
// Flow and request handles
// ---------------------------------------------------------------------------

function flowHandle<TFlow extends TypedFlow>(t: Transport, userId: string, address: string): FlowHandle<TFlow> {
  const flow = requireValue(address, "flow address");

  async function send(
    action: string,
    input: unknown,
    sendOptions?: SendOptions & Partial<StreamOption>
  ): Promise<SentRequest | Response> {
    const actionName = requireValue(action, "action");
    const body: ExecuteActionRequestBody = {
      input,
      userId,
      sessionId: sendOptions?.sessionId,
      requestId: sendOptions?.requestId,
      metadata: sendOptions?.metadata,
      ...(sendOptions?.attachments !== undefined && sendOptions.attachments.length > 0
        ? { attachments: sendOptions.attachments }
        : {})
    };
    const path =
      sendOptions?.sessionId === undefined
        ? `/api/flows/${seg(flow)}/actions/${seg(actionName)}`
        : `/api/flows/${seg(flow)}/${seg(sendOptions.sessionId)}/actions/${seg(actionName)}`;
    const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
    if (sendOptions?.stream === true) {
      return t.raw(path, { ...init, headers: { ...JSON_HEADERS, ...SSE_HEADERS } });
    }
    const response = await t.json<ExecuteActionResponse>(path, { ...init, headers: JSON_HEADERS });
    const handle = requestHandle(
      t,
      response.request.flowId ?? flow,
      response.request.id,
      response.session?.id ?? sendOptions?.sessionId ?? null
    );
    return Object.assign(handle, { response });
  }

  return {
    address: flow,
    send: send as FlowHandle<TFlow>["send"],
    read: async <TOutput>(name: string, input: unknown, readOptions: { sessionId: string }) => {
      const readName = requireValue(name, "read");
      const sessionId = requireValue(readOptions?.sessionId, "sessionId");
      const response = await t.json<{ output: TOutput }>(
        `/api/flows/${seg(flow)}/${seg(sessionId)}/reads/${seg(readName)}`,
        { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ input, userId }) }
      );
      return response.output;
    },
    createSession: async (create = {}) =>
      (
        await t.json<{ session: SessionDetail }>(`/api/flows/${seg(flow)}/sessions`, {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ userId, ...create })
        })
      ).session,
    upload: (request) => uploadTo(t, `/api/flows/${seg(flow)}/blobs`, userId, request),
    request: (id) => requestHandle(t, flow, requireValue(id, "requestId"), undefined)
  };
}

/**
 * A request handle. `knownSession` is the request's session when the caller
 * already knows it, `null` when it knows there is none, and `undefined` when
 * it must be read: then the first `continue` or `retry` reads the status
 * once, and the handle keeps the answer.
 */
function requestHandle(
  t: Transport,
  flow: string,
  id: string,
  knownSession: string | null | undefined
): RequestHandle {
  const base = `/api/flows/${seg(flow)}/requests/${seg(id)}`;
  let session: Promise<string | null> | undefined =
    knownSession === undefined ? undefined : Promise.resolve(knownSession);

  /** One status read; `withResult` asks for the stored result too (`include_result_output`). */
  const status = (signal?: AbortSignal, withResult = false): Promise<RequestStatusSnapshot> =>
    t.json<RequestStatusSnapshot>(
      `${base}/status`,
      signal === undefined ? undefined : { signal },
      withResult ? { include_result_output: "true" } : undefined
    );

  /**
   * The one wait: polls the status until the request has settled, and returns
   * the read that settled it. With `withResult` every read carries the stored
   * result, so `result()` hands back that same read, with no second read a
   * resumed run could slip in front of. A running request has no stored
   * result, so those polls stay small.
   */
  const settle = async (waitOptions: WaitOptions | undefined, withResult: boolean): Promise<RequestStatusSnapshot> => {
    const pollMs = waitOptions?.pollMs ?? 250;
    const signal = waitOptions?.signal;
    const until = waitOptions?.timeoutMs === undefined ? Infinity : Date.now() + waitOptions.timeoutMs;
    for (;;) {
      signal?.throwIfAborted();
      const snapshot = await status(signal, withResult);
      // A continued or resumed run is registered before its route answers, and
      // keeps the status it was carried on from until it gets its turn: while
      // the server holds a live run (`lastHeartbeatAt`), it isn't settled.
      if (snapshot.status !== "in_progress" && snapshot.lastHeartbeatAt === undefined) return snapshot;
      if (Date.now() >= until) clientError(`Request "${id}" did not finish in ${waitOptions?.timeoutMs} ms`);
      await pause(pollMs, signal);
    }
  };
  const wait = (waitOptions?: WaitOptions): Promise<RequestStatusSnapshot> => settle(waitOptions, false);

  const sessionPath = async (verb: "continue" | "retry"): Promise<string> => {
    session ??= status().then(
      (snapshot) => snapshot.sessionId ?? null,
      (error: unknown) => {
        session = undefined;
        throw error;
      }
    );
    const sessionId = await session;
    if (sessionId === null) clientError(`Request "${id}" has no session, so it cannot ${verb}`);
    return `/api/flows/${seg(flow)}/sessions/${seg(sessionId)}/requests/${seg(id)}/${verb}`;
  };

  async function continueRequest(
    continueOptions?: StreamOption & { includeTrace?: boolean }
  ): Promise<RequestHandle | Response> {
    const path = await sessionPath("continue");
    if (continueOptions?.stream === true) {
      return t.raw(path, { method: "POST", headers: SSE_HEADERS }, {
        include: continueOptions.includeTrace === true ? "trace" : undefined
      });
    }
    await t.json<{ requestId: string }>(path, { method: "POST" });
    return handle;
  }

  async function resume(body: ResumeSuspensionBody, resumeOptions?: StreamOption): Promise<RequestHandle | Response> {
    requireValue(body.suspensionId, "suspensionId");
    if (!RESUME_ACTIONS.includes(body.action)) {
      clientError(`resume requires action one of ${RESUME_ACTIONS.join(", ")}`);
    }
    const init: RequestInit = { method: "POST", body: JSON.stringify(body) };
    if (resumeOptions?.stream === true) {
      return t.raw(`${base}/resume`, { ...init, headers: { ...JSON_HEADERS, ...SSE_HEADERS } });
    }
    const resumed = await t.json<{ requestId: string }>(`${base}/resume`, { ...init, headers: JSON_HEADERS });
    // The run carries on under its own id; a server that answers another id names the request that does.
    return resumed.requestId === id
      ? handle
      : requestHandle(t, flow, resumed.requestId, session === undefined ? undefined : await session);
  }

  async function answer(body: AnswerSuspensionBody, answerOptions?: StreamOption): Promise<RequestHandle | Response> {
    requireValue(body.suspensionId, "suspensionId");
    if (!RESUME_ACTIONS.includes(body.action)) {
      clientError(`answer requires action one of ${RESUME_ACTIONS.join(", ")}`);
    }
    const init: RequestInit = {
      method: "POST",
      body: JSON.stringify({ suspensionId: body.suspensionId, action: body.action, ...(body.data !== undefined ? { data: body.data } : {}) })
    };
    if (answerOptions?.stream === true) {
      return t.raw(`${base}/answer`, { ...init, headers: { ...JSON_HEADERS, ...SSE_HEADERS } });
    }
    await t.json<{ requestId: string }>(`${base}/answer`, { ...init, headers: JSON_HEADERS });
    return handle;
  }

  const handle: RequestHandle = {
    id,
    flow,
    status: () => status(),
    wait,
    result: async (waitOptions) => {
      // Read by id, with the stored result: the session's length changes nothing.
      const read = await settle(waitOptions, true);
      const { hasOutput: _hasOutput, ...stored } = read.result ?? {};
      return { status: read.status, ...stored };
    },
    abort: async () => {
      await t.raw(`${base}/abort`, { method: "POST" });
    },
    continue: continueRequest as RequestHandle["continue"],
    retry: async (retryOptions) => {
      const path = await sessionPath("retry");
      const init: RequestInit = { method: "POST" };
      if (retryOptions?.input !== undefined) {
        init.headers = JSON_HEADERS;
        init.body = JSON.stringify({ inputOverride: retryOptions.input });
      }
      const retried = await t.json<{ request: { id: string; flowId?: string }; session?: { id: string } }>(path, init);
      return requestHandle(t, retried.request.flowId ?? flow, retried.request.id, retried.session?.id ?? null);
    },
    resume: resume as RequestHandle["resume"],
    answer: answer as RequestHandle["answer"],
    stream: ({ includeTrace, startingAfter, lastEventId, dedupWindowSize, ...callbacks }) =>
      openRequestStream(
        {
          fetcher: t.fetcher,
          url: (after) =>
            t.url(`${base}/stream`, {
              starting_after: after,
              include: includeTrace === true ? "trace" : undefined
            })
        },
        { ...callbacks, startingAfter, lastEventId, dedupWindowSize }
      )
  };
  return handle;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sid(sessionId: string): string {
  return seg(requireValue(sessionId, "sessionId"));
}

function joined(values: string[] | undefined): string | undefined {
  return values === undefined || values.length === 0 ? undefined : values.join(",");
}

// `@flow-state-dev/core`'s `warnOnceDev` is the codebase's pattern for a
// dev-only, once-per-key diagnostic, but `client` keeps `core` type-only (it
// ships to the browser with no @types/node; see
// scripts/validate-package-boundaries.mjs), so it is mirrored here. The
// indirect `globalThis.process` read can't be eliminated by a bundler's
// NODE_ENV replacement, but a bare `process` reference would throw in an
// unbundled browser. Silent unless NODE_ENV is explicitly "development" or
// "test": a production browser has no `process`, and must not warn.
const warnedParentMismatches = new Set<string>();

function warnParentMismatchOnce(key: string, message: string): void {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  if (env?.NODE_ENV !== "development" && env?.NODE_ENV !== "test") return;
  if (warnedParentMismatches.has(key)) return;
  warnedParentMismatches.add(key);
  // eslint-disable-next-line no-console
  console.warn(`[flow-state-dev] ${message}`);
}
