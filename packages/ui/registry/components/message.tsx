"use client";

import type { ComponentProps, HTMLAttributes } from "react";
import { cn } from "../lib/utils";
import type { FlowMessageRole } from "../lib/types";

export interface MessageProps extends HTMLAttributes<HTMLDivElement> {
  from: FlowMessageRole;
}

/**
 * Message wrapper that applies role-aware layout classes.
 */
export function Message({ className, from, ...props }: MessageProps) {
  return (
    <div
      className={cn(
        "group flex w-full max-w-[95%] flex-col gap-2",
        from === "user" ? "ml-auto" : "mr-auto",
        from === "user" ? "is-user" : "is-assistant",
        className,
      )}
      {...props}
    />
  );
}

export type MessageContentProps = ComponentProps<"div">;

/**
 * Bubble/content container used inside `Message`.
 */
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
