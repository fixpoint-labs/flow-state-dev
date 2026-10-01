/**
 * Shared setup for the bullmq tests that need a real Redis.
 *
 * They run when `REDIS_URL` is set. Without it they skip locally, and fail in
 * CI (`CI` set), so a CI job that lost its Redis service cannot pass by
 * skipping the only tests that exercise the queue path.
 */
import { randomUUID } from "node:crypto";
import { describe, it } from "vitest";

/** The Redis these tests talk to, or `undefined` when none was given. */
export const REDIS_URL = process.env.REDIS_URL;

/** `describe` for a suite that needs Redis: runs, skips, or fails as above. */
export function describeWithRedis(name: string, body: () => void): void {
  if (REDIS_URL !== undefined && REDIS_URL !== "") {
    describe(name, body);
    return;
  }
  if (process.env.CI) {
    describe(name, () => {
      it("needs a Redis", () => {
        throw new Error(
          "REDIS_URL is not set. In CI these cases fail rather than skip: give the job a Redis service."
        );
      });
    });
    return;
  }
  describe.skip(name, body);
}

/** A prefix of its own for one test, so its keys and queues never meet another's. */
export function isolatedPrefix(): string {
  return `t1634-${randomUUID().slice(0, 8)}`;
}

/** Poll until `probe` is true, or fail naming `what`. */
export async function until(
  probe: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 15_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
