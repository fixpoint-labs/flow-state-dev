/**
 * Attachments, as core serves them.
 *
 * - The limits set and the `fsd-blob:` reference helper, re-exported from
 *   `@flow-state-dev/contracts/attachments`, so the engine and other server
 *   packages read the one set through `core`, as they read the item taxonomy.
 * - The attachments block, `recordAttachments`, and the session list it keeps
 *   (`./helpers/record-attachments`).
 * - {@link attachmentReferenceSchema}: a stored file's reference, as a schema
 *   reads one where only references may ride (a harness run's input, a task's
 *   brief).
 */
import { z } from "zod";
import { parseBlobRef } from "@flow-state-dev/contracts/attachments";

export * from "@flow-state-dev/contracts/attachments";

// FIX-2519; FIX-2522.
/** A stored file's reference (`FileContent` whose `data` is `fsd-blob:<id>`): bytes never pass it. */
export const attachmentReferenceSchema = z.object({
  type: z.literal("file"),
  mediaType: z.string(),
  data: z.string().refine((data) => parseBlobRef(data) !== undefined, "a stored file's reference"),
  filename: z.string().optional(),
});
export {
  ATTACHMENTS,
  attachmentResourceStateSchema,
  attachmentsCollection,
  recordAttachments,
  type AttachmentResourceState,
} from "./helpers/record-attachments";
