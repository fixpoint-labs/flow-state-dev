import type { Content } from "./content";

export type ItemStatus = "in_progress" | "completed" | "incomplete" | "failed";

/**
 * @deprecated Legacy visibility role. Retained only for the deprecated
 * `resolveItemRole()` shim. Do not use in new code.
 */
export type ItemRole = "external" | "internal" | "trace";

/**
 * Resolved visibility of an item: whether it should be sent to the client
 * and whether it should be included in LLM conversation history.
 */
export type ItemVisibility = {
  client: boolean;
  history: boolean;
};

/**
 * Identity classification for the generator that produced an item.
 *
 * - `"agent"`: a user-facing agent. Items flow to the client and into
 *   conversation history.
 * - `"sub-agent"`: a task-executor under an agent. Items flow to the client
 *   (for observability / live rendering) but are excluded from conversation
 *   history — sub-agents are deaf to the broader conversation by design.
 * - `"trace"`: items produced for observability only (devtool/replay). They
 *   do not reach the client SSE stream and are not in history.
 *
 * A generator that declares no `agentType` produces no auto-emitted items —
 * only its typed `block_output` flows to parents via graph edges.
 */
export type AgentType = "agent" | "sub-agent" | "trace";

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
  requestId: string;
  itemIndex: number;
  provenance: ItemProvenance;
  ts: number;
  /** When set, this item was emitted inside a container scope. The value is the
   *  `blockInstanceId` of the sequencer/router that declared the container. */
  ownedBy?: string;
  /**
   * Identity of the generator that produced this item. Governs visibility
   * via `resolveItemVisibility()` for conversational item types
   * (`message`, `reasoning`, `block_tool_output`). Structural items
   * (status, component, block_output, etc.) ignore this field.
   */
  agentType?: AgentType;
  /**
   * Stable name of the producing agent. Defaults to the generator's block
   * `name` when `agentType` is set. Multiple generators that share an
   * `agentName` collaborate (same logical agent across instances); distinct
   * names stay isolated.
   */
  agentName?: string;
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
  /** When false, the client may send new actions even though the stream is still open. */
  blocked?: boolean;
  /** Number of background work tasks still running. */
  backgroundTasks?: number;
};

/**
 * @deprecated The `context` item type has been removed. Use generator
 * `context` slot configuration or `emitMessage` with `history: true,
 * client: false` instead.
 */
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

/**
 * Full state snapshot emitted at a step boundary for devtool inspection.
 * Today only sequencers emit these; the type is kind-agnostic so any future
 * block with stepped state can reuse it. The owning block is identified by
 * `provenance.blockName` / `provenance.blockInstanceId`, so no separate
 * sequencer-specific fields are carried.
 */
export type StateSnapshotItem = OutputItemBase & {
  type: "state_snapshot";
  stepName: string;
  stepIndex: number;
  state: unknown;
  version: number;
};

/**
 * Resolved block observability data captured at runtime. Emitted only when it
 * reveals something not inferable from surrounding items:
 *   - Generators: the resolved prompt, model, and registered tools.
 *   - Any block with a `connectInput` connector that transformed raw input:
 *     the transformed value, so debugging isn't guessing what the block
 *     actually received vs. what the previous block emitted.
 *
 * Blocks with none of the above (most handlers/sequencers/routers) emit no
 * debug item at all. Replace-in-place per block instance on the client.
 */
export type BlockDebugPayload = {
  /** Resolved model identifier (generators only). */
  model?: string;
  /** Fully assembled prompt as sent to the model (generators only). */
  prompt?: string;
  /** Registered tool names (generators only). */
  tools?: string[];
  /** Input after `connectInput` transformation. Only set when the connector
   *  actually changed the value — otherwise the previous block's output is
   *  the input, already visible via block_output. */
  connectedInput?: unknown;
};

/** Resolved block configuration snapshot emitted at block start for devtool debugging.
 *  Always transient and trace-only — never persisted, never sent to LLM context. */
export type BlockDebugItem = OutputItemBase & {
  type: "block_debug";
  blockName: string;
  blockKind: "generator" | "handler" | "sequencer" | "router";
  blockInstanceId: string;
  payload: BlockDebugPayload;
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
  | StateChangeItem
  | ResourceChangeItem
  | ErrorItem
  | StepErrorItem
  | SourceItem
  | StateSnapshotItem
  | BlockDebugItem;
