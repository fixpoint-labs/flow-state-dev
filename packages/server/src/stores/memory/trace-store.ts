/**
 * In-memory trace event store with bounded retention (FIX-506).
 *
 * Two retention bounds run concurrently:
 *   - `maxRequests`: FIFO over distinct request IDs by Map insertion order.
 *     When a NEW request would push the count over the cap, the oldest
 *     request's buffer is evicted in full.
 *   - `maxBytesPerRequest`: per-request soft cap on serialized event size.
 *     When appending an event would exceed the cap for that request, the
 *     oldest events in that request's buffer are dropped until the new
 *     event fits.
 *
 * Suitable for tests, single-process dev runs, and the default DevTool
 * tail. For durable retention or cross-process live tail use a SQLite or
 * future remote-backed implementation.
 */
import type { TraceEvent, TraceStore } from "../types";

export type InMemoryTraceStoreOptions = {
  maxRequests?: number;
  maxBytesPerRequest?: number;
};

const DEFAULT_MAX_REQUESTS = 50;
const DEFAULT_MAX_BYTES_PER_REQUEST = 5 * 1024 * 1024;

export class InMemoryTraceStore implements TraceStore {
  private readonly maxRequests: number;
  private readonly maxBytesPerRequest: number;
  private readonly requests = new Map<string, TraceEvent[]>();
  private readonly byteCount = new Map<string, number>();

  constructor(options: InMemoryTraceStoreOptions = {}) {
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    this.maxBytesPerRequest = options.maxBytesPerRequest ?? DEFAULT_MAX_BYTES_PER_REQUEST;
  }

  async appendEvent(requestId: string, event: TraceEvent): Promise<void> {
    const eventBytes = Buffer.byteLength(JSON.stringify(event), "utf8");

    let buffer = this.requests.get(requestId);
    if (buffer === undefined) {
      // New request — enforce maxRequests by evicting the oldest entry first.
      // Map iteration follows insertion order, so the first key is the oldest.
      while (this.requests.size >= this.maxRequests) {
        const oldest = this.requests.keys().next();
        if (oldest.done === true) break;
        this.requests.delete(oldest.value);
        this.byteCount.delete(oldest.value);
      }
      buffer = [];
      this.requests.set(requestId, buffer);
      this.byteCount.set(requestId, 0);
    }

    let bytes = this.byteCount.get(requestId) ?? 0;
    while (buffer.length > 0 && bytes + eventBytes > this.maxBytesPerRequest) {
      const dropped = buffer.shift()!;
      bytes -= Buffer.byteLength(JSON.stringify(dropped), "utf8");
    }

    buffer.push(event);
    bytes += eventBytes;
    this.byteCount.set(requestId, bytes);
  }

  async flush(_requestId: string): Promise<void> {
    // No-op: in-memory writes are synchronous.
  }

  async getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]> {
    const buffer = this.requests.get(requestId);
    if (buffer === undefined) return [];
    if (fromSequence === undefined) return buffer.slice();
    return buffer.filter((ev) => ev.sequenceNumber > fromSequence);
  }

  async listRequestIds(): Promise<string[]> {
    return Array.from(this.requests.keys());
  }
}

export function createInMemoryTraceStore(options?: InMemoryTraceStoreOptions): TraceStore {
  return new InMemoryTraceStore(options);
}
