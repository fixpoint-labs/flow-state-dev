/**
 * The blob store contract: where attachment bytes live.
 *
 * A file is uploaded once and held for its uploader. A message that names it
 * claims it into one owner (a session, by its storage key), and from then on
 * it is read only by someone who can read that owner, and deleted with it.
 * Bytes are reached only through this interface (nothing reads an adapter's
 * files directly), and only the engine's resolver turns a reference into
 * bytes for a model call or a harness.
 *
 * An owner is an opaque key the engine builds (`sessionBlobOwner`). The store
 * compares owners; it never learns what they name.
 */

/** Who uploaded a file: the verified caller at upload time. */
export type BlobUploader = {
  userId: string;
  orgId: string;
};

/** What the store keeps about one file, beside its bytes. */
export type BlobRecord = {
  /** The blob id (`b_…`), the part of `fsd-blob:<id>` after the scheme. */
  id: string;
  mediaType: string;
  filename?: string;
  /** Bytes in the file. */
  size: number;
  uploader: BlobUploader;
  /** The owner a message claimed it into. Absent while it is held for its uploader. */
  owner?: string;
  /** Epoch ms of the upload. */
  createdAt: number;
};

/** A new file for {@link BlobStore.put}. The id is the caller's: the engine generates it. */
export type BlobPut = {
  id: string;
  bytes: Uint8Array;
  mediaType: string;
  filename?: string;
  uploader: BlobUploader;
};

/**
 * The outcome of a claim.
 *
 * - `claimed`: it was held for this uploader and now belongs to the owner.
 * - `already-owned`: the same owner already holds it (a retried send).
 * - `not-found`: no such file, or it was uploaded by someone else. One answer
 *   for both, so an id is not a way to learn about another person's upload.
 * - `owned-elsewhere`: this uploader's file, already claimed by another owner.
 */
export type BlobClaimResult = "claimed" | "already-owned" | "not-found" | "owned-elsewhere";

/** Where a profile's attachment bytes live. Filled from the profile's `blobs` slot. */
export interface BlobStore {
  /**
   * `true` when the bytes stay on this host (its disk or its memory), so
   * another instance of the app can't reach them. A host whose disk does not
   * last refuses uploads to such a store.
   */
  readonly local: boolean;
  /** `false` when the bytes go when the process ends. */
  readonly persists: boolean;

  /**
   * Store a new file, held for its uploader. A store also sweeps here:
   * uploads no message claimed within `ATTACHMENT_LIMITS.unclaimedTtlMs` go.
   */
  put(input: BlobPut): Promise<BlobRecord>;
  /** The record for `id`, or `undefined`. */
  head(id: string): Promise<BlobRecord | undefined>;
  /** The record and bytes for `id`, or `undefined`. */
  read(id: string): Promise<{ record: BlobRecord; bytes: Uint8Array } | undefined>;
  /** Claim a held file into `owner`, for the uploader who holds it. */
  claim(id: string, claim: { uploader: BlobUploader; owner: string }): Promise<BlobClaimResult>;
  /**
   * Hand a claimed file back to its uploader: undoes a claim whose message
   * was refused before it ran. Does nothing unless `owner` holds it.
   */
  release(id: string, owner: string): Promise<void>;
  /**
   * Delete every file `owner` holds. Returns how many went. `keepUploader`
   * spares the files that uploader claimed: a reborn session's purge keeps
   * the files its own first message just claimed.
   */
  deleteOwner(owner: string, options?: { keepUploader?: BlobUploader }): Promise<number>;
  /** Delete one file by id. Returns whether it existed. */
  delete(id: string): Promise<boolean>;
  /** Release anything the store holds open. */
  dispose?(): Promise<void> | void;
}
