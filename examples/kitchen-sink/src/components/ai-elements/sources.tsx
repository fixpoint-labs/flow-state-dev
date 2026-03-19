"use client";

import type { ComponentProps } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { ChevronDownIcon, GlobeIcon } from "lucide-react";
import { memo, useState } from "react";

// ---------------------------------------------------------------------------
// Sources (root)
// ---------------------------------------------------------------------------

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = memo(
  ({ className, children, ...props }: SourcesProps) => {
    const [isOpen, setIsOpen] = useState(false);

    return (
      <Collapsible
        className={cn("not-prose", className)}
        open={isOpen}
        onOpenChange={setIsOpen}
        {...props}
      >
        {children}
      </Collapsible>
    );
  }
);

Sources.displayName = "Sources";

// ---------------------------------------------------------------------------
// SourcesTrigger
// ---------------------------------------------------------------------------

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
};

export const SourcesTrigger = memo(
  ({ className, count, children, ...props }: SourcesTriggerProps) => (
    <CollapsibleTrigger
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground",
        className
      )}
      {...props}
    >
      {children ?? (
        <>
          <GlobeIcon className="size-3.5" />
          <span>
            {count} {count === 1 ? "source" : "sources"}
          </span>
          <ChevronDownIcon className="size-3 transition-transform [[data-state=open]>&]:rotate-180" />
        </>
      )}
    </CollapsibleTrigger>
  )
);

SourcesTrigger.displayName = "SourcesTrigger";

// ---------------------------------------------------------------------------
// SourcesContent
// ---------------------------------------------------------------------------

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = memo(
  ({ className, children, ...props }: SourcesContentProps) => (
    <CollapsibleContent
      className={cn(
        "mt-1.5 flex flex-wrap gap-2",
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className
      )}
      {...props}
    >
      {children}
    </CollapsibleContent>
  )
);

SourcesContent.displayName = "SourcesContent";

// ---------------------------------------------------------------------------
// Source (individual link)
// ---------------------------------------------------------------------------

export type SourceProps = ComponentProps<"a"> & {
  favicon?: string;
};

export const Source = memo(
  ({ className, href, favicon, children, ...props }: SourceProps) => {
    const hostname = href ? safeHostname(href) : undefined;

    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          className
        )}
        {...props}
      >
        {favicon ? (
          <img src={favicon} alt="" className="size-3.5 rounded-sm" />
        ) : (
          <GlobeIcon className="size-3 shrink-0" />
        )}
        <span className="truncate max-w-[200px]">{children ?? hostname ?? href}</span>
      </a>
    );
  }
);

Source.displayName = "Source";

// ---------------------------------------------------------------------------

function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
