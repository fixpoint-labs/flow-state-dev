// FIX-2519, FIX-2636.
/**
 * The attachment seam: how the engine hands a block its request's file
 * reader. Framework-facing, on `core/internal` only; a harness reads its
 * files through `readHarnessAttachments` (`./harness-attachments.ts`), and
 * the attachments capability's `readAttachment` through the same function.
 */
import type { FileContent } from "../items/content";
import type { HarnessAttachmentBytes } from "./harness-attachments";

/**
 * The slot under which the engine hands a block its request's file reader.
 * A symbol, as the spend and dispatch seams are, so no handler body reaches it
 * by name. Read only by `readHarnessAttachments`.
 */
export const ATTACHMENT_SEAM: unique symbol = Symbol.for("@flow-state-dev/attachment-seam");

/**
 * What the engine attaches under {@link ATTACHMENT_SEAM}: the one
 * resolver, bound to the request's conversation and person. Rejects with
 * `HarnessAttachmentUnavailableError` for a file that is gone or is not that
 * conversation's, and with the store's own error when the store fails.
 */
export type AttachmentSeam = (file: FileContent) => Promise<HarnessAttachmentBytes>;
