/**
 * The attachments block: where a flow decides what to do with a turn's files.
 * In v1 it keeps the session's list of them.
 *
 * The action route has already claimed the turn's files, checked them against
 * the limits and put them on the user line before any block runs. This block
 * only records: it reads the claimed files from its context
 * (`ctx.request.attachments`) and writes one entry per file into the session's
 * {@link ATTACHMENTS} collection, keyed by blob id. An entry holds the file's
 * reference and its metadata, never its bytes. A flow without the block loses
 * nothing: its files are still claimed, shown and sent to the model.
 *
 * The collection is declared on the block, so including the block in a flow
 * installs it. Entries are session resource state, so a session delete takes
 * them with it.
 *
 * This file owns {@link ATTACHMENTS}, {@link attachmentsCollection},
 * {@link attachmentResourceStateSchema} and {@link recordAttachments}. Exported
 * through `@flow-state-dev/core/attachments`.
 */
import { z } from "zod";
import { parseBlobRef } from "@flow-state-dev/contracts/attachments";
import { handler } from "../blocks/handler";
import { defineResourceCollection } from "../types/resource-collection";

/** Accessor key AND storage prefix of the session's list of files. */
export const ATTACHMENTS = "attachments" as const;

// BP-023.
/**
 * One file a turn of the session sent, keyed by its blob id. Every field is
 * nullable with a null default, so an entry written by an older or newer shape
 * still parses.
 */
export const attachmentResourceStateSchema = z.object({
  /** The file's reference, as `FileContent.data` carries it. Read the bytes through the blob read route. */
  ref: z.string().nullable().default(null),
  /** The file's name, when the upload gave one. */
  filename: z.string().nullable().default(null),
  /** The file's media type. */
  mediaType: z.string().nullable().default(null),
  /** The request whose turn sent it. */
  requestId: z.string().nullable().default(null),
  /** Epoch millis it was recorded. */
  recordedAt: z.number().nullable().default(null),
});

/** One entry of {@link attachmentsCollection}. */
export type AttachmentResourceState = z.infer<typeof attachmentResourceStateSchema>;

/**
 * The session's list of files: one entry per file, keyed by blob id.
 *
 * `writable: false`, so no block or model tool edits or removes an entry; a
 * new key's create stays open, which is the block's one write. Lazy, because a
 * session is reused across turns and the block reads one key at a time. The
 * app reads the entries; the model does not.
 */
export const attachmentsCollection = defineResourceCollection({
  pattern: `${ATTACHMENTS}/*`,
  scope: "session",
  prefetchMode: "lazy",
  writable: false,
  stateSchema: attachmentResourceStateSchema,
  client: {
    state: { read: true },
    expose: ["ref", "filename", "mediaType", "requestId", "recordedAt"],
  },
});

/**
 * Records the files this turn sent in the session's {@link ATTACHMENTS} list.
 * Add it to a flow as a `.tap` step; it declares the collection, so there is
 * nothing else to wire. A turn with no files writes nothing, and a file
 * already listed (a retried turn) is not written again.
 *
 * ```ts
 * sequencer({ name: "chat", inputSchema })
 *   .tap(recordAttachments)
 *   .step(assistant)
 * ```
 */
export const recordAttachments = handler({
  name: "record-attachments",
  description: "Records the files this turn sent in the session's list of attachments.",
  resources: { [ATTACHMENTS]: attachmentsCollection },
  execute: async (_input: unknown, ctx): Promise<void> => {
    const list = ctx.resources[ATTACHMENTS];
    const requestId = ctx.request.identity.id;
    for (const file of ctx.request.attachments) {
      const blobId = parseBlobRef(file.data);
      if (blobId === undefined) continue;
      if ((await list.getOptional(blobId)) !== undefined) continue;
      await list.create(blobId, {
        ref: file.data,
        filename: file.filename ?? null,
        mediaType: file.mediaType,
        requestId,
        recordedAt: Date.now(),
      });
    }
  },
});
