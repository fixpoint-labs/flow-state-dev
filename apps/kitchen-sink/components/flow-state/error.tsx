"use client";

import type { ErrorItem } from "@flow-state-dev/core/items";
import { cn } from "@/lib/utils";
import { AlertCircle } from "lucide-react";

/** What an error says: its message, its code, and an openable *Details* block. */
export type ErrorBodyProps = Pick<ErrorItem, "message" | "code" | "details">;

/**
 * The text of an error, shared by every surface that shows one (`ErrorDisplay`
 * in an item stream, `RequestRecovery` on a failed turn), so a failure reads
 * the same wherever it appears.
 */
export function ErrorBody({ message, code, details }: ErrorBodyProps) {
  return (
    <>
      <span>{message}</span>
      {code && (
        <span className="text-xs opacity-70">Code: {code}</span>
      )}
      {details && Object.keys(details).length > 0 && (
        <details className="text-xs opacity-80">
          <summary className="cursor-pointer select-none">Details</summary>
          <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words">
            {typeof details.output === "string"
              ? details.output
              : JSON.stringify(details, null, 2)}
          </pre>
        </details>
      )}
    </>
  );
}

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
        <ErrorBody message={item.message} code={item.code} details={item.details} />
      </div>
    </div>
  );
}
