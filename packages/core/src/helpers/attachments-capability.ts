// FIX-2636 D1, D2.
/**
 * The attachments capability: the model reads a document an earlier turn
 * sent, on request, and history stops re-sending every recent document.
 *
 * {@link attachmentsCapability} installs three parts on the generator that
 * answers (`uses`):
 *
 * - `readAttachment`, a tool that takes a document's id or its name. Its
 *   output is the file's reference and name, never its text: the model call
 *   reads the text through the one resolver (`prepareMessages`), so the text
 *   exists only in the call to the provider and no item or resource holds it.
 * - A context entry listing the session's newest documents from the
 *   `attachments` list that `recordAttachments` keeps.
 * - A `history` query, `earlierDocuments: "named"`: an earlier turn's document
 *   becomes one line naming it and its id, instead of the newest-files window.
 *
 * Two halves, like `historySummary`: this capability on the generator, and
 * `recordAttachments` as a step before it, the list's one writer.
 *
 * Exported through `@flow-state-dev/core/attachments`.
 */
import { z } from "zod";
import { attachmentKind, parseBlobRef, toBlobRef } from "@flow-state-dev/contracts/attachments";
import { handler } from "../blocks/handler";
import { defineCapability } from "../capability";
import type { FileContent } from "../items/content";
import type { BlockContext } from "../types/block";
import type { ResourceCollectionRef } from "../types/resource-collection";
import { HarnessAttachmentUnavailableError, readHarnessAttachments } from "../types/harness-attachments";
import { ATTACHMENTS, attachmentsCollection, type AttachmentResourceState } from "./record-attachments";

/** Documents the context entry lists by id, newest first; an older one is read by its name. */
const LISTED_DOCUMENTS = 8;

/** Matches a name answers with when it names several documents. */
const LISTED_MATCHES = 10;

type Entry = AttachmentResourceState & { ref: string };

/** The session's documents, newest first. Images are not read on request, so they are not listed. */
async function documentsOf(ctx: BlockContext): Promise<Entry[]> {
  const list = (ctx.resources as Record<string, ResourceCollectionRef<AttachmentResourceState> | undefined>)[ATTACHMENTS];
  if (list === undefined) return [];
  return (await list.list())
    .map((instance) => instance.state as AttachmentResourceState)
    .filter((entry): entry is Entry => entry.ref !== null && attachmentKind(entry.mediaType ?? "") === "document")
    .sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0));
}

/** One document as the model is shown it: its name, type, id and when its turn sent it. */
function describe(entry: Entry): string {
  const sent = entry.recordedAt === null ? "" : ` · sent ${new Date(entry.recordedAt).toISOString()}`;
  return `${entry.filename ?? "(no name)"} · ${entry.mediaType} · id ${parseBlobRef(entry.ref)}${sent}`;
}

const asFile = (entry: Entry): FileContent => ({
  type: "file",
  mediaType: entry.mediaType ?? "application/octet-stream",
  data: entry.ref,
  ...(entry.filename !== null ? { filename: entry.filename } : {}),
});

/** The file an id names: the listed entry, or a bare reference the resolver still checks. */
function fileForId(id: string, documents: Entry[]): FileContent | undefined {
  const blobId = parseBlobRef(id) ?? id;
  const listed = documents.find((entry) => parseBlobRef(entry.ref) === blobId);
  if (listed !== undefined) return asFile(listed);
  try {
    return { type: "file", mediaType: "application/octet-stream", data: toBlobRef(blobId) };
  } catch {
    return undefined;
  }
}

const readAttachmentInput = z.object({
  id: z.string().optional().describe("The document's id, from its line in the conversation or the list of documents."),
  name: z.string().optional().describe("The document's file name, when you have no id for it."),
});

/** A document's reference and name, which the model call reads as its text. */
const readAttachmentOutput = z.union([
  z.object({ type: z.literal("file"), mediaType: z.string(), data: z.string(), filename: z.string().optional() }),
  z.string(),
]);

/**
 * The model's read of a document an earlier turn of this conversation sent,
 * by its id or by its name (matched case-insensitively against the session's
 * whole `attachments` list). Reads through the request's file reader, bound to
 * this session and person: a file that is not this conversation's answers
 * "not in this conversation", whatever id is passed.
 *
 * Returns the file's reference, which the model call turns into its text;
 * returns a sentence instead when there is nothing to read (no match, several
 * matches, an image). A document whose text is over the cap is the tool's
 * error.
 */
export const readAttachment = handler({
  name: "readAttachment",
  description:
    "Read the text of a document sent earlier in this conversation. Pass its id (from its line in the " +
    "conversation or the list of documents), or its file name when you have no id.",
  inputSchema: readAttachmentInput,
  outputSchema: readAttachmentOutput,
  resources: { [ATTACHMENTS]: attachmentsCollection },
  execute: async (input, ctx): Promise<z.infer<typeof readAttachmentOutput>> => {
    const documents = await documentsOf(ctx);
    let file: FileContent | undefined;
    if (input.id !== undefined && input.id !== "") {
      file = fileForId(input.id.trim(), documents);
      if (file === undefined) return `${input.id} is not in this conversation.`;
    } else if (input.name !== undefined && input.name !== "") {
      const name = input.name.trim().toLowerCase();
      const matches = documents.filter((entry) => entry.filename?.toLowerCase() === name);
      if (matches.length === 0) return `No document named "${input.name}" in this conversation.`;
      if (matches.length > 1) {
        return (
          `${matches.length} documents are named "${input.name}". Read one by its id:\n` +
          matches.slice(0, LISTED_MATCHES).map((entry) => `- ${describe(entry)}`).join("\n")
        );
      }
      file = asFile(matches[0]!);
    } else {
      return "Pass a document's id or its name.";
    }

    let read;
    try {
      [read] = await readHarnessAttachments(ctx, [file]);
    } catch (error) {
      if (error instanceof HarnessAttachmentUnavailableError) return `${file.filename ?? input.id} is not in this conversation.`;
      throw error;
    }
    const mediaType = read!.mediaType;
    if (attachmentKind(mediaType) !== "document") return `${file.filename ?? input.id} is an image; images are not read on request.`;
    // Over the cap, the text rejects, and the read is this tool's error.
    await read!.text?.();
    return { type: "file", mediaType, data: file.data, ...(file.filename !== undefined ? { filename: file.filename } : {}) };
  },
});

/**
 * The context entry: the session's newest documents, with the count of older
 * ones and how to read those. `null` while the session has none.
 */
async function listedDocuments(_input: unknown, ctx: BlockContext): Promise<string | null> {
  const documents = await documentsOf(ctx);
  if (documents.length === 0) return null;
  const listed = documents.slice(0, LISTED_DOCUMENTS);
  const older = documents.length - listed.length;
  return [
    "<attachments>",
    "Documents sent in this conversation, newest first. Read one with readAttachment by its id.",
    ...listed.map((entry) => `- ${describe(entry)}`),
    ...(older > 0 ? [`${older} older document${older === 1 ? "" : "s"} not listed: read one with readAttachment by its name.`] : []),
    "</attachments>",
  ].join("\n");
}

/**
 * Install on the generator that answers, beside `recordAttachments` before it:
 *
 * ```ts
 * const assistant = generator({ name: "assistant", model, history: true, uses: [attachmentsCapability] });
 * sequencer({ name: "chat", inputSchema }).tap(recordAttachments).step(assistant);
 * ```
 *
 * It declares the `attachments` list, so it installs it. A flow without it
 * keeps the newest-files window.
 */
export const attachmentsCapability = defineCapability({
  name: "attachments",
  resources: { [ATTACHMENTS]: attachmentsCollection },
  presets: {
    default: ["tools", "context", "history"],
    tools: { tools: [readAttachment] },
    context: { context: listedDocuments as (input: unknown, ctx: any) => Promise<string | null> },
    // An earlier turn's document is named with its id, not re-sent.
    history: { history: { earlierDocuments: "named" } },
  },
});
