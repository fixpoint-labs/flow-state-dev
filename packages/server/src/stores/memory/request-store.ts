import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  ExpectedVersion,
  RequestListOptions,
  RequestRecord,
  RequestStore,
  SetResult
} from "../types";
import { applyOffsetLimit, casWriteToMap, cloneValue } from "./shared";

export class InMemoryRequestStore implements RequestStore {
  private readonly records = new Map<string, RequestRecord>();
  private readonly eventsByRequestId = new Map<string, RequestStreamEvent[]>();

  async get(id: string): Promise<RequestRecord | undefined> {
    const record = this.records.get(id);
    return record === undefined ? undefined : cloneValue(record);
  }

  async set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>> {
    return casWriteToMap(this.records, id, value, expectedVersion);
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
  }

  async flushEvents(_requestId: string): Promise<void> {
    // No-op: events already in memory
  }

  async getEvents(requestId: string): Promise<RequestStreamEvent[]> {
    return [...(this.eventsByRequestId.get(requestId) ?? [])];
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

    filtered.sort((left, right) => right.updatedAt - left.updatedAt);
    return applyOffsetLimit(filtered, options).map((record) =>
      cloneValue(record)
    );
  }
}

export function createInMemoryRequestStore(): RequestStore {
  return new InMemoryRequestStore();
}
