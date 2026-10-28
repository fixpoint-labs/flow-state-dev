/**
 * `MessageResponse` from the UI registry (`packages/ui/registry/components/message.tsx`),
 * copied as the registry hands it out, without the rest of that file's message shell.
 * It renders Markdown with Streamdown, which closes an unfinished code fence or
 * emphasis while the text is still streaming.
 *
 * Streamdown parses raw HTML in Markdown by default (its `raw` rehype plugin,
 * then sanitized). {@link AgentMarkdown} drops that plugin, so HTML a model
 * writes shows as text and never becomes an element.
 */
import type { ComponentProps } from "react";
import { memo } from "react";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { defaultRehypePlugins, Streamdown } from "streamdown";
import { cn } from "../../lib/utils";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => (
    <Streamdown
      className={cn(
        "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        // Streamdown's inline code has a fixed corner; this one follows --radius-sm.
        "[&_code]:rounded-sm",
        className
      )}
      plugins={streamdownPlugins}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

MessageResponse.displayName = "MessageResponse";

/** Streamdown's rehype plugins without `raw`: sanitize and harden stay, HTML stays text. */
const { raw: _raw, ...textOnlyHtml } = defaultRehypePlugins;
const AGENT_REHYPE = Object.values(textOnlyHtml);

/** A worker's text, as Markdown, with any HTML in it shown as text. */
export function AgentMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <MessageResponse className={className} rehypePlugins={AGENT_REHYPE}>
      {text}
    </MessageResponse>
  );
}
