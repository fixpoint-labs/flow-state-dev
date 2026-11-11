// FIX-2522; epic FIX-2516 ER-7.
/**
 * The user attachment seam: how the engine hands a block a way to keep a copy
 * of files in the running person's own scope, for a record kept there that
 * outlives the turn the files came with (a task's brief on a conversation's
 * board, which sits at the user scope), and to drop such copies again when the
 * record they were kept for was never written. Framework-facing, on
 * `core/internal` only; a block keeps files through
 * {@link keepAttachmentsForUser} and drops them through
 * {@link discardAttachmentsForUser}.
 *
 * Each file is read through the engine's one resolver for the request's
 * conversation and person, so only a file the request can read is copied,
 * and the copy has an owner of its own: the turn's file and the kept copy
 * live and die apart. Nothing here names a task (ER-7: no task noun in core).
 */
import type { FileContent } from "../items/content";

/**
 * The slot under which the engine hands a block the request's file keeper. A
 * symbol, as the harness attachment seam is, so no handler body reaches it by
 * name. Read only by {@link keepAttachmentsForUser}.
 */
export const USER_ATTACHMENT_SEAM: unique symbol = Symbol.for("@flow-state-dev/user-attachment-seam");

/** What the engine attaches under {@link USER_ATTACHMENT_SEAM}. */
export type UserAttachmentSeam = {
  /**
   * Copy each file into the running user's own scope, in order, all or
   * nothing, and resolve to the copies' references.
   */
  keep: (files: ReadonlyArray<FileContent>) => Promise<FileContent[]>;
  /**
   * Delete copies this request's flow kept for the running user. A reference
   * to any other file (another scope's, another user's, gone) is left alone.
   */
  discard: (files: ReadonlyArray<FileContent>) => Promise<void>;
};

/** Thrown when files can't be kept: the context carries no keeper (a server with no blob store, a hand-built test context). */
export class UserAttachmentsUnavailableError extends Error {
  constructor() {
    super("This server keeps no files, so the files can't be kept.");
    this.name = "UserAttachmentsUnavailableError";
  }
}

/**
 * Copies of `files`, owned by the running person's own scope: references a
 * record at that scope keeps, readable by any of that person's runs and by
 * nobody else. Empty for no files.
 *
 * @throws {UserAttachmentsUnavailableError} When the context carries no keeper.
 *   A file the request can't read rejects with the engine's own error.
 */
export async function keepAttachmentsForUser(
  ctx: object,
  files: ReadonlyArray<FileContent>,
): Promise<FileContent[]> {
  if (files.length === 0) return [];
  const seam = (ctx as { readonly [USER_ATTACHMENT_SEAM]?: UserAttachmentSeam })[USER_ATTACHMENT_SEAM];
  if (seam === undefined) throw new UserAttachmentsUnavailableError();
  return seam.keep(files);
}

/**
 * Delete copies {@link keepAttachmentsForUser} made, for a record that was
 * never written (a filing refused after its files were kept): a kept copy is
 * owned, so nothing else ever sweeps it. Only the running user's copies, kept
 * by this flow, go; any other reference is left alone. A context with no
 * keeper kept nothing, so there is nothing to delete.
 */
export async function discardAttachmentsForUser(ctx: object, files: ReadonlyArray<FileContent>): Promise<void> {
  if (files.length === 0) return;
  const seam = (ctx as { readonly [USER_ATTACHMENT_SEAM]?: UserAttachmentSeam })[USER_ATTACHMENT_SEAM];
  await seam?.discard(files);
}
