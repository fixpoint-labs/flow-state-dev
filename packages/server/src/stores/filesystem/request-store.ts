import type { OutputItem } from "@flow-state-dev/core/items";
import type {
  RequestListOptions,
  RequestRecord,
  RequestStore
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";
import {
  createSerializedWriteQueue,
  type SerializedWriteQueue
} from "../../utils/serialized-write-queue";

export type FilesystemRequestStoreOptions = {
  rootDir: string;
};

export class FilesystemRequestStore implements RequestStore {
  private readonly store: FilesystemRecordStore<
    RequestRecord,
    RequestListOptions
  >;
  private readonly itemWriteQueues = new Map<string, SerializedWriteQueue>();
  private readonly itemWriteQueued = new Set<string>();

  constructor(options: FilesystemRequestStoreOptions) {
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
    // Coalesce: skip if a write is already queued for this request.
    // The queued write will snapshot the latest items when it executes.
    if (this.itemWriteQueued.has(requestId)) return;
    this.itemWriteQueued.add(requestId);

    const queue = this.getOrCreateWriteQueue(requestId);
    // Capture items snapshot at enqueue time for coalesce correctness.
    // The next call to persistItems will be skipped while this is queued,
    // and the one after that will capture the then-current items.
    const snapshot = [...items];
    queue.enqueue(async () => {
      this.itemWriteQueued.delete(requestId);
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
