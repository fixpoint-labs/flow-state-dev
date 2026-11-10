// FIX-2520 D1, D2.
/**
 * A document's text, as a target that gets text receives it: a text-like
 * file's own text, or a PDF's extracted text, headed by the file's name
 * (`formatAttachmentText`). Both the model call (`../context/history-files`)
 * and a harness handed the turn's files read text through here, so every
 * target gets the same text, held to the same cap.
 */
import {
  ATTACHMENT_LIMITS,
  AttachmentTextTooLargeError,
  formatAttachmentText,
  isTextAttachmentType,
  normalizeMediaType,
  parseBlobRef,
  toBlobRef
} from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { AttachmentUnavailableError, type ResolvedAttachment } from "./attachments";
import { extractPdfText, pdfTextBlobId } from "./pdf-text";

/** Reads one file's bytes for the conversation the call belongs to: the engine's resolver, bound to its scope. */
export type ReadAttachment = (file: FileContent) => Promise<ResolvedAttachment>;

/**
 * `file`'s text, headed by its name. `resolved` is the file itself, already
 * read through `read`. A PDF's text is the one stored beside it at upload,
 * read through the same resolver, so it is readable exactly where the PDF
 * is; a PDF stored before texts were kept has its text extracted here.
 *
 * @throws {AttachmentTextTooLargeError} When a PDF's text is over
 *   `ATTACHMENT_LIMITS.maxTextBytes`. A text-like file over it was refused at upload.
 * @throws {TypeError} When `file` is not a document (an image has no text).
 */
export async function readAttachmentText(file: FileContent, resolved: ResolvedAttachment, read: ReadAttachment): Promise<string> {
  const type = normalizeMediaType(resolved.record.mediaType);
  if (isTextAttachmentType(type)) return formatAttachmentText(file.filename, new TextDecoder().decode(resolved.bytes));
  if (type !== "application/pdf") throw new TypeError(`A file of type ${type} has no text to send.`);
  const bytes = await storedPdfText(file, read) ?? new TextEncoder().encode((await extractPdfText(resolved.bytes)).text);
  if (bytes.byteLength > ATTACHMENT_LIMITS.maxTextBytes) throw new AttachmentTextTooLargeError(file.filename, bytes.byteLength);
  return formatAttachmentText(file.filename, new TextDecoder().decode(bytes));
}

/** The text stored beside a PDF, or `undefined` when none was stored. */
async function storedPdfText(file: FileContent, read: ReadAttachment): Promise<Uint8Array | undefined> {
  const id = parseBlobRef(file.data);
  if (id === undefined) return undefined;
  try {
    return (await read({ type: "file", mediaType: "text/plain", data: toBlobRef(pdfTextBlobId(id)) })).bytes;
  } catch (error) {
    if (error instanceof AttachmentUnavailableError) return undefined;
    throw error;
  }
}
