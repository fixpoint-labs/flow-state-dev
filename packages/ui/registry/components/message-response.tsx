"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export type MessageResponseProps = ComponentProps<"div"> & {
  /** Pre-rendered content for environments without markdown pipeline wiring. */
  content?: string;
};

/**
 * Lightweight response renderer slot.
 */
export function MessageResponse({ className, content, children, ...props }: MessageResponseProps) {
  return (
    <div className={cn("prose prose-neutral dark:prose-invert max-w-none text-sm", className)} {...props}>
      {children ?? content}
    </div>
  );
}
