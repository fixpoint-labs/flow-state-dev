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
 * only its typed `block_trace` output flows to parents via graph edges.
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
  /**
   * Stable identity for the item. Most items mint a fresh random ID per
   * emission; keyed component items are an exception (see
   * {@link ComponentItem.key}).
   */
  id: string;
  type: string;
  status: ItemStatus;
  /**
   * When true, the item is delivered to live SSE consumers but never
   * persisted to the session log or replayed on history reload.
   *
   * Composes orthogonally with {@link ComponentItem.key}: see the "keyed
   * snapshot" pattern in `apps/docs/docs/streaming/emitting-items.md` for
   * the full transient × key matrix.
   */
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
   * (`message`, `reasoning`, `tool_output`). Structural items
   * (status, component, block_trace, etc.) ignore this field.
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
  | { kind: "structure"; shape: StructureShape };

/**
 * Internal-only BlockValue. Adds the `ref` case used by pass-through
 * composers (`.then`, `.work`, `.tap`, routers, `.rescue`) to avoid
 * duplicating content. Public consumers see only `inline | structure`
 * via {@link BlockValue}; the executor and persistence layers thread
 * `BlockValueInternal` through.
 */
export type BlockValueInternal<T = unknown> =
  | { kind: "inline"; value: T }
  | { kind: "ref"; sourceItemId: string }
  | { kind: "structure"; shape: StructureShape };

/**
 * Shape of a `structure` BlockValue: a container of nested BlockValues.
 * Entries use the internal value type because structures may transitively
 * contain refs.
 */
export type StructureShape =
  | { container: "array"; entries: BlockValueInternal<unknown>[] }
  | { container: "object"; entries: Record<string, BlockValueInternal<unknown>> };

/**
 * Unified block trace item — the single record describing one block's execution
 * across its lifecycle (added → input → generator → output). Replaces the prior
 * split between `block_output` (terminal) and `block_debug` (start-time).
 *
 * Items emit at block start with `status: "in_progress"` and are updated in
 * place as more becomes known: post-`connectInput` value, generator config
 * resolution, and final output / error / timing. The id is stable across the
 * full lifecycle so the devtool, replay tools, and the trace store can index
 * one row per block instance.
 *
 * Shape rules:
 * - `input.source` is the BlockValue describing where the block's raw input
 *   came from (a ref to the previous step's item, an inline literal at the
 *   sequencer head, or a structure for fan-in shapes).
 * - `input.connected` is set only when `connectInput` actually transformed
 *   the value — otherwise the connector was a no-op and the source is the
 *   effective input.
 * - `generator` is populated post-config-resolution for generator blocks.
 *   Optional nested object so consumers read with optional chaining.
 * - `output` is set on completion. Carries the BlockValue (inline / ref /
 *   structure) so pass-through composers don't duplicate content at every
 *   level.
 */
export type BlockTraceItem = OutputItemBase & {
  type: "block_trace";
  blockName: string;
  blockKind: "generator" | "handler" | "sequencer" | "router";
  blockInstanceId: string;
  status: "in_progress" | "completed" | "failed" | "planned";
  input?: {
    source: BlockValueInternal<unknown>;
    connected?: unknown;
  };
  output?: BlockValueInternal<unknown>;
  generator?: {
    model: string;
    tools: string[];
    prompt: string;
    user?: unknown[];
    history?: unknown[];
  };
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
  startedAt?: number;
  completedAt?: number;
  duration?: number;
  error?: {
    message: string;
    code?: string;
    /**
     * Open structured payload attached at failure time. Runtime auto-populates
     * well-known keys (`rawOutput`, `issues`, `phase`) for generator
     * output-validation failures; author-thrown `FlowError.details` flows
     * through verbatim.
     */
    details?: Record<string, unknown>;
  };
};

/** Tool result emitted when a block executes as a tool within a generator. */
export type ToolOutputItem = OutputItemBase & {
  type: "tool_output";
  blockName: string;
  output: unknown;
  toolCall: {
    callId: string;
    /**
     * Framework block name (e.g. `tf.memory/recall`). Used for UI display
     * and observability. Matches the registered block, including framework
     * naming conventions like `.` and `/`.
     */
    name: string;
    /**
     * Model-facing sanitized alias the LLM saw and called (e.g.
     * `tf_memory_recall`). When present, history replay uses this directly
     * for the `toolName` field on serialised tool-call / tool-result content
     * parts — the value is already known to satisfy provider name patterns
     * (notably OpenAI's `^[a-zA-Z0-9_-]+$`). Optional for backward
     * compatibility with items persisted before this field existed; the
     * replay path falls back to `sanitizeToolName(name)` when absent.
     */
    alias?: string;
    arguments: string;
    generatorBlock: string;
  };
  /** Present when the tool execution failed (status will be "failed"). */
  error?: {
    message: string;
    code?: string;
    /**
     * Open structured payload attached at failure time. Shape matches
     * `BlockTraceItem.error.details` so the two items render identically.
     */
    details?: Record<string, unknown>;
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
  /**
   * Message content parts. `output_text` parts accumulate `text` in-place
   * during streaming: each `content.delta` event mutates the current
   * snapshot held inside the emitter, and consumers reading
   * `response.getItems()` observe the latest accumulated text. The final
   * `item.done` payload supersedes any mid-stream accumulation, so the
   * authoritative final text always comes from the generator's terminal
   * emission. Aborted streams may leave a partial-token tail in the
   * persisted snapshot — this is a deliberate trade-off (see FIX-479).
   */
  content: Content[];
};

export type ReasoningItem = OutputItemBase & {
  type: "reasoning";
  /**
   * Reasoning summary parts. `reasoning_text` parts accumulate `text`
   * in-place during streaming via the same `content.delta` channel as
   * message text (see {@link MessageItem.content}).
   */
  summary: Content[];
};

export type ComponentItem = OutputItemBase & {
  type: "component";
  component: string;
  data: Record<string, unknown>;
  /**
   * Caller-provided stable identity for deduplication.
   *
   * Combined with `transient: false`, this expresses the **keyed snapshot**
   * pattern — one logical entity whose latest state replays on reload.
   * Keyed emissions upsert: the item ID is derived from `key`, the persisted
   * record holds one entry per `(requestId, key)`, and `data` is replaced
   * (not merged) on each emission. The SSE event log still appends per
   * emission. See `apps/docs/docs/streaming/emitting-items.md`.
   */
  key?: string;
};

/**
 * Visual grouping emitted by sequencers and routers that declare a `container`
 * config. Lifecycle: `item.added` with `status: "in_progress"` when the
 * sequencer scope opens; `item.updated` patching `status`, `completedAt`,
 * `duration` (and `error` on failure) when the scope closes; finally
 * `item.done` with the terminal status. Public-stream consumers see a live
 * in-flight signal for sequencer execution.
 */
export type ContainerItem = OutputItemBase & {
  type: "container";
  blockName: string;
  component?: string;
  label?: string;
  metadata?: Record<string, unknown>;
  /** Wall-clock time the sequencer/router scope opened. */
  startedAt?: number;
  /** Wall-clock time the scope closed (success or failure). */
  completedAt?: number;
  /** `completedAt - startedAt`, in ms. */
  duration?: number;
  /** Set on failure with the throwing error's message. */
  error?: { message: string };
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

export type OutputItem =
  | MessageItem
  | ReasoningItem
  | ToolOutputItem
  | ComponentItem
  | ContainerItem
  | SourceItem
  | StatusItem
  | ErrorItem
  | StateChangeItem
  | ResourceChangeItem;
