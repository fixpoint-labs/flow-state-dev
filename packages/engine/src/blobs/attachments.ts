/**
 * The engine's attachment operations over a blob store: who owns a file,
 * claiming the files a message names, and the one resolver that turns a
 * reference into bytes.
 *
 * **The resolver is the only reader of bytes.** Every model-message build and
 * every harness given a file calls {@link resolveAttachment}; nothing else decodes
 * `FileContent.data` or parses the reference by hand
 * (`test/blobs/one-resolver.test.ts` holds that).
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { normalizeMediaType, parseBlobRef } from "@flow-state-dev/core/attachments";
import { uint8ArrayToBase64 } from "../streaming/binary";
import { uploadedBy } from "./shared";
import type { BlobRecord, BlobStore, BlobUploader } from "./types";

/** The owner key for a session's files: its namespaced storage key, so the tenant is part of it. */
export function sessionBlobOwner(sessionStorageKey: string): string {
  return `session:${sessionStorageKey}`;
}

/** The session storage key a session owner names, or `undefined` for any other owner. */
export function sessionKeyOfBlobOwner(owner: string): string | undefined {
  return owner.startsWith("session:") ? owner.slice("session:".length) : undefined;
}

/** Why a message's attachments were refused. Nothing was claimed. */
export type AttachmentRefusal = {
  /** `invalid`: not a stored file's reference, or named as another type than the one it was uploaded as · `not-found`: no such upload of the caller's · `owned-elsewhere`: the caller's upload, already sent with another conversation. */
  reason: "invalid" | "not-found" | "owned-elsewhere";
  /** The attachment, by its position in the list. */
  index: number;
};

/**
 * Claim every attachment a message names into `owner`, for the uploader who
 * holds them, on behalf of one `send`. All or nothing: on a refusal, this
 * send's claims are released and the refusal names the first file refused.
 *
 * Returns the ids this send now relies on, those `owner` already held
 * included, so the caller can {@link confirmAttachments} them once the send is
 * admitted or {@link releaseAttachments} them if it is refused. A refusal
 * hands back only what no other send relies on.
 */
export async function claimAttachments(
  blobs: BlobStore,
  attachments: ReadonlyArray<FileContent>,
  claim: { uploader: BlobUploader; owner: string; send: string }
): Promise<{ held: string[] } | { refused: AttachmentRefusal }> {
  const ids: string[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const id = parseBlobRef(attachment.data);
    if (id === undefined) return { refused: { reason: "invalid", index } };
    ids.push(id);
  }
  // A file names the type it was uploaded as, so the limits counted on the
  // message's types are the limits on the stored files. Only the uploader's
  // own file is compared; anyone else's is refused by the claim as not found.
  for (const [index, id] of ids.entries()) {
    const record = await blobs.head(id);
    if (
      record !== undefined &&
      uploadedBy(record, claim.uploader) &&
      normalizeMediaType(record.mediaType) !== normalizeMediaType(attachments[index]!.mediaType)
    ) {
      return { refused: { reason: "invalid", index } };
    }
  }
  const held: string[] = [];
  for (const [index, id] of ids.entries()) {
    let result: Awaited<ReturnType<BlobStore["claim"]>>;
    try {
      result = await blobs.claim(id, claim);
    } catch (error) {
      // The store failed: hand back this send's claims, the one in flight
      // included (releasing a file this send never claimed changes nothing).
      await releaseAttachments(blobs, [...held, id], claim.owner, claim.send).catch(() => undefined);
      throw error;
    }
    if (result === "claimed" || result === "already-owned") held.push(id);
    else {
      await releaseAttachments(blobs, held, claim.owner, claim.send);
      return { refused: { reason: result, index } };
    }
  }
  return { held };
}

/** `send` was refused before it ran: each file goes back to its uploader unless another send relies on it. */
export async function releaseAttachments(
  blobs: BlobStore,
  ids: ReadonlyArray<string>,
  owner: string,
  send: string
): Promise<void> {
  for (const id of ids) await blobs.release(id, owner, send);
}

/** `send` was admitted: its files stay with `owner` whatever later sends do. */
export async function confirmAttachments(
  blobs: BlobStore,
  ids: ReadonlyArray<string>,
  owner: string,
  send: string
): Promise<void> {
  for (const id of ids) await blobs.confirm(id, owner, send);
}

/** A file's bytes, for a model part or a harness. */
export type ResolvedAttachment = {
  record: BlobRecord;
  bytes: Uint8Array;
  /** The bytes as base64, for a provider part that takes a string. */
  base64(): string;
};

/** Thrown when a reference can't be read for its owner. Named so a caller can say so in the conversation. */
export class AttachmentUnavailableError extends Error {
  constructor(readonly attachment: FileContent) {
    super(`Attachment "${attachment.filename ?? attachment.data}" is not available to this conversation`);
    this.name = "AttachmentUnavailableError";
  }
}

/**
 * True when `record` may be read in the scope `owner`, whose person is `user`:
 * the scope holds it, and that person uploaded it. A file is only ever claimed
 * by its uploader into a scope they own, so a file whose uploader is not the
 * scope's person landed there by a race with the scope's rebirth under someone
 * else, and is no file of theirs.
 */
export function readableIn(record: BlobRecord, owner: string, user: BlobUploader): boolean {
  return record.owner === owner && uploadedBy(record, user);
}

/**
 * The one resolver: a stored file's reference to its bytes, for the scope the
 * caller is working in. A reference that another scope holds, or that another
 * person uploaded, is unavailable, so a crafted reference in one conversation
 * can't read another's file.
 *
 * @throws {AttachmentUnavailableError} When `data` is no reference, or the file is gone or not readable in `scope` ({@link readableIn}).
 */
export async function resolveAttachment(
  blobs: BlobStore,
  attachment: FileContent,
  scope: { owner: string; user: BlobUploader }
): Promise<ResolvedAttachment> {
  const id = parseBlobRef(attachment.data);
  const found = id === undefined ? undefined : await blobs.read(id);
  if (found === undefined || !readableIn(found.record, scope.owner, scope.user)) {
    throw new AttachmentUnavailableError(attachment);
  }
  const { record, bytes } = found;
  return { record, bytes, base64: () => uint8ArrayToBase64(bytes) };
}
