import { cloneValue } from "@flow-state-dev/core/helpers";
import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  ExpectedVersion,
  RequestListOptions,
  RequestRecord,
  RequestStore,
  SetResult,
  SubscribeToEventsOptions
} from "../types";
import {
  applyOffsetLimit,
  casWriteToMap,
  incFieldInMap,
  patchFieldInMap,
  pushToArrayInMap
} from "./shared";
import { withRequestSourceDefault } from "../shared";
import { BoundedQueue } from "../../utils/bounded-queue";
import { StoreSubscriptionError } from "../../errors/store-subscription-error";
import { isTerminalRequestStreamEvent } from "../subscribe-helpers";

const DEFAULT_MAX_PENDING_EVENTS = 1000;

/** Per-request callback set; the bus shares its push chain with `persistEvents`. */
type Subscriber = (event: RequestStreamEvent) => void;

export class InMemoryRequestStore implements RequestStore {
  private readonly records = new Map<string, RequestRecord>();
  private readonly eventsByRequestId = new Map<string, RequestStreamEvent[]>();
  private readonly subscribersByRequestId = new Map<string, Set<Subscriber>>();
  private readonly runOnceByRequestId = new Map<string, Map<string, unknown>>();

  async get(id: string): Promise<RequestRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined
      ? undefined
      : withRequestSourceDefault(cloneValue(record));
  }

  async set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>> {
    return casWriteToMap(this.records, id, value, expectedVersion);
  }

  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<RequestRecord>> {
    return patchFieldInMap(this.records, id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<RequestRecord>> {
    return incFieldInMap(this.records, id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<RequestRecord>> {
    return pushToArrayInMap(this.records, id, path, values, expectedVersion, updatedAt);
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id);
  }

  persistItems(_requestId: string, _items: OutputItem[]): void {
    // No-op: items already in memory via ResponseEmitter
  }

  async flushItems(_requestId: string): Promise<void> {
    // No-op: nothing to flush in memory
  }

  persistEvents(requestId: string, events: RequestStreamEvent[]): void {
    // Append incrementally — the emitter now sends only new events per call.
    const existing = this.eventsByRequestId.get(requestId);
    if (existing !== undefined) {
      existing.push(...events);
    } else {
      this.eventsByRequestId.set(requestId, [...events]);
    }

    const subscribers = this.subscribersByRequestId.get(requestId);
    if (subscribers === undefined || subscribers.size === 0) return;
    for (const event of events) {
      // Snapshot the set so a subscriber that unregisters during iteration
      // (e.g. terminal event triggers iterator cleanup) doesn't perturb the
      // current fan-out.
      for (const cb of [...subscribers]) cb(event);
    }
  }

  async flushEvents(_requestId: string): Promise<void> {
    // No-op: events already in memory
  }

  async getEvents(
    requestId: string,
    fromSequence?: number
  ): Promise<RequestStreamEvent[]> {
    const all = this.eventsByRequestId.get(requestId) ?? [];
    if (fromSequence === undefined) return [...all];
    return all.filter((e) => e.sequence_number > fromSequence);
  }

  async *subscribeToEvents(
    requestId: string,
    options: SubscribeToEventsOptions
  ): AsyncIterableIterator<RequestStreamEvent> {
    const capacity = options.maxPendingEvents ?? DEFAULT_MAX_PENDING_EVENTS;
    const queue = new BoundedQueue<RequestStreamEvent>(capacity);
    let lastEmitted = options.fromSequence;
    let overflowed = false;

    const callback: Subscriber = (event) => {
      if (event.sequence_number <= lastEmitted) return;
      const result = queue.push(event);
      if (result === "overflow") overflowed = true;
    };

    let subscribers = this.subscribersByRequestId.get(requestId);
    if (subscribers === undefined) {
      subscribers = new Set();
      this.subscribersByRequestId.set(requestId, subscribers);
    }
    subscribers.add(callback);

    try {
      // Catch-up. Snapshot before reading from the queue so events appended
      // during the catch-up read are observed by the live loop (the callback
      // fired before lastEmitted advances and was filtered out by the
      // sequence guard; the live loop picks them up via getEvents below if
      // they squeezed in past the snapshot).
      const catchUp = await this.getEvents(requestId, options.fromSequence);
      for (const event of catchUp) {
        yield event;
        lastEmitted = event.sequence_number;
        if (isTerminalRequestStreamEvent(event)) return;
      }

      // Drain anything that arrived between the catch-up read and the
      // subscriber registration — `lastEmitted` is monotonic so duplicates
      // are filtered.
      const gap = await this.getEvents(requestId, lastEmitted);
      for (const event of gap) {
        yield event;
        lastEmitted = event.sequence_number;
        if (isTerminalRequestStreamEvent(event)) return;
      }

      while (!options.signal?.aborted) {
        if (overflowed) {
          throw new StoreSubscriptionError("backpressure_overflow");
        }
        const next = await queue.shift(options.signal);
        if (next === undefined) return;
        if (next.sequence_number <= lastEmitted) continue;
        yield next;
        lastEmitted = next.sequence_number;
        if (isTerminalRequestStreamEvent(next)) return;
      }
    } finally {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.subscribersByRequestId.delete(requestId);
      }
      queue.close();
    }
    // Memory deliberately ignores `livenessTimeoutMs` — no cross-process
    // death scenario applies; the originating process is the only producer.
  }

  async getRunOnceResult(
    requestId: string,
    key: string
  ): Promise<{ found: boolean; value?: unknown }> {
    const map = this.runOnceByRequestId.get(requestId);
    if (map === undefined || !map.has(key)) return { found: false };
    return { found: true, value: cloneValue(map.get(key)) };
  }

  async setRunOnceResult(
    requestId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    let map = this.runOnceByRequestId.get(requestId);
    if (map === undefined) {
      map = new Map();
      this.runOnceByRequestId.set(requestId, map);
    }
    map.set(key, cloneValue(value));
  }

  async list(options?: RequestListOptions): Promise<RequestRecord[]> {
    const filtered = Array.from(this.records.values()).filter((record) => {
      if (options?.flowKind !== undefined && record.flowKind !== options.flowKind) {
        return false;
      }

      if (options?.sessionId !== undefined && record.sessionId !== options.sessionId) {
        return false;
      }

      if (options?.userId !== undefined && record.userId !== options.userId) {
        return false;
      }

      if (options?.status !== undefined && record.status !== options.status) {
        return false;
      }

      return true;
    });

    if (options?.orderBy === "startedAtMs") {
      filtered.sort((left, right) => right.startedAtMs - left.startedAtMs);
    } else {
      filtered.sort((left, right) => right.updatedAt - left.updatedAt);
    }
    return applyOffsetLimit(filtered, options).map((record) =>
      withRequestSourceDefault(cloneValue(record))
    );
  }
}

export function createInMemoryRequestStore(): RequestStore {
  return new InMemoryRequestStore();
}
