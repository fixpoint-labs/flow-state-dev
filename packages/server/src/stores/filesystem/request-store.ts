import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  ExpectedVersion,
  PersistErrorHandler,
  RequestListOptions,
  RequestRecord,
  RequestStore,
  SetResult,
  SubscribeToEventsOptions
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";
import { ensureDirectory, toRecordPath } from "./shared";
import { withRequestSourceDefault } from "../shared";
import { pollEvents } from "../subscribe-helpers";
import { appendFile, readFile, writeFile, rename } from "node:fs/promises";
import {
  createSerializedWriteQueue,
  type SerializedWriteQueue
} from "../../utils/serialized-write-queue";

const DEFAULT_POLL_INTERVAL_MS = 100;

export type FilesystemRequestStoreOptions = {
  rootDir: string;
  /**
   * Poll interval for `subscribeToEvents` in milliseconds. Default 100ms.
   */
  subscribePollIntervalMs?: number;
  /**
   * Fired on a background write failure before the safety-net log, so
   * operators can alert on persistence loss (FIX-406 6B).
   */
  onPersistError?: PersistErrorHandler;
};

function toEventsPath(rootDir: string, requestId: string): string {
  return toRecordPath(rootDir, requestId).replace(/\.json$/, ".events.json");
}

function toRunOncePath(rootDir: string, requestId: string): string {
  return toRecordPath(rootDir, requestId).replace(/\.json$/, ".runonce.json");
}

// Module-scoped so the "warn once per corrupted file" guarantee holds across
// reads and across store instances within the same process (mirrors the
// trace store).
const corruptionWarned = new Set<string>();

/**
 * Filesystem-backed `RequestStore`.
 *
 * The event log is an append-only NDJSON file (`{requestId}.events.json`):
 * `persistEvents` appends only the new events through a per-request
 * `SerializedWriteQueue`, so persistence cost is O(new events) rather than
 * O(total log) per write.
 *
 * Multi-process disclaimer: this store assumes a single writer per request.
 * Ordering and the FIX-399 durability barrier are enforced within one process
 * by the per-request queue and the per-id write lock. There is NO inter-process
 * locking — running multiple processes against the same `rootDir` for the same
 * request is not a supported topology. Use SQLite or Postgres for any
 * multi-process or production deployment.
 */
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
  /**
   * Requests whose event file has had its on-disk format verified (and
   * migrated from legacy JSON-array to NDJSON if needed) at least once this
   * process. Migration runs lazily on the first `persistEvents` per request.
   */
  private readonly eventsFormatVerified = new Set<string>();

  private readonly pollIntervalMs: number;
  private readonly runOnceQueues = new Map<string, SerializedWriteQueue>();
  private readonly onPersistError?: PersistErrorHandler;

  constructor(options: FilesystemRequestStoreOptions) {
    this.rootDir = options.rootDir;
    this.pollIntervalMs =
      options.subscribePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onPersistError = options.onPersistError;
    this.store = createFilesystemRecordStore<RequestRecord, RequestListOptions>({
      rootDir: options.rootDir,
      sort: (left, right, listOptions) =>
        listOptions?.orderBy === "startedAtMs"
          ? right.startedAtMs - left.startedAtMs
          : right.updatedAt - left.updatedAt,
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
    return withRequestSourceDefault(await this.store.get(id));
  }

  async set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>> {
    return this.store.set(id, value, expectedVersion);
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(id);
  }

  async list(options?: RequestListOptions): Promise<RequestRecord[]> {
    const records = await this.store.list(options);
    return records.map((record) => withRequestSourceDefault(record));
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

      // Use the store's atomic update path so the read-merge-write happens
      // under the per-id write lock. The previous read-then-`set` pattern
      // raced with concurrent state CAS writes (`request.atomicState`): a
      // state mutation that landed between this read and write would be
      // silently overwritten because `set("any")` skips version checks.
      // Items are append-only and coalesced — last write wins intentionally —
      // but only the items + updatedAt fields, never the state field.
      await this.store.update(requestId, (current) => ({
        ...current,
        items: snapshot,
        updatedAt: Date.now()
      }));
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

      // First persist this process for this request: migrate a legacy
      // JSON-array file to NDJSON before appending. Migration/append errors
      // propagate to the queue's onError (FIX-399) — never swallowed.
      if (!this.eventsFormatVerified.has(requestId)) {
        await this.migrateLegacyEventsIfNeeded(targetPath);
        this.eventsFormatVerified.add(requestId);
      }

      const lines = newEvents.map((e) => `${JSON.stringify(e)}\n`).join("");
      await appendFile(targetPath, lines, "utf8");
    });
  }

  /**
   * If `targetPath` holds a legacy JSON-array events file (first non-whitespace
   * byte is `[`), rewrite it as NDJSON via an atomic temp-write + rename so the
   * subsequent append lands in a uniform format. No-op for missing files or
   * files already in NDJSON shape. Errors propagate to the caller.
   */
  private async migrateLegacyEventsIfNeeded(targetPath: string): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(targetPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    const firstNonWhitespace = raw.match(/\S/);
    if (firstNonWhitespace?.[0] !== "[") return; // already NDJSON or empty
    const events = JSON.parse(raw) as RequestStreamEvent[];
    const ndjson = events.map((e) => `${JSON.stringify(e)}\n`).join("");
    const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    await writeFile(tempPath, ndjson, "utf8");
    await rename(tempPath, targetPath);
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

  async getEvents(
    requestId: string,
    fromSequence?: number
  ): Promise<RequestStreamEvent[]> {
    const filePath = toEventsPath(this.rootDir, requestId);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const matchInclude = (e: RequestStreamEvent): boolean =>
      fromSequence === undefined || e.sequence_number > fromSequence;

    // Legacy JSON-array format: first non-whitespace byte is `[`.
    if (raw.match(/\S/)?.[0] === "[") {
      const events = JSON.parse(raw) as RequestStreamEvent[];
      return events.filter(matchInclude);
    }

    // NDJSON: one event per line. Skip blank lines; on a parse failure (e.g. a
    // torn final append) skip the line and warn once per file. The store is
    // single-writer per request, so a malformed line is a partial write, not
    // a sequence the reader can recover.
    const out: RequestStreamEvent[] = [];
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as RequestStreamEvent;
        if (matchInclude(event)) out.push(event);
      } catch {
        if (!corruptionWarned.has(filePath)) {
          corruptionWarned.add(filePath);
          console.warn(
            `[flow-state] skipping corrupted event line(s) in ${filePath}`
          );
        }
      }
    }
    return out;
  }

  subscribeToEvents(
    requestId: string,
    options: SubscribeToEventsOptions
  ): AsyncIterableIterator<RequestStreamEvent> {
    return pollEvents(
      (id, fromSequence) => this.getEvents(id, fromSequence),
      requestId,
      options,
      this.pollIntervalMs
    );
  }

  async getRunOnceResult(
    requestId: string,
    key: string
  ): Promise<{ found: boolean; value?: unknown }> {
    const filePath = toRunOncePath(this.rootDir, requestId);
    let map: Record<string, unknown>;
    try {
      const raw = await readFile(filePath, "utf8");
      map = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      const maybeError = error as NodeJS.ErrnoException;
      if (maybeError.code === "ENOENT") return { found: false };
      throw error;
    }
    if (!Object.prototype.hasOwnProperty.call(map, key)) return { found: false };
    return { found: true, value: map[key] };
  }

  async setRunOnceResult(
    requestId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    // Serialize per-request file writes so concurrent runOnce calls don't
    // clobber each other's partial maps. Drain to expose write errors to
    // the caller.
    const queue = this.getOrCreateRunOnceQueue(requestId);
    let resolve: () => void;
    let reject: (err: Error) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    queue.enqueue(async () => {
      try {
        await ensureDirectory(this.rootDir);
        const targetPath = toRunOncePath(this.rootDir, requestId);
        let map: Record<string, unknown> = {};
        try {
          const raw = await readFile(targetPath, "utf8");
          map = JSON.parse(raw) as Record<string, unknown>;
        } catch (error) {
          const maybeError = error as NodeJS.ErrnoException;
          if (maybeError.code !== "ENOENT") throw error;
        }
        map[key] = value;
        const tempPath = `${targetPath}.tmp-${process.pid}-${Date.now()}-${Math.random()
          .toString(16)
          .slice(2)}`;
        await writeFile(tempPath, JSON.stringify(map), "utf8");
        await rename(tempPath, targetPath);
        resolve();
      } catch (err) {
        reject(err as Error);
        throw err;
      }
    });
    await done;
  }

  private getOrCreateRunOnceQueue(requestId: string): SerializedWriteQueue {
    let queue = this.runOnceQueues.get(requestId);
    if (queue === undefined) {
      queue = createSerializedWriteQueue({
        label: `request-runonce:${requestId}`,
        onError: (err) => {
          this.onPersistError?.({ store: "request", id: requestId, error: err });
          console.error(
            `[flow-state] runOnce persistence failed for ${requestId}`,
            err
          );
        }
      });
      this.runOnceQueues.set(requestId, queue);
    }
    return queue;
  }

  private getOrCreateEventWriteQueue(requestId: string): SerializedWriteQueue {
    let queue = this.eventWriteQueues.get(requestId);
    if (queue === undefined) {
      queue = createSerializedWriteQueue({
        label: `request-events:${requestId}`,
        onError: (err) => {
          // Capture so flushEvents can re-throw to the emitter (FIX-399).
          // Fire the structured observable (FIX-406 6B) before the safety-net
          // log so operators can alert on persistence loss.
          this.lastEventError.set(requestId, err);
          this.onPersistError?.({ store: "request", id: requestId, error: err });
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
          this.onPersistError?.({ store: "request", id: requestId, error: err });
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
