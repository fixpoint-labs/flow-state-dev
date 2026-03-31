"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export interface SourceItem {
  id: string;
  title: string;
  href?: string;
}

export interface SourcesProps extends ComponentProps<"ul"> {
  items: SourceItem[];
}

/**
 * Source citation list for assistant responses.
 */
export function Sources({ className, items, ...props }: SourcesProps) {
  return (
    <ul className={cn("flex flex-col gap-2 text-xs", className)} {...props}>
      {items.map((item) => (
        <li key={item.id} className="rounded-md border px-3 py-2">
          {item.href ? (
            <a className="underline underline-offset-2" href={item.href} rel="noreferrer" target="_blank">
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </li>
      ))}
    </ul>
  );
}
