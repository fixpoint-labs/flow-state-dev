"use client";

import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

export type ConversationProps = ComponentProps<"div">;

/**
 * Scrollable message list container with neutral defaults for chat UIs.
 */
export function Conversation({ className, ...props }: ConversationProps) {
  return (
    <div
      className={cn("flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4", className)}
      {...props}
    />
  );
}
