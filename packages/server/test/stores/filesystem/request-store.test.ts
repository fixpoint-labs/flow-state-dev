/**
 * Filesystem request-store event-log tests (FIX-686).
 *
 * Exercises the append-only NDJSON event log through the public store
 * surface: incremental persistence, read-back order, malformed-line
 * tolerance, lazy migration of the legacy JSON-array format, the
 * `fromSequence` cursor on both formats, and the FIX-399 flush durability
 * barrier. Tests encode the durability intent (no silent loss, no sequence
 * gaps on replay), not just the file shape.
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestStreamEvent } from "@flow-state-dev/core/items";
import { createFilesystemRequestStore } from "../../../src/stores/filesystem/request-store";
import { makeRequestStreamEvent } from "../../../src/testing";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "fsd-req-events-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function eventsPath(requestId: string): string {
  return path.join(rootDir, `${encodeURIComponent(requestId)}.events.json`);
}

function ev(requestId: string, seq: number): RequestStreamEvent {
  return makeRequestStreamEvent(requestId, seq);
}

describe("FilesystemRequestStore — NDJSON event log", () => {
  it("persistEvents appends NDJSON lines and getEvents reads them back in order", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    store.persistEvents("r1", [ev("r1", 1), ev("r1", 2)]);
    await store.flushEvents("r1");
    store.persistEvents("r1", [ev("r1", 3)]);
    await store.flushEvents("r1");

    const raw = await readFile(eventsPath("r1"), "utf8");
    // Append-only NDJSON: one JSON object per line, terminating newline.
    expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(3);
    expect(raw.endsWith("\n")).toBe(true);

    const events = await store.getEvents("r1");
    expect(events.map((e) => e.sequence_number)).toEqual([1, 2, 3]);
  });

  it("getEvents skips a malformed trailing line and warns once per file", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    store.persistEvents("r1", [ev("r1", 1), ev("r1", 2)]);
    await store.flushEvents("r1");

    // Simulate a torn final append (process killed mid-write).
    const raw = await readFile(eventsPath("r1"), "utf8");
    await writeFile(eventsPath("r1"), `${raw}{"partial":`, "utf8");

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await store.getEvents("r1");
    const second = await store.getEvents("r1");
    expect(first.map((e) => e.sequence_number)).toEqual([1, 2]);
    expect(second.map((e) => e.sequence_number)).toEqual([1, 2]);
    // Corruption warning is one-shot per file across reads.
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it("auto-migrates a legacy JSON-array file to NDJSON on first persistEvents then appends", async () => {
    // Pre-seed a legacy JSON-array events file (the old format).
    const legacy = JSON.stringify([ev("r1", 1), ev("r1", 2)]);
    await writeFile(eventsPath("r1"), legacy, "utf8");

    const store = createFilesystemRequestStore({ rootDir });
    store.persistEvents("r1", [ev("r1", 3)]);
    await store.flushEvents("r1");

    const raw = await readFile(eventsPath("r1"), "utf8");
    // Migrated to NDJSON: no leading `[`, three newline-terminated lines.
    expect(raw.trimStart().startsWith("[")).toBe(false);
    expect(raw.split("\n").filter((l) => l.length > 0)).toHaveLength(3);

    const events = await store.getEvents("r1");
    expect(events.map((e) => e.sequence_number)).toEqual([1, 2, 3]);
  });

  it("reads a legacy JSON-array file directly via getEvents without a prior persist", async () => {
    const legacy = JSON.stringify([ev("r1", 1), ev("r1", 2), ev("r1", 3)]);
    await writeFile(eventsPath("r1"), legacy, "utf8");

    const store = createFilesystemRequestStore({ rootDir });
    const events = await store.getEvents("r1");
    expect(events.map((e) => e.sequence_number)).toEqual([1, 2, 3]);
  });

  it("applies fromSequence on the NDJSON path", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    for (let i = 1; i <= 5; i += 1) store.persistEvents("r1", [ev("r1", i)]);
    await store.flushEvents("r1");

    const events = await store.getEvents("r1", 3);
    expect(events.map((e) => e.sequence_number)).toEqual([4, 5]);
  });

  it("applies fromSequence on the legacy JSON-array path", async () => {
    const legacy = JSON.stringify([1, 2, 3, 4, 5].map((i) => ev("r1", i)));
    await writeFile(eventsPath("r1"), legacy, "utf8");

    const store = createFilesystemRequestStore({ rootDir });
    const events = await store.getEvents("r1", 3);
    expect(events.map((e) => e.sequence_number)).toEqual([4, 5]);
  });

  it("getEvents returns [] for an unknown request", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    expect(await store.getEvents("missing")).toEqual([]);
  });

  it("flushEvents resolves after the queue drains", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    store.persistEvents("r1", [ev("r1", 1)]);
    await store.flushEvents("r1");
    // After drain the bytes are on disk.
    expect((await store.getEvents("r1")).map((e) => e.sequence_number)).toEqual([
      1
    ]);
  });

  it("flushEvents re-throws a captured persist error (FIX-399)", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    // Pre-seed a directory where the events FILE should be so appendFile fails
    // with EISDIR — a durable, non-ENOENT failure on the append path.
    const { mkdir } = await import("node:fs/promises");
    await mkdir(eventsPath("r1"), { recursive: true });

    store.persistEvents("r1", [ev("r1", 1)]);
    await expect(store.flushEvents("r1")).rejects.toBeTruthy();
  });

  it("flushEvents re-throws a migration error and does not swallow it (FIX-399)", async () => {
    // A legacy file (leading `[`) whose body is not valid JSON forces
    // migrateLegacyEventsIfNeeded's JSON.parse to throw. That error must
    // propagate through the queue's onError → lastEventError → flushEvents,
    // never silently dropping the pending events.
    await writeFile(eventsPath("r2"), "[not valid json", "utf8");
    const store = createFilesystemRequestStore({ rootDir });
    store.persistEvents("r2", [ev("r2", 2)]);
    await expect(store.flushEvents("r2")).rejects.toBeTruthy();
  });
});
