/**
 * Whether a request body's media type is JSON.
 */

/**
 * `true` when `contentType`'s essence is `application/json`, ignoring
 * parameters such as `charset` and letter case. A write route uses it to
 * refuse any other type: `text/plain` is CORS-safelisted, so a foreign page
 * can send it without a preflight, while `application/json` can't be.
 */
export function isJsonMediaType(contentType: string | null): boolean {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
