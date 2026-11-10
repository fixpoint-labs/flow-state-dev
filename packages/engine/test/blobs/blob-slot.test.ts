/**
 * FIX-824 D1: attachment bytes live wherever the sessions live. The `blobs`
 * slot resolves to the profile's own adapter when it names one; otherwise to
 * the local disk when the sessions persist (under a filesystem primary's own
 * root, else `.fsdev/blobs/<profile>` in the working directory), and to memory when
 * they don't.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filesystemStores, inMemoryStores, localBlobStores, type StoreAdapter } from "../../src";
import { FlowStateConfigError } from "../../src/errors/flow-error";
import { resolveProfileStores } from "../../src/flowstate/resolve-slots";
import { newBlobId } from "../../src/blobs/shared";

const UPLOADER = { userId: "u1", orgId: "o1" };
const bytes = new Uint8Array([1, 2, 3]);

/**
 * A primary whose sessions persist, standing in for SQLite or Postgres: the
 * in-memory registry with its checkpoint and suspension stores marked as
 * keeping their data, which is how the engine tells a durable primary.
 */
function persistentPrimary(): StoreAdapter {
  return {
    capabilities: ["primary"],
    async resolve(slots) {
      const full = await inMemoryStores().resolve(slots);
      const keep = <T extends object>(store: T): T => Object.assign(Object.create(store) as T, { persists: true });
      return { ...full, checkpoints: keep(full.checkpoints!), suspensions: keep(full.suspensions!) };
    }
  };
}

const scratch = (): string => mkdtempSync(path.join(tmpdir(), "fsd-blob-slot-"));

afterEach(() => vi.restoreAllMocks());

describe("the blobs slot", () => {
  it("keeps an in-memory profile's files in memory", async () => {
    const { stores } = await resolveProfileStores({ profileName: "default", profile: { primary: inMemoryStores() } });
    expect(stores.blobs).toMatchObject({ local: true, persists: false });
  });

  it("puts a durable primary's files on disk under .fsdev/blobs/<profile> in the working directory", async () => {
    const cwd = scratch();
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const { stores } = await resolveProfileStores({ profileName: "default", profile: { primary: persistentPrimary() } });
    expect(stores.blobs).toMatchObject({ local: true, persists: true });
    const id = newBlobId();
    await stores.blobs!.put({ id, bytes, mediaType: "image/png", uploader: UPLOADER });
    expect(existsSync(path.join(cwd, ".fsdev", "blobs", "default", `${id}.bin`))).toBe(true);
  });

  // Two durable profiles with their own databases can run from one working
  // directory and share session ids; deleting a session in one must not take
  // the other's files.
  it("keeps each durable profile's files apart, so one profile's session cleanup can't reach another's", async () => {
    const cwd = scratch();
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const staging = (await resolveProfileStores({ profileName: "staging", profile: { primary: persistentPrimary() } })).stores.blobs!;
    const production = (await resolveProfileStores({ profileName: "production", profile: { primary: persistentPrimary() } })).stores.blobs!;
    const id = newBlobId();
    await production.put({ id, bytes, mediaType: "image/png", uploader: UPLOADER });
    const send = { uploader: UPLOADER, owner: "session:s1", send: "send-a" };
    await production.claim(id, send);
    await production.confirm(id, send.owner, send.send);
    await staging.deleteOwner("session:s1");
    expect((await production.head(id))?.owner).toBe("session:s1");
  });

  it("puts a filesystem primary's files under its own root", async () => {
    const root = scratch();
    const { stores } = await resolveProfileStores({
      profileName: "default",
      profile: { primary: filesystemStores({ rootDir: root, developmentOnly: true }) }
    });
    const id = newBlobId();
    await stores.blobs!.put({ id, bytes, mediaType: "image/png", uploader: UPLOADER });
    expect(existsSync(path.join(root, "blobs", `${id}.bin`))).toBe(true);
  });

  it("uses the folder a profile names with localBlobStores, over the default", async () => {
    const cwd = scratch();
    const chosen = scratch();
    vi.spyOn(process, "cwd").mockReturnValue(cwd);
    const { stores } = await resolveProfileStores({
      profileName: "default",
      profile: { primary: persistentPrimary(), blobs: localBlobStores({ rootDir: chosen }) }
    });
    const id = newBlobId();
    await stores.blobs!.put({ id, bytes, mediaType: "image/png", uploader: UPLOADER });
    expect(existsSync(path.join(chosen, `${id}.bin`))).toBe(true);
    expect(existsSync(path.join(cwd, ".fsdev", "blobs"))).toBe(false);
  });

  it("refuses an adapter that declares blobs but resolves no blob store", async () => {
    const empty: StoreAdapter = { capabilities: ["blobs"], resolve: async () => ({}) };
    await expect(
      resolveProfileStores({ profileName: "default", profile: { primary: inMemoryStores(), blobs: empty } })
    ).rejects.toBeInstanceOf(FlowStateConfigError);
  });
});
