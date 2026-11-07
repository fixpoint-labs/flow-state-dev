import { describe, it, expect } from "vitest";
import { createBindingCache } from "@flow-state-dev/core";
import { createClaudeCodeSessionProvider } from "../../src/sdk/session";

describe("createClaudeCodeSessionProvider", () => {
  it("resolves a non-empty key to a session that resumes that id", async () => {
    const provider = createClaudeCodeSessionProvider();
    const session = await provider.resolve("sess_123");
    expect(session.sdkSessionId).toBe("sess_123");
  });

  it("resolves an empty key to a fresh session (null id)", async () => {
    const provider = createClaudeCodeSessionProvider();
    const session = await provider.resolve("");
    expect(session.sdkSessionId).toBeNull();
  });

  it("release is safe to call (no-op)", async () => {
    const provider = createClaudeCodeSessionProvider();
    await expect(provider.release?.("sess_123")).resolves.toBeUndefined();
  });

  it("works when wrapped in createBindingCache", async () => {
    const cached = createBindingCache({
      provider: createClaudeCodeSessionProvider(),
      maxSize: 10,
      ttlMs: 60_000,
    });
    const a = await cached.resolve("sess_abc");
    const b = await cached.resolve("sess_abc");
    expect(a).toBe(b);
    expect(a.sdkSessionId).toBe("sess_abc");
  });
});
