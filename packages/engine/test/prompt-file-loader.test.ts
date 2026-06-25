import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core";
import {
  createPromptLoader,
  loadPromptFile,
  moduleDir,
  PromptFileLoadError,
  resolveBaseDir,
} from "../src/prompt-file-loader";

const FIXTURE_DIR = fileURLToPath(new URL("./fixtures/prompts", import.meta.url));
const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));

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

describe("moduleDir", () => {
  it("returns the module's own directory for a file: URL", () => {
    expect(moduleDir(import.meta.url)).toBe(TEST_DIR);
  });

  it("walks the optional relative path", () => {
    expect(moduleDir(import.meta.url, "./fixtures/prompts")).toBe(FIXTURE_DIR);
    expect(moduleDir(import.meta.url, "..")).toBe(path.dirname(TEST_DIR));
  });

  it("returns undefined for non-file: schemes (bundler-rewritten URLs)", () => {
    expect(moduleDir("turbopack://[project]/src/flows/x.js")).toBeUndefined();
    expect(moduleDir("https://example.com/chunk.js")).toBeUndefined();
  });

  it("returns undefined for an unparseable URL", () => {
    expect(moduleDir("not a url at all")).toBeUndefined();
  });
});

describe("resolveBaseDir", () => {
  it("returns the first existing candidate", () => {
    const missing = path.join(TEST_DIR, "does-not-exist");
    expect(resolveBaseDir([missing, TEST_DIR])).toBe(TEST_DIR);
  });

  it("prefers the earlier candidate when several qualify", () => {
    // The heart of the anchoring idiom: the module-relative candidate must
    // beat the cwd fallback whenever both directories exist.
    expect(resolveBaseDir([TEST_DIR, FIXTURE_DIR])).toBe(TEST_DIR);
  });

  it("skips candidates whose moduleDir came back undefined (bundler-rewritten URL)", () => {
    expect(
      resolveBaseDir([moduleDir("turbopack://[project]/x.js"), FIXTURE_DIR])
    ).toBe(FIXTURE_DIR);
  });

  it("rejects an existing directory that lacks the expect probe", () => {
    // FIXTURE_DIR exists but contains no nested fixtures/prompts; TEST_DIR does.
    expect(
      resolveBaseDir([FIXTURE_DIR, TEST_DIR], { expect: "fixtures/prompts" })
    ).toBe(TEST_DIR);
  });

  it("throws TypeError on a relative candidate", () => {
    expect(() => resolveBaseDir(["relative/dir"])).toThrow(TypeError);
  });

  it("validates every candidate eagerly, even after a qualifying one", () => {
    // A malformed fallback must fail in every runtime, not only in the
    // runtime where the earlier candidates happen to miss.
    expect(() => resolveBaseDir([TEST_DIR, "relative/dir"])).toThrow(TypeError);
  });

  it("throws an Error listing every rejected candidate when none qualifies", () => {
    const missing = path.join(TEST_DIR, "does-not-exist");
    let message = "";
    try {
      resolveBaseDir([undefined, missing, FIXTURE_DIR], { expect: "nope" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain("no candidate directory qualified");
    expect(message).toContain(`${missing} (does not exist)`);
    expect(message).toContain(`${FIXTURE_DIR} (missing "nope")`);
    expect(message).toContain("Undefined candidates were skipped");
  });
});
