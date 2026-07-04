/**
 * Provider/gateway package-loading behavior of createModelResolver.
 *
 * The loader migrated from synchronous `createRequire` execution to
 * sync availability checks (module resolution) + lazy dynamic `import()`
 * inside the resolved GeneratorModel (AI SDK 7 is ESM-only). These tests pin
 * the externally observable contract across that split:
 *
 * - missing provider package + no gateway → actionable install error
 * - missing provider package + configured gateway → gateway fall-through
 * - `resolveId` reports the candidate the executing path would use
 * - real provider packages load through the real loader (runtime smoke)
 * - `process.cwd()` resolution fallback for pnpm-strict app installs
 *
 * NOTE: these tests rely on `@ai-sdk/google` / `@ai-sdk/anthropic` NOT being
 * installed in this workspace, and `@ai-sdk/openai` being a core
 * devDependency (installed for the runtime smoke).
 */
import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockLanguageModelV3 } from "ai/test";
import { createModelResolver } from "../../src/models/createModelResolver";

function mockGatewayInstance() {
  return {
    languageModel: (id: string) =>
      new MockLanguageModelV3({
        doGenerate: async () => ({
          content: [{ type: "text", text: `via-gateway:${id}` }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
            outputTokens: { total: 3, text: 3, reasoning: undefined },
          },
          warnings: [],
        }),
      }),
  };
}

describe("createModelResolver — provider package loading", () => {
  it("missing provider package with no gateway produces the actionable install error", () => {
    // `@ai-sdk/google` is not installed in this workspace. A key alone makes
    // the provider *detected* but not *loadable*; with no gateway configured
    // the resolver must surface the actionable enumeration, not an opaque
    // module-resolution error.
    const resolver = createModelResolver({ keys: { google: "test-key" } });
    expect(() => resolver("google/gemini-3")).toThrow(
      /No provider available for "google".*Install the provider package/s
    );
  });

  it("falls through to a configured gateway when the provider package is not installed (FIX-609)", async () => {
    // Key present (provider detected) but `@ai-sdk/anthropic` is not
    // installed → the direct path is unavailable at resolution and the
    // configured gateway instance must serve the bare provider/model string.
    const resolver = createModelResolver({
      keys: { anthropic: "test-key" },
      gateways: { vercel: mockGatewayInstance() },
    });
    const model = resolver("anthropic/claude-sonnet-4-6");
    const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
    expect(result.text).toBe("via-gateway:anthropic/claude-sonnet-4-6");
  });

  it("resolveId('intent/…') skips an unavailable first candidate and returns the one the executing path would use", () => {
    // anthropic has a key but its package is not installed and no gateway is
    // configured → unavailable. openai has a key AND an installed package
    // (core devDependency) → available. Both the executing path and
    // `resolveId` must land on the same (second) candidate — availability is
    // decided synchronously via module resolution, not deferred to the lazy
    // package import.
    const resolver = createModelResolver({
      intents: { chat: ["anthropic/claude-sonnet-4-6", "openai/gpt-5.4-mini"] },
      defaultModel: "openai/gpt-5.4-mini",
      keys: { anthropic: "test-key", openai: "test-key" },
    });
    expect(resolver.resolveId("intent/chat")).toBe("openai/gpt-5.4-mini");
    // The executing path resolves without throwing (same winning candidate).
    expect(() => resolver("intent/chat")).not.toThrow();
  });

  it("runtime smoke: resolves a real direct provider id through the real dynamic-import loader", async () => {
    // Typecheck and the mocked suites never execute the loader; this test
    // imports the real `@ai-sdk/openai` package (core devDependency), runs
    // its factory, and constructs a language model. The pre-aborted signal
    // stops the call before any network I/O — an abort-shaped rejection
    // proves the whole load path executed; a "not installed"/"failed to
    // load" rejection would mean the loader broke.
    const resolver = createModelResolver({ keys: { openai: "sk-test-not-real" } });
    const model = resolver("openai/gpt-5.4-mini");

    const controller = new AbortController();
    controller.abort();

    let caught: unknown;
    try {
      await model.generate({
        messages: [{ role: "user", content: "hi" }],
        signal: controller.signal,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const text = `${(caught as Error)?.name}: ${(caught as Error)?.message}`;
    expect(text).not.toMatch(/not installed|failed to load/i);
    expect(text).toMatch(/abort/i);
  });

  it("falls back to process.cwd() resolution for pnpm-strict app installs", async () => {
    // Build a fake app root whose node_modules contains `@ai-sdk/google`
    // (which the workspace does NOT install), exporting the v7 factory name.
    // The loader's own-location resolution fails; the cwd fallback must find
    // and execute the app-installed package.
    const appRoot = mkdtempSync(join(tmpdir(), "fsdev-cwd-fallback-"));
    const pkgDir = join(appRoot, "node_modules", "@ai-sdk", "google");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, "package.json"),
      JSON.stringify({
        name: "@ai-sdk/google",
        version: "0.0.0-test",
        type: "module",
        main: "./index.js",
        exports: { ".": "./index.js" },
      })
    );
    writeFileSync(
      join(pkgDir, "index.js"),
      `export function createGoogle({ apiKey }) {
  return (modelId) => ({
    specificationVersion: "v3",
    provider: "google.generative-ai",
    modelId,
    supportedUrls: {},
    async doGenerate() {
      return {
        content: [{ type: "text", text: "from-cwd-fallback:" + modelId }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 1, text: 1, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
`
    );

    const originalCwd = process.cwd();
    process.chdir(appRoot);
    try {
      // Fresh module instance so the module-scope cwd-anchored resolver picks
      // up the new working directory.
      vi.resetModules();
      const { createModelResolver: createFromAppRoot } = await import(
        "../../src/models/createModelResolver"
      );
      const resolver = createFromAppRoot({ keys: { google: "test-key" } });
      const model = resolver("google/gemini-3");
      const result = await model.generate({ messages: [{ role: "user", content: "hi" }] });
      expect(result.text).toBe("from-cwd-fallback:gemini-3");
    } finally {
      process.chdir(originalCwd);
      vi.resetModules();
      rmSync(appRoot, { recursive: true, force: true });
    }
  });
});
