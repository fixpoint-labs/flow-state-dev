/**
 * Shared user-prompt serialization for generator-based utilities.
 */

/**
 * Pass a string through; serialize any other value as 2-space JSON.
 *
 * Generator utilities feed this into the `user` slot so a structured
 * input is readable in the model prompt without each factory copying
 * the same three-line helper.
 */
export function toUserContent(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }

  return JSON.stringify(input, null, 2);
}
