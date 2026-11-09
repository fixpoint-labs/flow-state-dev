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
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import { uint8ArrayToBase64 } from "../streaming/binary";
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
  /** `invalid`: not a stored file's reference · `not-found`: no such upload of the caller's · `owned-elsewhere`: the caller's upload, already sent with another conversation. */
  reason: "invalid" | "not-found" | "owned-elsewhere";
  /** The attachment, by its position in the list. */
  index: number;
};

/**
 * Claim every attachment a message names into `owner`, for the uploader who
 * holds them. All or nothing: on a refusal, the claims this call made are
 * released and the refusal names the first file refused.
 *
 * Returns the ids this call claimed (not those `owner` already held), so a
 * caller whose message is then refused can {@link releaseAttachments} them.
 */
export async function claimAttachments(
  blobs: BlobStore,
  attachments: ReadonlyArray<FileContent>,
  claim: { uploader: BlobUploader; owner: string }
): Promise<{ claimed: string[] } | { refused: AttachmentRefusal }> {
  const ids: string[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const id = parseBlobRef(attachment.data);
    if (id === undefined) return { refused: { reason: "invalid", index } };
    ids.push(id);
  }
  const claimed: string[] = [];
  for (const [index, id] of ids.entries()) {
    const result = await blobs.claim(id, claim);
    if (result === "claimed") claimed.push(id);
    if (result === "not-found" || result === "owned-elsewhere") {
      await releaseAttachments(blobs, claimed, claim.owner);
      return { refused: { reason: result, index } };
    }
  }
  return { claimed };
}

/** Hand claimed files back to their uploader: the message that claimed them was refused before it ran. */
export async function releaseAttachments(blobs: BlobStore, ids: ReadonlyArray<string>, owner: string): Promise<void> {
  for (const id of ids) await blobs.release(id, owner);
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
 * The one resolver: a stored file's reference to its bytes, for the owner the
 * caller is working in. A reference that another owner holds is unavailable,
 * so a crafted reference in one conversation can't read another's file.
 *
 * @throws {AttachmentUnavailableError} When `data` is no reference, or the file is gone or not `owner`'s.
 */
export async function resolveAttachment(
  blobs: BlobStore,
  attachment: FileContent,
  owner: string
): Promise<ResolvedAttachment> {
  const id = parseBlobRef(attachment.data);
  const found = id === undefined ? undefined : await blobs.read(id);
  if (found === undefined || found.record.owner !== owner) throw new AttachmentUnavailableError(attachment);
  const { record, bytes } = found;
  return { record, bytes, base64: () => uint8ArrayToBase64(bytes) };
}
