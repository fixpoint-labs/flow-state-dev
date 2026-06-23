/**
 * `@flow-state-dev/chat-sdk` — Vercel Chat SDK as an FSD inbound
 * transport.
 *
 * Wraps a `chat` instance (Slack, Microsoft Teams, Google Chat, Discord,
 * plus other adapters the SDK ships) into a single
 * `InboundTransportAdapter`. One adapter exposes every platform the host's
 * Chat instance has registered.
 *
 * Quick start:
 *
 *   import { Chat } from "chat";
 *   import { createSlackAdapter } from "@chat-adapter/slack";
 *   import { createFlowApiRouter } from "@flow-state-dev/server";
 *   import { createChatTransportAdapter } from "@flow-state-dev/chat-sdk";
 *
 *   const bot = new Chat({
 *     userName: "fsd-bot",
 *     adapters: { slack: createSlackAdapter({ ... }) },
 *   });
 *
 *   const router = createFlowApiRouter({
 *     registry,
 *     stores,
 *     adapters: [createChatTransportAdapter({ bot })],
 *   });
 *
 * Routing is declarative: a flow subscribes to chat events on its own
 * definition (`chat: { on: { mention: { block, input, when } } }`), and the
 * adapter dispatches the matching subscriptions. There is no adapter-mount
 * `route()`/`flowKind` — express content-based routing as `chat.on` bindings
 * with `when` predicates. An inbound event with no matching subscription is a
 * no-op ack. The flow's stream is piped back to the originating thread
 * automatically; disable per-flow via `flowOverrides`, per-adapter via
 * `streamToThread: false`. For richer outbound (cards, reactions, cross-thread
 * sends), import `chatCapability` and the `chat.*` blocks.
 */
export {
  createChatTransportAdapter,
  CHAT_TRANSPORT_SOURCE,
} from "./adapter";
export type {
  ChatAdapterOptions,
  ChatBotInput,
  ChatInboundEvent,
  ChatEventConfig,
  ChatEnvelopeMetadata,
  ChatFlowOverride,
} from "./types";
export { defineChatBinding } from "./define-binding";
export type { TypedChatEventBinding } from "./define-binding";
export { chatCapability } from "./capability";
export { chatPost } from "./blocks/post";
export { chatTyping } from "./blocks/typing";
export { chatReact } from "./blocks/react";
export { chatUpdate } from "./blocks/update";
