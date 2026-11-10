/**
 * Attachments, as core serves them.
 *
 * - The limits set and the `fsd-blob:` reference helper, re-exported from
 *   `@flow-state-dev/contracts/attachments`, so the engine and other server
 *   packages read the one set through `core`, as they read the item taxonomy.
 * - The attachments block, `recordAttachments`, and the session list it keeps
 *   (`./helpers/record-attachments`).
 */
export * from "@flow-state-dev/contracts/attachments";
export {
  ATTACHMENTS,
  attachmentResourceStateSchema,
  attachmentsCollection,
  recordAttachments,
  type AttachmentResourceState,
} from "./helpers/record-attachments";
