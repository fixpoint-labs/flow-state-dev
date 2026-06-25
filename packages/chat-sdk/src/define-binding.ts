/**
 * `defineChatBinding<T>()` — typed-event escape hatch.
 *
 * `@flow-state-dev/core`'s `ChatEventBinding` types `event` as `unknown`
 * because core cannot import the chat-sdk's `ChatInboundEvent` without
 * inverting the package dependency. This helper lets chat-sdk users author
 * a binding with a typed `event` parameter while producing a value that is
 * structurally assignable to `FlowDefinition['chat']['on'][key]`. It is a
 * compile-time convenience only — the runtime is a single passthrough.
 */
import type { ActionCore, ChatEventBinding } from "@flow-state-dev/core";
import type { ChatInboundEvent } from "./types";

/**
 * Binding shape with a typed `event` parameter. Carries the shared
 * `ActionCore` (the handler `block` plus execution policy) inline — a chat
 * binding is an action in chat form (FIX-838) — and re-types the event
 * functions over `T`.
 */
export type TypedChatEventBinding<T extends ChatInboundEvent = ChatInboundEvent> = ActionCore & {
  input: (event: T) => unknown | Promise<unknown>;
  sessionId?: (event: T) => string | Promise<string> | undefined;
  when?: (event: T) => boolean;
};

/**
 * Construct a `ChatEventBinding` whose handlers receive a typed
 * `ChatInboundEvent` (or a narrowed subtype via the `T` parameter) instead
 * of `unknown`. Carries the handler `block` inline. Place the result directly
 * in a flow's `chat.on` map.
 */
export function defineChatBinding<T extends ChatInboundEvent = ChatInboundEvent>(
  binding: TypedChatEventBinding<T>
): ChatEventBinding {
  return binding as unknown as ChatEventBinding;
}
