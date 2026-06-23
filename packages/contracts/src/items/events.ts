import type { Content } from "./content";
import type { OutputItem } from "./types";
import type { RequestStatus } from "../types/request-status";

export type { RequestStatus };

export type RequestEventBase = {
  stream: "request";
  requestId: string;
  sequence_number: number;
  ts: number;
};

export type UserEventBase = {
  stream: "user";
  userId: string;
  sequence_number: number;
  ts: number;
};

export type EventBase = RequestEventBase | UserEventBase;

export type RequestCreatedEvent = RequestEventBase & {
  type: "request.created";
  status: "in_progress";
};

export type RequestStatusEvent = RequestEventBase & {
  type: `request.${RequestStatus}`;
  status: RequestStatus;
};

export type ItemAddedEvent = RequestEventBase & {
  type: "item.added";
  item: OutputItem;
};

export type ItemDoneEvent = RequestEventBase & {
  type: "item.done";
  item: OutputItem;
};

/**
 * Identity-invariant keys that must not be replaced by an `item.updated`
 * patch. Producers should not include them; consumers must strip them
 * defensively before merging.
 */
export const ITEM_UPDATE_INVARIANT_KEYS = [
  "id",
  "type",
  "provenance",
  "itemVisibility",
  "transient"
] as const satisfies ReadonlyArray<keyof OutputItem>;

/**
 * Shallow top-level merge update for a previously-emitted item. Each
 * top-level key in `patch` replaces the existing value at that key on
 * the consumer's tracked item. Nested updates require re-supplying the
 * full nested object as the new top-level value.
 *
 * Identity-invariant keys (see `ITEM_UPDATE_INVARIANT_KEYS`) are stripped
 * both server-side and client-side before the patch is applied.
 */
export type ItemUpdatedEvent = RequestEventBase & {
  type: "item.updated";
  itemId: string;
  patch: Record<string, unknown>;
};

export type ContentPartAddedEvent = RequestEventBase & {
  type: "content.added";
  itemId: string;
  contentIndex: number;
  content: Content;
};

export type ContentPartDeltaEvent = RequestEventBase & {
  type: "content.delta";
  itemId: string;
  contentIndex: number;
  delta: string;
};

export type ContentPartDoneEvent = RequestEventBase & {
  type: "content.done";
  itemId: string;
  contentIndex: number;
  content: Content;
};

/**
 * A chunk of synthesized audio for an OutputAudioContent part that is being
 * streamed. Live-only — not replayed on `Last-Event-ID` resume; the durable
 * snapshot is the eventual `OutputAudioContent` delivered via
 * `content.added` / `content.done`. Chunks do not carry `mediaType` because
 * it is stable across the stream and declared on the parent content part.
 *
 * Set `isLast: true` on the final chunk so clients can flush their decode
 * pipeline without waiting for `content.done`.
 */
export type ContentAudioDeltaEvent = RequestEventBase & {
  type: "content.audio.delta";
  itemId: string;
  contentIndex: number;
  /** Base64-encoded audio chunk bytes. */
  audio: string;
  isLast?: boolean;
};

export type RequestResourceChangedEvent = RequestEventBase & {
  type: "resource.changed";
  scope: "request";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};

export type UserResourceChangedEvent = UserEventBase & {
  type: "resource.changed";
  scope: "session" | "user" | "org";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};

export type ResourceChangedEvent = RequestResourceChangedEvent | UserResourceChangedEvent;

/**
 * Pushed to clients that have fetched a resource's content when its content is updated.
 * Only sent to clients with active content subscriptions (inferred from prior GET calls).
 */
export type ResourceContentUpdatedEvent = UserEventBase & {
  type: "resource.content.updated";
  scope: "session" | "user" | "org";
  ref: string;
  topic?: string;
  content: string;
};

/**
 * Pushed to subscribed clients when a new collection item is created.
 * Does not include content — the client fetches if interested.
 */
export type ResourceContentCreatedEvent = UserEventBase & {
  type: "resource.content.created";
  scope: "session" | "user" | "org";
  ref: string;
  topic: string;
};

/**
 * Pushed to subscribed clients when a collection item is deleted.
 */
export type ResourceContentDeletedEvent = UserEventBase & {
  type: "resource.content.deleted";
  scope: "session" | "user" | "org";
  ref: string;
  topic: string;
};

export type ScopeStateChangedEvent = UserEventBase & {
  type: "scope.state.changed";
  scope: "session" | "user" | "org";
  scopeId: string;
  changeType: "updated" | "deleted";
};

export type SessionMetadataChangedEvent = RequestEventBase & {
  type: "session.metadata.changed";
  sessionId: string;
  title?: string;
  description?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type RequestDebugEvent = RequestEventBase & {
  type: "debug";
  name: string;
  data: unknown;
};

export type UserDebugEvent = UserEventBase & {
  type: "debug";
  name: string;
  data: unknown;
};

export type DebugEvent = RequestDebugEvent | UserDebugEvent;

export type RequestPingEvent = RequestEventBase & {
  type: "ping";
};

export type UserPingEvent = UserEventBase & {
  type: "ping";
};

export type PingEvent = RequestPingEvent | UserPingEvent;

export type RequestStreamEvent =
  | RequestCreatedEvent
  | RequestStatusEvent
  | ItemAddedEvent
  | ItemDoneEvent
  | ItemUpdatedEvent
  | ContentPartAddedEvent
  | ContentPartDeltaEvent
  | ContentPartDoneEvent
  | ContentAudioDeltaEvent
  | RequestResourceChangedEvent
  | SessionMetadataChangedEvent
  | RequestDebugEvent
  | RequestPingEvent;

export type UserStreamEvent =
  | UserResourceChangedEvent
  | ResourceContentUpdatedEvent
  | ResourceContentCreatedEvent
  | ResourceContentDeletedEvent
  | ScopeStateChangedEvent
  | UserDebugEvent
  | UserPingEvent;

export type StreamEvent = RequestStreamEvent | UserStreamEvent;
