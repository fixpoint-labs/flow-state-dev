/**
 * What "the same bug" is, for the Error Reporter (FIX-1983 D2).
 *
 * A failure's fingerprint is its flow kind, action, block path, error code and
 * message, with the message's ids, numbers and paths stripped. Two failures
 * with one fingerprint are one report: repeats only raise its count. Two bugs
 * that fail at the same block with the same code and words are merged until
 * someone splits them; that is the decision's known price.
 */

/** The parts a fingerprint is made from. */
export interface FingerprintParts {
  readonly flowKind: string;
  readonly actionName: string;
  readonly blockPath?: string;
  readonly code?: string;
  readonly message: string;
}

/** Ordered: paths first (they hold ids and numbers), then ids, then bare numbers. */
const STRIPS: ReadonlyArray<readonly [RegExp, string]> = [
  // A file path, with an optional `:line:col`.
  [/(?:[A-Za-z]:)?(?:\/[\w.@-]+){2,}(?::\d+)*/g, "<path>"],
  // A uuid.
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>"],
  // `0x` hex.
  [/\b0x[0-9a-f]+\b/gi, "<id>"],
  // A prefixed id (`req_…`, `s-…`, `task_…`) whose tail carries a digit.
  [/\b[a-z]{1,12}[_-](?=[\w-]*\d)[\w-]{4,}\b/gi, "<id>"],
  // Long hex or base36 runs with a digit in them.
  [/\b(?=[0-9a-z]*\d)[0-9a-z]{8,}\b/gi, "<id>"],
  // Any other number.
  [/\b\d+(?:\.\d+)?\b/g, "<n>"]
];

/**
 * A message with its ids, numbers and paths taken out, lower-cased, with
 * whitespace collapsed: what is left is the words that say what went wrong.
 */
export function normalizeErrorMessage(message: string): string {
  let text = message;
  for (const [pattern, mark] of STRIPS) text = text.replace(pattern, mark);
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Hex of the SHA-256 of `text`, first 16 bytes. */
async function digest(text: string): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let hex = "";
  for (const byte of bytes.subarray(0, 16)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/**
 * A failure's fingerprint: a digest of its flow kind, action, block path, code
 * and normalized message.
 */
export async function fingerprintOf(parts: FingerprintParts): Promise<string> {
  return digest(
    JSON.stringify([parts.flowKind, parts.actionName, parts.blockPath ?? "", parts.code ?? "", normalizeErrorMessage(parts.message)])
  );
}
