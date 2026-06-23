/**
 * Constant-time string comparison shared by the webhook signature verifiers
 * (`createHmacVerifier`, `slackWebhookVerifier`). Kept in one place so every
 * signature check uses the same timing-oracle-resistant comparison.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string comparison. Pads both inputs to a common length so the
 * timing-safe comparison itself is constant-time even when the inputs differ
 * in length, then checks the original lengths separately. A final `&` (not
 * `&&`) on the result avoids an early-return shortcut.
 */
export function constantTimeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  const length = Math.max(bufA.length, bufB.length);
  const padA = Buffer.alloc(length);
  const padB = Buffer.alloc(length);
  bufA.copy(padA);
  bufB.copy(padB);
  const sameContent = timingSafeEqual(padA, padB);
  const sameLength = bufA.length === bufB.length;
  return Boolean(Number(sameContent) & Number(sameLength));
}
