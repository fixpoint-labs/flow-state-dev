/** An excerpt, never a generated claim: skip Markdown scaffolding and keep the original words. */
export function replyPreview(text: string): string {
  const lines = text.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, "").split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !/^#{1,6}\s|^\|?\s*[-:]+\s*\|/.test(line))
    .map((line) => line
      .replace(/^[-*+]\s+|^\d+\.\s+/, "")
      .replace(/^\||\|$/g, "").replace(/\s*\|\s*/g, " · ")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(^|\s)[*_]([^*_]+)[*_](?=\s|[.,!?;:]|$)/g, "$1$2")
      .replace(/`([^`]+)`/g, "$1"));
  // Code-only and heading-only replies still deserve an excerpt of their actual content.
  const fallback = text.split("\n").filter((line) => !/^\s*(```|~~~)/.test(line)).join(" ").replace(/#{1,6}\s/g, "").trim();
  const excerpt = lines.slice(0, 3).join(" ") || fallback;
  return excerpt.length <= 360 ? `${excerpt}${lines.length > 3 ? "…" : ""}` : `${excerpt.slice(0, 360).replace(/\s+\S*$/, "")}…`;
}

/** Past this many characters a reply is long: roughly a screenful of prose in the thread's column. */
export const LONG_REPLY_CHARS = 700;
/** Past this many lines a reply is long, however short its lines: a list or a table that would fill the view. */
export const LONG_REPLY_LINES = 12;

/** Long replies get a fold control and, where the reader chose it, an excerpt before their full original details. */
export const isLongReply = (text: string): boolean => text.length > LONG_REPLY_CHARS || text.split("\n").length > LONG_REPLY_LINES;
