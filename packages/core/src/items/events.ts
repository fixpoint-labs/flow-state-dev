import type { Content } from "./content";
import type { OutputItem } from "./types";

export type RequestStatus = "in_progress" | "completed" | "incomplete" | "failed";

export type EventBase = {
  requestId: string;
  sequence_number: number;
  ts: number;
};

export type RequestCreatedEvent = EventBase & {
  type: "request.created";
  status: "in_progress";
};

export type RequestStatusEvent = EventBase & {
  type: "request.in_progress" | "request.completed" | "request.incomplete" | "request.failed";
  status: RequestStatus;
};

export type ItemAddedEvent = EventBase & {
  type: "item.added";
  item: OutputItem;
};

export type ItemDoneEvent = EventBase & {
  type: "item.done";
  item: OutputItem;
};

export type ContentPartAddedEvent = EventBase & {
  type: "content.added";
  itemId: string;
  contentIndex: number;
  content: Content;
};

export type ContentPartDeltaEvent = EventBase & {
  type: "content.delta";
  itemId: string;
  contentIndex: number;
  delta: string;
};

export type ContentPartDoneEvent = EventBase & {
  type: "content.done";
  itemId: string;
  contentIndex: number;
  content: Content;
};

export type ResourceChangedEvent = EventBase & {
  type: "resource.changed";
  scope: "request" | "session" | "user" | "project";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};

export type DebugEvent = EventBase & {
  type: "debug";
  name: string;
  data: unknown;
};

export type PingEvent = EventBase & {
  type: "ping";
};

export type StreamEvent =
  | RequestCreatedEvent
  | RequestStatusEvent
  | ItemAddedEvent
  | ItemDoneEvent
  | ContentPartAddedEvent
  | ContentPartDeltaEvent
  | ContentPartDoneEvent
  | ResourceChangedEvent
  | DebugEvent
  | PingEvent;
