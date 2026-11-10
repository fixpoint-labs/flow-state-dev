// FIX-2517 D1.
/**
 * The files on a person's lines, as a model call carries them.
 *
 * The history build leaves a user line's files as `file` parts in reference
 * form, so the turn-aligned limits count references, not bytes. This module
 * then does the two steps between that build and the model:
 *
 * 1. {@link budgetHistoryFiles}: counting back from the newest line, keep
 *    files up to one message's limits (`ATTACHMENT_LIMITS`), images and
 *    documents counted apart. An older file becomes one line of text on its
 *    turn, `[image: shot.png, not re-sent]`, so a long chat's call stays under
 *    the provider's request limit.
 * 2. {@link resolveHistoryFiles}: each kept file becomes an AI SDK part with
 *    its bytes inline, read through the one resolver the caller passes. A file
 *    that can't be read is named instead of failing the call.
 */
import { ATTACHMENT_LIMITS, attachmentKind } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import type { LLMMessage } from "@flow-state-dev/core/types";
import { AttachmentUnavailableError, type ResolvedAttachment } from "../blobs/attachments";

/** Reads one file's bytes for the conversation the history belongs to: the engine's resolver, bound to its session. */
export type ReadAttachment = (file: FileContent) => Promise<ResolvedAttachment>;

/** A user line's file, in the reference form the history build leaves it in. */
function isFilePart(part: unknown): part is FileContent {
  return (
    typeof part === "object" &&
    part !== null &&
    (part as { type?: unknown }).type === "file" &&
    typeof (part as { data?: unknown }).data === "string" &&
    typeof (part as { mediaType?: unknown }).mediaType === "string"
  );
}

function hasFileParts(message: LLMMessage): message is LLMMessage & { content: unknown[] } {
  return message.role === "user" && Array.isArray(message.content) && message.content.some(isFilePart);
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
  const left: Record<"image" | "document", number> = { image: ATTACHMENT_LIMITS.imagesPerMessage, document: ATTACHMENT_LIMITS.documentsPerMessage };
  const out = messages.slice();
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const message = out[i]!;
    if (!hasFileParts(message)) continue;
    out[i] = {
      ...message,
      content: message.content.map((part) => {
        if (!isFilePart(part)) return part;
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
 * Turn each remaining file part into the part a model takes, bytes inline:
 * an image as an image part, a document as a file part. Typed by the stored
 * file, not by what the line names. With no reader, or when the file is gone,
 * the file is named instead: a reference never reaches a provider.
 */
export async function resolveHistoryFiles(messages: LLMMessage[], read: ReadAttachment | undefined): Promise<LLMMessage[]> {
  if (!messages.some(hasFileParts)) return messages;
  const out: LLMMessage[] = [];
  for (const message of messages) {
    if (!hasFileParts(message)) {
      out.push(message);
      continue;
    }
    const content: unknown[] = [];
    for (const part of message.content) {
      content.push(isFilePart(part) ? await toModelPart(part, read) : part);
    }
    out.push({ ...message, content });
  }
  return out;
}

async function toModelPart(file: FileContent, read: ReadAttachment | undefined): Promise<unknown> {
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
  return {
    type: "file",
    data: resolved.base64(),
    mediaType,
    ...(file.filename !== undefined ? { filename: file.filename } : {})
  };
}
