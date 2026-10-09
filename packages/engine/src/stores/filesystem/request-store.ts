import type { OutputItem, RequestStreamEvent } from "@flow-state-dev/core/items";
import type {
  ConditionalRequestFields,
  ConditionalWriteResult,
  ExpectedVersion,
  PersistErrorHandler,
  RequestListOptions,
  RequestRecord,
  RequestStatus,
  RequestStore,
  SetResult,
  SubscribeToEventsOptions
} from "../types";
import {
  createFilesystemRecordStore,
  type FilesystemRecordStore
} from "./shared";
import { atomicWrite, ensureDirectory, toRecordPath } from "./shared";
import {
  matchesMembership,
  mergeItemsById,
  withHeldItems,
  withRequestSourceDefault,
  withStoredAbortRequested
} from "../shared";
import { matchesOrgFilter, matchesTenantFilter, resolveRequestIncarnation } from "../scope-keys";
import { compareRequestsForListing } from "../list-order";
import { pollEvents } from "../subscribe-helpers";
import { appendFile, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
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

/**
 * Path of the abort-intent marker beside a request's record file (FIX-1026).
 *
 * Existence *is* the flag, so the narrow read is a `stat` rather than a parse.
 * This adapter keeps items inline on the record, so any read that goes through
 * `readRecord` is O(items) — reusing it for the abort poll would deserialize a
 * growing item array on every heartbeat tick, which is the exact cost the
 * narrow read exists to remove.
 *
 * Deliberately not a `.json` file: `listRecords` only collects `.json`
 * entries, so the marker cannot be mistaken for a record.
 */
function toAbortMarkerPath(rootDir: string, requestId: string): string {
  return toRecordPath(rootDir, requestId).replace(/\.json$/, ".abort");
}

/**
 * Encode a path segment, hardening `:` (legal on POSIX but reserved on
 * Windows/NTFS) so request ids and keys containing `:` stay portable.
 */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/:/g, "%3A");
}

/**
 * Per-key runOnce result file path:
 * `{rootDir}/<enc(requestId)>@<enc(key)>.runonce`. One file per
 * (requestId, key) so persisting one key never rewrites another's bytes.
 *
 * `@` is the boundary because `encodeSegment` always escapes it, so it never
 * appears inside an encoded id or key: everything before the first `@` is the
 * request id, whatever the caller put in it. Record files end in `.json` and
 * never contain `@`, so neither can be taken for the other.
 */
function toRunOnceKeyPath(
  rootDir: string,
  requestId: string,
  key: string
): string {
  return path.join(rootDir, `${runOnceKeyPrefix(requestId)}${encodeSegment(key)}.runonce`);
}

/** `decodeURIComponent` that returns `undefined` for a malformed name. */
function safeDecode(name: string): string | undefined {
  try {
    return decodeURIComponent(name);
  } catch {
    return undefined;
  }
}

/**
 * Whether `parsed`, read from the file `name`, reads back as the record of the
 * request whose id is the whole name (`<enc(id)>.json`).
 */
function readsBackAsRecordFile(name: string, parsed: unknown): boolean {
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { id?: unknown }).id === safeDecode(name.slice(0, -".json".length))
  );
}

/** File-name prefix every per-key runOnce file of `requestId` starts with. */
function runOnceKeyPrefix(requestId: string): string {
  return `${encodeSegment(requestId)}@`;
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
 * Abort intent diverges from the other adapters on purpose (FIX-1026). Items
 * live inline on the record here, so `get()` is O(items) and keeping the flag
 * on the record would put that cost on every heartbeat poll. It lives in an
 * `.abort` marker file beside the record instead, making the poll a `stat`.
 * That divergence is why this adapter carries more abort code than the others:
 * `get`/`list` overlay the marker. Reads never mutate storage; every write that
 * touches a request's files takes the per-id lock.
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
  private readonly pollIntervalMs: number;
  private readonly onPersistError?: PersistErrorHandler;

  constructor(options: FilesystemRequestStoreOptions) {
    this.rootDir = options.rootDir;
    this.pollIntervalMs =
      options.subscribePollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.onPersistError = options.onPersistError;
    this.store = createFilesystemRecordStore<RequestRecord, RequestListOptions>({
      rootDir: options.rootDir,
      skipSidecars: true,
      sort: (left, right, listOptions) =>
        compareRequestsForListing(left, right, listOptions),
      // `orderBy: "none"` (FIX-1010) returns the matching set unordered. This
      // adapter scans by construction so it is not a cost bound here; it is
      // declared so every adapter answers the option, and so a caller that
      // depends on the *absence* of an order cannot be surprised by one.
      unordered: (listOptions) => listOptions?.orderBy === "none",
      filter: (record, listOptions): boolean => {
        if (
          listOptions?.flowKind !== undefined &&
          record.flowKind !== listOptions.flowKind
        ) {
          return false;
        }

        if (
          listOptions?.flowId !== undefined &&
          record.flowId !== listOptions.flowId
        ) {
          return false;
        }

        if (!matchesMembership(listOptions?.sessionId, record.sessionId)) {
          return false;
        }

        if (
          listOptions?.userId !== undefined &&
          record.userId !== listOptions.userId
        ) {
          return false;
        }

        if (!matchesMembership(listOptions?.status, record.status)) {
          return false;
        }

        if (!matchesTenantFilter(listOptions, record.tenantId)) {
          return false;
        }

        if (!matchesOrgFilter(listOptions, record.orgId)) {
          return false;
        }

        return true;
      }
    });
  }

  /**
   * Whether the abort marker exists for a request (FIX-1026).
   * `stat` rather than a read — the file's contents are never consulted.
   */
  private async hasAbortMarker(id: string): Promise<boolean> {
    try {
      await stat(toAbortMarkerPath(this.rootDir, id));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  /** Create or remove the abort marker so existence matches `requested`. */
  private async writeAbortMarker(id: string, requested: boolean): Promise<void> {
    const markerPath = toAbortMarkerPath(this.rootDir, id);
    if (requested) {
      await ensureDirectory(this.rootDir);
      await atomicWrite(markerPath, "");
      return;
    }
    await rm(markerPath, { force: true });
  }

  async get(id: string): Promise<RequestRecord | undefined> {
    const [record, marked] = await Promise.all([
      this.store.get(id),
      this.hasAbortMarker(id)
    ]);
    if (record === undefined) return undefined;
    return withRequestSourceDefault(
      withStoredAbortRequested(record, marked ? true : undefined)
    );
  }

  /**
   * Overlay abort markers onto records that did not come through `get`.
   *
   * One `readdir` rather than a `stat` per record, and it keeps `list()`
   * agreeing with `get()` — on every other adapter the flag rides the record,
   * so a listing that omitted it would make this adapter the odd one out for
   * any caller reading `abortRequested` off a list (the session request-list
   * endpoint among them).
   */
  private async overlayAbortMarkers(
    records: RequestRecord[]
  ): Promise<RequestRecord[]> {
    if (records.length === 0) return records;
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return records;
      throw err;
    }
    const marked = new Set(entries.filter((name) => name.endsWith(".abort")));
    return records.map((record) => {
      const isMarked = marked.has(
        path.basename(toAbortMarkerPath(this.rootDir, record.id))
      );
      return withStoredAbortRequested(record, isMarked ? true : undefined);
    });
  }

  async set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>> {
    // `abortRequested` is off `set`'s write surface (FIX-1026). The marker is
    // the only home, so the record body never carries the flag: stripping it
    // here means a full-record write can neither set the flag nor clear it,
    // whatever snapshot the caller built its record from.
    const record = withStoredAbortRequested(value, undefined);
    // A record that leaves `items` off keeps the stored ones (FIX-1735), read
    // under the write's lock. Only then does the write need the stored record,
    // which spares the store the O(items) read on every other write.
    if (record.items !== undefined) {
      return this.store.set(id, record, expectedVersion);
    }
    return this.store.set(id, record, expectedVersion, async (current) =>
      withHeldItems(record, current?.items)
    );
  }

  async isAbortRequested(requestId: string): Promise<boolean> {
    return this.hasAbortMarker(requestId);
  }

  async setFieldsIfStatus(
    id: string,
    fields: ConditionalRequestFields,
    allowedStatuses: readonly RequestStatus[],
    updatedAt: number,
    expectedIncarnation?: string
  ): Promise<ConditionalWriteResult> {
    const { abortRequested, ...recordFields } = fields;
    let found: RequestStatus | undefined;
    let otherRecord = false;

    // `update` runs the merge under the per-id write lock, and awaits it there.
    // The marker write happens INSIDE that merge, so the status check, the
    // record write and the marker write are one step. Writing the marker after
    // `update` returned would put it outside the lock, where a terminal write
    // or a `delete` can land in between — leaving a marker on a record that is
    // already finished, or an orphan marker that would cancel a later run
    // reusing the id.
    await this.store.update(id, async (current) => {
      found = current.status;
      // Another record under the same id is not the one the caller checked.
      if (
        expectedIncarnation !== undefined &&
        resolveRequestIncarnation(current) !== expectedIncarnation
      ) {
        otherRecord = true;
        return current;
      }
      // Returning `current` unchanged still rewrites the file — `update` has no
      // "decline" path. Deciding outside the lock instead would reintroduce the
      // read-then-write race this verb exists to remove, so the redundant write
      // on a failed predicate is the price, and it only happens on a cancel
      // that arrives after the request is already terminal.
      if (!allowedStatuses.includes(current.status)) return current;
      if (abortRequested !== undefined) {
        await this.writeAbortMarker(id, abortRequested);
      }
      const next: RequestRecord = { ...current, ...recordFields, updatedAt };
      // A status move whose result is `undefined` removes the stored result.
      if (fields.status !== undefined && fields.result === undefined) delete next.result;
      return next;
    });

    if (found === undefined || otherRecord) return { applied: false, status: undefined };
    if (!allowedStatuses.includes(found)) return { applied: false, status: found };
    return { applied: true, status: found };
  }

  /**
   * Delta verbs (`patchField`/`incField`/`pushToArray`) delegate to the shared
   * CAS record store, which mutates one depth-1 `state` field in place under
   * the per-id lock instead of rewriting the whole record. Per-verb semantics
   * are documented on `FilesystemRecordStore`.
   */
  async patchField(
    id: string,
    path: string[],
    value: unknown,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<RequestRecord>> {
    return this.store.patchField(id, path, value, expectedVersion, updatedAt);
  }

  async incField(
    id: string,
    path: string[],
    delta: number,
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<RequestRecord>> {
    return this.store.incField(id, path, delta, expectedVersion, updatedAt);
  }

  async pushToArray(
    id: string,
    path: string[],
    values: unknown[],
    expectedVersion: ExpectedVersion,
    updatedAt: number
  ): Promise<SetResult<RequestRecord>> {
    return this.store.pushToArray(id, path, values, expectedVersion, updatedAt);
  }

  async delete(id: string): Promise<void> {
    // Settle event writes before the sweep. A queued write takes its batch
    // the moment it starts, so dropping the unwritten batch alone is not
    // enough: an append already in flight would recreate the log after the
    // sweep, and a later request reusing the id would replay it.
    this.pendingNewEvents.delete(id);
    await this.eventWriteQueues.get(id)?.drain();
    // Sidecars are swept inside the per-id lock, alongside the record file.
    // Sweeping them after `delete` returned would put the marker removal
    // outside the lock, where a conditional write can slip in between and be
    // left holding a marker whose record is already gone.
    await this.store.delete(id, () => this.deleteSidecars(id));
    // An event write failure not yet reported belonged to the deleted
    // request; the id's next owner must not be handed it by its first flush.
    this.lastEventError.delete(id);
  }

  /**
   * Remove the sidecar files the request store writes alongside the primary
   * record: the NDJSON event log, the abort marker and every per-key runOnce
   * file. Without this, deleting a request orphans those files on disk and
   * they accumulate for high-churn deployments.
   *
   * Per-key files are matched by prefix. The prefix ends at the first `@`,
   * which no encoded id contains, so it matches this id's files and no other's.
   */
  private async deleteSidecars(id: string): Promise<void> {
    // `<id>.events.json` is also the record file of the request whose id is
    // `<id>.events`. Such a file that reads back as that record is left; see
    // `isRecordFile`.
    const eventsFile = path.basename(toEventsPath(this.rootDir, id));
    const abortMarker = path.basename(toAbortMarkerPath(this.rootDir, id));
    const keyPrefix = runOnceKeyPrefix(id);
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    // Every removal settles before a failure is reported, so no straggler
    // from this attempt is still running when the caller retries.
    const results = await Promise.allSettled(
      entries.map(async (name) => {
        const isPerKeyRunOnce =
          name.startsWith(keyPrefix) && name.endsWith(".runonce");
        const filePath = path.join(this.rootDir, name);
        if (name === abortMarker || isPerKeyRunOnce) {
          await rm(filePath, { force: true });
          return;
        }
        if (name === eventsFile && !(await this.isRecordFile(name))) {
          await rm(filePath, { force: true });
        }
      })
    );
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    if (failure !== undefined) throw failure.reason;
  }

  /**
   * Whether the file `name` reads back as the record of the request whose id
   * is the whole name (see {@link readsBackAsRecordFile}). A missing or
   * unparseable file does not.
   */
  private async isRecordFile(name: string): Promise<boolean> {
    let content: string;
    try {
      content = await readFile(path.join(this.rootDir, name), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw err;
    }
    try {
      return readsBackAsRecordFile(name, JSON.parse(content) as unknown);
    } catch {
      return false;
    }
  }

  async list(options?: RequestListOptions): Promise<RequestRecord[]> {
    const records = await this.store.list(options);
    const overlaid = await this.overlayAbortMarkers(records);
    return overlaid.map((record) => withRequestSourceDefault(record));
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
        items: mergeItemsById(current.items ?? [], snapshot),
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

  async countItems(requestId: string): Promise<number> {
    // Items live inline on the record file, so the count is the record read.
    const record = await this.store.get(requestId);
    return record?.items?.length ?? 0;
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
      // Append errors propagate to the queue's onError (FIX-399) — never
      // swallowed.
      const lines = newEvents.map((e) => `${JSON.stringify(e)}\n`).join("");
      await appendFile(targetPath, lines, "utf8");
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
    const keyPath = toRunOnceKeyPath(this.rootDir, requestId, key);
    try {
      const raw = await readFile(keyPath, "utf8");
      return { found: true, value: JSON.parse(raw) as unknown };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { found: false };
      throw error;
    }
  }

  async setRunOnceResult(
    requestId: string,
    key: string,
    value: unknown
  ): Promise<void> {
    // One file per (requestId, key): no read-merge-write, so concurrent writes
    // to different keys never collide and persisting one key doesn't rewrite
    // another. Atomic temp-write + rename guards against torn files.
    try {
      await ensureDirectory(this.rootDir);
      const targetPath = toRunOnceKeyPath(this.rootDir, requestId, key);
      await atomicWrite(targetPath, JSON.stringify(value));
    } catch (error) {
      this.onPersistError?.({
        store: "request",
        id: requestId,
        error: error as Error
      });
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
