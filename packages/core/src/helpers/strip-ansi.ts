/**
 * Remove terminal colour codes from text a person will read.
 */

// A CSI sequence: ESC [, parameter bytes 0x30–0x3F (digits, `:;<=>?`),
// intermediate bytes 0x20–0x2F, then one final byte 0x40–0x7E.
// eslint-disable-next-line no-control-regex
const COLOUR_CODES = /\u001b\[[0-?]*[ -/]*[@-~]/g;

/**
 * `text` with its ANSI control sequences (`ESC [ … final`, the colour and
 * style codes terminals interpret, colon-form SGR included) removed. Text
 * without any comes back as is.
 */
export function stripAnsi(text: string): string {
  return text.replace(COLOUR_CODES, "");
}
