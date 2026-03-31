"use client";

import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export type FlowMessageRole = "user" | "assistant" | "system";

export interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from: FlowMessageRole;
}

/**
 * Registry-derived message wrapper with role-aware layout.
 */
export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        "group flex w-full max-w-[95%] flex-col gap-2",
        from === "user" ? "ml-auto is-user" : "mr-auto is-assistant",
        className,
      )}
      {...props}
    />
  );
}

export type MessageContentProps = ComponentProps<"div">;

export function MessageContent({ className, ...props }: MessageContentProps) {
  return (
    <div
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden text-sm",
        "group-[.is-user]:ml-auto group-[.is-user]:rounded-xl group-[.is-user]:bg-muted group-[.is-user]:px-4 group-[.is-user]:py-3",
        className,
      )}
      {...props}
    />
  );
}

export type MessageResponseProps = ComponentProps<"div"> & {
  content?: string;
};

export function MessageResponse({ className, content, children, ...props }: MessageResponseProps) {
  return (
    <div className={cn("prose prose-neutral dark:prose-invert max-w-none text-sm", className)} {...props}>
      {children ?? content}
    </div>
  );
}
