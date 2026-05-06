"use client";

import type { ErrorItem, StepErrorItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle } from "lucide-react";

type ErrorLikeItem = ErrorItem | StepErrorItem;

export function ErrorDisplay({ item }: { item: ErrorLikeItem }) {
  // `error` is terminal (request failed); `step_error` is non-fatal by
  // definition — it covers rescued-handler failures and background work
  // failures, both of which leave the parent request intact. Render the
  // two as visually distinct: red for fatal, yellow for warning.
  const isStepError = item.type === "step_error";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border px-4 py-3 text-sm",
        isStepError
          ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
          : "border-destructive/40 bg-destructive/10 text-destructive"
      )}
    >
      {isStepError ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      )}
      <div className="flex flex-col gap-1">
        <span>{item.message}</span>
        {item.type === "step_error" && item.blockName && (
          <span className="text-xs opacity-70">
            Block: {item.blockName}
            {item.recovered ? " (recovered)" : ""}
          </span>
        )}
        {item.code && (
          <span className="text-xs opacity-70">Code: {item.code}</span>
        )}
      </div>
    </div>
  );
}
