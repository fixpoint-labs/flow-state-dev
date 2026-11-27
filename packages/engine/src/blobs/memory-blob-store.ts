/**
 * The in-memory blob store: a profile whose sessions live in memory keeps its
 * attachments in memory too, so a restart drops both together.
 */
import { isBlobId } from "@flow-state-dev/core/attachments";
import { decideClaim, decideConfirm, decideRelease, isSweepable, uploadedBy } from "./shared";
import type { BlobRecord, BlobStore } from "./types";

/** Build an in-memory blob store. `now` is for tests that move the clock. */
export function createMemoryBlobStore(options: { now?: () => number } = {}): BlobStore {
  const now = options.now ?? Date.now;
  const blobs = new Map<string, { record: BlobRecord; bytes: Uint8Array }>();

  const sweep = (): void => {
    const at = now();
    for (const [id, entry] of blobs) {
      if (isSweepable(entry.record, at)) blobs.delete(id);
    }
  };

  return {
    local: true,
    persists: false,
    async put(input) {
      if (!isBlobId(input.id)) throw new TypeError(`"${input.id}" is not a blob id`);
      sweep();
      const record: BlobRecord = {
        id: input.id,
        mediaType: input.mediaType,
        ...(input.filename === undefined ? {} : { filename: input.filename }),
        size: input.bytes.byteLength,
        uploader: { ...input.uploader },
        createdAt: now()
      };
      blobs.set(input.id, { record, bytes: input.bytes.slice() });
      return { ...record };
    },
    async head(id) {
      const entry = blobs.get(id);
      return entry === undefined ? undefined : { ...entry.record };
    },
    async read(id) {
      const entry = blobs.get(id);
      return entry === undefined ? undefined : { record: { ...entry.record }, bytes: entry.bytes.slice() };
    },
    async claim(id, claim) {
      const entry = blobs.get(id);
      const { result, next } = decideClaim(entry?.record, claim);
      if (entry !== undefined && next !== undefined) entry.record = next;
      return result;
    },
    async release(id, owner, send) {
      const entry = blobs.get(id);
      const next = decideRelease(entry?.record, owner, send);
      if (entry !== undefined && next !== undefined) entry.record = next;
    },
    async confirm(id, owner, send) {
      const entry = blobs.get(id);
      const next = decideConfirm(entry?.record, owner, send);
      if (entry !== undefined && next !== undefined) entry.record = next;
    },
    async deleteOwner(owner, options) {
      let deleted = 0;
      for (const [id, entry] of blobs) {
        if (entry.record.owner === owner && !uploadedBy(entry.record, options?.keepUploader)) {
          blobs.delete(id);
          deleted += 1;
        }
      }
      return deleted;
    },
    async delete(id) {
      return blobs.delete(id);
    }
  };
}
