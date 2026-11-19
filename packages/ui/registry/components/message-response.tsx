"use client";

/**
 * Markdown, drawn with Streamdown: the renderer chat messages use
 * ({@link MessageResponse}), and {@link MarkdownText} for text a card shows.
 *
 * Streamdown closes an unfinished code fence or emphasis while the text is
 * still streaming. It parses raw HTML in Markdown by default (its `raw` rehype
 * plugin, then sanitized); {@link MarkdownText} drops that plugin, so HTML in
 * the text shows as text and never becomes an element, and allows no image
 * source, so an image the text names is never fetched.
 */
import type { ComponentProps } from "react";
import { memo } from "react";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { defaultRehypePlugins, Streamdown } from "streamdown";

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

const streamdownPlugins = { cjk, code, math, mermaid };

/** Streamdown with the registry's plugins and spacing. Re-renders only when its text changes. */
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

/**
 * Streamdown's rehype plugins without `raw`, so HTML stays text, and with
 * harden allowing no image source, so an image in the text is never fetched.
 * Sanitize and harden's link rules stay as Streamdown sets them.
 */
const { raw: _raw, harden, ...textOnlyHtml } = defaultRehypePlugins;
const [hardenPlugin, hardenOptions] = harden as Extract<typeof harden, readonly unknown[]>;
const TEXT_ONLY_HTML: typeof harden[] = [
  ...Object.values(textOnlyHtml),
  [hardenPlugin, { ...hardenOptions, allowedImagePrefixes: [], allowDataImages: false }],
];

/** What a one-line text keeps: inline Markdown. Anything else is unwrapped to its text. */
const INLINE_ELEMENTS = ["strong", "em", "del", "code", "a"];

/** What a block of it drops: an image, so showing the text never makes the browser load one. */
const NO_IMAGES = ["img"];

/**
 * Text an agent or a tool wrote, as Markdown, with any HTML in it shown as
 * text, and no image loaded. `inline` keeps it to one truncated line: inline Markdown only, and a
 * list item or heading is unwrapped to its text rather than drawn as a block.
 */
export function MarkdownText({ text, className, inline = false }: { text: string; className?: string; inline?: boolean }) {
  return inline ? (
    <MessageResponse
      className={cn("truncate whitespace-nowrap [&_p]:inline", className)}
      rehypePlugins={TEXT_ONLY_HTML}
      allowedElements={INLINE_ELEMENTS}
      unwrapDisallowed
    >
      {text}
    </MessageResponse>
  ) : (
    <MessageResponse className={className} rehypePlugins={TEXT_ONLY_HTML} disallowedElements={NO_IMAGES} unwrapDisallowed>
      {text}
    </MessageResponse>
  );
}
