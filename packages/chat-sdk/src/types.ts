/**
 * Public type surface for `@flow-state-dev/chat-sdk`.
 *
 * Defines the adapter's options object, the unified inbound event shape
 * that internal routing normalizes Chat SDK callbacks into, and the
 * per-flow `chat` augmentation on `FlowDefinition`. Imports from `chat`
 * give us real types from the upstream package — wrappers re-export the
 * subset adapter authors and capability consumers reach for so they
 * don't have to depend on the upstream package directly.
 */
import type { Chat, Thread, Message } from "chat";

/**
 * Stable provenance identifier stamped on every chat-originated envelope.
 * Lives here rather than alongside the adapter factory so internal modules
 * can import it without a circular dependency through `adapter.ts`.
 */
export const CHAT_TRANSPORT_SOURCE = "chat" as const;
import type { ResolvedPrincipal } from "@flow-state-dev/server";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";

/**
 * Either a constructed `Chat` instance or a lazy factory. The lazy form
 * lets hosts defer expensive adapter construction (Slack OAuth tokens,
 * Redis state) until the first webhook arrives — useful for serverless.
 */
export type ChatBotInput = Chat | (() => Chat | Promise<Chat>);

/**
 * Normalized event shape passed to routing and principal resolvers. Wraps
 * the Chat SDK's per-callback arguments behind a single discriminant so a
 * single `route(event)` function can handle every callback kind.
 */
export interface ChatInboundEvent {
  kind:
    | "mention"
    | "subscribedMessage"
    | "directMessage"
    | "messageMatch"
    | "reaction"
    | "action"
    | "slashCommand"
    | "modalSubmit"
    | "assistantThreadStarted"
    | "memberJoined"
    | "custom";
  thread: Thread | null;
  message: Message | null;
  /** Adapter name from the Chat SDK (e.g. `"slack"`, `"discord"`). */
  platform: string;
  matchedPattern?: RegExp;
  matchedGroups?: RegExpMatchArray;
  actionId?: string;
  actionValue?: unknown;
  slashCommand?: { name: string; args: string };
  /** Underlying Chat SDK event payload as the handler received it. */
  raw: unknown;
}

/**
 * Result returned by a custom `route` function — selects the flow + action
 * to dispatch, optionally overriding the derived session id, and optionally
 * skipping dispatch entirely (`skip: true` → 200 OK with no flow run).
 */
export interface ChatRouteResult {
  flowKind: string;
  action: string;
  input: unknown;
  sessionId?: string;
  skip?: boolean;
}

export type ChatRouteFn = (
  event: ChatInboundEvent
) => ChatRouteResult | Promise<ChatRouteResult>;

/**
 * Per-callback opt-out flags. Every field defaults to `true`; set `false`
 * to skip registering a handler. Useful when a host wants Chat SDK to
 * deliver an event but not route it through FSD.
 */
export interface ChatEventConfig {
  mention?: boolean;
  subscribedMessage?: boolean;
  directMessage?: boolean;
  messageMatch?: boolean;
  reaction?: boolean;
  action?: boolean;
  slashCommand?: boolean;
  modalSubmit?: boolean;
  assistantThreadStarted?: boolean;
  memberJoined?: boolean;
}

/**
 * Options accepted by `createChatTransportAdapter`. The two routing
 * shapes are mutually-exclusive-with-default: either supply `flowKind`
 * (and optionally `action`) for short-form static routing, or supply a
 * custom `route` function that returns `ChatRouteResult` per event.
 */
export interface ChatAdapterOptions {
  bot: ChatBotInput;
  /** Short-form routing: every inbound event dispatches this flow. */
  flowKind?: string;
  /** Action name for short-form routing. Default `"chat"`. */
  action?: string;
  /** Custom router. Overrides short-form when present. */
  route?: ChatRouteFn;
  /**
   * Auto-stream flow output back to the originating thread. Default `true`.
   * Per-flow override via `FlowDefinition.chat.streamToThread`.
   */
  streamToThread?: boolean;
  /**
   * Map a stream event to a chat chunk. Return `string` to push, `null`
   * to skip, `undefined` to fall through to default behavior (push
   * `content.delta` text; render `item.done` of type `message` when
   * no prior `content.delta` was emitted for the same item).
   */
  itemToChunk?: (event: RequestStreamEvent) => string | null | undefined;
  /** Mount prefix. Default `"/api/chat"`. */
  routePrefix?: string;
  /**
   * Mount adapter OAuth callback routes. `true` mounts with default
   * (per-adapter-derived) redirect; pass `{ redirectUri }` to override.
   * Only adapters exposing a `handleOAuthCallback` method (Slack, Linear,
   * GitHub today) are mounted.
   */
  mountOAuthRoutes?: boolean | { redirectUri: string };
  /**
   * Adapter-supplied principal resolver. Default derives
   * `${platform}:${author.id}`. Throw `PrincipalResolutionError` to reject.
   */
  resolvePrincipal?: (
    event: ChatInboundEvent
  ) => ResolvedPrincipal | Promise<ResolvedPrincipal>;
  /** Per-event opt-outs. */
  events?: ChatEventConfig;
  /**
   * Per-flow overrides. Keyed by `flowKind`. Lets a single adapter serve
   * multiple flows where one needs `streamToThread: false`.
   */
  flowOverrides?: Record<string, ChatFlowOverride>;
}

/**
 * Provenance metadata stamped onto every chat-originated envelope.
 * Surfaced on `RequestRecord.metadata` and available to flow middleware.
 */
export interface ChatEnvelopeMetadata {
  platform: string;
  threadId: string;
  channelId: string;
  messageId?: string;
  authorId?: string;
  isDM: boolean;
  eventKind: ChatInboundEvent["kind"];
}

/**
 * Per-flow chat configuration. The spec proposed module-augmenting
 * `FlowDefinition`, but that's a `type` alias (not an interface) in
 * `@flow-state-dev/core/types`, so augmentation isn't available. Instead,
 * hosts pass per-flow overrides on the adapter via
 * `ChatAdapterOptions.flowOverrides`, keyed by flow kind. Functionally
 * equivalent; located on the adapter instead of the flow definition.
 */
export interface ChatFlowOverride {
  streamToThread?: boolean;
}
