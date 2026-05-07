/**
 * Filesystem-backed trace event store with FIFO retention by request (FIX-558).
 *
 * Two on-disk artifacts under `{rootDir}`:
 *   - `_roster.json` — array of `{ requestId, insertedAt }` in insertion order.
 *     Source of truth for `listRequestIds` and the `maxRequests` cap.
 *   - `{encodeURIComponent(requestId)}.ndjson` — one trace event per line,
 *     append-only.
 *
 * Concurrent appends to the same request are coalesced into one filesystem
 * write via a per-request `SerializedWriteQueue`. Roster mutations (the
 * size-checked eviction path) are serialized through a shared lock so size
 * checks and the corresponding `rm` of evicted files are atomic.
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
  rootDir: string;
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

/**
 * Module-scoped so the "warn once per corrupted file" guarantee holds across
 * `FilesystemTraceStore` instances within the same process — restarting the
 * store object during tests or registry rebuilds shouldn't re-spam logs for
 * the same on-disk file.
 */
const corruptionWarned = new Set<string>();

export class FilesystemTraceStore implements TraceStore {
  private readonly rootDir: string;
  private readonly maxRequests: number;
  private readonly writeQueues = new Map<string, SerializedWriteQueue>();
  private readonly pendingEvents = new Map<string, TraceEvent[]>();
  /**
   * One in-flight batch promise per request. Concurrent `appendEvent` calls
   * for the same request all await the same promise, so a single coalesced
   * write satisfies them collectively and a write failure rejects every
   * caller (instead of silently logging via the queue's `onError` hook).
   */
  private readonly pendingWrite = new Map<string, Promise<void>>();
  private readonly roster = new Map<string, number>();
  private rosterLock: Promise<unknown> = Promise.resolve();
  private rosterReady: Promise<void> | undefined;

  constructor(options: FilesystemTraceStoreOptions) {
    this.rootDir = options.rootDir;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  }

  appendEvent(requestId: string, event: TraceEvent): Promise<void> {
    let pending = this.pendingEvents.get(requestId);
    if (pending === undefined) {
      pending = [];
      this.pendingEvents.set(requestId, pending);
    }
    pending.push(event);

    let inflight = this.pendingWrite.get(requestId);
    if (inflight === undefined) {
      // Construct the inflight promise BEFORE enqueueing so the
      // `pendingWrite.set` below runs before the queue task's
      // `pendingWrite.delete` — `queue.enqueue` synchronously starts the
      // task up to its first `await`, which would otherwise leave a stale
      // `pendingWrite` entry that suppresses every subsequent batch.
      let resolveInflight!: () => void;
      let rejectInflight!: (err: Error) => void;
      inflight = new Promise<void>((resolve, reject) => {
        resolveInflight = resolve;
        rejectInflight = reject;
      });
      this.pendingWrite.set(requestId, inflight);

      const queue = this.getOrCreateWriteQueue(requestId);
      queue.enqueue(async () => {
        this.pendingWrite.delete(requestId);
        const events = this.pendingEvents.get(requestId) ?? [];
        this.pendingEvents.delete(requestId);
        if (events.length === 0) {
          resolveInflight();
          return;
        }
        try {
          await this.ensureRosterEntry(requestId);
          await ensureDirectory(this.rootDir);
          const lines = events.map((e) => `${JSON.stringify(e)}\n`).join("");
          await appendFile(eventsPath(this.rootDir, requestId), lines, "utf8");
          resolveInflight();
        } catch (err) {
          rejectInflight(err instanceof Error ? err : new Error(String(err)));
        }
      });
    }
    return inflight;
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
    for (const line of raw.split("\n")) {
      if (line.length === 0) continue;
      try {
        const event = JSON.parse(line) as TraceEvent;
        if (fromSequence === undefined || event.sequenceNumber > fromSequence) {
          out.push(event);
        }
      } catch {
        if (!corruptionWarned.has(filePath)) {
          corruptionWarned.add(filePath);
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
        // Malformed roster: treat as empty so the next write overwrites it
        // with valid JSON. We don't unlink it — operators can still recover
        // the bad file by hand if they care.
        console.warn(
          `[flow-state] trace roster at ${rosterPath(this.rootDir)} is unreadable; treating as empty`,
          err
        );
      }
    })();
    return this.rosterReady;
  }

  // `.then(fn, fn)` runs the callback regardless of whether the prior holder
  // resolved or rejected — a failed roster mutation must not block subsequent
  // ones, and we explicitly catch the chained rejection so it doesn't leak.
  private withRosterLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.rosterLock.then(fn, fn);
    this.rosterLock = next.catch(() => undefined);
    return next;
  }

  private async ensureRosterEntry(requestId: string): Promise<void> {
    await this.loadRoster();
    if (this.roster.has(requestId)) return;
    await this.withRosterLock(async () => {
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
        // Drop in-memory bookkeeping for evicted requests so the maps don't
        // grow unbounded over a long-running process. A concurrent
        // appendEvent that beat the roster mutation has already captured
        // the pending events into its queued task — its appendFile may
        // create an orphan file, which the spec accepts as the documented
        // "append wins / eviction wins" trade-off.
        this.pendingEvents.delete(id);
        this.pendingWrite.delete(id);
        this.writeQueues.delete(id);
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
      // The queue's own `onError` is a backstop for callers that didn't
      // await `appendEvent`. The primary error channel is the `inflight`
      // promise rejection in `appendEvent`.
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

export function createFilesystemTraceStore(
  options: FilesystemTraceStoreOptions
): TraceStore {
  return new FilesystemTraceStore(options);
}
