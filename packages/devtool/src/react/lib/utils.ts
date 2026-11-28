import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Enough of a session id to recognise, without filling the column it sits in.
 *
 * A derived ChildSession id is a 32-character hash, so the whole value is both
 * unreadable and too wide for a header crumb or a table cell — but the ends of
 * it are what a developer matches against a store dump or a log line.
 */
export function shortSessionId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

/**
 * A byte count for a person to read, in binary units to one decimal place
 * (`812 B`, `4.0 KB`, `42.3 MB`), as `du -h` counts them.
 */
export function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${units[unit]}`;
}

export function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// FIX-723.
/**
 * One-token summary of a failed item's error for the collapsed transcript row:
 * the HTTP status when present (a 403 reads differently from a 500),
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
