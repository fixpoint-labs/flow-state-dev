/**
 * The blob store contract, run against both built-in stores: a file is held
 * for its uploader until a message claims it into one owner; a claim by
 * anyone else reads as no file; an owner's files go with it; and uploads no
 * message claimed are swept after a day, not before.
 */
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalBlobStore } from "../../src/blobs/local-blob-store";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { newBlobId } from "../../src/blobs/shared";
import type { BlobStore } from "../../src/blobs/types";

const ALICE = { userId: "alice", orgId: "acme" };
const BOB = { userId: "bob", orgId: "acme" };
const DAY = 24 * 60 * 60 * 1000;

type Made = { store: BlobStore; clock: { now: number }; dir?: string };

const stores: Array<[string, () => Made]> = [
  [
    "memory",
    () => {
      const clock = { now: 1_000_000 };
      return { store: createMemoryBlobStore({ now: () => clock.now }), clock };
    }
  ],
  [
    "local disk",
    () => {
      const clock = { now: 1_000_000 };
      const dir = mkdtempSync(path.join(tmpdir(), "fsd-blob-store-"));
      return { store: createLocalBlobStore({ rootDir: dir, now: () => clock.now }), clock, dir };
    }
  ]
];

async function upload(store: BlobStore, uploader = ALICE, bytes = new Uint8Array([7, 8, 9])): Promise<string> {
  const id = newBlobId();
  await store.put({ id, bytes, mediaType: "image/png", filename: "a.png", uploader });
  return id;
}

describe.each(stores)("%s blob store", (_name, make) => {
  it("reads back the bytes it was given", async () => {
    const { store } = make();
    const bytes = new Uint8Array(4096).map((_, i) => (i * 31) % 256);
    const id = await upload(store, ALICE, bytes);
    const read = await store.read(id);
    expect(read?.bytes).toEqual(bytes);
    expect(read?.record).toMatchObject({ id, mediaType: "image/png", filename: "a.png", size: 4096, uploader: ALICE });
    expect(read?.record.owner).toBeUndefined();
  });

  it("claims a held file once into one owner, and refuses another owner", async () => {
    const { store } = make();
    const id = await upload(store);
    expect(await store.claim(id, { uploader: ALICE, owner: "session:s1", send: "send-1" })).toBe("claimed");
    expect(await store.claim(id, { uploader: ALICE, owner: "session:s1", send: "send-1" })).toBe("already-owned");
    expect(await store.claim(id, { uploader: ALICE, owner: "session:s2", send: "send-1" })).toBe("owned-elsewhere");
    expect((await store.head(id))?.owner).toBe("session:s1");
  });

  it("answers another user's claim as if there were no file", async () => {
    const { store } = make();
    const id = await upload(store);
    expect(await store.claim(id, { uploader: BOB, owner: "session:bob", send: "send-1" })).toBe("not-found");
    // Same user, another organization, is another uploader too.
    expect(await store.claim(id, { uploader: { userId: "alice", orgId: "other" }, owner: "session:x", send: "send-1" })).toBe("not-found");
    expect(await store.claim(newBlobId(), { uploader: ALICE, owner: "session:s1", send: "send-1" })).toBe("not-found");
    expect((await store.head(id))?.owner).toBeUndefined();
  });

  it("hands a released claim back to its uploader, and only for the owner that holds it", async () => {
    const { store } = make();
    const id = await upload(store);
    await store.claim(id, { uploader: ALICE, owner: "session:s1", send: "send-1" });
    await store.release(id, "session:other", "send-1");
    expect((await store.head(id))?.owner).toBe("session:s1");
    await store.release(id, "session:s1", "send-1");
    expect((await store.head(id))?.owner).toBeUndefined();
    expect(await store.claim(id, { uploader: ALICE, owner: "session:s2", send: "send-1" })).toBe("claimed");
  });

  it("deletes an owner's files and no one else's", async () => {
    const { store } = make();
    const mine = await upload(store);
    const other = await upload(store);
    const held = await upload(store);
    await store.claim(mine, { uploader: ALICE, owner: "session:s1", send: "send-1" });
    await store.claim(other, { uploader: ALICE, owner: "session:s2", send: "send-1" });
    expect(await store.deleteOwner("session:s1")).toBe(1);
    expect(await store.read(mine)).toBeUndefined();
    expect(await store.head(other)).toBeDefined();
    expect(await store.head(held)).toBeDefined();
    expect(await store.delete(other)).toBe(true);
    expect(await store.delete(other)).toBe(false);
  });

  it("sweeps an unclaimed upload after a day, on a later upload, and keeps claimed files", async () => {
    const { store, clock } = make();
    const unclaimed = await upload(store);
    const claimed = await upload(store);
    await store.claim(claimed, { uploader: ALICE, owner: "session:s1", send: "send-1" });

    clock.now += DAY - 1;
    await upload(store);
    expect(await store.head(unclaimed)).toBeDefined();

    // Due now; a store may sweep up to an hour late (the local one sweeps hourly).
    clock.now += 60 * 60 * 1000;
    await upload(store);
    expect(await store.head(unclaimed)).toBeUndefined();
    expect(await store.head(claimed)).toBeDefined();
  });

  it("never reads a path out of an id", async () => {
    const { store } = make();
    expect(await store.head("../../etc/passwd")).toBeUndefined();
    expect(await store.read("b_../x")).toBeUndefined();
    await expect(
      store.put({ id: "../escape", bytes: new Uint8Array([1]), mediaType: "image/png", uploader: ALICE })
    ).rejects.toThrow();
  });
});

describe("local disk blob store", () => {
  it("keeps a file across a new store over the same folder (a restart)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fsd-blob-restart-"));
    const first = createLocalBlobStore({ rootDir: dir });
    const id = await upload(first);
    await first.claim(id, { uploader: ALICE, owner: "session:s1", send: "send-1" });
    const second = createLocalBlobStore({ rootDir: dir });
    expect((await second.read(id))?.record.owner).toBe("session:s1");
  });

  it("sweeps a day-old unclaimed upload when the store opens", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fsd-blob-open-"));
    const clock = { now: 1_000_000 };
    const id = await upload(createLocalBlobStore({ rootDir: dir, now: () => clock.now }));
    clock.now += DAY;
    const reopened = createLocalBlobStore({ rootDir: dir, now: () => clock.now });
    expect(await reopened.head(id)).toBeUndefined();
    expect(readdirSync(dir)).toEqual([]);
  });

  // A server with persistent sessions and no blobs slot gets this store by
  // default, and every session create and delete asks it to delete an owner's
  // files. On a host whose working folder is read-only, a store that made its
  // folder to answer would fail every session, attachments used or not.
  it("answers reads and deletes without making its folder", async () => {
    const dir = path.join(mkdtempSync(path.join(tmpdir(), "fsd-blob-absent-")), "blobs");
    const store = createLocalBlobStore({ rootDir: dir });
    expect(await store.deleteOwner("session:s1")).toBe(0);
    expect(await store.head(newBlobId())).toBeUndefined();
    expect(await store.read(newBlobId())).toBeUndefined();
    expect(await store.claim(newBlobId(), { uploader: ALICE, owner: "session:s1", send: "send-1" })).toBe("not-found");
    await store.release(newBlobId(), "session:s1", "send-1");
    expect(await store.delete(newBlobId())).toBe(false);
    expect(existsSync(dir)).toBe(false);
  });

  // Every session create and delete asks for one owner's files. Reading every
  // record to answer would make each of those cost the whole folder.
  it("deletes an owner's files without reading another owner's", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fsd-blob-index-"));
    const store = createLocalBlobStore({ rootDir: dir });
    const mine = await upload(store);
    const theirs = await upload(store);
    await store.claim(mine, { uploader: ALICE, owner: "session:s1", send: "send-1" });
    await store.claim(theirs, { uploader: ALICE, owner: "session:s2", send: "send-2" });
    // A record this delete has no reason to open: opening it would throw.
    writeFileSync(path.join(dir, `${theirs}.json`), "{ not a record");
    expect(await store.deleteOwner("session:s1")).toBe(1);
    expect(await store.head(mine)).toBeUndefined();
  });

  it("finds an owner's files after a restart, and skips an index entry the owner no longer holds", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fsd-blob-index-restart-"));
    const first = createLocalBlobStore({ rootDir: dir });
    const kept = await upload(first);
    const handedBack = await upload(first);
    await first.claim(kept, { uploader: ALICE, owner: "session:s1", send: "send-1" });
    await first.claim(handedBack, { uploader: ALICE, owner: "session:s1", send: "send-2" });
    await first.release(handedBack, "session:s1", "send-2");
    const second = createLocalBlobStore({ rootDir: dir });
    expect(await second.deleteOwner("session:s1")).toBe(1);
    expect(await second.head(kept)).toBeUndefined();
    expect((await second.head(handedBack))?.owner).toBeUndefined();
  });

  // Unclaimed uploads live a day, so sweeping on every upload buys nothing an
  // hourly sweep doesn't, and costs a read of the whole folder each time.
  it("sweeps on upload at most once an hour", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "fsd-blob-throttle-"));
    const clock = { now: 1_000_000 };
    const store = createLocalBlobStore({ rootDir: dir, now: () => clock.now });
    const due = await upload(store);
    clock.now += DAY - 1;
    await upload(store);
    clock.now += 1;
    await upload(store);
    expect(await store.head(due)).toBeDefined();
    clock.now += 60 * 60 * 1000;
    await upload(store);
    expect(await store.head(due)).toBeUndefined();
  });

  it("tries to make its folder again after a failed upload", async () => {
    const parent = mkdtempSync(path.join(tmpdir(), "fsd-blob-retry-"));
    const blocker = path.join(parent, "blocked");
    writeFileSync(blocker, "a file where the folder's parent should be");
    const store = createLocalBlobStore({ rootDir: path.join(blocker, "blobs") });
    await expect(upload(store)).rejects.toThrow();
    rmSync(blocker);
    const id = await upload(store);
    expect((await store.read(id))?.bytes).toEqual(new Uint8Array([7, 8, 9]));
  });
});
