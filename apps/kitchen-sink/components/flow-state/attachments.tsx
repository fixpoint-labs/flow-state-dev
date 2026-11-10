"use client";

/**
 * Attachments for any composer: the files a person adds by paste, the +
 * picker or a drop, drawn above the text with a remove button each, and the
 * plain line that says why a file was refused.
 *
 * A file is checked against the limits set in `@flow-state-dev/core/attachments`,
 * downscaled when it is a large image, and uploaded the moment it is added, so
 * a file the server refuses is refused on its own chip before Send, not after.
 * What Send carries is `take()`: each file's reference (`fsd-blob:<id>`),
 * never its bytes.
 *
 * `useAttachments` holds the state; `AttachmentStrip` draws it; `AttachButton`
 * is the + button with its hidden picker; `AttachmentPreview` draws one file,
 * in the strip and on the person's line in the conversation. `PromptInput` is
 * built on the same hook.
 */

import type { ClipboardEvent, DragEvent, ReactNode, RefObject } from "react";
import type { FileContent } from "@flow-state-dev/core/items";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  ATTACHMENT_IMAGE_TYPES,
  ATTACHMENT_LIMITS,
  attachmentKind,
  normalizeMediaType,
  parseBlobRef,
} from "@flow-state-dev/core/attachments";
import { FileIcon, PlusIcon, XIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ============================================================================
// Types
// ============================================================================

/** What uploads a file: a `@flow-state-dev/client` client, or a flow handle from one (`client.flow(addr)`). */
export interface AttachmentUploader {
  upload(request: { data: Blob; mediaType?: string; filename?: string }): Promise<FileContent>;
}

/** Why a file was not attached. `message` is the line the composer shows. */
export interface AttachmentRefusal {
  code: "type" | "size" | "count" | "upload" | "unavailable";
  message: string;
  filename?: string;
}

/** One file in a draft. */
export interface PendingAttachment {
  id: string;
  filename: string;
  mediaType: string;
  /** Bytes as picked, before any downscale. */
  size: number;
  /** A local preview of an image, for the strip only. Never sent. */
  previewUrl?: string;
  status: "uploading" | "ready" | "refused";
  /** The uploaded file, in reference form, once `status` is `ready`. */
  attachment?: FileContent;
  /** Why the server refused it, once `status` is `refused`. */
  refusal?: string;
}

/** Overrides of the contract's limits, for a composer that takes less. */
export interface AttachmentLimitOverrides {
  imagesPerMessage?: number;
  documentsPerMessage?: number;
  /** Files of any kind in one message. */
  maxFiles?: number;
  maxFileBytes?: number;
}

export interface UseAttachmentsOptions {
  /** Where files go. With none, every file is refused by name. */
  client?: AttachmentUploader | null;
  /** The open conversation. A switch drops the draft's files. */
  sessionId?: string | null;
  /** The types the picker offers and the composer takes: a comma list as `<input accept>` reads it. Defaults to the contract's image types. */
  accept?: string;
  limits?: AttachmentLimitOverrides;
  /** Turns a picked file into the bytes uploaded. Defaults to `downscaleImage`. */
  prepare?: (file: File) => Promise<Blob>;
  /** Called with each refusal, beside the line the strip shows. */
  onRefused?: (refusal: AttachmentRefusal) => void;
}

/** The draft's files and what a composer does with them. */
export interface Attachments {
  files: PendingAttachment[];
  /** The latest batch's refusals, as the strip shows them. */
  refusals: AttachmentRefusal[];
  /** True while any upload is in flight. */
  uploading: boolean;
  /** True while files are dragged over a drop target. */
  dragging: boolean;
  /** The `accept` list the picker uses. */
  accept: string;
  add: (files: File[] | FileList) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Waits for the draft's uploads in flight, then resolves to those files' references, leaving the draft as it is. A file added meanwhile isn't included. */
  settle: () => Promise<FileContent[]>;
  /** `settle`, then `consume`s them: what Send carries. A file added meanwhile stays, and a second `take` while one waits gets none of the first's files. */
  take: () => Promise<FileContent[]>;
  /**
   * After a Send went out: removes those of `ids` that were sent (uploaded), and the refusal lines in `shown`,
   * the ones on screen when it began. A file refused while Send waited keeps its chip and its line.
   */
  consume: (ids: string[], shown: AttachmentRefusal[]) => void;
  openFileDialog: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** For a text box: takes pasted files, leaves pasted text alone. */
  onPaste: (event: ClipboardEvent<HTMLElement>) => void;
  /** For the element files are dropped on. */
  dropTarget: {
    onDragEnter: (event: DragEvent<HTMLElement>) => void;
    onDragOver: (event: DragEvent<HTMLElement>) => void;
    onDragLeave: (event: DragEvent<HTMLElement>) => void;
    onDrop: (event: DragEvent<HTMLElement>) => void;
  };
}

// ============================================================================
// Helpers
// ============================================================================

/** The longest side, in pixels, an image is downscaled to before upload. */
export const ATTACHMENT_IMAGE_MAX_EDGE = 1568;

const DEFAULT_ACCEPT = ATTACHMENT_IMAGE_TYPES.join(",");

/** The size that fits `width` × `height` within `maxEdge` on its longest side, or `undefined` when it already fits. */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } | undefined {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return undefined;
  const scale = maxEdge / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * An image downscaled to `maxEdge` on its longest side, in its own type. A GIF
 * (which would lose its frames), a file that isn't an image, one already small
 * enough, and one the browser can't decode are returned as they are; the
 * server checks those.
 */
export async function downscaleImage(file: File, maxEdge = ATTACHMENT_IMAGE_MAX_EDGE): Promise<Blob> {
  const type = normalizeMediaType(file.type);
  if (!type.startsWith("image/") || type === "image/gif") return file;
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return file;
  try {
    const bitmap = await createImageBitmap(file);
    const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
    if (size === undefined) {
      bitmap.close();
      return file;
    }
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, type, 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** Whether `type` matches an `accept` list (`image/*`, `image/png`, …). */
function accepts(accept: string, type: string): boolean {
  return accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((pattern) => (pattern.endsWith("/*") ? type.startsWith(pattern.slice(0, -1)) : type === pattern));
}

function megabytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

/** A file's size as a person reads it. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The line a server refusal shows, from its HTTP status. */
function uploadRefusal(name: string, error: unknown, maxFileBytes: number): AttachmentRefusal {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  if (status === 413) return { code: "size", filename: name, message: `${name} is over ${megabytes(maxFileBytes)}` };
  if (status === 415) return { code: "type", filename: name, message: `${name} isn't supported` };
  if (status === 501) return { code: "unavailable", filename: name, message: "Attachments aren't set up on this server" };
  return { code: "upload", filename: name, message: `${name} couldn't be uploaded` };
}

/** The read route's address for a stored file, or `undefined` when `data` is not a reference. */
export function attachmentReadUrl(data: string, base = ""): string | undefined {
  const id = parseBlobRef(data);
  return id === undefined ? undefined : `${base.replace(/\/+$/, "")}/api/flows/blobs/${id}`;
}

const hasFiles = (event: DragEvent<HTMLElement>) => Boolean(event.dataTransfer?.types?.includes("Files"));

// ============================================================================
// The hook
// ============================================================================

/** A composer's attachments: checked, downscaled and uploaded as they are added. */
export function useAttachments(options: UseAttachmentsOptions = {}): Attachments {
  const { client, sessionId, accept = DEFAULT_ACCEPT, limits, prepare = downscaleImage, onRefused } = options;
  const [files, setFiles] = useState<PendingAttachment[]>([]);
  const [refusals, setRefusalState] = useState<AttachmentRefusal[]>([]);
  // Mirrors `refusals` for a Send that snapshots the lines on screen when it begins.
  const refusalsRef = useRef<AttachmentRefusal[]>([]);
  const setRefusals = useCallback((next: (prev: AttachmentRefusal[]) => AttachmentRefusal[]) => {
    refusalsRef.current = next(refusalsRef.current);
    setRefusalState(refusalsRef.current);
  }, []);
  const [dragDepth, setDragDepth] = useState(0);
  // The source of truth, read synchronously by `add` (counts) and `settle`; state mirrors it for drawing.
  const filesRef = useRef<PendingAttachment[]>([]);
  const inFlight = useRef(new Map<string, Promise<void>>());
  // Files a `take` in progress has claimed, so a second Send can't carry them too.
  const reserved = useRef(new Set<string>());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // The latest options, read by callbacks that outlive a render.
  const latest = useRef({ client, prepare, onRefused });
  latest.current = { client, prepare, onRefused };

  const maxFileBytes = limits?.maxFileBytes ?? ATTACHMENT_LIMITS.maxFileBytes;
  const imagesPerMessage = limits?.imagesPerMessage ?? ATTACHMENT_LIMITS.imagesPerMessage;
  const documentsPerMessage = limits?.documentsPerMessage ?? ATTACHMENT_LIMITS.documentsPerMessage;
  const maxFiles = limits?.maxFiles;

  const update = useCallback((next: (prev: PendingAttachment[]) => PendingAttachment[]) => {
    filesRef.current = next(filesRef.current);
    setFiles(filesRef.current);
  }, []);

  const refuse = useCallback((batch: AttachmentRefusal[]) => {
    for (const refusal of batch) latest.current.onRefused?.(refusal);
    setRefusals((prev) => [...prev, ...batch]);
  }, [setRefusals]);

  const upload = useCallback(
    (entry: PendingAttachment, picked: File) => {
      const run = (async () => {
        let next: Partial<PendingAttachment>;
        try {
          const uploader = latest.current.client;
          if (!uploader) throw Object.assign(new Error("no uploader"), { status: 501 });
          const data = await latest.current.prepare(picked);
          const attachment = await uploader.upload({ data, mediaType: entry.mediaType, filename: entry.filename });
          next = { status: "ready", attachment };
        } catch (error) {
          const refusal = uploadRefusal(entry.filename, error, maxFileBytes);
          // A file removed while it uploaded, or dropped with its conversation, isn't announced.
          if (filesRef.current.some((f) => f.id === entry.id)) refuse([refusal]);
          next = { status: "refused", refusal: refusal.message };
        } finally {
          inFlight.current.delete(entry.id);
        }
        // A file removed while it uploaded stays removed.
        update((prev) => prev.map((f) => (f.id === entry.id ? { ...f, ...next } : f)));
      })();
      inFlight.current.set(entry.id, run);
    },
    [maxFileBytes, refuse, update],
  );

  const add = useCallback(
    (incoming: File[] | FileList) => {
      const list = [...incoming];
      if (list.length === 0) return;
      // Each batch's refusals replace the last batch's.
      setRefusals(() => []);
      if (!latest.current.client) {
        refuse([{ code: "unavailable", message: "Attachments aren't available here" }]);
        return;
      }
      const batch: AttachmentRefusal[] = [];
      const kept = filesRef.current.filter((f) => f.status !== "refused");
      let images = kept.filter((f) => attachmentKind(f.mediaType) === "image").length;
      let documents = kept.length - images;
      let total = kept.length;
      const overCount = new Set<string>();
      const added: Array<[PendingAttachment, File]> = [];
      for (const picked of list) {
        const name = picked.name || "file";
        const type = normalizeMediaType(picked.type);
        if (picked.size > maxFileBytes) {
          batch.push({ code: "size", filename: name, message: `${name} is over ${megabytes(maxFileBytes)}` });
          continue;
        }
        const kind = attachmentKind(type);
        if (kind === undefined || !accepts(accept, type)) {
          batch.push({ code: "type", filename: name, message: `${name} isn't supported` });
          continue;
        }
        const message =
          maxFiles !== undefined && total >= maxFiles
            ? `Only ${maxFiles} files per message`
            : kind === "image" && images >= imagesPerMessage
              ? `Only ${imagesPerMessage} images per message`
              : kind === "document" && documents >= documentsPerMessage
                ? `Only ${documentsPerMessage} documents per message`
                : undefined;
        if (message !== undefined) {
          // One line per limit, however many files it turned away.
          if (!overCount.has(message)) batch.push({ code: "count", message });
          overCount.add(message);
          continue;
        }
        total += 1;
        if (kind === "image") images += 1;
        else documents += 1;
        const entry: PendingAttachment = {
          id: nanoid(),
          filename: name,
          mediaType: type,
          size: picked.size,
          status: "uploading",
          ...(kind === "image" ? { previewUrl: URL.createObjectURL(picked) } : {}),
        };
        added.push([entry, picked]);
      }
      if (added.length > 0) update((prev) => [...prev, ...added.map(([entry]) => entry)]);
      if (batch.length > 0) refuse(batch);
      for (const [entry, picked] of added) upload(entry, picked);
    },
    [accept, documentsPerMessage, imagesPerMessage, maxFileBytes, maxFiles, refuse, update, upload],
  );

  const remove = useCallback(
    (id: string) =>
      update((prev) => {
        const found = prev.find((f) => f.id === id);
        if (found?.previewUrl) URL.revokeObjectURL(found.previewUrl);
        return prev.filter((f) => f.id !== id);
      }),
    [update],
  );

  const clear = useCallback(() => {
    update((prev) => {
      for (const f of prev) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return [];
    });
    setRefusals(() => []);
  }, [update, setRefusals]);

  const consume = useCallback(
    (ids: string[], shown: AttachmentRefusal[]) => {
      const batch = new Set(ids);
      const sent = (f: PendingAttachment) => batch.has(f.id) && f.status === "ready";
      update((prev) => {
        for (const f of prev) if (sent(f) && f.previewUrl) URL.revokeObjectURL(f.previewUrl);
        return prev.filter((f) => !sent(f));
      });
      const seen = new Set(shown);
      setRefusals((prev) => prev.filter((r) => !seen.has(r)));
    },
    [update, setRefusals],
  );

  // The references of exactly `ids`, once their uploads finish: a file added meanwhile isn't in the batch.
  const settleBatch = useCallback(async (ids: string[]) => {
    await Promise.all(ids.map((id) => inFlight.current.get(id)).filter((p) => p !== undefined));
    const batch = new Set(ids);
    return filesRef.current.flatMap((f) => (batch.has(f.id) && f.status === "ready" && f.attachment ? [f.attachment] : []));
  }, []);

  const settle = useCallback(() => settleBatch(filesRef.current.map((f) => f.id)), [settleBatch]);

  const take = useCallback(async () => {
    // Claimed before the wait, so a concurrent take gets none of these.
    const ids = filesRef.current.map((f) => f.id).filter((id) => !reserved.current.has(id));
    for (const id of ids) reserved.current.add(id);
    const shown = refusalsRef.current;
    try {
      const taken = await settleBatch(ids);
      consume(ids, shown);
      return taken;
    } finally {
      for (const id of ids) reserved.current.delete(id);
    }
  }, [settleBatch, consume]);

  const openFileDialog = useCallback(() => fileInputRef.current?.click(), []);

  const onPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const pasted: File[] = [];
      for (const item of event.clipboardData?.items ?? []) {
        if (item.kind !== "file") continue;
        const picked = item.getAsFile();
        if (picked) pasted.push(picked);
      }
      if (pasted.length === 0) return;
      event.preventDefault();
      add(pasted);
    },
    [add],
  );

  const dropTarget = useMemo<Attachments["dropTarget"]>(
    () => ({
      onDragEnter: (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        setDragDepth((d) => d + 1);
      },
      onDragOver: (event) => {
        if (hasFiles(event)) event.preventDefault();
      },
      onDragLeave: (event) => {
        if (hasFiles(event)) setDragDepth((d) => Math.max(0, d - 1));
      },
      onDrop: (event) => {
        if (hasFiles(event)) event.preventDefault();
        setDragDepth(0);
        const dropped = event.dataTransfer?.files;
        if (dropped && dropped.length > 0) add(dropped);
      },
    }),
    [add],
  );

  // Drop the draft's files when the conversation changes: a draft belongs to the one it was started in.
  const shownSession = useRef(sessionId);
  useEffect(() => {
    if (shownSession.current === sessionId) return;
    shownSession.current = sessionId;
    clear();
  }, [sessionId, clear]);

  // Release the local previews when the composer goes away.
  useEffect(
    () => () => {
      for (const f of filesRef.current) if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    },
    [],
  );

  const uploading = files.some((f) => f.status === "uploading");
  return useMemo<Attachments>(
    () => ({
      files,
      refusals,
      uploading,
      dragging: dragDepth > 0,
      accept,
      add,
      remove,
      clear,
      settle,
      take,
      consume,
      openFileDialog,
      fileInputRef,
      onPaste,
      dropTarget,
    }),
    [files, refusals, uploading, dragDepth, accept, add, remove, clear, settle, take, consume, openFileDialog, onPaste, dropTarget],
  );
}

// ============================================================================
// Drawing
// ============================================================================

export interface AttachmentPreviewProps {
  filename: string;
  mediaType: string;
  size?: number;
  /** Where an image's thumbnail is read from. With none, the file draws as a chip. */
  src?: string;
  status?: PendingAttachment["status"];
  /** Why the file was refused, shown on its chip. */
  refusal?: string;
  onRemove?: () => void;
  className?: string;
}

/** One file: a thumbnail for an image, a chip (name, type, size) for anything else or an image that can't be read. */
export function AttachmentPreview({ filename, mediaType, size, src, status, refusal, onRemove, className }: AttachmentPreviewProps) {
  const [broken, setBroken] = useState(false);
  const image = src !== undefined && !broken && mediaType.startsWith("image/") && status !== "refused";
  const removeButton = onRemove ? (
    <button
      aria-label={`Remove ${filename}`}
      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      onClick={onRemove}
      type="button"
    >
      <XIcon className="size-3" />
    </button>
  ) : null;
  const busy = status === "uploading" ? <Spinner aria-label="Uploading" className="absolute inset-0 m-auto size-5 text-foreground" /> : null;

  if (image) {
    return (
      <div aria-busy={status === "uploading"} className={cn("relative size-16 shrink-0", className)}>
        <img
          alt={filename}
          className={cn("size-16 rounded-md border border-border object-cover", status === "uploading" && "opacity-60")}
          onError={() => setBroken(true)}
          src={src}
        />
        {busy}
        {removeButton}
      </div>
    );
  }

  const note = refusal ?? (broken ? "Couldn't load" : undefined);
  return (
    <div
      aria-busy={status === "uploading"}
      className={cn(
        "relative flex h-16 max-w-56 shrink-0 items-center gap-2 rounded-md border border-border bg-muted px-3 text-xs",
        note !== undefined && "border-destructive",
        className,
      )}
    >
      <FileIcon className="size-5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="truncate font-medium text-foreground">{filename}</p>
        <p className={cn("truncate", note !== undefined ? "text-destructive" : "text-muted-foreground")}>
          {note ?? [mediaType, size === undefined ? undefined : formatFileSize(size)].filter(Boolean).join(" · ")}
        </p>
      </div>
      {busy}
      {removeButton}
    </div>
  );
}

export interface AttachmentStripProps {
  attachments: Attachments;
  className?: string;
}

/**
 * The draft's files above the text, and the refusal lines. The lines sit in a
 * polite live region that is always present, so a screen reader announces each
 * one as it appears.
 */
export function AttachmentStrip({ attachments, className }: AttachmentStripProps) {
  const { files, refusals, remove } = attachments;
  return (
    <div className={cn("flex w-full flex-col gap-1.5", className)}>
      {files.length > 0 && (
        <ul aria-label="Attachments" className="flex flex-wrap gap-2 pt-1.5">
          {files.map((f) => (
            <li key={f.id}>
              <AttachmentPreview
                filename={f.filename}
                mediaType={f.mediaType}
                onRemove={() => remove(f.id)}
                refusal={f.refusal}
                size={f.size}
                src={f.previewUrl}
                status={f.status}
              />
            </li>
          ))}
        </ul>
      )}
      <div aria-label="Attachment notices" aria-live="polite" className="text-destructive text-xs empty:hidden" role="status">
        {refusals.map((r, i) => (
          <p key={`${i}-${r.message}`}>{r.message}</p>
        ))}
      </div>
    </div>
  );
}

export interface AttachButtonProps {
  attachments: Attachments;
  className?: string;
  /** What the button shows. Defaults to a + icon. */
  children?: ReactNode;
}

/** The + button and the multi-select picker it opens, for a composer without PromptInput. */
export function AttachButton({ attachments, className, children }: AttachButtonProps) {
  return (
    <>
      <input
        accept={attachments.accept}
        aria-hidden
        className="hidden"
        multiple
        onChange={(event) => {
          if (event.currentTarget.files) attachments.add(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
        ref={attachments.fileInputRef}
        tabIndex={-1}
        type="file"
      />
      <button
        aria-label="Attach files"
        className={cn(
          "inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 focus-visible:outline-ring",
          className,
        )}
        onClick={attachments.openFileDialog}
        type="button"
      >
        {children ?? <PlusIcon className="size-4" />}
      </button>
    </>
  );
}
