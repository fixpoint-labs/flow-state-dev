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
      <div className="flex flex-col gap-1">
        <span>{item.message}</span>
        {item.code && (
          <span className="text-xs opacity-70">Code: {item.code}</span>
        )}
      </div>
    </div>
  );
}
