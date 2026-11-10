/**
 * The action route's half of attachments: the files a message names
 * in `attachments` are checked against the one limits set and the action's
 * user line, then claimed into the turn's session before any block runs,
 * after the session check, and handed back to their uploader if the send is
 * then refused. A reference that is not the caller's, or that the caller
 * already sent with another conversation, is refused by name and nothing is
 * claimed.
 */
import { randomUUID } from "node:crypto";
import { attachmentLimitRefusal } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { claimAttachments, confirmAttachments, releaseAttachments, sessionBlobOwner } from "../blobs/attachments";
import type { BlobUploader } from "../blobs/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { StoreRegistry } from "../stores/types";
import { jsonResponse, loadTenantSession, unknownSessionResponse } from "./route-utils";

/**
 * The outcome: a response to send instead of running, or the claim to settle
 * once admission decides: `confirm` when the send is admitted, `release` when
 * it is refused. A release hands back only what no other send relies on.
 */
export type RequestAttachmentClaim =
  | { refused: Response }
  | {
      /** The files the request carries, as the run gets them: each the reference and its name, nothing else. */
      attachments: FileContent[];
      confirm: () => Promise<void>;
      release: () => Promise<void>;
    };

const NOTHING_CLAIMED: RequestAttachmentClaim = {
  attachments: [],
  confirm: async () => undefined,
  release: async () => undefined
};

/**
 * Check the files a request body's `attachments` names, then claim them into
 * its session. This is the request's parse step for files, the one place
 * every send passes: the action must have a user line to put them on
 * (`userMessage`), and the message must be within the one limits set
 * (`attachmentLimitRefusal`). Each refusal is by name, before anything is
 * claimed or runs.
 *
 * The session check here is the one a send gets at admission, made early so
 * a file is never claimed into someone else's session: an existing session
 * must be the caller's (in user and organization), and is answered as an
 * unknown session otherwise. A session the send will create is the caller's
 * by construction; if admission refuses it anyway, `release` hands the files
 * back.
 */
export async function claimRequestAttachments(
  field: unknown,
  options: {
    stores: StoreRegistry;
    sessionId: string | undefined;
    tenantId: string | undefined;
    uploader: BlobUploader;
    /** Whether the action writes a user line (`userMessage`), the only place files go. */
    takesFiles: boolean;
  }
): Promise<RequestAttachmentClaim> {
  if (field === undefined || field === null) return NOTHING_CLAIMED;
  if (!Array.isArray(field)) {
    return { refused: jsonResponse(400, { error: "attachment_invalid", message: "`attachments` must be a list of files." }) };
  }
  if (field.length === 0) return NOTHING_CLAIMED;
  for (const [index, entry] of field.entries()) {
    if (!isFileContent(entry)) return { refused: invalid(index) };
  }
  // Only what names the file: a caller's `ephemeral`, say, would drop it from
  // the stored line.
  const attachments = (field as FileContent[]).map(
    (file): FileContent => ({
      type: "file",
      mediaType: file.mediaType,
      data: file.data,
      ...(typeof file.filename === "string" ? { filename: file.filename } : {})
    })
  );

  if (!options.takesFiles) {
    return {
      refused: jsonResponse(400, {
        error: "attachments_not_accepted",
        message: "This action writes no user message, so it takes no files."
      })
    };
  }
  const overLimit = attachmentLimitRefusal(attachments);
  if (overLimit !== undefined) {
    if (overLimit.reason === "type") {
      return {
        refused: jsonResponse(400, {
          error: "attachment_type_refused",
          index: overLimit.index,
          message: "Attachments may be PNG, JPEG, WebP or GIF images, PDFs, or text, Markdown, CSV, JSON, YAML, HTML, XML or source files."
        })
      };
    }
    const kind = overLimit.reason === "too-many-images" ? "images" : "documents";
    return {
      refused: jsonResponse(400, {
        error: "attachment_limit",
        index: overLimit.index,
        limit: overLimit.limit,
        message: `A message can carry at most ${overLimit.limit} ${kind}.`
      })
    };
  }

  const blobs = options.stores.blobs;
  if (blobs === undefined) {
    return {
      refused: jsonResponse(501, {
        error: "attachments_not_configured",
        message: "This server has no blob store, so it takes no attachments."
      })
    };
  }
  const { sessionId, tenantId, uploader } = options;
  if (sessionId === undefined) {
    return {
      refused: jsonResponse(400, {
        error: "attachments_need_session",
        message: "Files belong to a conversation: send them with a session id."
      })
    };
  }
  const existing = await loadTenantSession(options.stores.session, sessionId, tenantId);
  if (existing !== undefined && (existing.userId !== uploader.userId || existing.orgId !== uploader.orgId)) {
    return { refused: unknownSessionResponse(sessionId) };
  }

  const owner = sessionBlobOwner(resolveSessionStorageKey(sessionId, tenantId));
  // One id per send, so a refused send undoes only its own claims.
  const send = randomUUID();
  const outcome = await claimAttachments(blobs, attachments, { uploader, owner, send });
  if ("refused" in outcome) {
    const { reason, index } = outcome.refused;
    if (reason === "invalid") return { refused: invalid(index) };
    if (reason === "owned-elsewhere") {
      return {
        refused: jsonResponse(409, {
          error: "attachment_already_sent",
          index,
          message: "This file was already sent with another conversation. Attach it again."
        })
      };
    }
    return {
      refused: jsonResponse(404, { error: "attachment_not_found", index, message: "No such upload of yours." })
    };
  }
  const ids = outcome.held;
  return {
    attachments,
    confirm: () => confirmAttachments(blobs, ids, owner, send),
    release: () => releaseAttachments(blobs, ids, owner, send)
  };
}

function invalid(index: number): Response {
  return jsonResponse(400, {
    error: "attachment_invalid",
    index,
    message: "An attachment must be a file uploaded to this server, sent as its `fsd-blob` reference."
  });
}

function isFileContent(value: unknown): value is FileContent {
  if (typeof value !== "object" || value === null) return false;
  const file = value as Record<string, unknown>;
  return file.type === "file" && typeof file.mediaType === "string" && typeof file.data === "string";
}
