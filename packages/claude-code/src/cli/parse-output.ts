/**
 * Defensive parser for `claude --remote` stdout.
 *
 * The exact stdout shape of `claude --remote` is undocumented and may change
 * across CLI versions, so this parser extracts what it can and never throws:
 * it pulls a claude.ai/code URL and a session UUID when present, returning
 * `null` for anything it can't find. The dispatch block keeps the raw stdout
 * regardless, so a miss here degrades to "handle without URL", not data loss.
 */

/** Matches a claude.ai cloud-session URL anywhere in the output. */
const URL_RE = /https?:\/\/claude\.ai\/[^\s"')<>]+/i;
/** Matches a v4-style UUID. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

export interface ParsedRemoteDispatch {
  url: string | null;
  sessionId: string | null;
}

/**
 * Extract `{ url, sessionId }` from dispatch stdout. Prefers a UUID embedded in
 * the URL path (most specific), then falls back to the first UUID anywhere in
 * the output. Both fields are independently nullable.
 */
export function parseRemoteDispatchOutput(stdout: string): ParsedRemoteDispatch {
  const url = stdout.match(URL_RE)?.[0] ?? null;
  const sessionId =
    (url ? url.match(UUID_RE)?.[0] : undefined) ?? stdout.match(UUID_RE)?.[0] ?? null;
  return { url, sessionId };
}
