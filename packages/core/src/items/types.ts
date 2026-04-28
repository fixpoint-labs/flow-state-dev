import type { Content } from "./content";

export type ItemStatus = "in_progress" | "completed" | "incomplete" | "failed";

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
 * - `"primary"`: a user-facing agent. Items flow to the client and into
 *   conversation history.
 * - `"sub"`: a task-executor under a primary agent. Items flow to the client
 *   (for observability / live rendering) but are excluded from conversation
 *   history — sub-agents are deaf to the broader conversation by design.
 * - `"trace"`: items produced for observability only (devtool/replay). They
 *   do not reach the client SSE stream and are not in history.
 *
 * A generator that declares no `agentType` produces no auto-emitted items —
 * only its typed `block_output` flows to parents via graph edges.
 */
export type AgentType = "primary" | "sub" | "trace";

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

/**
 * Discriminated union describing how a block's `output` item carries its content.
 *
 * - `inline` — the block produced novel content. Leaves (generators, handlers)
 *   and explicit transforms (`.map`, `connectOutput`) use this kind.
 * - `ref` — the block's output is reference-identical to another item's content.
 *   Pass-through composers (`.then`, `.work`, `.tap`, routers, `.rescue`) use this
 *   kind to avoid duplicating content at every nesting level.
 * - `structure` — the block produced a novel container whose slots are refs or
 *   inlines. Aggregators (`.thenAll`, `.parallel`, `.forEach`) use this kind.
 *
 * Invariants:
 * - Every `ref` points one hop to a content-bearing item (never another ref).
 *   This is guaranteed by flatten-at-emit in the executor.
 * - The union kind is determined by the builder step that constructed the block,
 *   not by runtime equality. Consumers can reason about composition intent from
 *   the shape: `inline` on a sequencer means a transform happened at that node.
 *
 * See FIX-413 for the design rationale and the full per-method kind table.
 */
export type BlockValue<T = unknown> =
  | { kind: "inline"; value: T }
  | { kind: "ref"; sourceItemId: string }
  | { kind: "structure"; shape: StructureShape };

/**
 * Shape of a `structure` BlockValue: a container of nested BlockValues.
 * Used by aggregators that produce a novel array or object of existing content.
 */
export type StructureShape =
  | { container: "array"; entries: BlockValue<unknown>[] }
  | { container: "object"; entries: Record<string, BlockValue<unknown>> };

export type BlockOutputItem = OutputItemBase & {
  type: "block_output";
  blockName: string;
  blockKind?: string;
  /**
   * Block output as a BlockValue discriminated union. See {@link BlockValue}.
   * Resolve via `resolveBlockValue(item.output, lookup)` to recover the typed
   * payload `T`. `ctx.getBlockOutput()` resolves transparently.
   */
  output: BlockValue<unknown>;
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
  scope: "request" | "session" | "user" | "org" | "block_instance";
  blockInstanceId?: string;
  operation: "patch" | "set" | "increment" | "push" | "delete_key" | "atomic";
  path?: string;
  delta?: unknown;
  version: number;
};

export type ResourceChangeItem = OutputItemBase & {
  type: "resource_change";
  scope: "request" | "session" | "user" | "org";
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
 * Full state snapshot emitted at a step boundary for devtool inspection
 * and durable checkpointing (FIX-401).
 *
 * Sequencers emit one logical snapshot per instance, keyed by `key`
 * (the sequencer's `blockInstanceId`). Subsequent emissions for the same
 * key are in-place updates, not new entries — clients and middleware
 * dedupe on `key`.
 *
 * - `durable: true` — also written to `stores.checkpoints` so the Phase 2
 *   resume runtime (FIX-141) can pick up after an interrupted request.
 * - `durable: false` — stream-only, observability for the devtool.
 * - `terminal: true` — final emission for this sequencer's run (success,
 *   error, or cancellation). Durability middleware treats terminal frames
 *   as a `delete(requestId, blockInstanceId)` signal so the checkpoint
 *   store stays clean once the sequencer completes.
 *
 * The owning block is identified by `provenance.blockName` /
 * `provenance.blockInstanceId`; no sequencer-specific identity fields are
 * duplicated here.
 */
export type StateSnapshotItem = OutputItemBase & {
  type: "state_snapshot";
  /** Stable dedup key — set to the sequencer's `blockInstanceId`. */
  key: string;
  stepName: string;
  stepIndex: number;
  state: unknown;
  /** Monotonic write counter for this sequencer instance. */
  version: number;
  /** When true, also persist this snapshot to `stores.checkpoints`. */
  durable: boolean;
  /** When true, this is the final emission for the sequencer run; durability
   *  middleware should `delete` rather than `write`. */
  terminal?: boolean;
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
