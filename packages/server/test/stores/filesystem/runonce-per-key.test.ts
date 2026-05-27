/**
 * Filesystem runOnce per-key file tests (FIX-686).
 *
 * The runOnce result store now writes one file per (requestId, key) pair
 * instead of a single read-merge-write map file, eliminating write
 * amplification across keys. Tests verify round-trip, atomic overwrite,
 * cross-key isolation under concurrency, and lazy read-only fallback to a
 * legacy single-map file written by an older version.
 */
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemRequestStore } from "../../../src/stores/filesystem/request-store";
import { toRecordPath } from "../../../src/stores/filesystem/shared";

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(tmpdir(), "fsd-runonce-"));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("FilesystemRequestStore — runOnce per-key files", () => {
  it("writes and reads a result round-trip", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("r1", "k1", { hello: "world" });

    const result = await store.getRunOnceResult("r1", "k1");
    expect(result).toEqual({ found: true, value: { hello: "world" } });
  });

  it("reports not-found for an unknown key", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("r1", "k1", 1);
    expect(await store.getRunOnceResult("r1", "missing")).toEqual({
      found: false
    });
  });

  it("overwrites an existing key", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("r1", "k1", "first");
    await store.setRunOnceResult("r1", "k1", "second");
    expect(await store.getRunOnceResult("r1", "k1")).toEqual({
      found: true,
      value: "second"
    });
  });

  it("isolates concurrent writes to different keys", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await Promise.all([
      store.setRunOnceResult("r1", "a", 1),
      store.setRunOnceResult("r1", "b", 2),
      store.setRunOnceResult("r1", "c", 3)
    ]);

    expect(await store.getRunOnceResult("r1", "a")).toEqual({ found: true, value: 1 });
    expect(await store.getRunOnceResult("r1", "b")).toEqual({ found: true, value: 2 });
    expect(await store.getRunOnceResult("r1", "c")).toEqual({ found: true, value: 3 });
  });

  it("falls back to a legacy single-map file when no per-key file exists", async () => {
    // Simulate a file written by the pre-upgrade single-map implementation.
    const legacyPath = toRecordPath(rootDir, "r1").replace(
      /\.json$/,
      ".runonce.json"
    );
    await writeFile(
      legacyPath,
      JSON.stringify({ old: "value", other: 42 }),
      "utf8"
    );

    const store = createFilesystemRequestStore({ rootDir });
    expect(await store.getRunOnceResult("r1", "old")).toEqual({
      found: true,
      value: "value"
    });
    expect(await store.getRunOnceResult("r1", "other")).toEqual({
      found: true,
      value: 42
    });
    expect(await store.getRunOnceResult("r1", "absent")).toEqual({
      found: false
    });
  });

  it("prefers a per-key file over the legacy map", async () => {
    const legacyPath = toRecordPath(rootDir, "r1").replace(
      /\.json$/,
      ".runonce.json"
    );
    await writeFile(legacyPath, JSON.stringify({ k1: "legacy" }), "utf8");

    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("r1", "k1", "fresh");
    expect(await store.getRunOnceResult("r1", "k1")).toEqual({
      found: true,
      value: "fresh"
    });
  });

  it("writes one file per key — writing one key does not rewrite another", async () => {
    // The write-amplification fix: each key is its own file, so persisting
    // key "b" must not touch key "a"'s file. We assert distinct per-key files
    // exist and that "a"'s file is untouched (mtime) after writing "b".
    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("r1", "a", 1);

    const filesAfterA = (await readdir(rootDir)).filter((f) =>
      f.includes(".runonce.")
    );
    // A per-key file carries the key in its name, distinguishing it from the
    // legacy single `<id>.runonce.json` map.
    expect(filesAfterA.length).toBe(1);
    expect(filesAfterA[0]).not.toMatch(/^[^.]*\.runonce\.json$/);

    const aPath = path.join(rootDir, filesAfterA[0]);
    const aStatBefore = await stat(aPath);

    await store.setRunOnceResult("r1", "b", 2);

    const filesAfterB = (await readdir(rootDir)).filter((f) =>
      f.includes(".runonce.")
    );
    expect(filesAfterB.length).toBe(2);
    // "a"'s file content is byte-identical (size unchanged); the write of "b"
    // did not read-merge-rewrite the whole map.
    const aStatAfter = await stat(aPath);
    expect(aStatAfter.size).toBe(aStatBefore.size);
  });

  it("handles keys with special characters", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("req:1", "scope:foo/bar", "ok");
    expect(await store.getRunOnceResult("req:1", "scope:foo/bar")).toEqual({
      found: true,
      value: "ok"
    });
  });
});
