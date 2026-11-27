"use client";

/**
 * Worker-originated text in the conversation: two-line preview when long,
 * collapsed by default; short text is fully visible with no control.
 */
import { ChevronRightIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";
import { CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/** Plain-text length above which a single-line reply gets a collapse control. */
export const WORKER_REPLY_PREVIEW_MAX_CHARS = 120;
/** Plain-text length above which a two-line reply gets a collapse control. */
export const WORKER_REPLY_PREVIEW_TWO_LINE_MAX_CHARS = 80;
/** Newline count above which a reply always gets a collapse control. */
export const WORKER_REPLY_PREVIEW_MAX_LINES = 2;

const PREVIEW_CLAMP = "line-clamp-2 text-sm leading-[1.6]";
const PREVIEW_FADE_BASE =
  "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-gradient-to-t after:to-transparent";

function workerReplyPreviewClasses(fadeFromClass: string) {
  return cn(PREVIEW_CLAMP, PREVIEW_FADE_BASE, fadeFromClass);
}

/** Bottom fade colours that match each worker-reply card shell. */
export const WORKER_REPLY_PREVIEW_FADE = {
  received: "after:from-card",
  result: "after:from-success/5",
} as const;

/** Plain-text body for a worker reply; tolerates legacy non-string values. */
export function workerReplyTextOf(text: unknown): string {
  return typeof text === "string" ? text : "";
}

/** Whether the plain-text body fits in the two-line preview without a control. */
export function fitsWorkerReplyPreview(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  if (/^[\s]*[-*+]\s|```|^#+\s|\|.+\|/m.test(trimmed)) return false;
  const lines = trimmed.split("\n");
  if (lines.length > WORKER_REPLY_PREVIEW_MAX_LINES) return false;
  if (trimmed.length > WORKER_REPLY_PREVIEW_MAX_CHARS) return false;
  if (lines.length === WORKER_REPLY_PREVIEW_MAX_LINES && trimmed.length > WORKER_REPLY_PREVIEW_TWO_LINE_MAX_CHARS) return false;
  return true;
}

/** One markdown subtree: inline clamp while closed, block body while open. */
export function WorkerReplyCollapsibleBody({
  text,
  open,
  fadeFromClass,
}: {
  text: string;
  open: boolean;
  fadeFromClass: string;
}) {
  return (
    <CollapsibleContent forceMount className="px-4 py-3 outline-none">
      <div data-part={open ? "body" : "preview"} className={open ? undefined : workerReplyPreviewClasses(fadeFromClass)}>
        {open ? (
          <MarkdownText className="text-sm leading-[1.6]" text={text} />
        ) : (
          <MarkdownText inline className="text-sm leading-[1.6]" text={text} />
        )}
      </div>
    </CollapsibleContent>
  );
}

/** Full body when the text fits the preview — no expand control. */
export function WorkerReplyStaticBody({ text }: { text: string }) {
  return (
    <div className="px-4 py-3">
      <MarkdownText className="text-sm leading-[1.6]" text={text} />
    </div>
  );
}

/** Chevron expand/collapse with labels that match open state. */
export function WorkerReplyExpandTrigger({
  open,
  expandLabel,
  collapseLabel,
  group,
}: {
  open: boolean;
  expandLabel: string;
  collapseLabel: string;
  group: "report" | "result";
}) {
  return (
    <CollapsibleTrigger
      aria-label={open ? collapseLabel : expandLabel}
      className="shrink-0 rounded-sm p-1 text-text-3 hover:bg-surface-raised hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
    >
      <ChevronRightIcon
        aria-hidden
        className={cn(
          "size-3.5 transition-transform",
          `group-data-[state=closed]/${group}:rotate-0`,
          `group-data-[state=open]/${group}:-rotate-90`,
        )}
      />
    </CollapsibleTrigger>
  );
}