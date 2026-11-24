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
  claim: { uploader: BlobUploader; owner: string; send: string }
): { result: BlobClaimResult; next?: BlobRecord } {
  if (record === undefined) return { result: "not-found" };
  // Another person's upload reads as no upload at all.
  if (!uploadedBy(record, claim.uploader)) return { result: "not-found" };
  if (record.owner === claim.owner) {
    // Kept for good already (an admitted send, or a record from before sends
    // were tracked), or this send is already counted: nothing to write.
    const pending = record.pendingSends;
    if (record.admitted === true || pending === undefined || pending.includes(claim.send)) return { result: "already-owned" };
    return { result: "already-owned", next: { ...record, pendingSends: [...pending, claim.send] } };
  }
  if (record.owner !== undefined) return { result: "owned-elsewhere" };
  return { result: "claimed", next: { ...record, owner: claim.owner, pendingSends: [claim.send] } };
}

/**
 * Decide a refused send's release. Returns the record to write, or
 * `undefined` when nothing changes. The file goes back to its uploader only
 * when `send` was the last send relying on it and none was admitted.
 */
export function decideRelease(record: BlobRecord | undefined, owner: string, send: string): BlobRecord | undefined {
  if (record === undefined || record.owner !== owner || record.pendingSends === undefined) return undefined;
  const pendingSends = record.pendingSends.filter((pending) => pending !== send);
  if (pendingSends.length === 0 && record.admitted !== true) {
    const { owner: _owner, pendingSends: _pending, admitted: _admitted, ...held } = record;
    return held;
  }
  return pendingSends.length === record.pendingSends.length ? undefined : { ...record, pendingSends };
}

/** Decide an admitted send's confirmation: the record to write, or `undefined` when nothing changes. */
export function decideConfirm(record: BlobRecord | undefined, owner: string, send: string): BlobRecord | undefined {
  if (record === undefined || record.owner !== owner || record.pendingSends === undefined) return undefined;
  const pendingSends = record.pendingSends.filter((pending) => pending !== send);
  if (record.admitted === true && pendingSends.length === record.pendingSends.length) return undefined;
  return { ...record, pendingSends, admitted: true };
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
