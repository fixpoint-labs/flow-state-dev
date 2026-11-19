/**
 * A stored item read loosely, and what the jobs read off one: a message's
 * text and files, a tool call's arguments, and who a `sendMessage` went to.
 */
import type { FileContent } from "@flow-state-dev/core/items";

/** An item, read loosely: each read below checks the fields it uses. */
export type Item = Record<string, any>;

/** The text of a message item. */
export const textOf = (item: Item): string =>
  (Array.isArray(item.content) ? item.content : [])
    .map((part: { text?: unknown }) => (typeof part.text === "string" ? part.text : ""))
    .join("");

/** The files a message carries: its `file` parts, references to the stored bytes. */
export const filesOf = (item: Item): FileContent[] =>
  (Array.isArray(item.content) ? item.content : []).filter(
    (part: Record<string, unknown>): part is FileContent => part.type === "file" && typeof part.data === "string" && typeof part.mediaType === "string",
  );

/** A tool call's arguments, or none when they don't parse. */
export const parseArgs = (item: Item): Record<string, unknown> => {
  try {
    return JSON.parse(String(item.toolCall?.arguments ?? "{}")) as Record<string, unknown>;
  } catch {
    return {};
  }
};

/** Who a `sendMessage` output went to, when it sent one: a refused send sent nothing. */
export function sentTo(item: Item): string | undefined {
  const to = parseArgs(item).to;
  const messageId = item.output?.sent;
  return typeof messageId === "string" && typeof to === "string" ? to : undefined;
}
