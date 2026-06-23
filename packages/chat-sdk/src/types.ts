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
  /**
   * Inbound user identity surfaced by event types that don't carry a
   * `Message` (slash commands, assistant thread started, member joined,
   * button actions). Populated by the per-callback handler when the
   * underlying Chat SDK event exposes a user — the default principal
   * resolver reads this when `message?.author` is absent.
   */
  principalUser?: { userId: string };
  slashCommand?: { name: string; args: string };
  /** Underlying Chat SDK event payload as the handler received it. */
  raw: unknown;
}

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
 * Options accepted by `createChatTransportAdapter`. Routing is purely
 * declarative (FIX-838): the adapter mounts the bot and dispatches the flow
 * `chat.on` subscriptions whose event key + `when` predicate match an inbound
 * event — there is no adapter-mount `route()`/`flowKind` escape hatch. Express
 * content-based routing as `chat.on` bindings with `when` predicates on the
 * flow definition, mirroring the webhook transport.
 */
export interface ChatAdapterOptions {
  bot: ChatBotInput;
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
 * Provenance metadata stamped onto every chat-originated envelope, namespaced
 * under `chat` so it sits beside `metadata.webhook` / `metadata.schedule` in
 * the shared action-forms model (FIX-838). Surfaced on
 * `RequestRecord.metadata` and available to flow middleware; the devtool reads
 * `metadata.chat` to explain why a flow fired.
 *
 * `eventKey` is the resolution coordinate: the matched `chat.on` subscription
 * key. `resolveActionCore` reads it (gated on `source === "chat"`) to find the
 * inline handler on `flow.chat.on`, so it is always present — every chat
 * dispatch now flows through a declared subscription.
 */
export interface ChatEnvelopeMetadata {
  chat: {
    platform: string;
    threadId: string;
    channelId: string;
    messageId?: string;
    authorId?: string;
    isDM: boolean;
    eventKind: ChatInboundEvent["kind"];
    /** The matched `chat.on` key — the resolution coordinate. */
    eventKey: string;
  };
}

/**
 * Per-flow chat override carried on the adapter mount, keyed by flow kind.
 *
 * As of FIX-667 the primary place to declare per-flow chat behavior is the
 * flow definition itself (`chat: { streamToThread, on }` in core). This
 * adapter-mount override is retained for FIX-638 hosts and is consulted
 * only when the flow's own `chat.streamToThread` is unset — see the
 * precedence chain in `shouldStreamToThread`. Flagged for follow-up
 * deprecation once hosts migrate to the flow-level field.
 */
export interface ChatFlowOverride {
  streamToThread?: boolean;
}
