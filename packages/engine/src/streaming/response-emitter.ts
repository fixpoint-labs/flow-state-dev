/**
 * Request-scoped stream event emitter that buffers events/items and supports replay/inspection.
 */
import type {
  Content,
  ContentAudioDeltaEvent,
  ContentPartAddedEvent,
  ContentPartDeltaEvent,
  ContentPartDoneEvent,
  ItemAddedEvent,
  ItemDoneEvent,
  ItemProvenance,
  ItemUpdatedEvent,
  OutputItem,
  RequestDebugEvent,
  RequestCreatedEvent,
  RequestPingEvent,
  RequestResourceChangedEvent,
  RequestStatus,
  RequestStatusEvent,
  RequestStreamEvent,
  ResourceChangeItem
} from "@flow-state-dev/core/items";
import { ITEM_UPDATE_INVARIANT_KEYS } from "@flow-state-dev/core/items";

export type { RuntimeItem } from "../execution/internal/response";
import type { RuntimeItem } from "../execution/internal/response";
import type { ResponseEmitterHandle } from "@flow-state-dev/core/types";
import { uint8ArrayToBase64 } from "./binary";
import { createRequestEventId } from "./encode-event";
import {
  applyEnvelopeSeam,
  applyItemSeam,
  NOOP_INTERNAL_STREAMING_SEAMS,
  type InternalStreamingSeams
} from "./internal/seams";
import { createStreamEnvelope } from "./types";

export type RequestStreamEventWithId = RequestStreamEvent & {
  id: string;
};

type RequestEventDraft<TEvent extends RequestStreamEvent> = Omit<
  TEvent,
  "stream" | "requestId" | "sequence_number" | "ts"
>;

export type CreateResponseEmitterOptions = {
  requestId: string;
  startSequenceNumber?: number;
  /**
   * Starting item index for this emitter — the next item it assigns gets
   * `startItemIndex + (items emitted so far)`. A same-request continuation
   * (FIX-811) seeds this from the suspended request's last persisted item
   * index so re-entry items (`suspension_resume` + post-resume items) continue
   * after the pre-suspension log instead of restarting at `0`. Without it,
   * persistent stores that order items by index (e.g. SQLite `ORDER BY
   * sequence ASC`) would interleave the re-entry items ahead of the prior log
   * and break the `pre + suspension + suspension_resume + post` ordering.
   */
  startItemIndex?: number;
  maxBufferSize?: number;
  now?: () => number;
  onEvent?: (event: RequestStreamEventWithId) => Promise<void> | void;
};

type CreateInternalResponseEmitterOptions = CreateResponseEmitterOptions & {
  internalSeams?: InternalStreamingSeams;
};

const DEFAULT_PROVENANCE: ItemProvenance = {
  blockName: "runtime",
  blockInstanceId: "runtime",
  phase: "main"
};

export type ResponseEmitterItemHooks = {
  /** Fires once an item reaches a terminal status via `item.done`. */
  onItemDone?: (item: RuntimeItem) => void;
  /**
   * Fires when an in-flight item's content is mutated by a streaming
   * `content.delta` event (FIX-479). Both `MessageItem.content[i].text`
   * and `ReasoningItem.summary[i].text` accumulation flow through this
   * hook so callers can checkpoint the running snapshot to durable
   * storage at a coalesced cadence. The hook is synchronous and not a
   * durability barrier — it does not gate the wire push and is not
   * awaited. For per-event durability use the events log via
   * `setEventHooks`; this hook covers snapshot-style checkpointing of
   * the items field.
   */
  onItemUpdate?: (item: RuntimeItem) => void;
};

export type ResponseEmitterEventHooks = {
  onEvent?: (events: RequestStreamEventWithId[]) => void;
  /**
   * Awaitable durability barrier. When provided, the emitter awaits this
   * after `onEvent` and before publishing to the wire so the client never
   * observes an event that isn't yet durable (FIX-399). Without this hook,
   * persistence remains fire-and-forget (legacy behavior, useful for tests).
   */
  flushEvents?: () => Promise<void>;
  /**
   * Invoked when `flushEvents` rejects. Lets operators surface persistence
   * failures instead of silently swallowing them. The error is also re-thrown
   * from `appendEvent` so the producing block fails loud.
   */
  onPersistError?: (error: Error) => void;
};

const DEFAULT_MAX_BUFFER_SIZE = 10_000;

function isRequestStreamDraft(value: unknown): value is {
  type: RequestStreamEvent["type"];
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === "string";
}

/**
 * Removes identity-invariant keys from an `item.updated` patch so producers
 * cannot accidentally rewrite the item's identity when emitting a delta.
 * Returns a fresh object — never mutates the caller's input.
 */
function stripInvariantKeys(
  patch: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(patch)) {
    if ((ITEM_UPDATE_INVARIANT_KEYS as ReadonlyArray<string>).includes(key)) {
      continue;
    }
    result[key] = patch[key];
  }
  return result;
}

function isOutputItem(value: unknown): value is OutputItem {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.type === "string" &&
    typeof candidate.itemIndex === "number"
  );
}

/**
 * True when the event carries (or refers to) an item with `transient: true`.
 *
 * `item.added` / `item.done` carry the full item inline. The other item-bound
 * events (`item.updated`, `content.*`) reference the item by id, so the lookup
 * goes through `itemsById` — which the caller has already populated for
 * `item.added` before `appendEvent` runs. Non-item-bound events (request.*,
 * ping, debug, resource_changed) return false; they're never transient at
 * this layer.
 */
function isTransientItemEvent(
  event: RequestStreamEventWithId,
  itemsById: ReadonlyMap<string, OutputItem>
): boolean {
  if (event.type === "item.added" || event.type === "item.done") {
    return (event.item as { transient?: boolean }).transient === true;
  }
  if (
    event.type === "item.updated" ||
    event.type === "content.added" ||
    event.type === "content.delta" ||
    event.type === "content.done"
  ) {
    const item = itemsById.get(event.itemId);
    return item?.transient === true;
  }
  return false;
}

/**
 * Stateful request event emitter used by runtime execution and SSE transport.
 */
export class ResponseEmitter implements ResponseEmitterHandle {
  private readonly requestId: string;
  private readonly now: () => number;
  private readonly onEvent?: (event: RequestStreamEventWithId) => Promise<void> | void;
  private readonly internalSeams: InternalStreamingSeams;
  private readonly maxBufferSize: number;
  private sequenceNumber: number;
  private readonly baseItemIndex: number;
  private readonly events: RequestStreamEventWithId[] = [];
  private readonly itemsById = new Map<string, OutputItem>();
  private onLogEvent?: (eventType: string, detail: Record<string, unknown>) => void;
  private droppedBufferedEvents = 0;
  private readonly eventObservers: Array<(event: RequestStreamEventWithId) => void> = [];
  private itemHooks?: ResponseEmitterItemHooks;
  private eventHooks?: ResponseEmitterEventHooks;
  private readonly itemListeners = new Set<{
    listener: (item: OutputItem, kind: "added" | "updated" | "done") => void;
    filter?: (item: OutputItem, kind: "added" | "updated" | "done") => boolean;
  }>();

  /**
   * Creates a request-scoped emitter instance.
   */
  constructor(options: CreateInternalResponseEmitterOptions) {
    this.requestId = options.requestId;
    this.sequenceNumber = Math.max(0, options.startSequenceNumber ?? 0);
    this.baseItemIndex = Math.max(0, options.startItemIndex ?? 0);
    this.maxBufferSize = Math.max(1, options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE);
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
    this.internalSeams = options.internalSeams ?? NOOP_INTERNAL_STREAMING_SEAMS;
  }

  /**
   * Registers an event observer that is called after each event is emitted.
   * Used by the TTS pipeline to intercept content deltas for synthesis.
   */
  addEventObserver(fn: (event: RequestStreamEventWithId) => void): void {
    this.eventObservers.push(fn);
  }

  /**
   * Sets a logging callback for item and content lifecycle events.
   * @internal Used by the execution layer for runtime observability.
   */
  setLogCallback(fn: (eventType: string, detail: Record<string, unknown>) => void): void {
    this.onLogEvent = fn;
  }

  /**
   * Registers hooks that fire when items reach terminal status.
   * Used by the execution layer for incremental item persistence.
   */
  setItemHooks(hooks: ResponseEmitterItemHooks): void {
    this.itemHooks = hooks;
  }

  /**
   * Subscribes to subsequent item lifecycle transitions on this emitter
   * (FIX-621). `kind` is `"added"` for fresh items, `"updated"` for in-place
   * mutations (item.updated and streaming content.delta), and `"done"` for
   * terminal status. Returns an idempotent unsubscribe — calling it more
   * than once is a no-op. Listener errors are isolated: a throw routes to
   * a debug event and other listeners still fire.
   *
   * Fan-out uses snapshot semantics: the listener set is copied before
   * iteration, so a listener that unsubscribes itself (or registers a new
   * listener) mid-fan-out does not corrupt the in-flight loop. A listener
   * registered during fan-out only sees subsequent events.
   *
   * When `options.filter` is provided, the listener is skipped for events
   * the filter returns false for (FIX-660). Filter throws are caught and
   * the listener STILL fires (fail-open) — a filter that throws is a
   * caller bug; failing closed would silently produce 5-second
   * `.waitForCondition` timeouts with nothing in the trace explaining why.
   */
  subscribeToItems(
    listener: (item: OutputItem, kind: "added" | "updated" | "done") => void,
    options?: {
      filter?: (item: OutputItem, kind: "added" | "updated" | "done") => boolean;
    }
  ): () => void {
    const entry = { listener, filter: options?.filter };
    this.itemListeners.add(entry);
    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.itemListeners.delete(entry);
    };
  }

  /**
   * Fans out an item transition to all currently-registered listeners.
   * Snapshots the listener set first so in-flight unsubscribe/subscribe
   * calls do not affect the current iteration. Per-listener filters are
   * evaluated against the snapshot entry; listener and filter exceptions
   * are both isolated via debug events and do not propagate.
   */
  private fanoutItemEvent(
    item: OutputItem,
    kind: "added" | "updated" | "done"
  ): void {
    const snapshot = Array.from(this.itemListeners);
    for (const entry of snapshot) {
      let pass = true;
      if (entry.filter !== undefined) {
        try {
          pass = entry.filter(item, kind);
        } catch (err) {
          void this.emitDebug("response.subscribeToItems.filter_threw", {
            err: String(err),
            itemType: item.type
          });
          // Fail-open: a throwing filter is a caller bug; silently
          // skipping the listener would surface as a phantom timeout.
          pass = true;
        }
      }
      if (!pass) continue;
      try {
        entry.listener(item, kind);
      } catch (err) {
        // Fire-and-forget — emitDebug is async but we deliberately don't
        // await it inside the fan-out loop to avoid serializing listeners
        // behind the debug-event persistence path.
        void this.emitDebug("response.subscribeToItems.listener_threw", {
          err: String(err)
        });
      }
    }
  }

  /**
   * Registers hooks for incremental event persistence.
   * Called after each replayable event with only the newly emitted event(s).
   */
  setEventHooks(hooks: ResponseEmitterEventHooks): void {
    this.eventHooks = hooks;
  }

  /**
   * Emits a draft request event if shape is valid; otherwise emits an internal debug event.
   *
   * Item events (`item.added`, `item.done`) are routed through the tracking helpers
   * so that items are captured in `getItems()` and available for persistence/replay.
   */
  async emit(event: unknown): Promise<void> {
    if (!isRequestStreamDraft(event)) {
      await this.emitDebug("response.emit.invalid", { value: event });
      return;
    }

    const draft = event as Record<string, unknown>;

    // Route item events through tracking helpers so items are persisted.
    if (draft.type === "item.added" && isOutputItem(draft.item)) {
      await this.emitItemAdded(draft.item as OutputItem);
      return;
    }

    if (draft.type === "item.done" && isOutputItem(draft.item)) {
      await this.emitItemDone(draft.item as OutputItem);
      return;
    }

    if (
      draft.type === "item.updated" &&
      typeof draft.itemId === "string" &&
      typeof draft.patch === "object" &&
      draft.patch !== null
    ) {
      await this.emitItemUpdated(
        draft.itemId,
        draft.patch as Record<string, unknown>
      );
      return;
    }

    await this.appendEvent(
      event as RequestEventDraft<RequestStreamEvent>
    );
  }

  /**
   * Emits the canonical request-created event.
   */
  async emitRequestCreated(): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestCreatedEvent>({
      type: "request.created",
      status: "in_progress"
    });
  }

  /**
   * Emits a request status transition event.
   */
  async emitRequestStatus(
    status: RequestStatus
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestStatusEvent>({
      type: `request.${status}`,
      status
    });
  }

  /**
   * Emits an item-added event and tracks the item for later item views.
   */
  async emitItemAdded(item: OutputItem): Promise<RequestStreamEventWithId> {
    const interceptedItem = applyItemSeam(
      this.internalSeams,
      item,
      "item.added"
    );
    this.itemsById.set(interceptedItem.id, interceptedItem);
    this.fanoutItemEvent(interceptedItem, "added");

    // Skip the runtime log line for transient items. Long-lived polling
    // patterns (task-board claim-task / check-board) emit hundreds of
    // these per second; logging each one floods stderr without adding
    // operator value. Persistence and wire delivery are unchanged below.
    if (interceptedItem.transient !== true) {
      this.onLogEvent?.("item.added", {
        itemId: interceptedItem.id,
        itemType: interceptedItem.type,
        blockName: interceptedItem.provenance?.blockName
      });
    }

    return this.appendEvent<ItemAddedEvent>({
      type: "item.added",
      item: interceptedItem
    });
  }

  /**
   * Emits an item-done event and updates tracked item state.
   */
  async emitItemDone(item: OutputItem): Promise<RequestStreamEventWithId> {
    const interceptedItem = applyItemSeam(
      this.internalSeams,
      item,
      "item.done"
    );
    this.itemsById.set(interceptedItem.id, interceptedItem);
    this.fanoutItemEvent(interceptedItem, "done");
    const event = await this.appendEvent<ItemDoneEvent>({
      type: "item.done",
      item: interceptedItem
    });
    this.itemHooks?.onItemDone?.(interceptedItem);
    return event;
  }

  /**
   * Emits an `item.updated` event applying a shallow top-level merge of
   * `patch` to the previously-emitted item. Identity-invariant keys
   * (`id`, `type`, `provenance`, `itemVisibility`, `transient`) are stripped
   * from the patch before it reaches the wire and before the server-side
   * mirror is updated.
   *
   * Out-of-order resilience: if `itemId` is unknown (no prior `item.added`
   * for it on this emitter), nothing is emitted and a debug event is
   * recorded for diagnosis. Updates after `item.done` are applied normally.
   */
  async emitItemUpdated(
    itemId: string,
    patch: Record<string, unknown>
  ): Promise<RequestStreamEventWithId | undefined> {
    const existing = this.itemsById.get(itemId);
    if (existing === undefined) {
      await this.emitDebug("response.emit.item_updated.unknown_id", {
        itemId
      });
      return undefined;
    }

    const sanitized = stripInvariantKeys(patch);
    const merged = { ...existing, ...sanitized } as OutputItem;
    this.itemsById.set(itemId, merged);
    this.fanoutItemEvent(merged, "updated");

    if (existing.transient !== true) {
      this.onLogEvent?.("item.updated", {
        itemId,
        patchKeys: Object.keys(sanitized)
      });
    }

    return this.appendEvent<ItemUpdatedEvent>({
      type: "item.updated",
      itemId,
      patch: sanitized
    });
  }

  /**
   * Emits item.added + item.done events for a single transient item without
   * tracking it in `itemsById`. The events reach connected clients via the
   * SSE stream and are persisted to the events log (the durable source for
   * replay). The item is NOT returned from `getItems()` and therefore never
   * enters the request-record items array — useful for large observability
   * payloads (e.g. full LLM prompts in block_debug) that would otherwise
   * balloon in-memory request state.
   *
   * Tradeoff: one-shot items cannot be replayed from the in-memory response
   * buffer after a reconnect — only from the events log store. For
   * block_debug this is acceptable because a reconnecting client sees the
   * next emission when the block re-resolves, and devtool replay reads from
   * the events log anyway.
   */
  async emitItemOneShot(item: OutputItem): Promise<{
    addedEvent: RequestStreamEventWithId;
    doneEvent: RequestStreamEventWithId;
  }> {
    const interceptedAdded = applyItemSeam(
      this.internalSeams,
      item,
      "item.added"
    );
    const addedEvent = await this.appendEvent<ItemAddedEvent>({
      type: "item.added",
      item: interceptedAdded
    });
    const interceptedDone = applyItemSeam(
      this.internalSeams,
      interceptedAdded,
      "item.done"
    );
    const doneEvent = await this.appendEvent<ItemDoneEvent>({
      type: "item.done",
      item: interceptedDone
    });
    return { addedEvent, doneEvent };
  }

  /**
   * Emits a content-part added event for an item.
   */
  async emitContentAdded(
    itemId: string,
    contentIndex: number,
    content: Content
  ): Promise<RequestStreamEventWithId> {
    if (this.itemsById.get(itemId)?.transient !== true) {
      this.onLogEvent?.("content.added", {
        itemId,
        contentIndex,
        contentType: content.type
      });
    }

    return this.appendEvent<ContentPartAddedEvent>({
      type: "content.added",
      itemId,
      contentIndex,
      content
    });
  }

  /**
   * Emits a content-part delta event for an item.
   */
  async emitContentDelta(
    itemId: string,
    contentIndex: number,
    delta: string
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<ContentPartDeltaEvent>({
      type: "content.delta",
      itemId,
      contentIndex,
      delta
    });
  }

  /**
   * Emits a chunk of streaming TTS audio for an in-flight
   * `OutputAudioContent` part. Live-only — the chunk is delivered to wire
   * consumers and the in-memory buffer but excluded from `getReplayableEvents`
   * and the events-log persistence hook, mirroring the policy for text
   * `content.delta`. The durable representation is the eventual
   * `OutputAudioContent` snapshot delivered via `emitContentAdded` /
   * `emitContentDone`; chunks live only on the wire.
   *
   * The emitter encodes raw bytes to base64 (the wire format is JSON SSE);
   * callers pass the `Uint8Array` from `VoiceProvider.speakStream()` directly.
   */
  async emitContentAudioDelta(
    itemId: string,
    contentIndex: number,
    chunk: { bytes: Uint8Array; isLast?: boolean }
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<ContentAudioDeltaEvent>({
      type: "content.audio.delta",
      itemId,
      contentIndex,
      audio: uint8ArrayToBase64(chunk.bytes),
      ...(chunk.isLast === true ? { isLast: true } : {})
    });
  }

  /**
   * Emits a content-part done event for an item.
   */
  async emitContentDone(
    itemId: string,
    contentIndex: number,
    content: Content
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<ContentPartDoneEvent>({
      type: "content.done",
      itemId,
      contentIndex,
      content
    });
  }

  /**
   * Emits a debug event.
   */
  async emitDebug(
    name: string,
    data: unknown
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestDebugEvent>({
      type: "debug",
      name,
      data
    });
  }

  /**
   * Emits a keepalive ping event.
   */
  async emitPing(): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestPingEvent>({
      type: "ping"
    });
  }

  /**
   * Emits the standard resource change item lifecycle and optional request resource.changed event.
   */
  async emitResourceChange(options: {
    scope: ResourceChangeItem["scope"];
    resourcePath: string;
    changeType: ResourceChangeItem["changeType"];
    delta?: unknown;
    version?: number;
    itemId?: string;
    itemIndex?: number;
    provenance?: ItemProvenance;
    transient?: boolean;
    ts?: number;
  }): Promise<{
    item: ResourceChangeItem;
    addedEvent: RequestStreamEventWithId;
    doneEvent: RequestStreamEventWithId;
    changedEvent?: RequestStreamEventWithId;
  }> {
    const ts = options.ts ?? this.now();
    const itemIndex =
      options.itemIndex ?? this.getItemCount();

    const item: ResourceChangeItem = {
      id:
        options.itemId ??
        `item_resource_change_${itemIndex}_${Math.random()
          .toString(16)
          .slice(2)}`,
      type: "resource_change",
      status: "completed",
      transient: options.transient ?? true,
      requestId: this.requestId,
      itemIndex,
      provenance: options.provenance ?? DEFAULT_PROVENANCE,
      ts,
      scope: options.scope,
      resourcePath: options.resourcePath,
      changeType: options.changeType,
      delta: options.delta,
      version: options.version
    };

    const addedEvent = await this.emitItemAdded(item);
    const doneEvent = await this.emitItemDone(item);

    let changedEvent: RequestStreamEventWithId | undefined;
    if (options.scope === "request") {
      changedEvent = await this.appendEvent<RequestResourceChangedEvent>({
        type: "resource.changed",
        scope: "request",
        resourcePath: options.resourcePath,
        changeType: options.changeType
      });
    }

    return {
      item,
      addedEvent,
      doneEvent,
      changedEvent
    };
  }

  /**
   * Returns all emitted request events in emission order.
   */
  getEvents(): RequestStreamEventWithId[] {
    return [...this.events];
  }

  /**
   * Returns current tracked items in stream (insertion) order.
   *
   * The backing `Map` preserves first-insert order and re-`set`s (item.done /
   * item.updated) keep an item's original slot, so iteration order already
   * matches the emission sequence that `itemIndex` encodes. No read-time sort
   * (FIX-406 6G) — the previous `Array.from(...).sort()` ran on every emit via
   * `getItemCount`'s former `getItems().length`, compounding to O(N² log N).
   */
  getItems(): OutputItem[] {
    return Array.from(this.itemsById.values());
  }

  /**
   * O(1) next-`itemIndex` cursor. Used on the per-emit hot path to assign the
   * next item's index without materializing or ordering the items snapshot.
   * Includes `baseItemIndex` so a same-request continuation's re-entry items
   * continue after the prior persisted log (FIX-811); `baseItemIndex` is `0` on
   * a fresh run, so this stays `itemsById.size` there.
   */
  getItemCount(): number {
    return this.baseItemIndex + this.itemsById.size;
  }

  /**
   * Returns all replayable events (excludes ping, debug, content.delta, and
   * content.audio.delta).
   *
   * `content.delta` is reclassified as non-replayable (FIX-479): the running
   * text is checkpointed via `MessageItem.content` / `ReasoningItem.summary`
   * snapshots through the `onItemUpdate` hook instead.
   *
   * `content.audio.delta` follows the same policy (FIX-523): the durable
   * representation is the eventual `OutputAudioContent` snapshot delivered
   * via `content.added` / `content.done`. Replaying per-chunk audio would
   * 10–100x the event-log size for sub-second TTS without enabling any
   * client behavior that the snapshot doesn't already cover.
   */
  getReplayableEvents(): RequestStreamEventWithId[] {
    return this.events.filter(
      (event) =>
        event.type !== "ping" &&
        event.type !== "debug" &&
        event.type !== "content.delta" &&
        event.type !== "content.audio.delta"
    );
  }

  /**
   * Returns the most recently emitted event id.
   */
  getLastEventId(): string | undefined {
    return this.events[this.events.length - 1]?.id;
  }

  /**
   * Returns the latest request sequence number.
   */
  getSequenceNumber(): number {
    return this.sequenceNumber;
  }

  private async appendEvent<TEvent extends RequestStreamEvent>(
    event: RequestEventDraft<TEvent>
  ): Promise<RequestStreamEventWithId> {
    this.sequenceNumber += 1;
    const sequence = this.sequenceNumber;

    const fullEvent = {
      ...event,
      stream: "request",
      requestId: this.requestId,
      sequence_number: sequence,
      ts: this.now()
    } as TEvent;

    const interceptedEnvelope = applyEnvelopeSeam(
      this.internalSeams,
      createStreamEnvelope(
        fullEvent,
        createRequestEventId(this.requestId, sequence)
      ),
      "event.before_store"
    );

    const withId: RequestStreamEventWithId = {
      ...(interceptedEnvelope.event as RequestStreamEvent),
      id: interceptedEnvelope.id
    };

    // Transient-item events skip the in-RAM buffer. Long-lived polling
    // patterns (e.g. task-board's claim-task / check-board worker loop)
    // emit hundreds of `block_trace` lifecycle events per second; counting
    // them against `maxBufferSize` evicts earlier non-transient events
    // that operators still want in post-mortem inspection. The wire and
    // persistence paths below are unaffected — transient events still
    // stream live and still land in the events log per the streaming
    // contract.
    if (!isTransientItemEvent(withId, this.itemsById)) {
      this.events.push(withId);
      this.enforceBufferLimit();
    }

    // Mutate the in-flight item snapshot for streaming-text deltas
    // (FIX-479). The events log no longer carries content.delta entries,
    // so the items snapshot is the durable source of in-flight text.
    if (withId.type === "content.delta") {
      this.applyDelta(withId.itemId, withId.contentIndex, withId.delta);
    }

    // Persist replayable events BEFORE publishing to the wire (FIX-399).
    // Without this barrier the client could observe `seq=N`, the process
    // could die, and the persisted log would still cap at `seq < N` —
    // a silent gap on reconnect. Ping/debug aren't replayable so they
    // don't need durability and skip the barrier entirely. content.delta
    // is reclassified as non-replayable (FIX-479): per-token disk round-
    // trips serialize concurrent worker streams behind a single events
    // queue. Live SSE consumers still receive every delta; durable
    // checkpointing of the running text happens through the items
    // snapshot via the onItemUpdate hook.
    //
    // FIX-361's incremental batching is preserved: persistEvents accumulates
    // events that arrive while a write is in flight, so concurrent emissions
    // (Promise.all of content deltas, etc.) coalesce into a single write.
    // Backpressure also comes for free — slow persistence throttles the
    // producer instead of growing an unbounded RAM buffer.
    // content.audio.delta is non-replayable for the same reason as
    // content.delta (FIX-523): chunks are the live transport, the durable
    // representation is the OutputAudioContent snapshot. Without this
    // exclusion, every audio chunk would be persisted to the events log
    // (10–100x bloat per sub-second TTS turn).
    const isReplayable =
      withId.type !== "ping" &&
      withId.type !== "debug" &&
      withId.type !== "content.delta" &&
      withId.type !== "content.audio.delta";
    if (isReplayable && this.eventHooks?.onEvent !== undefined) {
      this.eventHooks.onEvent([withId]);
      if (this.eventHooks.flushEvents !== undefined) {
        try {
          await this.eventHooks.flushEvents();
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          this.eventHooks.onPersistError?.(error);
          throw error;
        }
      }
    }

    if (this.onEvent !== undefined) {
      // Only await if the callback returns a Promise. Sync callbacks (e.g.
      // LiveRequestStream's controller.enqueue) should not yield to the
      // microtask queue — doing so serializes every content delta and
      // creates a visible streaming bottleneck.
      const result = this.onEvent(withId);
      if (result instanceof Promise) {
        await result;
      }
    }

    for (const observer of this.eventObservers) {
      observer(withId);
    }

    return withId;
  }

  /**
   * Applies a streaming text delta to an in-flight item's content (FIX-479).
   *
   * `content.delta` events share a single wire type for both message and
   * reasoning streaming (verified at generator.ts where reasoning deltas
   * reuse `type: "content.delta"` against a `ReasoningItem.id`). The
   * dispatch below branches on the tracked item's type to pick the
   * correct field path (`MessageItem.content[i].text` vs
   * `ReasoningItem.summary[i].text`).
   *
   * Defensive no-ops keep the emitter robust to ordering drift: an unknown
   * `itemId`, an out-of-range `contentIndex`, or an unsupported item type
   * is ignored silently.
   */
  private applyDelta(itemId: string, contentIndex: number, delta: string): void {
    const item = this.itemsById.get(itemId);
    if (item === undefined) return;
    if (item.type === "message") {
      const part = item.content?.[contentIndex];
      if (part === undefined || part.type !== "output_text") return;
      part.text += delta;
    } else if (item.type === "reasoning") {
      const part = item.summary?.[contentIndex];
      if (part === undefined || part.type !== "reasoning_text") return;
      part.text += delta;
    } else {
      return;
    }
    this.itemHooks?.onItemUpdate?.(item);
    this.fanoutItemEvent(item, "updated");
  }

  private enforceBufferLimit(): void {
    if (this.events.length <= this.maxBufferSize) {
      return;
    }

    const overflowCount = this.events.length - this.maxBufferSize;
    this.events.splice(0, overflowCount);
    this.droppedBufferedEvents += overflowCount;

    this.onLogEvent?.("response.buffer.capped", {
      requestId: this.requestId,
      maxBufferSize: this.maxBufferSize,
      droppedEvents: this.droppedBufferedEvents
    });
  }
}

/**
 * Creates a public response emitter with default seam behavior.
 */
export function createResponseEmitter(
  options: CreateResponseEmitterOptions
): ResponseEmitter {
  return new ResponseEmitter({
    ...options,
    internalSeams: NOOP_INTERNAL_STREAMING_SEAMS
  });
}

/**
 * Creates an internal response emitter with optional seam hooks.
 */
export function createInternalResponseEmitter(
  options: CreateInternalResponseEmitterOptions
): ResponseEmitter {
  return new ResponseEmitter({
    ...options,
    internalSeams: options.internalSeams ?? NOOP_INTERNAL_STREAMING_SEAMS
  });
}
