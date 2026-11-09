/**
 * The rules every blob store applies the same way: what a claim does to a
 * record, and which uploads a sweep takes. A store calls these rather than
 * restating them, so a hosted adapter decides exactly as the built-in ones.
 */
import { randomUUID } from "node:crypto";
import { ATTACHMENT_LIMITS } from "@flow-state-dev/core/attachments";
import type { BlobClaimResult, BlobRecord, BlobUploader } from "./types";

/** A new blob id: `b_` and 32 random hex characters. */
export function newBlobId(): string {
  return `b_${randomUUID().replace(/-/g, "")}`;
}

/**
 * Decide a claim against the stored record. Returns the result and, when it
 * changes the record, the record to write.
 */
export function decideClaim(
  record: BlobRecord | undefined,
  claim: { uploader: BlobUploader; owner: string }
): { result: BlobClaimResult; next?: BlobRecord } {
  if (record === undefined) return { result: "not-found" };
  // Another person's upload reads as no upload at all.
  if (!uploadedBy(record, claim.uploader)) return { result: "not-found" };
  if (record.owner === claim.owner) return { result: "already-owned" };
  if (record.owner !== undefined) return { result: "owned-elsewhere" };
  return { result: "claimed", next: { ...record, owner: claim.owner } };
}

/** True when `record` was uploaded by `uploader`, in user and organization. */
export function uploadedBy(record: BlobRecord, uploader: BlobUploader | undefined): boolean {
  return uploader !== undefined && record.uploader.userId === uploader.userId && record.uploader.orgId === uploader.orgId;
}

/** True when a sweep at `now` takes `record`: held by no owner for at least the unclaimed lifetime. */
export function isSweepable(record: BlobRecord, now: number): boolean {
  return record.owner === undefined && now - record.createdAt >= ATTACHMENT_LIMITS.unclaimedTtlMs;
}

/**
 * Run `work` for `key` after any earlier work for the same key settles, so a
 * claim and a release on one id never interleave inside one process.
 */
export function createKeyedLock(): <T>(key: string, work: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<unknown>>();
  return async <T>(key: string, work: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const run = previous.then(work, work);
    const tail = run.catch(() => undefined);
    tails.set(key, tail);
    try {
      return await run;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}
