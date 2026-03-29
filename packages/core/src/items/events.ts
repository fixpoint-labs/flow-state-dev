import type { Content } from "./content";
import type { OutputItem } from "./types";

export type RequestStatus = "in_progress" | "completed" | "incomplete" | "failed" | "interrupted";

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

export type RequestResourceChangedEvent = RequestEventBase & {
  type: "resource.changed";
  scope: "request";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};

export type UserResourceChangedEvent = UserEventBase & {
  type: "resource.changed";
  scope: "session" | "user" | "project";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};

export type ResourceChangedEvent = RequestResourceChangedEvent | UserResourceChangedEvent;

export type ScopeStateChangedEvent = UserEventBase & {
  type: "scope.state.changed";
  scope: "session" | "user" | "project";
  scopeId: string;
  changeType: "updated" | "deleted";
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
  | ContentPartAddedEvent
  | ContentPartDeltaEvent
  | ContentPartDoneEvent
  | RequestResourceChangedEvent
  | RequestDebugEvent
  | RequestPingEvent;

export type UserStreamEvent =
  | UserResourceChangedEvent
  | ScopeStateChangedEvent
  | UserDebugEvent
  | UserPingEvent;

export type StreamEvent = RequestStreamEvent | UserStreamEvent;
