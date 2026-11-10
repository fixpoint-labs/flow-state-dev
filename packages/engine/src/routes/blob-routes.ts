/**
 * The attachment routes: `POST /blobs` takes one file as a raw body,
 * the transcribe route's shape, and answers with its reference; `GET
 * /blobs/:blobId` streams the bytes back to a caller who can read the session
 * that owns the file. Both sit beside the session routes, not under a flow.
 *
 * A document is checked before it is stored: a text file within its cap and
 * readable as text, a PDF within its page cap, with its text stored beside it
 * (`../blobs/pdf-text.ts`).
 *
 * The read route serves images inline and every other type as a download,
 * always with `nosniff`, so a file can't be run as a page whatever it holds.
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { ATTACHMENT_LIMITS, formatKilobytes, isAttachmentMediaType, isTextAttachmentType, normalizeMediaType, toBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { readableIn, sessionBlobOwner } from "../blobs/attachments";
import { PdfTooManyPagesError, PdfUnreadableError, extractPdfText, pdfTextBlobId } from "../blobs/pdf-text";
import { newBlobId } from "../blobs/shared";
import { resolveSessionStorageKey } from "../stores/scope-keys";
import type { HostDiskState } from "../blobs/host-disk";
import type { SessionRecord, StoreRegistry } from "../stores/types";
import type { ResolvedPrincipal } from "../transports/types";
import type { ParsedFlowRoute } from "./parseFlowRoute";
import { blobSessionId } from "./route-auth";
import { getString, jsonResponse, loadCheckedSession, unknownBlobResponse } from "./route-utils";

/** What the upload route reads. */
export type UploadBlobContext = {
  stores: StoreRegistry;
  /** The caller, when the app authenticates. Otherwise the `userId` query names the uploader, as on the action route's body. */
  principal?: ResolvedPrincipal;
  hostDisk: HostDiskState;
};

/** What the read route reads. */
export type GetBlobContext = {
  stores: StoreRegistry;
  tenantId?: string;
  /** The session the route guard checked the caller against, when it checked one. */
  checkedSession?: SessionRecord | null;
};

const notConfigured = (): Response =>
  jsonResponse(501, {
    error: "attachments_not_configured",
    message: "This server has no blob store, so it takes no attachments."
  });

/** Store one uploaded file, held for its uploader, and answer with its reference. */
export async function handleUploadBlob(request: Request, ctx: UploadBlobContext): Promise<Response> {
  const blobs = ctx.stores.blobs;
  if (blobs === undefined) return notConfigured();
  if (!ctx.hostDisk.persists && blobs.local) {
    return jsonResponse(501, {
      error: "attachments_unavailable",
      message:
        "This host does not keep its disk between requests, so attachments stored on it would be lost. " +
        "Name a hosted blob store in the profile's `blobs` slot."
    });
  }

  const url = new URL(request.url);
  const userId = ctx.principal?.userId ?? getString(url.searchParams.get("userId"));
  if (userId === undefined) {
    return jsonResponse(400, { error: "An upload requires non-empty userId" });
  }
  const orgId = ctx.principal?.orgId ?? DEFAULT_ORG_ID;

  const mediaType = normalizeMediaType(request.headers.get("content-type") ?? "");
  if (!isAttachmentMediaType(mediaType)) {
    return jsonResponse(415, {
      error: "attachment_type_refused",
      message: `Files of type "${mediaType || "unknown"}" can't be attached.`
    });
  }

  const bytes = await readCapped(request, ATTACHMENT_LIMITS.maxFileBytes);
  if (bytes === "too-large") {
    return jsonResponse(413, {
      error: "attachment_too_large",
      message: `A file can be at most ${ATTACHMENT_LIMITS.maxFileBytes} bytes.`
    });
  }
  if (bytes.byteLength === 0) {
    return jsonResponse(400, { error: "attachment_empty", message: "The upload has no bytes." });
  }

  const document = await checkDocument(mediaType, bytes);
  if (document instanceof Response) return document;

  const filename = cleanFilename(url.searchParams.get("filename"));
  const id = newBlobId();
  const uploader = { userId, orgId };
  // The text first: a PDF is never stored without the text a target that
  // can't read PDFs gets in its place. A text with no PDF is swept unclaimed.
  if (document.pdfText !== undefined) {
    await blobs.put({ id: pdfTextBlobId(id), bytes: document.pdfText, mediaType: "text/plain", uploader });
  }
  await blobs.put({ id, bytes, mediaType, ...(filename === undefined ? {} : { filename }), uploader });
  const attachment: FileContent = {
    type: "file",
    mediaType,
    ...(filename === undefined ? {} : { filename }),
    data: toBlobRef(id)
  };
  return jsonResponse(201, { attachment });
}

/** Serve a stored file's bytes to a caller who can read the session that owns it. */
export async function handleGetBlob(
  _request: Request,
  route: Extract<ParsedFlowRoute, { kind: "get_blob" }>,
  ctx: GetBlobContext
): Promise<Response> {
  if (ctx.stores.blobs === undefined) return notConfigured();
  // Checked again here: on an app where nothing authenticates the guard read
  // no file, and a file no session in this tenant owns is no file at all.
  const sessionId = await blobSessionId(ctx.stores, route.blobId, ctx.tenantId);
  if (sessionId === undefined) return unknownBlobResponse();
  const session = await loadCheckedSession(ctx.stores.session, sessionId, ctx.tenantId, ctx.checkedSession);
  if (session === undefined) return unknownBlobResponse();

  const found = await ctx.stores.blobs.read(route.blobId);
  // The session's owner must be the file's uploader too: a straggling claim
  // can land in a session id between its purge and its rebirth under another
  // person, and that person reads no file of someone else's.
  const user = { userId: session.userId, orgId: session.orgId ?? DEFAULT_ORG_ID };
  if (found === undefined || !readableIn(found.record, sessionBlobOwner(resolveSessionStorageKey(sessionId, ctx.tenantId)), user)) {
    return unknownBlobResponse();
  }
  const { record, bytes } = found;
  const inline = record.mediaType.startsWith("image/");
  const disposition = `${inline ? "inline" : "attachment"}${record.filename === undefined ? "" : `; filename*=UTF-8''${encodeURIComponent(record.filename)}`}`;
  return new Response(bytes as Uint8Array<ArrayBuffer>, {
    status: 200,
    headers: {
      "content-type": record.mediaType,
      "content-length": String(bytes.byteLength),
      "content-disposition": disposition,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-cache"
    }
  });
}

// FIX-2520 D1, D2.
/**
 * A document's own limits, checked before anything is stored: a text-like
 * file is UTF-8 text with no NUL bytes, at most `maxTextBytes`, and is
 * refused over it, never cut; a PDF opens, has at most `maxPdfPages` pages,
 * and its text is extracted for the targets that can't read PDFs. Returns
 * the refusal to send, or what to store beside the file.
 */
async function checkDocument(mediaType: string, bytes: Uint8Array): Promise<Response | { pdfText?: Uint8Array }> {
  if (isTextAttachmentType(mediaType)) {
    if (bytes.byteLength > ATTACHMENT_LIMITS.maxTextBytes) {
      return jsonResponse(413, {
        error: "attachment_text_too_large",
        size: bytes.byteLength,
        limit: ATTACHMENT_LIMITS.maxTextBytes,
        message:
          `This file is ${formatKilobytes(bytes.byteLength)}; a text file goes in whole, up to ${formatKilobytes(ATTACHMENT_LIMITS.maxTextBytes)}. ` +
          "Split it, or send the part that matters."
      });
    }
    if (!isUtf8Text(bytes)) {
      return jsonResponse(415, { error: "attachment_not_text", message: "This file isn't UTF-8 text, so it can't be sent as text." });
    }
    return {};
  }
  if (normalizeMediaType(mediaType) === "application/pdf") {
    try {
      const { text } = await extractPdfText(bytes);
      return { pdfText: new TextEncoder().encode(text) };
    } catch (error) {
      if (error instanceof PdfTooManyPagesError) {
        return jsonResponse(413, { error: "pdf_too_many_pages", pages: error.pages, limit: ATTACHMENT_LIMITS.maxPdfPages, message: error.message });
      }
      if (error instanceof PdfUnreadableError) return jsonResponse(415, { error: "pdf_unreadable", message: error.message });
      throw error;
    }
  }
  return {};
}

/** True when `bytes` decode as UTF-8 and hold no NUL byte, which no text file does. */
function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

/** The request body, or `"too-large"` as soon as it passes `limit` bytes, without reading the rest. */
async function readCapped(request: Request, limit: number): Promise<Uint8Array | "too-large"> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) return "too-large";
  if (request.body === null) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return "too-large";
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** A filename as a person sees it: no folders, no control characters, at most 255 characters. */
function cleanFilename(raw: string | null): string | undefined {
  const base = (raw ?? "").split(/[\\/]/).pop() ?? "";
  // eslint-disable-next-line no-control-regex
  // Cut by code point: a cut through a surrogate pair leaves a name that
  // `encodeURIComponent` throws on, and the file could never be downloaded.
  const clean = Array.from(base.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 255).join("");
  return clean.length === 0 ? undefined : clean;
}
