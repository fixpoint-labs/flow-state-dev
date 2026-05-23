/**
 * String-case utilities for normalizing identifiers (notably XML tag names
 * authored in different conventions). Pure functions, no runtime dependencies.
 */

/**
 * Convert a camelCase string to kebab-case.
 *
 * @example
 * camelToKebab("userPreferences") // "user-preferences"
 * camelToKebab("documents")       // "documents"
 */
export function camelToKebab(key: string): string {
  return key.replace(/([A-Z])/g, "-$1").replace(/^-/, "").toLowerCase();
}

/**
 * Normalize an authored tag name (camelCase, snake_case, or kebab-case) to
 * the canonical kebab-case form. Used before tag-name aggregation so that
 * `userPreferences`, `user_preferences`, and `user-preferences` all collapse
 * to the same canonical key.
 *
 * @example
 * normalizeTagName("documents")        // "documents"
 * normalizeTagName("userPreferences")  // "user-preferences"
 * normalizeTagName("user_preferences") // "user-preferences"
 * normalizeTagName("user-preferences") // "user-preferences"
 */
export function normalizeTagName(key: string): string {
  return camelToKebab(key.replace(/_/g, "-"))
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
