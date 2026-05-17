/**
 * Tests for `selectBashProvider()` — env-driven sandbox provider selection.
 *
 * Covers the behavior matrix from the FIX-587 spec: explicit BASH_PROVIDER
 * opt-in/opt-out, Vercel auto-detect, and the safe `just-bash` fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectBashProvider } from "../flows/chat-agent/blocks/bash-tools";

const VARS = [
  "VERCEL",
  "BASH_PROVIDER",
  "STORE_TYPE",
  "VERCEL_TOKEN",
  "VERCEL_TEAM_ID",
  "VERCEL_PROJECT_ID",
] as const;

describe("selectBashProvider", () => {
  const snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of VARS) snapshot[k] = process.env[k];
    for (const k of VARS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of VARS) {
      if (snapshot[k] === undefined) delete process.env[k];
      else process.env[k] = snapshot[k];
    }
  });

  it("defaults to just-bash with python + javascript when no env is set", () => {
    expect(selectBashProvider()).toEqual({
      type: "just-bash",
      python: true,
      javascript: true,
    });
  });

  it("picks `local` when STORE_TYPE=filesystem and no explicit override", () => {
    process.env.STORE_TYPE = "filesystem";
    expect(selectBashProvider()).toEqual({ type: "local" });
  });

  it("picks `moat` when BASH_PROVIDER=moat", () => {
    process.env.BASH_PROVIDER = "moat";
    expect(selectBashProvider()).toEqual({
      type: "moat",
      persist: true,
      configPath: "./moat.yaml",
    });
  });

  it("explicit BASH_PROVIDER=just-bash forces just-bash even on Vercel with creds", () => {
    process.env.BASH_PROVIDER = "just-bash";
    process.env.VERCEL = "1";
    process.env.VERCEL_TOKEN = "tok";
    process.env.VERCEL_TEAM_ID = "team";
    process.env.VERCEL_PROJECT_ID = "proj";
    expect(selectBashProvider()).toMatchObject({ type: "just-bash" });
  });

  it("explicit BASH_PROVIDER=local forces local", () => {
    process.env.BASH_PROVIDER = "local";
    expect(selectBashProvider()).toEqual({ type: "local" });
  });

  it("explicit BASH_PROVIDER=vercel returns the Vercel provider with the SDK class attached", () => {
    process.env.BASH_PROVIDER = "vercel";
    const p = selectBashProvider();
    expect(p.type).toBe("vercel");
    expect((p as { Sandbox: unknown }).Sandbox).toBeDefined();
  });

  it("on Vercel with the access-token triple, auto-detect picks `vercel`", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_TOKEN = "tok";
    process.env.VERCEL_TEAM_ID = "team";
    process.env.VERCEL_PROJECT_ID = "proj";
    const p = selectBashProvider();
    expect(p.type).toBe("vercel");
    expect((p as { Sandbox: unknown }).Sandbox).toBeDefined();
  });

  it("on Vercel without credentials, falls back to just-bash (the FIX-587 fix)", () => {
    process.env.VERCEL = "1";
    expect(selectBashProvider()).toMatchObject({ type: "just-bash" });
  });

  it("on Vercel with only a partial triple, falls back to just-bash", () => {
    process.env.VERCEL = "1";
    process.env.VERCEL_TOKEN = "tok";
    // missing VERCEL_TEAM_ID and VERCEL_PROJECT_ID
    expect(selectBashProvider()).toMatchObject({ type: "just-bash" });
  });

  it("unknown BASH_PROVIDER values warn and fall through to auto-detect", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.BASH_PROVIDER = "nonsense-value";
    expect(selectBashProvider()).toMatchObject({ type: "just-bash" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/Unknown BASH_PROVIDER/);
    expect(warn.mock.calls[0]![0]).toMatch(/nonsense-value/);
    warn.mockRestore();
  });

  it("module-init smoke test: importing the kitchen-sink bash-tools module succeeds", async () => {
    // The kitchen-sink's `features-capability.ts` calls selectBashProvider()
    // at module-init time. If the selector ever throws, the entire flow
    // registration crashes on cold start. This test guards against that.
    await expect(
      import("../flows/chat-agent/blocks/bash-tools"),
    ).resolves.toBeDefined();
  });
});
