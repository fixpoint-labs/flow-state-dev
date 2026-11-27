"use client";

/**
 * Worker-originated text in the conversation: two-line preview when long,
 * collapsed by default; short text is fully visible with no control.
 */
import { cn } from "../lib/utils";
import { MarkdownText } from "./flow-state/message-response";
import { CollapsibleContent } from "./ui/collapsible";

const PREVIEW_CLAMP = "line-clamp-2 text-sm leading-[1.6]";
const PREVIEW_FADE =
  "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-8 after:bg-gradient-to-t after:from-card after:to-transparent";

export const WORKER_REPLY_PREVIEW = cn(PREVIEW_CLAMP, PREVIEW_FADE);

/** Whether the plain-text body fits in the two-line preview without a control. */
export function fitsWorkerReplyPreview(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  const lines = trimmed.split("\n");
  if (lines.length > 2) return false;
  if (trimmed.length > 120) return false;
  if (lines.length === 2 && trimmed.length > 80) return false;
  return true;
}

/** Preview while collapsed and full body while open; parent supplies the `Collapsible` root. */
export function WorkerReplyCollapsibleBody({
  text,
  hideWhenOpenClass,
}: {
  text: string;
  /** e.g. `group-data-[state=open]/report:hidden` matching the root `group/<name>`. */
  hideWhenOpenClass: string;
}) {
  const markdown = <MarkdownText className="text-sm leading-[1.6]" text={text} />;
  return (
    <>
      <div className={cn(hideWhenOpenClass, "px-4 py-3")} data-part="preview">
        <div className={WORKER_REPLY_PREVIEW}>{markdown}</div>
      </div>
      <CollapsibleContent className="px-4 py-3 outline-none">{markdown}</CollapsibleContent>
    </>
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