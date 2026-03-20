/**
 * Shared utility functions for @thought-fabric/core.
 *
 * These are general-purpose helpers used across multiple domains
 * (memory, attention, identity, etc).
 */

/** Generate a short random alphanumeric ID. */
export function shortId(length = 4): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let id = ''
  for (let i = 0; i < length; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// ---------------------------------------------------------------------------
// Text matching
// ---------------------------------------------------------------------------

/** Tokenize a string into lowercase word tokens. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
}

/**
 * Compute token overlap ratio between two strings.
 * Returns a value [0, 1] representing the fraction of tokens in `a` that appear in `b`.
 */
export function tokenOverlap(a: string, b: string): number {
  const tokensA = tokenize(a)
  const tokensB = new Set(tokenize(b))
  if (tokensA.length === 0) return 0
  const matches = tokensA.filter((t) => tokensB.has(t)).length
  return matches / tokensA.length
}

/**
 * Find the best-matching item from a list by bidirectional token overlap.
 * Uses the max of overlap(a→b) and overlap(b→a) for match detection.
 * Returns both the max overlap (for match threshold) and min overlap
 * (for identity detection — both directions must be high for "same content").
 */
export function findBestOverlap<T extends { content: string }>(
  content: string,
  items: T[],
  threshold = 0.6,
): { fact: T; overlap: number; minOverlap: number } | undefined {
  let best: { fact: T; overlap: number; minOverlap: number } | undefined

  for (const item of items) {
    const overlapAB = tokenOverlap(content, item.content)
    const overlapBA = tokenOverlap(item.content, content)
    const overlap = Math.max(overlapAB, overlapBA)
    const minOverlap = Math.min(overlapAB, overlapBA)
    if (overlap >= threshold && (!best || overlap > best.overlap)) {
      best = { fact: item, overlap, minOverlap }
    }
  }

  return best
}
