/**
 * The action route's half of attachments: the files a message names
 * in `attachments` are claimed into the turn's session before any block runs,
 * after the session check, and handed back to their uploader if the send is
 * then refused. A reference that is not the caller's, or that the caller
 * already sent with another conversation, is refused by name and nothing is
 * claimed.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { claimAttachments, releaseAttachments, sessionBlobOwner } from "../blobs/attachments";
import type { BlobUploader } from "../blobs/types";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { StoreRegistry } from "../stores/types";
import { jsonResponse, loadTenantSession, unknownSessionResponse } from "./route-utils";

/** The outcome: a response to send instead of running, or a `release` to call if the send is refused later. */
export type RequestAttachmentClaim = { refused: Response } | { release: () => Promise<void> };

const NOTHING_CLAIMED: RequestAttachmentClaim = { release: async () => undefined };

/**
 * Claim the files a request body's `attachments` names into its session.
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
  const attachments = field as FileContent[];

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
  const outcome = await claimAttachments(blobs, attachments, { uploader, owner });
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
  const ids = outcome.claimed;
  return { release: () => releaseAttachments(blobs, ids, owner) };
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
