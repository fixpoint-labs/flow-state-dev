// FIX-2519, FIX-2520; epic FIX-2516 ER-1, ER-5.
/**
 * A turn's files, as a harness takes them.
 *
 * A caller hands a harness a turn's files on {@link HarnessRunInput}'s
 * `attachments`, in reference form (`FileContent` whose `data` is
 * `fsd-blob:<id>`). The harness adapter is the one place that knows its SDK's
 * form of an image, so it is the one that reads the bytes, and it reads them
 * through {@link readHarnessAttachments}: the engine's one resolver, bound to
 * the conversation the request runs in. Nothing a harness is handed carries
 * bytes, and no adapter decodes `data` itself.
 *
 * What a harness reads as files is its own word, {@link HarnessBlock}'s
 * `accepts`. A document it doesn't read as a file (a text-like file always,
 * a PDF where `accepts` lacks it) reaches it as its text, headed by its
 * name: {@link readHarnessTurnFiles} splits a turn's files that way. Any
 * other file refuses the turn before the run starts
 * ({@link refuseUnacceptedAttachments}), naming the file and the harness: a
 * harness never runs a turn without a file the person sent with it.
 *
 * @see `./harness.ts` for the run input and the block's `accepts`.
 */
import type { FileContent } from "../items/content";
import { attachmentSentAs, normalizeMediaType, type AttachmentAccepts } from "@flow-state-dev/contracts/attachments";
import { ATTACHMENT_SEAM, type AttachmentSeam } from "./attachment-seam";

/** One file's bytes, as a harness adapter hands them to its SDK. */
export interface HarnessAttachmentBytes {
  /** The type the file was stored as, which is the one a harness is told. */
  mediaType: string;
  /** The name it was attached under, when it had one. */
  filename?: string;
  bytes: Uint8Array;
  /** The bytes as base64, for an SDK that takes a string. */
  base64(): string;
  /**
   * A document's text as a target that gets text receives it, headed by its
   * name: a text-like file's own text, a PDF's extracted text. The engine's
   * reader fills it. Rejects with `AttachmentTextTooLargeError` for a PDF
   * whose text is over `ATTACHMENT_LIMITS.maxTextBytes`, never cutting it.
   */
  text?(): Promise<string>;
}

/** A turn's files as a harness hands them on: the ones it reads as files, and the text of the rest. */
export interface HarnessTurnFiles {
  /** The files the harness reads as files, in the order attached. */
  files: HarnessAttachmentBytes[];
  /** Each other file's text, headed by its name, in the order attached, a blank line apart. `""` for none. */
  text: string;
}

/** Thrown before a harness run starts: the turn carries a file the harness can't take. Nothing ran. */
export class HarnessAttachmentRefusedError extends Error {
  constructor(
    /** The harness that refused, as a person names it (`Codex`). */
    readonly harness: string,
    readonly attachment: FileContent,
  ) {
    super(
      `${harness} can't take ${describeFile(attachment)}. The turn did not run; send it again without that file.`,
    );
    this.name = "HarnessAttachmentRefusedError";
  }
}

/** Thrown when a turn's file can't be read for the harness. The run does not start without it. */
export class HarnessAttachmentUnavailableError extends Error {
  constructor(readonly attachment: FileContent, options?: { cause?: unknown }) {
    super(`${capitalised(describeFile(attachment))} is not available to this conversation, so the turn did not run.`, options);
    this.name = "HarnessAttachmentUnavailableError";
  }
}

/**
 * Refuse the turn when a file's type is not one `harness` takes. A harness
 * that declares no `accepts` takes no files. Called by each adapter before its
 * run starts, and by a host before it starts the turn (a harness session's
 * flow), so a refusal never costs a checkout or a process.
 *
 * @throws {HarnessAttachmentRefusedError} Naming the first file refused.
 */
export function refuseUnacceptedAttachments(
  harness: string,
  accepts: AttachmentAccepts | undefined,
  attachments: ReadonlyArray<FileContent> | undefined,
): void {
  for (const attachment of attachments ?? []) {
    if (accepts === undefined || attachmentSentAs(attachment.mediaType, accepts) === undefined) {
      throw new HarnessAttachmentRefusedError(harness, attachment);
    }
  }
}

/**
 * A turn's files as `harness` hands them on: refused first, by
 * {@link refuseUnacceptedAttachments}, before anything is read; then each
 * read through the engine's one resolver, and split into the files the
 * harness reads (`accepts`) and the text of every other document.
 *
 * @throws {HarnessAttachmentRefusedError} Before anything is read.
 * @throws {HarnessAttachmentUnavailableError} When a file can't be read, or a
 *   document's text can't (a reader with no text).
 */
export async function readHarnessTurnFiles(
  harness: string,
  ctx: object,
  accepts: AttachmentAccepts,
  attachments: ReadonlyArray<FileContent> | undefined,
): Promise<HarnessTurnFiles> {
  refuseUnacceptedAttachments(harness, accepts, attachments);
  const read = await readHarnessAttachments(ctx, attachments);
  const files: HarnessAttachmentBytes[] = [];
  const texts: string[] = [];
  for (const [index, file] of read.entries()) {
    if (attachmentSentAs(file.mediaType, accepts) === "file") files.push(file);
    else if (file.text === undefined) throw new HarnessAttachmentUnavailableError(attachments![index]!);
    else texts.push(await file.text());
  }
  return { files, text: texts.join("\n\n") };
}

/** The prompt a harness runs: the person's text, then the turn's documents' text after a blank line, when there is any. */
export function promptWithTurnText(prompt: string, turn: HarnessTurnFiles): string {
  return turn.text === "" ? prompt : `${prompt}\n\n${turn.text}`;
}

/**
 * Each file's bytes, in the order given, read through the engine's one
 * resolver for the conversation `ctx` runs in. Empty for no files.
 *
 * @throws {HarnessAttachmentUnavailableError} When a file can't be read: gone,
 *   another conversation's, or the context carries no reader (a hand-built
 *   test context, a server with no blob store). A store that fails rejects
 *   with its own error.
 */
export async function readHarnessAttachments(
  ctx: object,
  attachments: ReadonlyArray<FileContent> | undefined,
): Promise<HarnessAttachmentBytes[]> {
  if (attachments === undefined || attachments.length === 0) return [];
  const read = (ctx as { readonly [ATTACHMENT_SEAM]?: AttachmentSeam })[ATTACHMENT_SEAM];
  const out: HarnessAttachmentBytes[] = [];
  for (const attachment of attachments) {
    if (read === undefined) throw new HarnessAttachmentUnavailableError(attachment);
    out.push(await read(attachment));
  }
  return out;
}

function describeFile(attachment: FileContent): string {
  const type = normalizeMediaType(attachment.mediaType) || "a file of no type";
  return attachment.filename !== undefined ? `"${attachment.filename}" (${type})` : `a file of type ${type}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
