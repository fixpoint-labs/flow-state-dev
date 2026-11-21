/**
 * Recognising a provider failure in text a turn came back with.
 *
 * Callers use it to tell a provider failure from an answer: a rate limit,
 * a 5xx, a gateway or transport error, or a stream failure. The last
 * alternative is `stream failed`, which also matches the AI SDK's
 * "AI SDK stream failed".
 */

const PROVIDER_ERROR =
  /rate.?limit|429|5\d\d |overloaded|timed? ?out|ECONNRESET|fetch failed|provider|gateway|unavailable|stream failed/i;

/** Whether `text` is a provider failure rather than an answer to grade. */
export function isProviderError(text: string): boolean {
  return PROVIDER_ERROR.test(text);
}
