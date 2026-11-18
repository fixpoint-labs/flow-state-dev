import { handler } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { mockGenerator, testBlock } from "@flow-state-dev/testing";
import { describe, expect, it } from "vitest";
import { research, validateResearchReport } from "../src/research";

describe("research report citations", () => {
  it("rejects citations that no completed research task retrieved", () => {
    expect(() =>
      validateResearchReport(
        {
          question: "What changed?",
          summary: "A sourced answer.",
          findings: [{ claim: "The change shipped.", citations: ["https://invented.example/report"] }],
          sources: [{ title: "Invented", url: "https://invented.example/report" }],
        },
        new Set(["https://fixture.example/source"]),
      ),
    ).toThrow(/not retrieved/);
  });

  it("returns a report when every finding cites retrieved evidence", () => {
    const report = {
      question: "What changed?",
      summary: "A sourced answer.",
      findings: [{ claim: "The change shipped.", citations: ["https://fixture.example/source"] }],
      sources: [{ title: "Fixture", url: "https://fixture.example/source" }],
    };

    expect(validateResearchReport(report, new Set(["https://fixture.example/source"]))).toEqual(report);
  });
});

describe("research configuration", () => {
  it("allows a single attempt with either a zero or unused positive retry budget", () => {
    for (const maxTotalRetries of [0, 6]) {
      expect(() => research({ model: "test", maxAttemptsPerTask: 1, maxTotalRetries })).not.toThrow();
    }
  });

  it("requires a fallback model or all three role-specific models", () => {
    expect(() => research({})).toThrow(/provide model or role-specific models/);
    for (const models of [
      { planner: "test" }, { executor: "test" }, { synthesizer: "test" },
      { planner: "test", executor: "test" }, { executor: "test", synthesizer: "test" },
      { planner: "test", synthesizer: "test" },
    ]) {
      expect(() => research({ models })).toThrow(/provide model or role-specific models/);
      expect(() => research({ model: "fallback", models })).not.toThrow();
    }
    expect(() => research({ models: { planner: "p", executor: "e", synthesizer: "s" } })).not.toThrow();
  });
});

// Walk the kit's declared block graph to exercise its blocks without exporting internals.
async function researchRun(toolOverrides = {}) {
  const kit = research({ model: "test", toolOverrides });
  const installed = await kit.definition.install({ config: kit.config, folder: undefined, slots: {} });
  return installed.flows[0]!.actions.run!.block;
}

function findBlock(root: BlockDefinition<any, any>, name: string): BlockDefinition<any, any> {
  const pending = [root];
  const visited = new Set<BlockDefinition<any, any>>();
  while (pending.length > 0) {
    const block = pending.pop()!;
    if (visited.has(block)) continue;
    visited.add(block);
    if (block.name === name) return block;
    pending.push(...(block.childBlocks ?? []), ...(block.staticTools ?? []));
  }
  throw new Error(`Missing research block: ${name}`);
}

const sourceUrl = "https://fixture.example/source";
const draft = { question: "What changed?", summary: "An answer", findings: [], sources: [] };

function runGenerators(retrieve = false) {
  return {
    "research-planner": mockGenerator({ name: "planner", script: [{ structuredOutput: {
      tasks: [{ id: "s1", title: null, goal: "Find evidence", context: null }],
    } }] }),
    "research-executor": mockGenerator({ name: "executor", script: [
      ...(!retrieve ? [] : [{ toolCalls: [{ toolCallId: "fetch-1", toolName: "fetch", args: {} }] }]),
      { structuredOutput: { summary: "Evidence", success: true, reason: "", sources: [] } },
    ] }),
    "research-evaluate-llm": mockGenerator({ name: "evaluator", script: [{ structuredOutput: { decision: "complete", reasoning: "Done" } }] }),
    "research-synthesizer": mockGenerator({ name: "synthesizer", script: [{ structuredOutput: draft }] }),
  };
}

describe("research run provenance", () => {
  it("clears the first run's URLs and attempt counts before a second question", async () => {
    const run = await researchRun({ fetch: handler({ name: "fixture-fetch", execute: () => ({ url: sourceUrl }) }) });
    const first = await testBlock(run, {
      input: { question: "First question" },
      session: { state: { researchRetrievedUrls: [], researchToolAttempts: {} } }, generators: runGenerators(true), unmockedGeneratorPolicy: "error",
    });
    expect(first.error).toBeNull();
    expect(first.output).toEqual(expect.objectContaining({ retrieval: { urls: [sourceUrl], attempts: { fetch: 1 } } }));
    const second = await testBlock(run, {
      input: { question: "Second question" }, session: { state: first.state.session },
      generators: runGenerators(), unmockedGeneratorPolicy: "error",
    });
    expect(second.error).toBeNull();
    expect(second.output).toEqual(expect.objectContaining({ retrieval: { urls: [], attempts: {} } }));

    const staleCitation = await testBlock(run, {
      input: { question: "Second question" }, session: { state: first.state.session },
      generators: {
        ...runGenerators(),
        "research-synthesizer": mockGenerator({ name: "stale-synthesizer", script: [{ structuredOutput: {
          ...draft, findings: [{ claim: "Old evidence", citations: [sourceUrl] }], sources: [{ title: "Old", url: sourceUrl }],
        } }] }),
      },
      unmockedGeneratorPolicy: "error",
    });
    expect(staleCitation.error?.message).toContain(`Research report citation was not retrieved: ${sourceUrl}`);
  });
});

describe("research retrieval tools", () => {
  it.each([
    ["search", { results: [{ url: sourceUrl }, null, {}, { url: 4 }, { url: sourceUrl }] }, [sourceUrl]],
    ["fetch", { url: sourceUrl }, [sourceUrl]],
    ["crawl", { pages: [{ url: sourceUrl }, null, {}, { url: false }, { url: sourceUrl }] }, [sourceUrl]],
    ["search", { results: "invalid" }, []],
    ["fetch", { url: 4 }, []],
    ["crawl", { pages: "invalid" }, []],
    ["search", null, []],
    ["fetch", "invalid", []],
    ["crawl", {}, []],
  ] as const)("records only returned URLs for %s: %j", async (method, output, urls) => {
    const run = await researchRun({ [method]: handler({ name: "fixture-tool", execute: () => output }) });
    const result = await testBlock(findBlock(run, method), {
      input: {}, session: { state: { researchRetrievedUrls: [], researchToolAttempts: { [method]: 1 } } },
    });
    expect(result.error).toBeNull();
    expect(result.output).toEqual(output);
    expect(result.state.session).toMatchObject({
      researchRetrievedUrls: urls, researchToolAttempts: { [method]: 2 },
    });
  });

  it("counts failed attempts without recording a URL, then records a successful retry once", async () => {
    let attempts = 0;
    const run = await researchRun({ fetch: handler({ name: "flaky-fetch", execute: () => {
      if (++attempts === 1) throw new Error("Temporary retrieval failure");
      return { url: sourceUrl };
    } }) });
    const tool = findBlock(run, "fetch");
    const failed = await testBlock(tool, {
      input: {}, session: { state: { researchRetrievedUrls: [], researchToolAttempts: { search: 3 } } },
    });
    expect(failed.error?.message).toContain("Temporary retrieval failure");
    expect(failed.state.session).toMatchObject({ researchRetrievedUrls: [], researchToolAttempts: { search: 3, fetch: 1 } });
    const retried = await testBlock(tool, { input: {}, session: { state: failed.state.session } });
    expect(retried.error).toBeNull();
    expect(retried.state.session).toMatchObject({ researchRetrievedUrls: [sourceUrl], researchToolAttempts: { search: 3, fetch: 2 } });
    const repeated = await testBlock(tool, { input: {}, session: { state: retried.state.session } });
    expect(repeated.error).toBeNull();
    expect(repeated.state.session).toMatchObject({ researchRetrievedUrls: [sourceUrl], researchToolAttempts: { search: 3, fetch: 3 } });
  });
});

describe("research executor provenance", () => {
  it.each([true, false])("accepts a task source only when a tool retrieved it (retrieved: %s)", async (retrieved) => {
    const run = await researchRun();
    const synthesis = findBlock(run, "research-cited-synthesis");
    const task = {
      id: "s1", goal: "Find evidence", status: "completed",
      result: { summary: "Evidence", success: true, reason: "", sources: [{ title: "Evidence", url: sourceUrl }] },
    };
    const result = await testBlock(synthesis, {
      input: { goal: draft.question, status: "completed", tasks: [task], completedSteps: 1, totalSteps: 1 },
      session: { state: { researchRetrievedUrls: retrieved ? [sourceUrl] : [], researchToolAttempts: { fetch: 1 } } },
      // The report itself has no citations: executor sources must be checked independently.
      generators: { "research-synthesizer": mockGenerator({ name: "synth", script: [{ structuredOutput: draft }] }) },
      unmockedGeneratorPolicy: "error",
    });
    if (retrieved) {
      expect(result.error).toBeNull();
      expect(result.output).toMatchObject({ tasks: [task], retrieval: { urls: [sourceUrl], attempts: { fetch: 1 } } });
    } else {
      expect(result.error?.message).toContain(`Research task source was not retrieved: ${sourceUrl}`);
    }
  });
});
