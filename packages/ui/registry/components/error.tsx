"use client";

import type { ErrorItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

export function ErrorDisplay({ item }: { item: ErrorItem }) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        "border-destructive/40 bg-destructive/10 text-destructive"
      )}
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex min-w-0 flex-col gap-1">
        <span>{item.message}</span>
        {item.code && (
          <span className="text-xs opacity-70">Code: {item.code}</span>
        )}
        {item.details && Object.keys(item.details).length > 0 && (
          <details className="text-xs opacity-80">
            <summary className="cursor-pointer select-none">Details</summary>
            <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words">
              {typeof item.details.output === "string"
                ? item.details.output
                : JSON.stringify(item.details, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </div>
  );
}
