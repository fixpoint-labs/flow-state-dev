import type { Content } from "./content";

export type ItemStatus = "in_progress" | "completed" | "incomplete" | "failed";

export type ItemProvenance = {
  blockName: string;
  blockDefinitionId?: string;
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
  transient?: boolean;
  /** Structural lifecycle item — excluded from LLM context, visible in devtool trace. */
  trace?: boolean;
  requestId: string;
  itemIndex: number;
  provenance: ItemProvenance;
  ts: number;
};

export type BlockOutputItem = OutputItemBase & {
  type: "block_output";
  blockName: string;
  blockKind?: string;
  output: unknown;
  /** Epoch ms when block execution started. */
  startedAt?: number;
  /** Epoch ms when block execution completed or failed. */
  completedAt?: number;
  /** Duration in ms (completedAt - startedAt). */
  duration?: number;
  modelUsage?: {
    model: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    providerMetadata?: Record<string, Record<string, unknown>>;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
  };
  toolCall?: {
    callId: string;
    arguments: string;
    generatorBlock: string;
  };
};

export type RouterDecisionItem = OutputItemBase & {
  type: "router_decision";
  routerName: string;
  selectedRoute: string;
};

export type MessageItem = OutputItemBase & {
  type: "message";
  role: "assistant" | "user" | "system" | "developer" | "tool";
  content: Content[];
};

export type ReasoningItem = OutputItemBase & {
  type: "reasoning";
  summary: Content[];
};

export type ComponentItem = OutputItemBase & {
  type: "component";
  component: string;
  data: Record<string, unknown>;
};

export type ContainerItem = OutputItemBase & {
  type: "container";
  blockName: string;
  component?: string;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type StatusItem = OutputItemBase & {
  type: "status";
  message: string;
  detail?: unknown;
};

export type ContextItem = OutputItemBase & {
  type: "context";
  text: string;
};

export type StateChangeItem = OutputItemBase & {
  type: "state_change";
  scope: "request" | "session" | "user" | "project" | "block_instance";
  blockInstanceId?: string;
  operation: "patch" | "set" | "increment" | "push" | "delete_key" | "atomic";
  path?: string;
  delta?: unknown;
  version: number;
};

export type ResourceChangeItem = OutputItemBase & {
  type: "resource_change";
  scope: "request" | "session" | "user" | "project";
  resourcePath: string;
  changeType: "created" | "updated" | "deleted";
  delta?: unknown;
  version?: number;
};

export type ErrorItem = OutputItemBase & {
  type: "error";
  message: string;
  code?: string;
};

export type StepErrorItem = OutputItemBase & {
  type: "step_error";
  message: string;
  code?: string;
  blockName?: string;
  recovered: boolean;
};

export type OutputItem =
  | BlockOutputItem
  | RouterDecisionItem
  | MessageItem
  | ReasoningItem
  | ComponentItem
  | ContainerItem
  | StatusItem
  | ContextItem
  | StateChangeItem
  | ResourceChangeItem
  | ErrorItem
  | StepErrorItem;
