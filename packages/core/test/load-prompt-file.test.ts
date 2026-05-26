import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BlockContext } from "../src/types/block";
import {
  loadPromptFile,
  PromptFileLoadError,
} from "../src/prompt/load-prompt-file.node";

function mockCtx(): BlockContext {
  return { session: { state: { recent_news: [] } }, resources: {} } as unknown as BlockContext;
}

describe("loadPromptFile", () => {
  it("loads a prompt file relative to the importer", async () => {
    const pf = loadPromptFile("./fixtures/prompts/analyst.prompt.md", import.meta.url);
    expect(pf.name).toBe("fundamentals-analyst");
    expect(pf._meta.hasUserBlock).toBe(true);
    const out = await pf.prompt({ ticker: "tsla" }, mockCtx());
    expect(out).toContain("Always return a single JSON object");
    expect(out).toContain("Investigate TSLA");
  });

  it("auto-discovers sibling .md files as partials", async () => {
    // analyst.prompt.md uses {% render 'shared-output-preamble' %}; the loader
    // must have registered the sibling shared-output-preamble.md.
    const pf = loadPromptFile("./fixtures/prompts/analyst.prompt.md", import.meta.url);
    const out = await pf.prompt({ ticker: "AAPL" }, mockCtx());
    expect(out).toContain("Always return a single JSON object");
  });

  it("throws PromptFileLoadError for a missing file", () => {
    expect(() =>
      loadPromptFile("./fixtures/prompts/does-not-exist.md", import.meta.url)
    ).toThrow(PromptFileLoadError);
  });

  it("accepts an absolute path (importerUrl ignored)", async () => {
    const abs = fileURLToPath(
      new URL("./fixtures/prompts/analyst.prompt.md", import.meta.url)
    );
    const pf = loadPromptFile(abs, "file:///irrelevant/");
    expect(pf.name).toBe("fundamentals-analyst");
    const out = await pf.prompt({ ticker: "msft" }, mockCtx());
    expect(out).toContain("Investigate MSFT");
  });
});
