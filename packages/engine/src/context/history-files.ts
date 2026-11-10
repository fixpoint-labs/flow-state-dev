// FIX-2517 D1, FIX-2520.
/**
 * The files on a person's lines, as a model call carries them.
 *
 * The history build leaves a user line's files as `file` parts in reference
 * form, so the turn-aligned limits count references, not bytes, and so
 * everything a run records of its conversation (a generator's trace, a tool
 * loop's prelude) holds references only. Two steps lie between that build and
 * the provider:
 *
 * 1. {@link budgetHistoryFiles}, in the history read: counting back from the
 *    newest line, keep files up to one message's limits (`ATTACHMENT_LIMITS`),
 *    images and documents counted apart. An older file becomes one line of
 *    text on its turn, `[image: shot.png, not re-sent]`, so a long chat's call
 *    stays under the provider's request limit.
 * 2. {@link resolveHistoryFiles}, at the model call (the run's
 *    `ModelResolver.prepareMessages`): each kept file becomes an AI SDK part
 *    with its bytes inline, read through the one resolver, or as text, by
 *    what the call's model reads: a text-like file is always text
 *    headed by its name, a PDF is a file where the provider reads PDFs and
 *    its extracted text everywhere else. A file that can't be read is named
 *    instead of failing the call.
 */
import {
  ATTACHMENT_DOCUMENT_TYPES,
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_LIMITS,
  attachmentKind,
  attachmentSentAs,
  parseBlobRef,
  type AttachmentAccepts
} from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import type { LLMMessage } from "@flow-state-dev/core/types";
import { AttachmentUnavailableError, type ResolvedAttachment } from "../blobs/attachments";
import { readAttachmentText, type ReadAttachment } from "../blobs/attachment-text";

export type { ReadAttachment } from "../blobs/attachment-text";

/** What a call that names no target reads as files: images and PDFs, as before calls named one. */
const UNNAMED_TARGET_ACCEPTS: AttachmentAccepts = [...ATTACHMENT_IMAGE_TYPES, ...ATTACHMENT_DOCUMENT_TYPES];

/** A user line's file still in reference form. A part already holding bytes is not one. */
function isFileReference(part: unknown): part is FileContent {
  if (typeof part !== "object" || part === null) return false;
  const file = part as { type?: unknown; data?: unknown; mediaType?: unknown };
  return (
    file.type === "file" &&
    typeof file.mediaType === "string" &&
    typeof file.data === "string" &&
    parseBlobRef(file.data) !== undefined
  );
}

function hasFileReferences(message: unknown): message is LLMMessage & { content: unknown[] } {
  if (typeof message !== "object" || message === null) return false;
  const { role, content } = message as { role?: unknown; content?: unknown };
  return role === "user" && Array.isArray(content) && content.some(isFileReference);
}

/** The one line a model sees in place of a file it is not sent. */
function fileNote(file: FileContent, why: string): { type: "text"; text: string } {
  const kind = attachmentKind(file.mediaType) ?? "file";
  return { type: "text", text: `[${kind}${file.filename !== undefined ? `: ${file.filename}` : ""}, ${why}]` };
}

/**
 * Keep the newest files up to one message's limits, walking back from the
 * newest line; name every older one on its turn. Within one line, files go in
 * the order attached. Lines without files pass through untouched.
 */
export function budgetHistoryFiles(messages: LLMMessage[]): LLMMessage[] {
  const left: Record<"image" | "document", number> = {
    image: ATTACHMENT_LIMITS.imagesPerMessage,
    document: ATTACHMENT_LIMITS.documentsPerMessage
  };
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const message = out[i]!;
    if (!hasFileReferences(message)) continue;
    out[i] = {
      ...message,
      content: message.content.map((part) => {
        if (!isFileReference(part)) return part;
        const kind = attachmentKind(part.mediaType);
        if (kind === undefined || left[kind] <= 0) return fileNote(part, "not re-sent");
        left[kind] -= 1;
        return part;
      })
    };
  }
  return out;
}

/**
 * Turn each file reference on a call's user lines into the part a model
 * takes: an image as an image part, bytes inline; a document as a file part
 * where `target.accepts` reads it, and as its text otherwise
 * (`attachmentSentAs`). A call that names no target reads images and PDFs.
 * Typed by the stored file, not by what the line names. With no reader, or
 * when the file is gone, the file is named instead: a reference never reaches
 * a provider. Returns new messages; the ones passed in are not changed, so a
 * record that holds them keeps its references.
 */
export async function resolveHistoryFiles(
  messages: unknown[],
  read: ReadAttachment | undefined,
  target?: { accepts: AttachmentAccepts }
): Promise<unknown[]> {
  const accepts = target?.accepts ?? UNNAMED_TARGET_ACCEPTS;
  if (!messages.some(hasFileReferences)) return messages;
  const out: unknown[] = [];
  for (const message of messages) {
    if (!hasFileReferences(message)) {
      out.push(message);
      continue;
    }
    const content: unknown[] = [];
    for (const part of message.content) {
      content.push(isFileReference(part) ? await toModelPart(part, read, accepts) : part);
    }
    out.push({ ...message, content });
  }
  return out;
}

async function toModelPart(file: FileContent, read: ReadAttachment | undefined, accepts: AttachmentAccepts): Promise<unknown> {
  if (read === undefined) return fileNote(file, "no longer available");
  let resolved: ResolvedAttachment;
  try {
    resolved = await read(file);
  } catch (error) {
    // Gone, or never this conversation's: the line says so, and the rest of
    // the conversation still reaches the model. A store that fails is not a
    // missing file, and fails the call rather than quietly sending text.
    if (error instanceof AttachmentUnavailableError) return fileNote(file, "no longer available");
    throw error;
  }
  const { mediaType } = resolved.record;
  if (attachmentKind(mediaType) === "image") return { type: "image", image: resolved.base64(), mediaType };
  // A PDF whose text is over the cap fails the call before it is sent: never cut.
  if (attachmentSentAs(mediaType, accepts) === "text") return { type: "text", text: await readAttachmentText(file, resolved, read) };
  return {
    type: "file",
    data: resolved.base64(),
    mediaType,
    ...(file.filename !== undefined ? { filename: file.filename } : {})
  };
}
