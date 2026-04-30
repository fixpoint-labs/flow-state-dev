"use client";

/**
 * `<LinkCardRenderer />` — registry-distributed renderer for the `link-card`
 * generative UI shape. Consumes `ComponentItem.data` matching the
 * `LinkCardSchema` exported from `@flow-state-dev/ui/generative`.
 */
import type { ComponentItem } from "@flow-state-dev/core/items";

interface LinkCardData {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
  favicon?: string;
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function LinkCardRenderer({ item }: { item: ComponentItem }) {
  const data = item.data as unknown as LinkCardData;
  const host = safeHostname(data.url);
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-border bg-card text-card-foreground shadow-sm overflow-hidden max-w-md hover:bg-accent transition-colors"
    >
      {data.imageUrl ? (
        <div className="aspect-[16/9] bg-muted overflow-hidden">
          <img
            src={data.imageUrl}
            alt={data.title}
            className="w-full h-full object-cover"
          />
        </div>
      ) : null}
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {data.favicon ? (
            <img src={data.favicon} alt="" className="w-3.5 h-3.5 rounded-sm" />
          ) : null}
          <span className="truncate">{data.siteName ?? host}</span>
        </div>
        <h3 className="text-sm font-semibold leading-snug line-clamp-2">
          {data.title}
        </h3>
        {data.description ? (
          <p className="text-xs text-muted-foreground line-clamp-3">
            {data.description}
          </p>
        ) : null}
      </div>
    </a>
  );
}
