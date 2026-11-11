// FIX-2517 D1, FIX-2520, FIX-2636.
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
 *
 * A flow with the attachments capability reads its history with
 * `earlierDocuments: "named"`: step 1 names an earlier turn's document with
 * its id instead of keeping it. The model reads one with `readAttachment`,
 * whose result holds the file's reference; step 2 turns that result into the
 * document's text, for each step of the turn's tool loop.
 */
import {
  ATTACHMENT_DOCUMENT_TYPES,
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_LIMITS,
  attachmentKind,
  attachmentSentAs,
  AttachmentTextTooLargeError,
  parseBlobRef,
  type AttachmentAccepts
} from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import type { LLMMessage } from "@flow-state-dev/core/types";
import { AttachmentUnavailableError, type ResolvedAttachment } from "../blobs/attachments";
import { readAttachmentText, type ReadAttachment } from "../blobs/attachment-text";
import { PdfTooManyPagesError, PdfUnreadableError } from "../blobs/pdf-text";

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

/** A tool's result whose output is one document's reference (`readAttachment`'s read), as a tool loop step carries it. */
type DocumentResult = { type: "tool-result"; output: { type: "json"; value: FileContent } };

function isDocumentResult(part: unknown): part is DocumentResult {
  if (typeof part !== "object" || part === null) return false;
  const { type, output } = part as { type?: unknown; output?: { type?: unknown; value?: unknown } };
  return (
    type === "tool-result" &&
    output?.type === "json" &&
    isFileReference(output.value) &&
    attachmentKind(output.value.mediaType) === "document"
  );
}

function hasDocumentResults(message: unknown): message is LLMMessage & { content: unknown[] } {
  if (typeof message !== "object" || message === null) return false;
  const { role, content } = message as { role?: unknown; content?: unknown };
  return role === "tool" && Array.isArray(content) && content.some(isDocumentResult);
}

/** The one line a model sees in place of a file it is not sent. */
function fileNote(file: FileContent, why: string): { type: "text"; text: string } {
  const kind = attachmentKind(file.mediaType) ?? "file";
  return { type: "text", text: `[${kind}${file.filename !== undefined ? `: ${file.filename}` : ""}, ${why}]` };
}

// FIX-2636 D2.
/**
 * How the history carries an earlier turn's documents: `"window"`, the newest
 * up to one message's limits (FIX-2517 D1); `"named"`, none, each named with
 * its id for the model to read on request. Set by the history read's
 * `ItemQuery.earlierDocuments`.
 */
export type EarlierDocuments = "window" | "named";

/** The line a model sees in place of an earlier document it can read on request: its name, its id and the tool. */
function readableNote(file: FileContent): { type: "text"; text: string } {
  return fileNote(file, `id ${parseBlobRef(file.data)}, not re-sent; read it with readAttachment`);
}

/**
 * Keep the newest files up to one message's limits, walking back from the
 * newest line; name every older one on its turn. Within one line, files go in
 * the order attached. Lines without files pass through untouched.
 *
 * With `earlierDocuments: "named"`, a document on one of the first `earlier`
 * messages (the earlier turns, ahead of the request's own) is named with its
 * id instead, whatever the window holds; images keep the window.
 */
export function budgetHistoryFiles(
  messages: LLMMessage[],
  options: { earlierDocuments?: EarlierDocuments; earlier?: number } = {}
): LLMMessage[] {
  const left: Record<"image" | "document", number> = {
    image: ATTACHMENT_LIMITS.imagesPerMessage,
    document: ATTACHMENT_LIMITS.documentsPerMessage
  };
  const named = options.earlierDocuments === "named";
  const earlier = options.earlier ?? messages.length;
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const message = out[i]!;
    if (!hasFileReferences(message)) continue;
    out[i] = {
      ...message,
      content: message.content.map((part) => {
        if (!isFileReference(part)) return part;
        const kind = attachmentKind(part.mediaType);
        if (named && kind === "document" && i < earlier) return readableNote(part);
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
 *
 * `current` is the files the request being answered sent: only these refuse
 * the call when they can't go as text. Any other line's document that can't
 * is named on its turn, so one file can't fail every later turn of the
 * session. It is the request's own list, not the last user line, because a
 * generator may add a user line of its own after the history.
 */
export async function resolveHistoryFiles(
  messages: unknown[],
  read: ReadAttachment | undefined,
  target: { accepts: AttachmentAccepts } | undefined,
  current: ReadonlyArray<FileContent>
): Promise<unknown[]> {
  const accepts = target?.accepts ?? UNNAMED_TARGET_ACCEPTS;
  if (!messages.some((message) => hasFileReferences(message) || hasDocumentResults(message))) return messages;
  const sent = new Set(current.map((file) => file.data));
  const out: unknown[] = [];
  for (const message of messages) {
    if (hasDocumentResults(message)) {
      const content: unknown[] = [];
      for (const part of message.content) content.push(isDocumentResult(part) ? await toReadResult(part, read) : part);
      out.push({ ...message, content });
      continue;
    }
    if (!hasFileReferences(message)) {
      out.push(message);
      continue;
    }
    const content: unknown[] = [];
    for (const part of message.content) {
      content.push(isFileReference(part) ? await toModelPart(part, read, accepts, sent.has(part.data)) : part);
    }
    out.push({ ...message, content });
  }
  return out;
}

/**
 * A document the model read in this turn's tool loop, as the call carries it:
 * its text, headed by its name, always as text. A file that can't be read
 * now, or whose text is over the cap, is the tool's error, not a failed call.
 */
async function toReadResult(part: DocumentResult, read: ReadAttachment | undefined): Promise<unknown> {
  const file = part.output.value;
  const failed = (why: string) => ({ ...part, output: { type: "error-text", value: `${file.filename ?? "The file"} ${why}.` } });
  if (read === undefined) return failed("is no longer available");
  try {
    const text = await readAttachmentText(file, await read(file), read);
    return { ...part, output: { type: "text", value: text } };
  } catch (error) {
    if (error instanceof AttachmentUnavailableError) return failed("is not in this conversation");
    if (error instanceof AttachmentTextTooLargeError) return failed("has too much text to read");
    if (error instanceof PdfUnreadableError || error instanceof PdfTooManyPagesError) return failed("can't be read as text");
    throw error;
  }
}

async function toModelPart(
  file: FileContent,
  read: ReadAttachment | undefined,
  accepts: AttachmentAccepts,
  current: boolean
): Promise<unknown> {
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
  // A PDF whose text is over the cap fails the call before it is sent, never
  // cut; on an older turn it is named instead.
  if (attachmentSentAs(mediaType, accepts) === "text") {
    try {
      return { type: "text", text: await readAttachmentText(file, resolved, read) };
    } catch (error) {
      if (current) throw error;
      if (error instanceof AttachmentTextTooLargeError) return fileNote(file, "too much text to re-send");
      if (error instanceof PdfUnreadableError || error instanceof PdfTooManyPagesError) return fileNote(file, "can't be read as text");
      throw error;
    }
  }
  return {
    type: "file",
    data: resolved.base64(),
    mediaType,
    ...(file.filename !== undefined ? { filename: file.filename } : {})
  };
}
