/**
 * Filesystem-backed trace event store with FIFO retention by request (FIX-558).
 *
 * Mirrors the SQLite store's two-table design with files:
 *   - `_roster.json` records the FIFO insertion order of distinct request IDs.
 *     Source of truth for `listRequestIds` and the `maxRequests` cap.
 *   - `{encodeURIComponent(requestId)}.ndjson` holds one trace event per line,
 *     append-only. Atomic appends rely on POSIX `O_APPEND`; coalesced via a
 *     per-request `SerializedWriteQueue`.
 *
 * Designed for `fsdev dev`: events survive process restarts, the roster
 * file is the only mutable cross-cutting state, and reads are full-file
 * (single-digit MB max in practice).
 *
 * No per-request byte cap — the in-memory store needs one for heap
 * pressure; the filesystem store has the disk bounded only by `maxRequests`
 * and the natural size of a request's event tail.
 */
import { appendFile, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createSerializedWriteQueue,
  type SerializedWriteQueue
} from "../../utils/serialized-write-queue";
import type { TraceEvent, TraceStore } from "../types";
import { ensureDirectory } from "./shared";

export type FilesystemTraceStoreOptions = {
  /** Directory where the `_roster.json` file and `.ndjson` event files live. */
  rootDir: string;
  /**
   * FIFO retention cap measured in distinct request IDs. When a new request
   * pushes the roster past this number, the oldest request's events are
   * evicted from disk. Defaults to {@link DEFAULT_MAX_REQUESTS}.
   */
  maxRequests?: number;
};

const DEFAULT_MAX_REQUESTS = 50;

const ROSTER_FILE = "_roster.json";

type RosterEntry = { requestId: string; insertedAt: number };

function rosterPath(rootDir: string): string {
  return path.join(rootDir, ROSTER_FILE);
}

function eventsPath(rootDir: string, requestId: string): string {
  return path.join(rootDir, `${encodeURIComponent(requestId)}.ndjson`);
}

export class FilesystemTraceStore implements TraceStore {
  private readonly rootDir: string;
  private readonly maxRequests: number;
  private readonly writeQueues = new Map<string, SerializedWriteQueue>();
  /** True when a coalescing write task is already in-flight for this request. */
  private readonly writeScheduled = new Set<string>();
  /** Events accumulated between coalesced flushes. Drained inside the queue task. */
  private readonly pendingEvents = new Map<string, TraceEvent[]>();
  /** Insertion-ordered cache of `_roster.json`. Map insertion order is the FIFO. */
  private readonly roster = new Map<string, number>();
  /** Serializes roster mutations so size-checked eviction is atomic. */
  private rosterLock: Promise<unknown> = Promise.resolve();
  /** Lazy initialization handle so loadRoster runs at most once per instance. */
  private rosterReady: Promise<void> | undefined;
  /** Tracks file paths we've already warned about to avoid log spam. */
  private readonly corruptionWarned = new Set<string>();

  constructor(options: FilesystemTraceStoreOptions) {
    this.rootDir = options.rootDir;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  }

  async appendEvent(requestId: string, event: TraceEvent): Promise<void> {
    let pending = this.pendingEvents.get(requestId);
    if (pending === undefined) {
      pending = [];
      this.pendingEvents.set(requestId, pending);
    }
    pending.push(event);

    const queue = this.getOrCreateWriteQueue(requestId);
    if (!this.writeScheduled.has(requestId)) {
      this.writeScheduled.add(requestId);
      queue.enqueue(async () => {
        // Read pending at execution time so events appended between enqueue
        // and now are coalesced into a single append.
        this.writeScheduled.delete(requestId);
        const events = this.pendingEvents.get(requestId) ?? [];
        this.pendingEvents.delete(requestId);
        if (events.length === 0) return;

        // Roster registration runs inside the queued task so eviction can
        // observe and clean up old requests in the same critical section
        // before the new file is created.
        await this.ensureRosterEntry(requestId);
        await ensureDirectory(this.rootDir);
        const lines = events.map((e) => `${JSON.stringify(e)}\n`).join("");
        await appendFile(eventsPath(this.rootDir, requestId), lines, "utf8");
      });
    }

    // Awaiting drain makes `appendEvent` durability-equivalent to the
    // in-memory and SQLite implementations: by the time the promise
    // resolves, the event is on disk and visible to `getEvents`.
    await queue.drain();
  }

  async flush(requestId: string): Promise<void> {
    const queue = this.writeQueues.get(requestId);
    if (queue !== undefined) await queue.drain();
  }

  async getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]> {
    await this.loadRoster();
    if (!this.roster.has(requestId)) return [];

    const filePath = eventsPath(this.rootDir, requestId);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") return [];
      throw err;
    }

    const out: TraceEvent[] = [];
    let warnedThisRead = false;
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as TraceEvent;
        if (fromSequence === undefined || event.sequenceNumber > fromSequence) {
          out.push(event);
        }
      } catch {
        if (!warnedThisRead && !this.corruptionWarned.has(filePath)) {
          this.corruptionWarned.add(filePath);
          warnedThisRead = true;
          console.warn(
            `[flow-state] skipping corrupted trace line(s) in ${filePath}`
          );
        }
      }
    }
    return out;
  }

  async listRequestIds(): Promise<string[]> {
    await this.loadRoster();
    return Array.from(this.roster.keys());
  }

  private loadRoster(): Promise<void> {
    if (this.rosterReady !== undefined) return this.rosterReady;
    this.rosterReady = (async () => {
      try {
        const raw = await readFile(rosterPath(this.rootDir), "utf8");
        const entries = JSON.parse(raw) as RosterEntry[];
        for (const entry of entries) {
          this.roster.set(entry.requestId, entry.insertedAt);
        }
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        if (e.code === "ENOENT") return;
        // Malformed roster: treat as empty so a new write overwrites it
        // with valid JSON. Operators can still recover the bad file by
        // hand if they care — we don't unlink it.
        console.warn(
          `[flow-state] trace roster at ${rosterPath(this.rootDir)} is unreadable; treating as empty`,
          err
        );
      }
    })();
    return this.rosterReady;
  }

  private withRosterLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.rosterLock.then(fn, fn);
    // Swallow rejection so a failed roster mutation doesn't poison the chain.
    this.rosterLock = next.catch(() => undefined);
    return next;
  }

  private async ensureRosterEntry(requestId: string): Promise<void> {
    await this.loadRoster();
    if (this.roster.has(requestId)) return;
    await this.withRosterLock(async () => {
      // Re-check inside the lock — a concurrent append may have added it.
      if (this.roster.has(requestId)) return;
      this.roster.set(requestId, Date.now());

      const evicted: string[] = [];
      while (this.roster.size > this.maxRequests) {
        const oldest = this.roster.keys().next();
        if (oldest.done === true) break;
        evicted.push(oldest.value);
        this.roster.delete(oldest.value);
      }

      await this.writeRoster();

      for (const id of evicted) {
        // Best-effort cleanup. A concurrent appendEvent for an evicted
        // request can re-add it on its next call — that's the documented
        // "append wins / eviction wins" trade-off.
        this.pendingEvents.delete(id);
        try {
          await rm(eventsPath(this.rootDir, id));
        } catch (err) {
          const e = err as NodeJS.ErrnoException;
          if (e.code !== "ENOENT") {
            console.error(
              `[flow-state] failed to remove evicted trace events for ${id}`,
              err
            );
          }
        }
      }
    });
  }

  private async writeRoster(): Promise<void> {
    await ensureDirectory(this.rootDir);
    const entries: RosterEntry[] = [];
    for (const [requestId, insertedAt] of this.roster) {
      entries.push({ requestId, insertedAt });
    }
    const target = rosterPath(this.rootDir);
    const tmp = `${target}.tmp-${process.pid}-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    await writeFile(tmp, JSON.stringify(entries), "utf8");
    await rename(tmp, target);
  }

  private getOrCreateWriteQueue(requestId: string): SerializedWriteQueue {
    let queue = this.writeQueues.get(requestId);
    if (queue === undefined) {
      queue = createSerializedWriteQueue({
        label: `trace-events:${requestId}`,
        onError: (err) => {
          console.error(
            `[flow-state] trace event persistence failed for ${requestId}`,
            err
          );
        }
      });
      this.writeQueues.set(requestId, queue);
    }
    return queue;
  }
}

/**
 * Construct a {@link FilesystemTraceStore}. Accepts the same options as the
 * class constructor; returns the {@link TraceStore} interface so callers
 * stay decoupled from the concrete class.
 */
export function createFilesystemTraceStore(
  options: FilesystemTraceStoreOptions
): TraceStore {
  return new FilesystemTraceStore(options);
}
