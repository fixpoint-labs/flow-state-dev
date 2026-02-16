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
  ResourceUpdateItem
} from "@flow-state-dev/core/items";
import type { ResponseEmitterHandle } from "@flow-state-dev/core/types";
import { createRequestEventId } from "./encode-event";

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
  now?: () => number;
  onEvent?: (event: RequestStreamEventWithId) => Promise<void> | void;
};

const DEFAULT_PROVENANCE: ItemProvenance = {
  blockName: "runtime",
  blockInstanceId: "runtime",
  phase: "main"
};

function isRequestStreamDraft(value: unknown): value is {
  type: RequestStreamEvent["type"];
} {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === "string";
}

export class ResponseEmitter implements ResponseEmitterHandle {
  private readonly requestId: string;
  private readonly now: () => number;
  private readonly onEvent?: (event: RequestStreamEventWithId) => Promise<void> | void;
  private sequenceNumber: number;
  private readonly events: RequestStreamEventWithId[] = [];
  private readonly itemsById = new Map<string, OutputItem>();

  constructor(options: CreateResponseEmitterOptions) {
    this.requestId = options.requestId;
    this.sequenceNumber = Math.max(0, options.startSequenceNumber ?? 0);
    this.now = options.now ?? (() => Date.now());
    this.onEvent = options.onEvent;
  }

  async emit(event: unknown): Promise<void> {
    if (!isRequestStreamDraft(event)) {
      await this.emitDebug("response.emit.invalid", { value: event });
      return;
    }

    await this.appendEvent(
      event as RequestEventDraft<RequestStreamEvent>
    );
  }

  async emitRequestCreated(): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestCreatedEvent>({
      type: "request.created",
      status: "in_progress"
    });
  }

  async emitRequestStatus(
    status: RequestStatus
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestStatusEvent>({
      type: `request.${status}`,
      status
    });
  }

  async emitItemAdded(item: OutputItem): Promise<RequestStreamEventWithId> {
    this.itemsById.set(item.id, item);
    return this.appendEvent<ItemAddedEvent>({
      type: "item.added",
      item
    });
  }

  async emitItemDone(item: OutputItem): Promise<RequestStreamEventWithId> {
    this.itemsById.set(item.id, item);
    return this.appendEvent<ItemDoneEvent>({
      type: "item.done",
      item
    });
  }

  async emitContentAdded(
    itemId: string,
    contentIndex: number,
    content: Content
  ): Promise<RequestStreamEventWithId> {
    return this.appendEvent<ContentPartAddedEvent>({
      type: "content.added",
      itemId,
      contentIndex,
      content
    });
  }

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

  async emitPing(): Promise<RequestStreamEventWithId> {
    return this.appendEvent<RequestPingEvent>({
      type: "ping"
    });
  }

  async emitResourceUpdate(options: {
    scope: ResourceUpdateItem["scope"];
    resourcePath: string;
    changeType: ResourceUpdateItem["changeType"];
    itemId?: string;
    itemIndex?: number;
    provenance?: ItemProvenance;
    visibility?: ResourceUpdateItem["visibility"];
    transient?: boolean;
    ts?: number;
  }): Promise<{
    item: ResourceUpdateItem;
    addedEvent: RequestStreamEventWithId;
    doneEvent: RequestStreamEventWithId;
    changedEvent?: RequestStreamEventWithId;
  }> {
    const ts = options.ts ?? this.now();
    const itemIndex =
      options.itemIndex ?? this.itemsById.size;

    const item: ResourceUpdateItem = {
      id:
        options.itemId ??
        `item_resource_update_${itemIndex}_${Math.random()
          .toString(16)
          .slice(2)}`,
      type: "fsd:resource_update",
      status: "completed",
      visibility: options.visibility ?? "internal",
      transient: options.transient ?? true,
      requestId: this.requestId,
      itemIndex,
      provenance: options.provenance ?? DEFAULT_PROVENANCE,
      ts,
      scope: options.scope,
      resourcePath: options.resourcePath,
      changeType: options.changeType
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

  getEvents(): RequestStreamEventWithId[] {
    return [...this.events];
  }

  getItems(): OutputItem[] {
    const items = Array.from(this.itemsById.values());
    items.sort((left, right) => left.itemIndex - right.itemIndex);
    return items;
  }

  getLastEventId(): string | undefined {
    return this.events[this.events.length - 1]?.id;
  }

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

    const withId: RequestStreamEventWithId = {
      ...fullEvent,
      id: createRequestEventId(this.requestId, sequence)
    };

    this.events.push(withId);
    if (this.onEvent !== undefined) {
      await this.onEvent(withId);
    }

    return withId;
  }
}

export function createResponseEmitter(
  options: CreateResponseEmitterOptions
): ResponseEmitter {
  return new ResponseEmitter(options);
}
