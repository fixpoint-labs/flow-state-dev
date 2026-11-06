/**
 * The title a session's row shows in the sessions list.
 *
 * The title is the one the session's title generator wrote (`sessionTitleGenerator`, run as a
 * sidechain of the main worker's turn). Until one has landed, the row falls back to the first
 * line of the session's first message, as it always has; a session with no message shows
 * `New session`.
 */

/** The title of a session with no generated title and no message yet. */
export const NEW_SESSION_TITLE = "New session";

/** The most of a first message a fallback title keeps. */
export const FALLBACK_TITLE_CHARS = 60;

/** The row title: the generated title when there is one, else the first message's first line, else `New session`. */
export function sessionTitle(input: { title: string | undefined; firstLine: string | undefined }): string {
  const generated = input.title?.trim() ?? "";
  if (generated !== "") return generated;
  if (input.firstLine === undefined) return NEW_SESSION_TITLE;
  return input.firstLine.slice(0, FALLBACK_TITLE_CHARS);
}

/** The first line of a message, trimmed, as a fallback title reads it. */
export function firstLineOfText(text: string): string {
  return text.split("\n")[0]!.trim();
}
