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
  /** When set, this item was emitted inside a container scope. The value is the
   *  `blockInstanceId` of the sequencer/router that declared the container. */
  ownedBy?: string;
};

export type BlockOutputItem = OutputItemBase & {
  type: "block_output";
  blockName: string;
  blockKind?: string;
  output: unknown;
  /** Present when block execution failed (status will be "failed"). */
  error?: {
    message: string;
    code?: string;
  };
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

/** Tool result emitted when a block executes as a tool within a generator. */
export type BlockToolOutputItem = OutputItemBase & {
  type: "block_tool_output";
  blockName: string;
  output: unknown;
  toolCall: {
    callId: string;
    name: string;
    arguments: string;
    generatorBlock: string;
  };
  /** Present when the tool execution failed (status will be "failed"). */
  error?: {
    message: string;
    code?: string;
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
  /** Caller-provided stable identity for deduplication. When present, clients
   *  should show only the latest item with a given key (replacing prior ones). */
  key?: string;
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

/** Source reference emitted by provider-native tools (e.g., web search). */
export type SourceItem = OutputItemBase & {
  type: "source";
  sourceType: "url";
  sourceId: string;
  url: string;
  title?: string;
  providerMetadata?: Record<string, Record<string, unknown>>;
};

/** Suspension status indicating the current state of a HITL suspension point. */
export type SuspensionStatus = "pending" | "approved" | "rejected" | "timed_out";

/**
 * Emitted when a block calls `ctx.suspend()` to pause execution for human input.
 * The item starts with suspensionStatus "pending" and transitions to a terminal
 * status when the resume endpoint is called or the timeout fires.
 */
export type SuspensionItem = OutputItemBase & {
  type: "suspension";
  suspensionId: string;
  /** The suspension-specific status (distinct from the item lifecycle status). */
  suspensionStatus: SuspensionStatus;
  /** Human-readable reason for the suspension. */
  reason: string;
  /** Structured data the client needs to render the approval UI. */
  data?: Record<string, unknown>;
  /** Optional component descriptor for custom client-side rendering. */
  render?: { component: string; props?: Record<string, unknown> };
  /** Populated after resume with the data provided by the client. */
  resumeData?: unknown;
};

export type OutputItem =
  | BlockOutputItem
  | BlockToolOutputItem
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
  | StepErrorItem
  | SourceItem
  | SuspensionItem;
