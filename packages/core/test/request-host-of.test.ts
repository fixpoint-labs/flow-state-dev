/**
 * `requestHostOf(ctx)` reads the request host off any context and answers
 * `undefined` when none is wired — what a framework package's optional host
 * reads expect now that `requestHost` is off the public `BlockContext`.
 * `requireRequestHost` is the throwing form, built on it.
 */
import { describe, expect, it } from "vitest";
import { NoRequestHostError, requestHostOf, requireRequestHost } from "../src/internal";
import type { InternalBlockContext, RequestHost } from "../src/internal";

const host = { userDeadlineMs: 1500 } as unknown as RequestHost;

describe("requestHostOf", () => {
  it("is undefined on a hand-built context with no host, where requireRequestHost throws by name", () => {
    expect(requestHostOf({})).toBeUndefined();
    expect(() => requireRequestHost({})).toThrow(NoRequestHostError);
  });

  it("returns the host the engine wired, and requireRequestHost returns the same one", () => {
    const ctx: Pick<InternalBlockContext, "requestHost"> = { requestHost: host };
    expect(requestHostOf(ctx)).toBe(host);
    expect(requireRequestHost(ctx)).toBe(host);
  });
});
