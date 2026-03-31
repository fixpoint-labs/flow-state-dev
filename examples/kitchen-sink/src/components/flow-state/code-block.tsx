"use client";

import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

export interface CodeBlockProps extends ComponentProps<"div"> {
  code: string;
  language?: string;
}

/**
 * Registry-derived code block used by tool output renders.
 */
export function CodeBlock({ className, code, language, ...props }: CodeBlockProps) {
  return (
    <div className={cn("overflow-hidden rounded-lg border", className)} {...props}>
      {language ? <div className="border-b bg-muted px-3 py-1 text-xs">{language}</div> : null}
      <pre className="overflow-x-auto p-3 text-xs">
        <code>{code}</code>
      </pre>
    </div>
  );
}
