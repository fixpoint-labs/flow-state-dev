import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * One-token summary of a failed item's error for the collapsed transcript row
 * (FIX-723): the HTTP status when present (a 403 reads differently from a 500),
 * otherwise the non-http classification (`network` / `timeout` / `abort`).
 * Returns `undefined` when there is nothing useful to surface inline.
 */
export function errorSummary(
  details: Record<string, unknown> | undefined
): string | undefined {
  if (!details) return undefined;
  if (typeof details.httpStatus === "number") return String(details.httpStatus);
  if (typeof details.errorType === "string" && details.errorType !== "http") {
    return details.errorType;
  }
  return undefined;
}
