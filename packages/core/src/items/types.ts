import type { Content } from "./content";

export type ItemStatus = "in_progress" | "completed" | "incomplete" | "failed";
export type ItemVisibility = "ui" | "llm" | "both" | "internal";

export type ItemProvenance = {
  blockName: string;
  blockInstanceId: string;
  parentBlockInstanceId?: string;
  phase: "main" | "work";
  stepIndex?: number;
  workGroupId?: string;
  attempt?: number;
};

export type OutputItemBase = {
  id: string;
  type: string;
  status: ItemStatus;
  visibility: ItemVisibility;
  transient?: boolean;
  requestId: string;
  itemIndex: number;
  provenance: ItemProvenance;
  ts: number;
};

export type MessageItem = OutputItemBase & {
  type: "message";
  role: "assistant" | "user" | "system" | "developer" | "tool";
  content: Content[];
};

export type FunctionCallItem = OutputItemBase & {
  type: "function_call";
  callId: string;
  name: string;
  arguments: string;
};

export type FunctionCallOutputItem = OutputItemBase & {
  type: "function_call_output";
  callId: string;
  output: string;
};

export type ReasoningItem = OutputItemBase & {
  type: "reasoning";
  summary: Content[];
};

export type BlockOutputItem = OutputItemBase & {
  type: "fsd:block_output";
  blockName: string;
  renderName?: string;
  output: unknown;
};

export type StatusItem = OutputItemBase & {
  type: "fsd:status";
  message: string;
  detail?: unknown;
};

export type ResourceUpdateItem = OutputItemBase & {
  type: "fsd:resource_update";
  scope: "request" | "session" | "user" | "project";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
};

export type ErrorItem = OutputItemBase & {
  type: "fsd:error";
  message: string;
  code?: string;
};

export type StepErrorItem = OutputItemBase & {
  type: "fsd:step_error";
  message: string;
  code?: string;
  blockName?: string;
  recovered: boolean;
};

export type SuspendItem = OutputItemBase & {
  type: "fsd:suspend";
  reason: string;
  data?: unknown;
  resumeSchema?: unknown;
};

export type DebugItem = OutputItemBase & {
  type: "fsd:debug";
  name: string;
  data: unknown;
};

export type StandaloneFileItem = OutputItemBase & {
  type: "fsd:file";
  mediaType: string;
  data: string;
  filename?: string;
};

export type OutputItem =
  | MessageItem
  | FunctionCallItem
  | FunctionCallOutputItem
  | ReasoningItem
  | BlockOutputItem
  | StatusItem
  | ResourceUpdateItem
  | ErrorItem
  | StepErrorItem
  | SuspendItem
  | DebugItem
  | StandaloneFileItem;
