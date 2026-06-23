import { describe, expect, it } from "vitest";
import {
  normalizeDeps,
  supervisorWorkerView,
} from "../flows/chat-agent/shared/prompt-filters";
import { loadPrompt } from "../flows/chat-agent/shared/prompts";

// The <user> renderer ignores ctx (it reads only `input` + the registered
// filters), so a bare stub is enough to exercise the template end to end.
const supervisorWorkerPrompt = loadPrompt(
  "run/thinking-styles/prompts/supervisor-worker.prompt.md",
);
const renderUser = (input: unknown) =>
  supervisorWorkerPrompt.user!(input, {} as any);

describe("normalizeDeps", () => {
  it("passes a raw string dep through as its summary", () => {
    expect(normalizeDeps({ dep1: "raw body" })).toEqual([
      { id: "dep1", summary: "raw body", sources: [] },
    ]);
  });

  it("extracts summary + keeps sources that have a usable url", () => {
    const out = normalizeDeps({
      dep1: {
        summary: "the summary",
        sources: [
          { title: "Docs", url: "https://example.com" },
          { title: "No URL", url: "" }, // dropped — empty url
          { url: "https://untitled.dev" }, // kept, title defaults to ""
        ],
      },
    });
    expect(out).toEqual([
      {
        id: "dep1",
        summary: "the summary",
        sources: [
          { title: "Docs", url: "https://example.com" },
          { title: "", url: "https://untitled.dev" },
        ],
      },
    ]);
  });

  it("falls back to JSON when an object dep has no string summary", () => {
    const value = { result: 42 };
    expect(normalizeDeps({ dep1: value })).toEqual([
      { id: "dep1", summary: JSON.stringify(value), sources: [] },
    ]);
  });

  it("returns [] for non-record input", () => {
    expect(normalizeDeps(undefined)).toEqual([]);
    expect(normalizeDeps(null)).toEqual([]);
    expect(normalizeDeps("nope")).toEqual([]);
  });
});

describe("supervisorWorkerView", () => {
  it("resolves context, then legacy string input, else null", () => {
    expect(supervisorWorkerView({ goal: "g", context: "c" }).context).toBe("c");
    expect(supervisorWorkerView({ goal: "g", input: "legacy" }).context).toBe(
      "legacy",
    );
    expect(supervisorWorkerView({ goal: "g", input: { x: 1 } }).context).toBeNull();
    expect(supervisorWorkerView({ goal: "g" }).context).toBeNull();
  });

  it("normalizes absent feedback to null (not empty string)", () => {
    expect(supervisorWorkerView({ goal: "g" }).feedback).toBeNull();
    expect(supervisorWorkerView({ goal: "g", feedback: "" }).feedback).toBeNull();
    expect(supervisorWorkerView({ goal: "g", feedback: "fix it" }).feedback).toBe(
      "fix it",
    );
  });

  it("always exposes every key so a strict template never reads undefined", () => {
    const view = supervisorWorkerView({});
    expect(Object.keys(view).sort()).toEqual([
      "context",
      "feedback",
      "goal",
      "priorTasks",
    ]);
    expect(view.priorTasks).toEqual([]);
  });
});

describe("supervisor-worker <user> template", () => {
  it("renders goal, context, prior-task deps with sources, and feedback", async () => {
    const out = await renderUser({
      taskId: "t1",
      goal: "Summarize the findings",
      context: "Keep it under 200 words",
      deps: {
        research: {
          summary: "Found three relevant studies",
          sources: [{ title: "Study A", url: "https://a.example" }],
        },
      },
      feedback: "Cite the sources inline",
    });

    expect(out).toContain("Task: Summarize the findings");
    expect(out).toContain("Context: Keep it under 200 words");
    expect(out).toContain("Context from prior tasks:");
    expect(out).toContain("From research:");
    expect(out).toContain("Found three relevant studies");
    expect(out).toContain("Sources used in this task:");
    expect(out).toContain("- Study A: https://a.example");
    expect(out).toContain("Previous feedback: Cite the sources inline");
  });

  it("omits optional sections when absent and handles a raw-string dep", async () => {
    const out = await renderUser({
      taskId: "t2",
      goal: "Do the thing",
      deps: { prior: "just a string result" },
    });

    expect(out).toContain("Task: Do the thing");
    expect(out).toContain("From prior:");
    expect(out).toContain("just a string result");
    // No context / sources / feedback were provided.
    expect(out).not.toContain("Context:");
    expect(out).not.toContain("Sources used in this task:");
    expect(out).not.toContain("Previous feedback:");
  });

  it("falls back to the legacy input-as-context string, but ignores non-string input", async () => {
    const withString = await renderUser({
      taskId: "t3",
      goal: "G",
      input: "legacy context string",
    });
    expect(withString).toContain("Context: legacy context string");

    const withObject = await renderUser({
      taskId: "t4",
      goal: "G",
      input: { not: "a string" },
    });
    expect(withObject).not.toContain("Context:");
  });
});
