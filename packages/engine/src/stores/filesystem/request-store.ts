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
import { withRequestSourceDefault, withStoredAbortRequested } from "../shared";
import { matchesTenantFilter } from "../scope-keys";
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

function toRunOncePath(rootDir: string, requestId: string): string {
  return toRecordPath(rootDir, requestId).replace(/\.json$/, ".runonce.json");
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
 * `{rootDir}/<enc(requestId)>.runonce.<enc(key)>.json`. One file per
 * (requestId, key) so persisting one key never rewrites another's bytes.
 */
function toRunOnceKeyPath(
  rootDir: string,
  requestId: string,
  key: string
): string {
  return path.join(
    rootDir,
    `${encodeSegment(requestId)}.runonce.${encodeSegment(key)}.json`
  );
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
 * `get`/`list` overlay the marker, and a pre-upgrade record carrying the flag
 * inline is migrated to a marker on its first write. Reads never mutate
 * storage; every write that touches a request's files takes the per-id lock.
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
  /**
   * Requests whose inline legacy abort intent has been dealt with by a write
   * that completed (FIX-1026). Every write strips the inline field, so once
   * one has landed the record can never carry it again and later writes can
   * skip the check entirely — which is what keeps the legacy read at one per
   * request per process instead of one per write, on an adapter whose records
   * carry items and are therefore O(items) to read.
   *
   * A plain set of ids, checked synchronously, NOT a promise to await. The
   * check has to stay synchronous: an `await` here would hand the per-id write
   * lock to anything already queued, and a `delete` that slipped through would
   * then be undone by the write that waited. Two writers both seeing "not yet"
   * is harmless — they serialize on that lock, and the second finds the first
   * has already stripped the field.
   */
  private readonly abortIntentMigrated = new Set<string>();
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

        if (!matchesTenantFilter(listOptions, record.tenantId)) {
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

    // BP-030 dual-read. The marker is authoritative once it exists; a record
    // written before the flag moved off `set`'s surface still carries it
    // inline, and must still read as requested.
    //
    // Read-only. An earlier revision created the marker here to "migrate" the
    // record; a read does not mutate storage. Migrating from this path would
    // also put a locked read-modify-write on the hot read path, and `get` is
    // already the O(items) call the marker exists to keep off the poll.
    //
    // Migration happens on the write path instead — every write that strips
    // the inline flag (`set` and `setFieldsIfStatus` alike) moves it into the
    // marker first, so no write discards stored intent. Between an upgrade and
    // a request's first write, the flag is therefore visible here but not to
    // `isAbortRequested`, which is a bare `stat`. That gap is one write wide
    // and closes on the first write, which every live request performs.
    const inlineLegacy = record.abortRequested === true;

    return withRequestSourceDefault(
      withStoredAbortRequested(record, marked || inlineLegacy ? true : undefined)
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
      return withStoredAbortRequested(
        record,
        isMarked || record.abortRequested === true ? true : undefined
      );
    });
  }

  /**
   * Move a pre-upgrade inline `abortRequested: true` into the marker, once per
   * request per process (FIX-1026, BP-030).
   *
   * Both write paths strip the inline field — `set` always, and
   * `setFieldsIfStatus` on every applied write regardless of whether its field
   * set mentions `abortRequested`. On a record written before the flag moved
   * off `set`'s write surface that field is the *only* copy of the
   * cancellation, so stripping it without migrating would let an ordinary
   * write clear stored intent, which the `set` contract forbids in both
   * directions. It is not merely a lost read: `isAbortRequested` is a bare
   * `stat`, so intent left inline is intent the cross-process poll can never
   * deliver, and a request cancelled before the upgrade that reached
   * `suspended` or `interrupted` would resume and run to completion.
   *
   * Runs inside the per-id lock the write has already taken, against the
   * record that write is about to replace — never as an operation of its own.
   * A separately-locked migration ahead of the write releases the lock in
   * between, and a `delete` issued afterwards runs to completion in that gap;
   * the trailing write then recreates the request the delete removed, with the
   * deleted marker's cancellation gone. Sharing the caller's lock also means
   * the strip and the migration that rescues the stripped value cannot be
   * separated by another writer, which is what the memo used to buy.
   *
   * Takes no lock and reads nothing of its own, deliberately: reaching for
   * either from in here would either deadlock against the lock the caller
   * holds or reopen the window it exists to close.
   */
  private async migrateLegacyAbortIntent(
    id: string,
    current: RequestRecord | undefined
  ): Promise<void> {
    // Records written by this store never carry the field, so this writes
    // nothing for every non-legacy request.
    if (current?.abortRequested === true) {
      await this.writeAbortMarker(id, true);
    }
    // Only once the marker is safely on disk. A failed marker write must leave
    // the id unmarked so the next write retries it — and because this runs
    // before the record is replaced, that failure also aborts the write rather
    // than stripping a cancellation it could not move.
    this.abortIntentMigrated.add(id);
  }

  async set(
    id: string,
    value: RequestRecord,
    expectedVersion: ExpectedVersion
  ): Promise<SetResult<RequestRecord>> {
    // `abortRequested` is off `set`'s write surface (FIX-1026). The marker is
    // the only home, so the record body never carries the flag: stripping it
    // here means a full-record write can neither set the flag nor clear it,
    // whatever snapshot the caller built its record from. The `beforeWrite`
    // hook moves a legacy record's inline copy to the marker first — under
    // this same write's lock — so stripping never discards stored intent.
    return this.store.set(
      id,
      withStoredAbortRequested(value, undefined),
      expectedVersion,
      // Omitted once this request is known migrated, which is what spares the
      // store the O(items) read the hook would otherwise need on every write.
      this.abortIntentMigrated.has(id)
        ? undefined
        : (current) => this.migrateLegacyAbortIntent(id, current)
    );
  }

  async isAbortRequested(requestId: string): Promise<boolean> {
    return this.hasAbortMarker(requestId);
  }

  async setFieldsIfStatus(
    id: string,
    fields: ConditionalRequestFields,
    allowedStatuses: readonly RequestStatus[],
    updatedAt: number
  ): Promise<ConditionalWriteResult> {
    const { abortRequested, ...recordFields } = fields;
    let found: RequestStatus | undefined;

    // `update` runs the merge under the per-id write lock, and awaits it there.
    // The marker write happens INSIDE that merge, so the status check, the
    // record write and the marker write are one step. Writing the marker after
    // `update` returned would put it outside the lock, where a terminal write
    // or a `delete` can land in between — leaving a marker on a record that is
    // already finished, or an orphan marker that would cancel a later run
    // reusing the id.
    await this.store.update(id, async (current) => {
      found = current.status;
      // Returning `current` unchanged still rewrites the file — `update` has no
      // "decline" path. Deciding outside the lock instead would reintroduce the
      // read-then-write race this verb exists to remove, so the redundant write
      // on a failed predicate is the price, and it only happens on a cancel
      // that arrives after the request is already terminal.
      if (!allowedStatuses.includes(current.status)) return current;
      // Same obligation as `set`, for the same reason: the strip below runs
      // unconditionally, but the marker is only written when `fields` carries
      // `abortRequested`. A conditional write of any OTHER field would
      // therefore strip a legacy record's only copy of its cancellation with
      // nothing to replace it — gone from `get()` and from `isAbortRequested()`
      // alike. So the guard holds for callers that do not exist yet: the verb
      // is deliberately general, and today's two callers both happening to
      // pass `abortRequested` is a property of the callers, not of this
      // method. An explicit value in `fields` is the caller's decision and
      // wins outright; there is nothing to carry forward.
      if (abortRequested === undefined) {
        await this.migrateLegacyAbortIntent(id, current);
      } else {
        await this.writeAbortMarker(id, abortRequested);
        this.abortIntentMigrated.add(id);
      }
      // Drop any inline copy on the way out. The marker is the sole home, and
      // a pre-upgrade record that still carries the flag inline would
      // otherwise outlive an applied `{ abortRequested: false }`: the marker
      // would be removed, the inline `true` would remain, and the next `get`
      // would report the cancellation as still standing.
      return withStoredAbortRequested(
        { ...current, ...recordFields, updatedAt },
        undefined
      );
    });

    if (found === undefined) return { applied: false, status: undefined };
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
    // Sidecars are swept inside the per-id lock, alongside the record file.
    // Sweeping them after `delete` returned would put the marker removal
    // outside the lock, where a conditional write can slip in between and be
    // left holding a marker whose record is already gone.
    await this.store.delete(id, () => this.deleteSidecars(id));
    // The record and its marker are gone, so "already migrated" is no longer a
    // fact about anything. Dropping it keeps the skip above answering a
    // question about a record that exists.
    this.abortIntentMigrated.delete(id);
  }

  /**
   * Remove the sidecar files the request store writes alongside the primary
   * record: the NDJSON event log and every runOnce file (legacy single-map and
   * per-key). Without this, deleting a request orphans those files on disk and
   * they accumulate for high-churn deployments. The events/legacy-runonce
   * paths encode the id with `encodeURIComponent`; per-key runOnce files use
   * `encodeSegment` (which also escapes `:`). Both agree for framework `req_*`
   * ids; matching both prefixes keeps the sweep correct for any id.
   */
  private async deleteSidecars(id: string): Promise<void> {
    const exact = new Set([
      path.basename(toEventsPath(this.rootDir, id)),
      path.basename(toRunOncePath(this.rootDir, id)),
      path.basename(toAbortMarkerPath(this.rootDir, id))
    ]);
    const runOncePrefixes = [
      `${encodeURIComponent(id)}.runonce.`,
      `${encodeSegment(id)}.runonce.`
    ];
    let entries: string[];
    try {
      entries = await readdir(this.rootDir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
      throw err;
    }
    await Promise.all(
      entries.map(async (name) => {
        const isPerKeyRunOnce =
          name.endsWith(".json") &&
          runOncePrefixes.some((prefix) => name.startsWith(prefix));
        if (exact.has(name) || isPerKeyRunOnce) {
          await rm(path.join(this.rootDir, name), { force: true });
        }
      })
    );
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
    await atomicWrite(targetPath, ndjson);
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
    // Per-key file is the source of truth post-upgrade.
    const keyPath = toRunOnceKeyPath(this.rootDir, requestId, key);
    try {
      const raw = await readFile(keyPath, "utf8");
      return { found: true, value: JSON.parse(raw) as unknown };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    // Lazy fallback: a legacy single-map file written by an older version.
    // Legacy files are read-only after upgrade — never rewritten.
    const legacyPath = toRunOncePath(this.rootDir, requestId);
    let map: Record<string, unknown>;
    try {
      const raw = await readFile(legacyPath, "utf8");
      map = JSON.parse(raw) as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { found: false };
      }
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
