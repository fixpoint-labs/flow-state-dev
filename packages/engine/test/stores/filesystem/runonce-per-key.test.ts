/**
 * Filesystem runOnce per-key file tests (FIX-686).
 *
 * The runOnce result store now writes one file per (requestId, key) pair
 * instead of a single read-merge-write map file, eliminating write
 * amplification across keys. Tests verify round-trip, atomic overwrite,
 * cross-key isolation under concurrency, and lazy read-only fallback to a
 * legacy single-map file written by an older version.
 */
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFilesystemRequestStore } from "../../../src/stores/filesystem/request-store";
import { toRecordPath } from "../../../src/stores/filesystem/shared";
import { makeRequestStreamEvent } from "../../../src/testing";

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
      f.endsWith(".runonce")
    );
    // A per-key file carries the key in its name, distinguishing it from the
    // legacy single `<id>.runonce.json` map.
    expect(filesAfterA.length).toBe(1);
    expect(filesAfterA[0]).not.toMatch(/^[^.]*\.runonce\.json$/);

    const aPath = path.join(rootDir, filesAfterA[0]);
    const aStatBefore = await stat(aPath);

    await store.setRunOnceResult("r1", "b", 2);

    const filesAfterB = (await readdir(rootDir)).filter((f) =>
      f.endsWith(".runonce")
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

  it("delete removes every runOnce and events sidecar, leaving no orphans", async () => {
    // Intent: per-key runOnce files (and the events log) must be swept on
    // delete, or high-churn deployments accumulate orphaned sidecars forever.
    const store = createFilesystemRequestStore({ rootDir });
    await store.setRunOnceResult("req_1", "k1", "a");
    await store.setRunOnceResult("req_1", "k2", "b");
    store.persistEvents("req_1", [makeRequestStreamEvent("req_1", 1)]);
    await store.flushEvents("req_1");
    // A sibling request must survive the delete untouched.
    await store.setRunOnceResult("req_2", "k1", "keep");

    expect(
      (await readdir(rootDir)).some((f) => f.startsWith("req_1"))
    ).toBe(true);

    await store.delete("req_1");

    const remaining = await readdir(rootDir);
    expect(remaining.some((f) => f.startsWith("req_1"))).toBe(false);
    expect(await store.getRunOnceResult("req_2", "k1")).toEqual({
      found: true,
      value: "keep"
    });
  });
});

describe("FilesystemRequestStore — per-key files from the older layout", () => {
  // Older versions named per-key files `<id>.runonce.<key>.json`. Results a
  // request stored before an upgrade must still be found after it, and still
  // go when the request is deleted.
  const writeLegacyKeyFile = (name: string, value: unknown) =>
    writeFile(path.join(rootDir, name), JSON.stringify(value), "utf8");

  it("reads a result stored in the older per-key layout", async () => {
    await writeLegacyKeyFile("req_old.runonce.step.json", { owner: "old" });
    const store = createFilesystemRequestStore({ rootDir });

    expect(await store.getRunOnceResult("req_old", "step")).toEqual({
      found: true,
      value: { owner: "old" }
    });
  });

  it("delete removes the request's older per-key files", async () => {
    await writeLegacyKeyFile("req_old.runonce.step.json", { owner: "old" });
    const store = createFilesystemRequestStore({ rootDir });

    await store.delete("req_old");

    expect(await readdir(rootDir)).toEqual([]);
    expect(await store.getRunOnceResult("req_old", "step")).toEqual({ found: false });
  });

  it("delete quarantines an older per-key file another id could have written, so the id's next owner cannot read it", async () => {
    // `foo.runonce.bar.runonce.step.json` is ("foo", "bar.runonce.step") or
    // ("foo.runonce.bar", "step"). Deleting "foo" frees the id; left readable,
    // the next request to take "foo" would get this result as its own, and it
    // may be the previous "foo"'s. Removed, it may be a live
    // "foo.runonce.bar"'s. So it is moved out of every read path: the worst
    // case is that "foo.runonce.bar" runs that step again, never that a result
    // reaches a request it does not belong to.
    await writeLegacyKeyFile("foo.runonce.bar.runonce.step.json", { owner: "previous foo" });
    const store = createFilesystemRequestStore({ rootDir });

    await store.delete("foo");

    expect(await store.getRunOnceResult("foo", "bar.runonce.step")).toEqual({ found: false });
    expect(await store.getRunOnceResult("foo.runonce.bar", "step")).toEqual({ found: false });
    expect(await readdir(rootDir)).toEqual(["foo.runonce.bar.runonce.step.json.quarantined"]);
  });

  it("delete of the longer id quarantines the same ambiguous file too", async () => {
    await writeLegacyKeyFile("foo.runonce.bar.runonce.step.json", { owner: "foo?" });
    const store = createFilesystemRequestStore({ rootDir });

    await store.delete("foo.runonce.bar");

    expect(await store.getRunOnceResult("foo.runonce.bar", "step")).toEqual({ found: false });
    expect(await store.getRunOnceResult("foo", "bar.runonce.step")).toEqual({ found: false });
  });

  it("never hands a result shaped like a record to the id's next owner", async () => {
    // A stored result is arbitrary JSON, so ("foo", "bar") can hold one that
    // reads back exactly like the record of request "foo.runonce.bar" (whose
    // record file has the same name). Nothing tells the two apart, so delete
    // leaves the file (it may be that request's record) and the read path
    // refuses to serve it as a result, to anyone.
    await writeLegacyKeyFile("foo.runonce.bar.json", {
      id: "foo.runonce.bar",
      secret: "previous foo's result"
    });
    const store = createFilesystemRequestStore({ rootDir });

    await store.delete("foo");

    // A new request takes the id "foo" and asks for the same key.
    expect(await store.getRunOnceResult("foo", "bar")).toEqual({ found: false });
  });

  it("delete leaves another request's record that looks like an older per-key file", async () => {
    // The record of request "foo.runonce.bar" is `foo.runonce.bar.json`, which
    // is also the older per-key name for ("foo", "bar").
    const store = createFilesystemRequestStore({ rootDir });
    await store.set(
      "foo.runonce.bar",
      {
        id: "foo.runonce.bar",
        flowKind: "test",
        actionName: "run",
        userId: "u1",
        source: "http",
        status: "completed",
        startedAtMs: 1,
        state: {},
        version: 0,
        createdAt: 1,
        updatedAt: 1
      },
      "any"
    );

    await store.delete("foo");

    expect((await store.get("foo.runonce.bar"))?.id).toBe("foo.runonce.bar");
  });
});

// A request's event log and single-map runOnce file are named
// `<id>.events.json` and `<id>.runonce.json`, which are also the record files
// of the requests whose ids are `<id>.events` and `<id>.runonce`. Deleting
// one request must never delete, or read, another's record.
describe("FilesystemRequestStore — sidecar names shared with another request's record", () => {
  const recordFor = (id: string) => ({
    id,
    flowKind: "test",
    actionName: "run",
    userId: "u1",
    source: "http" as const,
    status: "completed" as const,
    startedAtMs: 1,
    state: {},
    version: 0,
    createdAt: 1,
    updatedAt: 1
  });

  it("delete of foo leaves the record of request foo.runonce", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.set("foo", recordFor("foo"), "any");
    await store.set("foo.runonce", recordFor("foo.runonce"), "any");

    await store.delete("foo");

    expect(await store.get("foo")).toBeUndefined();
    expect((await store.get("foo.runonce"))?.id).toBe("foo.runonce");
  });

  it("never reads another request's record as foo's single-map runOnce results", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.set("foo.runonce", recordFor("foo.runonce"), "any");

    // A request that takes the id foo asks for a key the record happens to have.
    expect(await store.getRunOnceResult("foo", "status")).toEqual({ found: false });
  });

  it("delete of foo leaves the record of request foo.events", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.set("foo", recordFor("foo"), "any");
    await store.set("foo.events", recordFor("foo.events"), "any");

    await store.delete("foo");

    expect((await store.get("foo.events"))?.id).toBe("foo.events");
  });

  it("still removes foo's own single-map runOnce file", async () => {
    await writeFile(
      path.join(rootDir, "foo.runonce.json"),
      JSON.stringify({ step: "foo's result" }),
      "utf8"
    );
    const store = createFilesystemRequestStore({ rootDir });

    await store.delete("foo");

    expect(await readdir(rootDir)).toEqual([]);
  });
});

// The record is what makes an id taken. While any of its children remain,
// the record must remain too, so a failed delete leaves the id unclaimable
// and can be retried, rather than freeing it over stale data.
describe("FilesystemRequestStore — delete removes the record last", () => {
  it("keeps the record when a sidecar cannot be removed, and a retry completes", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    await store.set(
      "req_stuck",
      {
        id: "req_stuck",
        flowKind: "test",
        actionName: "run",
        userId: "u1",
        source: "http",
        status: "completed",
        startedAtMs: 1,
        state: {},
        version: 0,
        createdAt: 1,
        updatedAt: 1
      },
      "any"
    );
    // A non-empty directory where the event log goes: removing it throws.
    const eventsPath = path.join(rootDir, "req_stuck.events.json");
    await mkdir(eventsPath);
    await writeFile(path.join(eventsPath, "x"), "x", "utf8");

    await expect(store.delete("req_stuck")).rejects.toThrow();
    expect((await store.get("req_stuck"))?.id).toBe("req_stuck");

    await rm(eventsPath, { recursive: true, force: true });
    await store.delete("req_stuck");
    expect(await store.get("req_stuck")).toBeUndefined();
  });
});

// A failed event write is reported by the next flush of the same id. Once the
// request is deleted, that failure belongs to nobody: a request that takes
// the id next must not be handed the old request's error.
describe("FilesystemRequestStore — delete forgets the id's event write failure", () => {
  it("does not report a deleted request's failed event write to the id's next owner", async () => {
    const store = createFilesystemRequestStore({ rootDir });
    // A directory where the event log goes makes the append fail.
    const eventsPath = path.join(rootDir, "req_reused.events.json");
    await mkdir(eventsPath, { recursive: true });
    store.persistEvents("req_reused", [makeRequestStreamEvent("req_reused", 1)]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await rm(eventsPath, { recursive: true, force: true });

    await store.delete("req_reused");

    // The next request under the id writes and flushes cleanly.
    store.persistEvents("req_reused", [makeRequestStreamEvent("req_reused", 1)]);
    await expect(store.flushEvents("req_reused")).resolves.toBeUndefined();
  });
});
