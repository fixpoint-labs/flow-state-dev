/**
 * The title a session's row shows in the sessions list.
 *
 * The title is the one the session's title generator wrote (`sessionTitleGenerator`,
 * on the main worker's `afterAnswer`). Until that lands, the row shows
 * `New session`, and it falls back to the first line of the first message only once
 * a turn has ended with still no title: the point where generation has
 * failed, as far as the lab can tell.
 */

/** The title of a session with no generated title and no message yet. */
export const NEW_SESSION_TITLE = "New session";

/** The most of a first message a fallback title keeps. */
export const FALLBACK_TITLE_CHARS = 60;

/**
 * The row title: the generated title when there is one; else `New session` while a turn runs or
 * the session has no message; else the first line of its first message, cut short.
 */
export function sessionTitle(input: { title: string | undefined; firstLine: string | undefined; running: boolean }): string {
  const generated = input.title?.trim() ?? "";
  if (generated !== "") return generated;
  if (input.running || input.firstLine === undefined) return NEW_SESSION_TITLE;
  return input.firstLine.slice(0, FALLBACK_TITLE_CHARS);
}

/** The first line of a message, as a fallback title reads it. */
export function firstLineOfText(text: string): string {
  return text.split("\n")[0]!.trim();
}
