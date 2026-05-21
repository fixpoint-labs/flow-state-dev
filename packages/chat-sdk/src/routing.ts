/**
 * Resolve a `ChatInboundEvent` to the flow + action to dispatch.
 *
 * Two routing modes. Static (`options.flowKind` set) wraps every event
 * into `{ flowKind, action: options.action ?? "chat", input: <derived> }`.
 * Custom (`options.route` set) hands the event to user code and returns
 * the result verbatim — the user may also set `skip: true` to ack the
 * event without running a flow.
 *
 * The default-derived input shape favors what flow authors actually
 * read: the raw message text for messages/mentions/DMs, the action
 * payload for interactive components, the slash command args, etc.
 */
import type { ChatAdapterOptions, ChatInboundEvent, ChatRouteResult } from "./types";

export async function routeEvent(
  event: ChatInboundEvent,
  options: ChatAdapterOptions
): Promise<ChatRouteResult> {
  if (options.route !== undefined) {
    return options.route(event);
  }
  if (options.flowKind === undefined) {
    // Construction-time validation in `createChatTransportAdapter` ensures
    // we never reach here — defensive throw keeps the type narrow.
    throw new Error(
      "@flow-state-dev/chat-sdk: routeEvent called without flowKind or route."
    );
  }
  return {
    flowKind: options.flowKind,
    action: options.action ?? "chat",
    input: deriveInput(event),
  };
}

function deriveInput(event: ChatInboundEvent): unknown {
  const text = event.message?.text;
  switch (event.kind) {
    case "mention":
    case "subscribedMessage":
    case "directMessage":
    case "messageMatch":
      return {
        text: typeof text === "string" ? text : "",
        ...(event.matchedGroups !== undefined
          ? { groups: Array.from(event.matchedGroups) }
          : {}),
      };
    case "reaction":
      return { emoji: extractEmoji(event.raw), text: text ?? "" };
    case "action":
      return { actionId: event.actionId, value: event.actionValue };
    case "slashCommand":
      return event.slashCommand;
    case "modalSubmit":
      return { values: event.actionValue };
    case "assistantThreadStarted":
      return { threadStarted: true };
    case "memberJoined":
      return { memberJoined: true };
    case "custom":
      return event.raw;
  }
}

function extractEmoji(raw: unknown): string | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const e = (raw as { emoji?: unknown }).emoji;
  return typeof e === "string" ? e : undefined;
}
