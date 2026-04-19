import type { Content } from "./content";

export type ItemStatus = "in_progress" | "completed" | "incomplete" | "failed";

/**
 * Visibility role of an item within the system. Answers "who is this for?"
 *
 * - `external`: shown to the user, included in LLM history, visible in devtool.
 * - `internal`: included in LLM history, hidden from UI, visible in devtool.
 * - `trace`: observability only — excluded from UI and LLM history, visible in devtool.
 *
 * The hierarchy is strict: `external ⊃ internal ⊃ trace`. An item shown to the
 * user is always also in history; an item hidden from history is also hidden
 * from the UI. To suppress an item entirely, set `emit: false` on the block.
 */
/**
 * @deprecated Use `client` and `history` boolean flags instead. Kept for
 * backward compatibility — `resolveItemVisibility()` maps legacy roles to
 * the new booleans at read time.
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
  /** Whether this item is sent to connected clients. When unset, resolved
   *  from per-type defaults via `resolveItemVisibility()`. */
  client?: boolean;
  /** Whether this item is included in LLM conversation history. When unset,
   *  resolved from per-type defaults via `resolveItemVisibility()`. */
  history?: boolean;
  /**
   * @deprecated Use `client` and `history` booleans instead.
   * Retained for backward compatibility with pre-boolean items.
   * `resolveItemVisibility()` maps this to booleans as a fallback.
   */
  itemRole?: ItemRole;
  /**
   * @deprecated Use `client: false, history: false` instead. Retained for
   * backward compatibility with pre-role items.
   */
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

/** Full state snapshot emitted at sequencer step boundaries for devtool inspection. */
export type SequencerStateSnapshotItem = OutputItemBase & {
  type: "sequencer_state_snapshot";
  sequencerName: string;
  sequencerInstanceId: string;
  stepName: string;
  stepIndex: number;
  state: unknown;
  version: number;
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
  | SequencerStateSnapshotItem;
