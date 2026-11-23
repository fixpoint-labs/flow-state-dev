/**
 * Remove terminal colour codes from text a person will read.
 */

// eslint-disable-next-line no-control-regex
const COLOUR_CODES = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * `text` with its ANSI control sequences (`ESC [ … final`, the colour and
 * style codes terminals interpret) removed. Text without any comes back as is.
 */
export function stripAnsi(text: string): string {
  return text.replace(COLOUR_CODES, "");
}
