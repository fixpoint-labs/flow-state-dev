import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  RequestListOptions,
  RequestRecord,
  RequestStore
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";
import { ensureDirectory, toRecordPath } from "./shared";
import { readFile, writeFile, rename } from "node:fs/promises";
import {
  createSerializedWriteQueue,
  type SerializedWriteQueue
} from "../../utils/serialized-write-queue";

export type FilesystemRequestStoreOptions = {
  rootDir: string;
};

function toEventsPath(rootDir: string, requestId: string): string {
  return toRecordPath(rootDir, requestId).replace(/\.json$/, ".events.json");
}

export class FilesystemRequestStore implements RequestStore {
  private readonly store: FilesystemRecordStore<
    RequestRecord,
    RequestListOptions
  >;
  private readonly rootDir: string;
  private readonly itemWriteQueues = new Map<string, SerializedWriteQueue>();
  private readonly itemWriteQueued = new Set<string>();
  /** Holds the most recent items snapshot so the queued write always uses the latest data. */
  private readonly latestItemSnapshots = new Map<string, OutputItem[]>();
  private readonly eventWriteQueues = new Map<string, SerializedWriteQueue>();
  private readonly eventWriteQueued = new Set<string>();
  /** Accumulates new events between coalesced writes for incremental persistence. */
  private readonly pendingNewEvents = new Map<string, RequestStreamEvent[]>();
  /**
   * Tracks the most recent persistence error per request. flushEvents drains
   * the queue then throws (and clears) any captured error so callers can
   * propagate persist failures instead of silently swallowing them (FIX-399).
   */
  private readonly lastEventError = new Map<string, Error>();

  constructor(options: FilesystemRequestStoreOptions) {
    this.rootDir = options.rootDir;
    this.store = createFilesystemRecordStore<RequestRecord, RequestListOptions>({
      rootDir: options.rootDir,
      filter: (record, listOptions): boolean => {
        if (
          listOptions?.flowKind !== undefined &&
          record.flowKind !== listOptions.flowKind
        ) {
          return false;
        }

        if (
          listOptions?.sessionId !== undefined &&
          record.sessionId !== listOptions.sessionId
        ) {
          return false;
        }

        if (
          listOptions?.userId !== undefined &&
          record.userId !== listOptions.userId
        ) {
          return false;
        }

        if (
          listOptions?.status !== undefined &&
          record.status !== listOptions.status
        ) {
          return false;
        }

        return true;
      }
    });
  }

  async get(id: string): Promise<RequestRecord | undefined> {
    return this.store.get(id);
  }

  async set(id: string, value: RequestRecord): Promise<void> {
    await this.store.set(id, value);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(options?: RequestListOptions): Promise<RequestRecord[]> {
    return this.store.list(options);
  }

  persistItems(requestId: string, items: OutputItem[]): void {
    // Always capture the latest snapshot so the queued write uses the most
    // recent items, even when subsequent calls are coalesced away.
    this.latestItemSnapshots.set(requestId, [...items]);

    if (this.itemWriteQueued.has(requestId)) return;
    this.itemWriteQueued.add(requestId);

    const queue = this.getOrCreateWriteQueue(requestId);
    queue.enqueue(async () => {
      this.itemWriteQueued.delete(requestId);
      // Read the snapshot at execution time — not enqueue time — so items
      // added between the first persistItems call and this write are included.
      const snapshot = this.latestItemSnapshots.get(requestId);
      this.latestItemSnapshots.delete(requestId);
      if (snapshot === undefined) return;

      const current = await this.store.get(requestId);
      if (current !== undefined) {
        await this.store.set(requestId, {
          ...current,
          items: snapshot,
          updatedAt: Date.now()
        });
      }
    });
  }

  async flushItems(requestId: string): Promise<void> {
    const queue = this.itemWriteQueues.get(requestId);
    if (queue !== undefined) {
      await queue.drain();
    }
  }

  persistEvents(requestId: string, events: RequestStreamEvent[]): void {
    // Accumulate new events — the emitter now sends only incremental events.
    let pending = this.pendingNewEvents.get(requestId);
    if (pending === undefined) {
      pending = [];
      this.pendingNewEvents.set(requestId, pending);
    }
    pending.push(...events);

    if (this.eventWriteQueued.has(requestId)) return;
    this.eventWriteQueued.add(requestId);

    const queue = this.getOrCreateEventWriteQueue(requestId);
    queue.enqueue(async () => {
      this.eventWriteQueued.delete(requestId);
      const newEvents = this.pendingNewEvents.get(requestId) ?? [];
      this.pendingNewEvents.delete(requestId);
      if (newEvents.length === 0) return;

      await ensureDirectory(this.rootDir);
      const targetPath = toEventsPath(this.rootDir, requestId);

      // Read existing events and append the new ones.
      let existing: RequestStreamEvent[] = [];
      try {
        const raw = await readFile(targetPath, "utf8");
        existing = JSON.parse(raw) as RequestStreamEvent[];
      } catch {
        // File may not exist yet on first write.
      }

      const merged = [...existing, ...newEvents];
      const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
        .toString(16)
        .slice(2)}`;

      const serialized = JSON.stringify(merged);
      await writeFile(tempPath, serialized, "utf8");
      await rename(tempPath, targetPath);
    });
  }

  async flushEvents(requestId: string): Promise<void> {
    const queue = this.eventWriteQueues.get(requestId);
    if (queue !== undefined) {
      await queue.drain();
    }
    const lastError = this.lastEventError.get(requestId);
    if (lastError !== undefined) {
      this.lastEventError.delete(requestId);
      throw lastError;
    }
  }

  async getEvents(requestId: string): Promise<RequestStreamEvent[]> {
    const filePath = toEventsPath(this.rootDir, requestId);
    try {
      const raw = await readFile(filePath, "utf8");
      return JSON.parse(raw) as RequestStreamEvent[];
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private getOrCreateEventWriteQueue(requestId: string): SerializedWriteQueue {
    let queue = this.eventWriteQueues.get(requestId);
    if (queue === undefined) {
      queue = createSerializedWriteQueue({
        label: `request-events:${requestId}`,
        onError: (err) => {
          // Capture so flushEvents can re-throw to the emitter (FIX-399).
          // Still log here for ops visibility — the emitter's onPersistError
          // hook is the structured propagation channel; this is the safety net
          // for callers that haven't wired the hook.
          this.lastEventError.set(requestId, err);
          console.error(
            `[flow-state] event persistence failed for ${requestId}`,
            err
          );
        }
      });
      this.eventWriteQueues.set(requestId, queue);
    }
    return queue;
  }

  private getOrCreateWriteQueue(requestId: string): SerializedWriteQueue {
    let queue = this.itemWriteQueues.get(requestId);
    if (queue === undefined) {
      queue = createSerializedWriteQueue({
        label: `request-items:${requestId}`,
        onError: (err) => {
          console.error(
            `[flow-state] item persistence failed for ${requestId}`,
            err
          );
        }
      });
      this.itemWriteQueues.set(requestId, queue);
    }
    return queue;
  }
}

export function createFilesystemRequestStore(
  options: FilesystemRequestStoreOptions
): RequestStore {
  return new FilesystemRequestStore(options);
}
