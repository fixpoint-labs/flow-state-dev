import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import { handler } from "@flow-state-dev/core";
import { research } from "@flow-state-dev/patterns/research";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import { z } from "zod";

const url = "https://fixture.example/research";
let fetchAttempts = 0;
const search = handler({ name: "search", inputSchema: z.any(), execute: (input) => ({ query: input.query, results: [{ title: "Fixture", url, snippet: "Evidence", source: "tavily" }] }) });
const fetch = handler({
  name: "fetch", inputSchema: z.any(),
  execute: (input) => {
    fetchAttempts += 1;
    if (fetchAttempts === 1 || process.env.GOAL_CONTROL === "no-rescue") throw new Error("injected flaky fetch");
    return { url: input.url, title: "Fixture", markdown: "The fixture documents the result.", metadata: { statusCode: 200, contentType: "text/html", wordCount: 6 }, source: "builtin" };
  },
});
const crawl = handler({ name: "crawl", inputSchema: z.any(), execute: (input) => ({
  rootUrl: input.url,
  pages: [{ url: input.url, title: "Fixture section", markdown: "More fixture evidence.", metadata: { statusCode: 200, contentType: "text/html", wordCount: 3 }, source: "builtin" }],
  totalPages: 1, crawlDepth: 1, source: "builtin",
}) });

const invented = process.env.GOAL_CONTROL === "invent-citation";
const models = createMockModelResolver({
  generators: {
    "research-planner": mockGenerator({ name: "planner", script: [{ structuredOutput: { tasks: [{ id: "evidence", title: null, goal: "Find and read the fixture evidence", context: null }] } }] }),
    "research-executor": mockGenerator({ name: "executor", script: [
      { toolCalls: [{ toolCallId: "s1", toolName: "search", args: { query: "fixture evidence", maxResults: 5, topic: "general" } }, { toolCallId: "f1", toolName: "fetch", args: { url } }] },
      { toolCalls: [{ toolCallId: "s2", toolName: "search", args: { query: "fixture evidence", maxResults: 5, topic: "general" } }, { toolCallId: "f2", toolName: "fetch", args: { url } }, { toolCallId: "c2", toolName: "crawl", args: { url, maxPages: 2, maxDepth: 1 } }] },
      { structuredOutput: { summary: "The fixture documents the result.", success: true, reason: "", sources: [{ title: "Fixture", url: process.env.GOAL_CONTROL === "invent-executor-source" ? "https://invented.example/executor" : url, method: "fetch" }] } },
    ] }),
    "research-evaluate-llm": mockGenerator({ name: "evaluator", script: [{ structuredOutput: { decision: "complete", reasoning: "enough evidence" } }] }),
    "research-synthesizer": mockGenerator({ name: "synthesizer", script: [{ structuredOutput: {
      question: "What does the fixture document?", summary: "The fixture documents the result.",
      findings: [{ claim: "The fixture documents the result.", citations: [invented ? "https://invented.example/report" : url] }],
      sources: [{ title: "Fixture", url: invented ? "https://invented.example/report" : url }],
    } }] }),
  },
  policy: "error",
});

export default createFlowState({
  kits: [research({ model: "fixture/model", toolOverrides: { search, fetch, crawl }, maxAttemptsPerTask: 2 })],
  root: import.meta.url,
  stores: { default: { primary: inMemoryStores() } },
  modelResolver: models,
});
