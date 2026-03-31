/** Minimal className merge helper for copied registry components. */
export function cn(...tokens: Array<string | undefined | false | null>): string {
  return tokens.filter(Boolean).join(" ");
}
