/**
 * Filesystem-backed trace event store with FIFO retention by request.
 *
 * On-disk layout under `{rootDir}`:
 *   - `_roster.json` — `[{ requestId, insertedAt }]`, source of truth for
 *     `listRequestIds` and the `maxRequests` cap.
 *   - `{encodeURIComponent(requestId)}.ndjson` — one trace event per line,
 *     append-only.
 *
 * Concurrent appends to the same request coalesce into one batched
 * `appendFile` via a per-request `SerializedWriteQueue`. Roster mutations
 * (size-checked eviction) serialize through a single roster lock.
 */
import { appendFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  createSerializedWriteQueue,
  type SerializedWriteQueue
} from "../../utils/serialized-write-queue";
import type { TraceEvent, TraceStore } from "../types";
import { atomicWrite, ensureDirectory } from "./shared";

export type FilesystemTraceStoreOptions = {
  rootDir: string;
  maxRequests?: number;
};

const DEFAULT_MAX_REQUESTS = 50;
const ROSTER_FILE = "_roster.json";

type RosterEntry = { requestId: string; insertedAt: number };

type RequestState = {
  queue: SerializedWriteQueue;
  pending: TraceEvent[];
  inflight: Promise<void> | undefined;
};

function rosterPath(rootDir: string): string {
  return path.join(rootDir, ROSTER_FILE);
}

function eventsPath(rootDir: string, requestId: string): string {
  return path.join(rootDir, `${encodeURIComponent(requestId)}.ndjson`);
}

// Module-scoped so the "warn once per corrupted file" guarantee holds across
// `FilesystemTraceStore` instances within the same process.
const corruptionWarned = new Set<string>();

export class FilesystemTraceStore implements TraceStore {
  private readonly rootDir: string;
  private readonly maxRequests: number;
  private readonly state = new Map<string, RequestState>();
  private readonly roster = new Map<string, number>();
  private rosterLock: Promise<unknown> = Promise.resolve();
  private rosterReady: Promise<void> | undefined;
  private dirReady: Promise<void> | undefined;

  constructor(options: FilesystemTraceStoreOptions) {
    this.rootDir = options.rootDir;
    this.maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  }

  appendEvent(requestId: string, event: TraceEvent): Promise<void> {
    const state = this.getOrCreateState(requestId);
    state.pending.push(event);

    if (state.inflight !== undefined) return state.inflight;

    let resolveInflight!: () => void;
    let rejectInflight!: (err: Error) => void;
    const inflight = new Promise<void>((resolve, reject) => {
      resolveInflight = resolve;
      rejectInflight = reject;
    });
    state.inflight = inflight;

    // The queued task runs synchronously up to its first `await` and clears
    // `state.inflight` then — capture the promise in a local so the caller
    // returns the original handle even after the task nulls the field.
    state.queue.enqueue(async () => {
      const events = state.pending;
      state.pending = [];
      state.inflight = undefined;
      if (events.length === 0) {
        resolveInflight();
        return;
      }
      try {
        await this.ensureRosterEntry(requestId);
        await this.ensureRootDir();
        const lines = events.map((e) => `${JSON.stringify(e)}\n`).join("");
        await appendFile(eventsPath(this.rootDir, requestId), lines, "utf8");
        resolveInflight();
      } catch (err) {
        rejectInflight(err instanceof Error ? err : new Error(String(err)));
      }
    });

    return inflight;
  }

  async flush(requestId: string): Promise<void> {
    const state = this.state.get(requestId);
    if (state !== undefined) await state.queue.drain();
  }

  async getEvents(requestId: string, fromSequence?: number): Promise<TraceEvent[]> {
    await this.loadRoster();
    if (!this.roster.has(requestId)) return [];

    const filePath = eventsPath(this.rootDir, requestId);
    let raw: string;
    try {
      raw = await readFile(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
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

  private getOrCreateState(requestId: string): RequestState {
    let state = this.state.get(requestId);
    if (state !== undefined) return state;
    state = {
      queue: createSerializedWriteQueue({
        label: `trace-events:${requestId}`,
        // Backstop for callers that never await `appendEvent`. The primary
        // error channel is the `inflight` promise rejection.
        onError: (err) => {
          console.error(
            `[flow-state] trace event persistence failed for ${requestId}`,
            err
          );
        }
      }),
      pending: [],
      inflight: undefined
    };
    this.state.set(requestId, state);
    return state;
  }

  private ensureRootDir(): Promise<void> {
    if (this.dirReady !== undefined) return this.dirReady;
    this.dirReady = ensureDirectory(this.rootDir);
    return this.dirReady;
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
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
        // Treat malformed roster as empty so the next write overwrites it.
        // We don't unlink — operators can still recover the bad file by hand.
        console.warn(
          `[flow-state] trace roster at ${rosterPath(this.rootDir)} is unreadable; treating as empty`,
          err
        );
      }
    })();
    return this.rosterReady;
  }

  // `.then(fn, fn)` runs `fn` after either outcome so a rejected mutation
  // doesn't block the chain; the trailing `.catch` keeps the rejection from
  // leaking as an unhandled-rejection warning.
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

      // Drop bookkeeping for evicted requests; in-flight appends that beat
      // the lock have already captured their pending events into the queued
      // task, so their `appendFile` may create an orphan file (accepted per
      // the spec's "append wins / eviction wins" trade-off).
      for (const id of evicted) this.state.delete(id);
      await Promise.allSettled(
        evicted.map((id) =>
          rm(eventsPath(this.rootDir, id)).catch((err) => {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
              console.error(
                `[flow-state] failed to remove evicted trace events for ${id}`,
                err
              );
            }
          })
        )
      );
    });
  }

  private async writeRoster(): Promise<void> {
    await this.ensureRootDir();
    const entries: RosterEntry[] = [];
    for (const [requestId, insertedAt] of this.roster) {
      entries.push({ requestId, insertedAt });
    }
    await atomicWrite(rosterPath(this.rootDir), JSON.stringify(entries));
  }
}

export function createFilesystemTraceStore(
  options: FilesystemTraceStoreOptions
): TraceStore {
  return new FilesystemTraceStore(options);
}
