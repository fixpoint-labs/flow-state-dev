/**
 * Per-flow chat-transport configuration types.
 *
 * A flow declares which inbound chat events trigger which of its actions
 * directly on its definition (`chat: { on: { ... } }`), mirroring the
 * per-flow declarative pattern MCP (`mcp`) and Scheduled (`schedules`)
 * already use. The `@flow-state-dev/chat-sdk` adapter discovers these
 * declarations by walking the flow registry at mount time and dispatches
 * matching events to every flow whose subscription matches.
 *
 * Package-boundary rule: this module MUST NOT import from
 * `@flow-state-dev/chat-sdk`. The dependency is one-way (chat-sdk → core).
 * The event passed to a binding is therefore typed `unknown` here; chat-sdk
 * users reach for `defineChatBinding<T>()` to recover a typed `event`
 * parameter without inverting the dependency.
 *
 * Like the webhook transport, a chat binding *is an action in chat form*: it
 * carries the shared `ActionCore` (the handler block plus execution policy)
 * inline, so the handler needs no entry in `flow.actions` and is reached only
 * through a matching inbound chat event — never the public action endpoint or
 * MCP. The dispatch resolves it through `resolveActionCore` via the
 * `metadata.chat.eventKey` coordinate, not by a named-action lookup.
 */

import type { ActionCore } from "./flow";

/**
 * Binding from one chat event-name key to one handler on a flow — an action in
 * chat form. It extends the shared `ActionCore` (the handler `block` plus
 * execution policy like `durable` and `tokenBudget`) with the chat-specific
 * event mapping. Because it carries the core inline, the handler needs no entry
 * in `flow.actions`.
 *
 * `input` and `sessionId` may return a value or a Promise — the chat-sdk
 * adapter awaits the result before constructing the dispatch envelope
 * (matches the `ScheduleInputFn` precedent in `./schedules`). `when` is
 * synchronous: the adapter evaluates it in the hot path before any async
 * work so the no-match case stays cheap.
 */
export interface ChatEventBinding extends ActionCore {
  /**
   * Map the inbound chat event to the handler's input. May return a value or
   * a Promise. The returned value is validated against the binding's
   * `inputSchema` (falling back to `block.inputSchema`) by the runtime, the
   * same way HTTP request bodies are.
   */
  input: (event: unknown) => unknown | Promise<unknown>;

  /**
   * Derive the session id from the event. May return a value or a Promise.
   * When omitted, the chat-sdk adapter falls back to the originating
   * thread's id. The fallback lives in the adapter, not here — core cannot
   * inspect chat-sdk event shapes.
   */
  sessionId?: (event: unknown) => string | Promise<string> | undefined;

  /**
   * Synchronous predicate. When provided and falsy for an event, the binding
   * does not match and no flow runs for it; other bindings on this flow and
   * on other flows still evaluate independently. Narrow to a single platform
   * with `when: (e) => e.platform === "slack"`. Async filtering is out of
   * scope — let dispatch happen and reject inside the action instead.
   */
  when?: (event: unknown) => boolean;
}

/**
 * Per-flow chat configuration. Carried on `FlowDefinition.chat`.
 */
export interface ChatConfig {
  /**
   * Subscription map. Each key is matched against the chat-sdk's
   * `ChatInboundEvent.kind` by exact string equality — the SDK's event
   * vocabulary (`"mention"`, `"directMessage"`, `"reaction"`, etc.) is a
   * closed union uniform across every platform a registered `Chat` instance
   * exposes, so a binding to `"mention"` fires wherever the bot has a
   * registered adapter. Narrow to one platform with a `when:` predicate.
   *
   * Keys outside the SDK vocabulary (raw GitHub PR lifecycle, Stripe events)
   * never match — those ride the webhook transport. No wildcards in v1. An
   * empty map (`on: {}`) is valid, e.g. when only `streamToThread` is set.
   */
  on?: Record<string, ChatEventBinding>;

  /**
   * Per-flow override for the adapter's default `streamToThread` behavior.
   * Takes precedence over `ChatAdapterOptions.flowOverrides[kind].streamToThread`
   * and the adapter-level `streamToThread` default.
   */
  streamToThread?: boolean;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Validate a flow's `chat` config at registration time. No-op when `chat`
 * or `chat.on` is absent or empty. Throws on a binding with no `block` (a chat
 * binding is an action, so a handler block is required), a non-function
 * `input`/`sessionId`/`when`, or an empty event key. Event-key spelling is NOT
 * validated against the SDK vocabulary — keys are opaque strings (a typo simply
 * never matches).
 *
 * Throws plain `Error`, matching `validateWebhookConfig` /
 * `validateScheduleConfig`; adapter callers translate registration failures
 * into a hard startup abort.
 */
export function validateChatConfig(
  flowKind: string,
  chat: ChatConfig | undefined
): void {
  if (chat?.on === undefined) return;

  for (const [eventKey, binding] of Object.entries(chat.on)) {
    if (eventKey.length === 0) {
      throw new Error(
        `Flow "${flowKind}" declares a chat subscription with an empty event key. ` +
          `Use a non-empty event name (e.g. "mention", "directMessage").`
      );
    }

    if (binding === null || typeof binding !== "object") {
      throw new Error(
        `Flow "${flowKind}" chat subscription "${eventKey}" must be an object with at ` +
          `least a \`block\` and \`input\`.`
      );
    }

    if (binding.block === null || typeof binding.block !== "object") {
      throw new Error(
        `Flow "${flowKind}" chat subscription "${eventKey}" must declare a \`block\` ` +
          `(the handler — handler/generator/sequencer/router) to run for the event.`
      );
    }

    if (typeof binding.input !== "function") {
      throw new Error(
        `Flow "${flowKind}" chat subscription "${eventKey}" must declare \`input\` as a ` +
          `function mapping the event to the action's input.`
      );
    }

    if (binding.sessionId !== undefined && typeof binding.sessionId !== "function") {
      throw new Error(
        `Flow "${flowKind}" chat subscription "${eventKey}" has a \`sessionId\` that is ` +
          `not a function. Provide a function deriving the session id from the event, or omit it.`
      );
    }

    if (binding.when !== undefined && typeof binding.when !== "function") {
      throw new Error(
        `Flow "${flowKind}" chat subscription "${eventKey}" has a \`when\` that is not a ` +
          `function. Provide a synchronous predicate over the event, or omit it.`
      );
    }
  }
}
