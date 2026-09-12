/**
 * Prompt-file frontmatter is the agent unit for `prompt-ref` (FIX-1370).
 *
 * These tests go through the public surfaces: parseSkillMd already covers
 * dual-write rejection; this file pins load + roster so a file-owned
 * `tools`/`model`/`description` actually reach the worker and the coordinator.
 */
import { describe, expect, it } from "vitest";
import type { AgentSpec, SkillFile } from "@flow-state-dev/core";
import { agentPurpose } from "../../src/skills/delegation-surface";
import { parseAgentPromptFile } from "../../src/skills/internal/agent-prompt-file";

describe("parseAgentPromptFile", () => {
  it("loads tools, model, visibility, context-supply, and description from frontmatter", () => {
    const parsed = parseAgentPromptFile(
      [
        "---",
        "description: Analyzes one competitor.",
        "tools: [search, fetch]",
        "model: openai/gpt-5.4-mini",
        "visibility: sub",
        "context-supply: conversation",
        "---",
        "",
        "You analyze one competitor.",
        "Cite sources.",
      ].join("\n"),
      "analyzer",
    );
    expect(parsed.body).toContain("You analyze one competitor.");
    expect(parsed.body).not.toContain("description:");
    expect(parsed.tuning).toEqual({
      description: "Analyzes one competitor.",
      tools: ["search", "fetch"],
      model: "openai/gpt-5.4-mini",
      itemVisibility: { client: true, history: false },
      contextSupply: "conversation",
    });
  });

  it("treats a body-only file as prompt text with no tuning", () => {
    const parsed = parseAgentPromptFile("You write briefs.\n", "writer");
    expect(parsed.body).toBe("You write briefs.\n");
    expect(parsed.tuning).toEqual({});
  });

  it("rejects an unknown frontmatter key", () => {
    expect(() =>
      parseAgentPromptFile("---\nfoo: bar\n---\n\nbody", "analyzer"),
    ).toThrow(/unknown field `foo`/);
  });
});

describe("agentPurpose — prompt-file description", () => {
  const files: SkillFile[] = [
    {
      path: "reference/analyze.md",
      content: [
        "---",
        "description: Analyzes one competitor.",
        "tools: [search]",
        "---",
        "",
        "You are a competitor analyst who writes long preambles before the work.",
      ].join("\n"),
    },
  ];

  it("prefers frontmatter description over the first body line", () => {
    const spec: AgentSpec = { promptRef: "./reference/analyze.md" };
    expect(agentPurpose(spec, files)).toBe("Analyzes one competitor.");
  });

  it("falls back to the first non-blank body line, capped at 80 chars", () => {
    const spec: AgentSpec = { promptRef: "./reference/plain.md" };
    const plain: SkillFile[] = [
      {
        path: "reference/plain.md",
        content: "You write a one-line brief and nothing else.\n\nMore instructions.",
      },
    ];
    expect(agentPurpose(spec, plain)).toBe("You write a one-line brief and nothing else.");
  });
});
