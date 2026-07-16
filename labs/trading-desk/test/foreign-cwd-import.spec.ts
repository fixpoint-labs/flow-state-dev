/**
 * Regression test for FIX-786: importing the analysis flow (and loading its
 * prompts and fixtures) must work regardless of the process working directory.
 *
 * The prompt and fixture loaders are anchored at module load time; before the
 * fix they resolved against `process.cwd()`, so any entry point started
 * outside the package dir (fsdev run at the repo root, a consumer-repo
 * script) failed at import with PromptFileLoadError. This spec chdirs to a
 * foreign directory FIRST and only then dynamically imports the modules, so
 * their module-level anchoring runs under the foreign cwd. Vitest isolates
 * module registries per spec file, so the fresh imports here don't collide
 * with other specs that import the same modules at the package root.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import os from "node:os";

const ORIGINAL_CWD = process.cwd();

beforeAll(() => {
  process.chdir(os.tmpdir());
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
});

describe("importing the analysis flow from a foreign cwd", () => {
  it("loads a phase prompt through loadPrompt", async () => {
    const { loadPrompt } = await import("../flows/analysis/lib/prompt");
    const pf = loadPrompt("agents/analysts/prompts/fundamentals.prompt.md");
    // A parsed PromptFile with its frontmatter intact proves the load + parse
    // succeeded; don't pin the prompt's copy, which changes independently.
    expect(pf.description).toBeTruthy();
  });

  it("loads a fixture without a rootDir override", async () => {
    const { loadFixture } = await import(
      "../flows/analysis/tools/runtime/fixtures"
    );
    const result = await loadFixture("get_balance_sheet", {
      ticker: "NVDA",
      date: "2026-05-06",
    });
    expect(result.source).toBe("fixture");
    expect(result.ticker).toBe("NVDA");
  });

  it("imports the full flow module", async () => {
    const mod = await import("../flows/analysis/flow");
    // Duck-type the FlowInstance shape (isFlowInstance lives in the CLI
    // package, which trading-desk doesn't depend on).
    const flow = mod.default as { kind?: unknown; actions?: unknown };
    expect(typeof flow.kind).toBe("string");
    expect(typeof flow.actions).toBe("object");
    expect(flow.actions).not.toBeNull();
  });
});
