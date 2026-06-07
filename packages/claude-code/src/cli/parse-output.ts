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
/**
 * Captures the session id segment of a `claude.ai/code/<id>` URL. The id may be
 * a `session_…` token or a UUID — both are accepted, since the exact CLI format
 * is undocumented and has varied.
 */
const CODE_SESSION_RE = /https?:\/\/claude\.ai\/code\/([^\s"')<>/?#]+)/i;
/** Matches a v4-style UUID. */
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/**
 * Sentence/quote punctuation to strip off the *end* of a captured token. The
 * URL/id character classes are intentionally permissive (the format is
 * undocumented), so a token at the end of a sentence like "…session_abc."
 * would otherwise keep the trailing period. Trimming only the tail avoids
 * truncating ids or URLs that legitimately contain these characters internally.
 */
const TRAILING_PUNCT_RE = /[.,;:!?'")\]]+$/;

export interface ParsedRemoteDispatch {
  url: string | null;
  sessionId: string | null;
}

/**
 * Extract `{ url, sessionId }` from dispatch stdout. Prefers the id segment of a
 * `claude.ai/code/<id>` URL (handles both `session_…` and UUID forms), then
 * falls back to the first bare UUID anywhere in the output. Trailing sentence
 * punctuation is stripped from both. Both fields are independently nullable.
 */
export function parseRemoteDispatchOutput(stdout: string): ParsedRemoteDispatch {
  const rawUrl = stdout.match(URL_RE)?.[0] ?? null;
  const rawId = stdout.match(CODE_SESSION_RE)?.[1] ?? stdout.match(UUID_RE)?.[0] ?? null;
  return {
    url: rawUrl ? rawUrl.replace(TRAILING_PUNCT_RE, "") : null,
    sessionId: rawId ? rawId.replace(TRAILING_PUNCT_RE, "") : null,
  };
}
