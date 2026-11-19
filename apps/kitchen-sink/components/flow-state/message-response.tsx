"use client";

/**
 * Markdown, drawn with Streamdown: the renderer chat messages use
 * ({@link MessageResponse}), and {@link MarkdownText} for text a card shows.
 *
 * Streamdown closes an unfinished code fence or emphasis while the text is
 * still streaming. It parses raw HTML in Markdown by default (its `raw` rehype
 * plugin, then sanitized); {@link MarkdownText} drops that plugin, so HTML in
 * the text shows as text and never becomes an element, and allows no image
 * source, so an image the text names is never fetched. Both resolve a
 * relative link against the page's base (`<base href>`), as the browser
 * resolves one, so `./inbox/x` stays under the prefix an app is served at.
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

const { raw: _raw, harden, ...withoutRaw } = defaultRehypePlugins;
const [hardenPlugin, hardenOptions] = harden as Extract<typeof harden, readonly unknown[]>;

/**
 * Streamdown's harden with `overrides`, resolving a relative link against the
 * page's base rather than the origin's root. Read when drawn, since the base
 * is the page's (no document while rendering on a server).
 */
function hardenAtPage(overrides: Record<string, unknown> = {}): typeof harden {
  const defaultOrigin = typeof document === "undefined" ? undefined : document.baseURI;
  return [hardenPlugin, { ...hardenOptions, defaultOrigin, ...overrides }];
}

/**
 * Streamdown's rehype plugins without `raw`, so HTML stays text, and with
 * harden allowing no image source, so an image in the text is never fetched.
 * Sanitize and harden's link rules stay as Streamdown sets them.
 */
function textOnlyHtml(): typeof harden[] {
  return [...Object.values(withoutRaw), hardenAtPage({ allowedImagePrefixes: [], allowDataImages: false })];
}

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
      rehypePlugins={Object.values({ ...defaultRehypePlugins, harden: hardenAtPage() })}
      {...props}
    />
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

MessageResponse.displayName = "MessageResponse";

/** What a one-line text keeps: inline Markdown. Anything else is unwrapped to its text. */
const INLINE_ELEMENTS = ["strong", "em", "del", "code", "a"];

/**
 * Text an agent or a tool wrote, as Markdown, with any HTML in it shown as
 * text. `inline` keeps it to one truncated line: inline Markdown only, and a
 * list item or heading is unwrapped to its text rather than drawn as a block.
 */
export function MarkdownText({ text, className, inline = false }: { text: string; className?: string; inline?: boolean }) {
  return inline ? (
    <MessageResponse
      className={cn("truncate whitespace-nowrap [&_p]:inline", className)}
      rehypePlugins={textOnlyHtml()}
      allowedElements={INLINE_ELEMENTS}
      unwrapDisallowed
    >
      {text}
    </MessageResponse>
  ) : (
    <MessageResponse className={className} rehypePlugins={textOnlyHtml()}>
      {text}
    </MessageResponse>
  );
}
