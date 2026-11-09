/**
 * Two sends into one session can name the same file. A send that is refused
 * hands back only what no other send still relies on: the second send's file
 * stays in the session whether the first is refused before or after it
 * claims, and a file goes back to its uploader only once every send that
 * named it was refused.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { claimAttachments, confirmAttachments, releaseAttachments } from "../../src/blobs/attachments";
import { createLocalBlobStore } from "../../src/blobs/local-blob-store";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { newBlobId } from "../../src/blobs/shared";
import type { BlobStore } from "../../src/blobs/types";

const ALICE = { userId: "alice", orgId: "acme" };
const OWNER = "session:s1";

const stores: Array<[string, () => BlobStore]> = [
  ["memory", () => createMemoryBlobStore()],
  ["local disk", () => createLocalBlobStore({ rootDir: mkdtempSync(path.join(tmpdir(), "fsd-blob-sends-")) })]
];

async function uploaded(store: BlobStore) {
  const id = newBlobId();
  await store.put({ id, bytes: new Uint8Array([1, 2]), mediaType: "image/png", uploader: ALICE });
  return { id, file: { type: "file" as const, mediaType: "image/png", data: toBlobRef(id) } };
}

/** One send's claim of `files`: what the action route does for each message. */
async function send(store: BlobStore, files: Parameters<typeof claimAttachments>[1], token: string) {
  const outcome = await claimAttachments(store, files, { uploader: ALICE, owner: OWNER, send: token });
  if ("refused" in outcome) throw new Error(`refused: ${outcome.refused.reason}`);
  return {
    refuse: () => releaseAttachments(store, outcome.held, OWNER, token),
    admit: () => confirmAttachments(store, outcome.held, OWNER, token)
  };
}

describe.each(stores)("%s: sends sharing a file", (_name, make) => {
  it("keeps the file for a send that is admitted when the send that first claimed it is refused", async () => {
    const store = make();
    const { id, file } = await uploaded(store);
    const first = await send(store, [file], "send-a");
    const second = await send(store, [file], "send-b");
    await first.refuse();
    await second.admit();
    expect((await store.head(id))?.owner).toBe(OWNER);
  });

  it("keeps the file for a send still in flight when another send that named it is refused", async () => {
    const store = make();
    const { id, file } = await uploaded(store);
    const first = await send(store, [file], "send-a");
    await send(store, [file], "send-b");
    await first.refuse();
    expect((await store.head(id))?.owner).toBe(OWNER);
  });

  it("keeps a file a past message was admitted with, when a later send naming it is refused", async () => {
    const store = make();
    const { id, file } = await uploaded(store);
    await (await send(store, [file], "send-a")).admit();
    await (await send(store, [file], "send-b")).refuse();
    expect((await store.head(id))?.owner).toBe(OWNER);
  });

  it("hands the file back once every send that named it was refused", async () => {
    const store = make();
    const { id, file } = await uploaded(store);
    const first = await send(store, [file], "send-a");
    const second = await send(store, [file], "send-b");
    await first.refuse();
    await second.refuse();
    expect((await store.head(id))?.owner).toBeUndefined();
  });
});
