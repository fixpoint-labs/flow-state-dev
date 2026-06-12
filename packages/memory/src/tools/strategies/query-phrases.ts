/**
 * Shared query-phrase extraction for recall strategies.
 *
 * Lives in its own module so both the `llm-filter` strategy and the
 * graph-expand candidate builder can use it without importing each other —
 * keeping the two strategy modules free of a circular dependency.
 */

/** Minimum word count for an exact-phrase match candidate. */
export const EXACT_PHRASE_MIN_WORDS = 3

/**
 * Extract contiguous phrases of `EXACT_PHRASE_MIN_WORDS`+ words from the query.
 *
 * Whitespace splits only — no tokenisation tricks. Phrases overlap; a 5-word
 * query produces (5-3)+(5-4)+(5-5) = 3 phrases at min-len 3.
 */
export function extractExactPhrases(query: string): string[] {
  const words = query.trim().split(/\s+/).filter((w) => w.length > 0)
  if (words.length < EXACT_PHRASE_MIN_WORDS) return []
  const phrases: string[] = []
  for (let len = EXACT_PHRASE_MIN_WORDS; len <= words.length; len++) {
    for (let start = 0; start + len <= words.length; start++) {
      phrases.push(words.slice(start, start + len).join(' '))
    }
  }
  return phrases
}
