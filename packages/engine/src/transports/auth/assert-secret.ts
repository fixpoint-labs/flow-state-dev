/** Shared validation for configured authentication and signing secrets. */

/** Reject an absent, empty, or non-string secret without exposing its value. */
export function assertSecret(secret: unknown, helper: string): asserts secret is string {
  if (typeof secret !== "string" || secret.length === 0) {
    throw new Error(`${helper}: \`secret\` must be a non-empty string.`);
  }
}
