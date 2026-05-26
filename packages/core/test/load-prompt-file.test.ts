import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BlockContext } from "../src/types/block";
import {
  createPromptLoader,
  loadPromptFile,
  PromptFileLoadError,
} from "../src/prompt/load-prompt-file.node";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/prompts", import.meta.url));

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

describe("createPromptLoader", () => {
  it("loads prompts relative to the captured base dir, no import.meta.url per call", async () => {
    const load = createPromptLoader(FIXTURE_DIR);
    const pf = load("analyst.prompt.md");
    expect(pf.name).toBe("fundamentals-analyst");
    const out = await pf.prompt({ ticker: "nvda" }, mockCtx());
    expect(out).toContain("Investigate NVDA");
  });

  it("applies a shared partialsDir to every load", async () => {
    // analyst.prompt.md renders {% render 'shared-output-preamble' %}; point the
    // partials dir at the fixtures dir explicitly to back it.
    const load = createPromptLoader(FIXTURE_DIR, { partialsDir: FIXTURE_DIR });
    const out = await load("analyst.prompt.md").prompt({ ticker: "AMD" }, mockCtx());
    expect(out).toContain("Always return a single JSON object");
  });

  it("applies the loader's shared filters, and per-call filters override them", async () => {
    const load = createPromptLoader(FIXTURE_DIR, {
      filters: { shout: (v: unknown) => String(v).toUpperCase() },
    });
    const shared = await load("filtered.prompt.md").prompt({ word: "buy" }, mockCtx());
    expect(shared).toBe("BUY");

    const overridden = await load("filtered.prompt.md", {
      filters: { shout: (v: unknown) => `<<${String(v)}>>` },
    }).prompt({ word: "buy" }, mockCtx());
    expect(overridden).toBe("<<buy>>");
  });

  it("throws when baseDir is not absolute", () => {
    expect(() => createPromptLoader("relative/dir")).toThrow(TypeError);
  });
});
