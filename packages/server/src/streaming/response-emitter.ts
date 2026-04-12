/**
 * Request-scoped stream event emitter that buffers events/items and supports replay/inspection.
 */
import type {
  Content,
  ContentPartAddedEvent,
  ContentPartDeltaEvent,
  ContentPartDoneEvent,
  ItemAddedEvent,
  ItemDoneEvent,
  ItemProvenance,
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
import type { ResponseEmitterHandle } from "@flow-state-dev/core/types";
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
  onItemDone?: (item: OutputItem) => void;
};

export type ResponseEmitterEventHooks = {
  onEvent?: (events: RequestStreamEventWithId[]) => void;
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
 * Stateful request event emitter used by runtime execution and SSE transport.
 */
export class ResponseEmitter implements ResponseEmitterHandle {
  private readonly requestId: string;
  private readonly now: () => number;
  private readonly onEvent?: (event: RequestStreamEventWithId) => Promise<void> | void;
  private readonly internalSeams: InternalStreamingSeams;
  private readonly maxBufferSize: number;
  private sequenceNumber: number;
  private readonly events: RequestStreamEventWithId[] = [];
  private readonly itemsById = new Map<string, OutputItem>();
  private onLogEvent?: (eventType: string, detail: Record<string, unknown>) => void;
  private droppedBufferedEvents = 0;
  private readonly eventObservers: Array<(event: RequestStreamEventWithId) => void> = [];
  private itemHooks?: ResponseEmitterItemHooks;
  private eventHooks?: ResponseEmitterEventHooks;

  /**
   * Creates a request-scoped emitter instance.
   */
  constructor(options: CreateInternalResponseEmitterOptions) {
    this.requestId = options.requestId;
    this.sequenceNumber = Math.max(0, options.startSequenceNumber ?? 0);
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

    this.onLogEvent?.("item.added", {
      itemId: interceptedItem.id,
      itemType: interceptedItem.type,
      blockName: interceptedItem.provenance?.blockName
    });

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
    const event = await this.appendEvent<ItemDoneEvent>({
      type: "item.done",
      item: interceptedItem
    });
    this.itemHooks?.onItemDone?.(interceptedItem);
    return event;
  }

  /**
   * Emits a content-part added event for an item.
   */
  async emitContentAdded(
    itemId: string,
    contentIndex: number,
    content: Content
  ): Promise<RequestStreamEventWithId> {
    this.onLogEvent?.("content.added", {
      itemId,
      contentIndex,
      contentType: content.type
    });

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
      options.itemIndex ?? this.itemsById.size;

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
   * Returns current tracked items sorted chronologically (ts, then itemIndex tiebreaker).
   */
  getItems(): OutputItem[] {
    const items = Array.from(this.itemsById.values());
    items.sort((left, right) => {
      const tsDiff = left.ts - right.ts;
      if (tsDiff !== 0) {
        return tsDiff;
      }

      return left.itemIndex - right.itemIndex;
    });
    return items;
  }

  /**
   * Returns all replayable events (excludes ping and debug).
   */
  getReplayableEvents(): RequestStreamEventWithId[] {
    return this.events.filter(
      (event) => event.type !== "ping" && event.type !== "debug"
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

    this.events.push(withId);
    this.enforceBufferLimit();
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

    // Fire event persistence hook with only the new event (incremental).
    // Previous implementation passed getReplayableEvents() — the full history —
    // on every emission, causing O(n²) persistence work across N events.
    if (this.eventHooks?.onEvent !== undefined) {
      const eventType = withId.type;
      if (eventType !== "ping" && eventType !== "debug") {
        this.eventHooks.onEvent([withId]);
      }
    }

    return withId;
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
