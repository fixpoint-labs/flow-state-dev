import { describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  buildRunSkillDescription,
  createRunSkillTool,
  listEnabledSkills,
} from "../src/run-skill-tool";
import { createMockSkillsCollection } from "./mocks";

import { runForTest } from "@flow-state-dev/testing";
function buildCtx(collection: ReturnType<typeof createMockSkillsCollection>) {
  // Minimal BlockContext shape used by run-skill-tool — only the bits the
  // tool actually touches. Includes the fields the framework generator
  // needs when the fork branch fires (request.identity, response.emit).
  const sessionState: Record<string, unknown> = { activeSkills: [] };
  return {
    request: {
      identity: { id: "r1", userId: "u1" },
      state: {},
    },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: sessionState,
      patchState: async (updates: Record<string, unknown>) => {
        Object.assign(sessionState, updates);
      },
    },
    org: {
      identity: { type: "org" as const, id: "p1" },
    },
    user: {},
    // Unified resource registry — the collection's intrinsic scope (set on
    // defineSkillsCollection) routes reads/writes; tests don't need per-scope bags.
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
    signal: new AbortController().signal,
    response: { emit: async () => {} },
    resolveModel: () => ({ modelId: "test", generate: async () => ({ text: "ok" }) }),
    cap: {},
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emitMessage: () => {},
    emitComponent: () => {},
    emitStatus: () => {},
  } as never;
}

describe("listEnabledSkills", () => {
  it("returns enabled skills with descriptions", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/foo/SKILL.md", {
      name: "skills/foo/SKILL.md",
      state: { description: "foo skill" },
      content: null,
    });
    c._store.set("skills/bar/SKILL.md", {
      name: "skills/bar/SKILL.md",
      state: { description: "bar skill" },
      content: null,
    });
    const list = listEnabledSkills(c);
    expect(list.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });

  it("excludes skills with disable-model-invocation: true", () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/foo/SKILL.md", {
      name: "skills/foo/SKILL.md",
      state: { description: "foo", disableModelInvocation: true },
      content: null,
    });
    c._store.set("skills/bar/SKILL.md", {
      name: "skills/bar/SKILL.md",
      state: { description: "bar" },
      content: null,
    });
    const list = listEnabledSkills(c);
    expect(list.map((s) => s.name)).toEqual(["bar"]);
  });

  it("ignores supporting files (only SKILL.md entries)", () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/foo/SKILL.md", {
      name: "skills/foo/SKILL.md",
      state: { description: "foo" },
      content: null,
    });
    c._store.set("skills/foo/reference/x.md", {
      name: "skills/foo/reference/x.md",
      state: {},
      content: "# X",
    });
    expect(listEnabledSkills(c).map((s) => s.name)).toEqual(["foo"]);
  });
});

describe("buildRunSkillDescription", () => {
  it("returns the empty-state message when no skills are enabled", () => {
    expect(buildRunSkillDescription([])).toMatch(/No skills/);
  });

  it("lists enabled skills with descriptions", () => {
    const out = buildRunSkillDescription([
      { name: "foo", description: "foo desc" },
      { name: "bar", description: "bar desc" },
    ]);
    expect(out).toContain("- foo: foo desc");
    expect(out).toContain("- bar: bar desc");
  });

  it("omits slash-command guidance — slash routing is handled server-side by createIntentSelector", () => {
    const out = buildRunSkillDescription([
      { name: "foo", description: "foo desc" },
    ]);
    expect(out).not.toMatch(/slash command/i);
    expect(out).not.toContain("/<skill-name>");
  });
});

describe("createRunSkillTool — inline mode", () => {
  it("activates a skill by mutating session state", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/pptx/SKILL.md", {
      name: "skills/pptx/SKILL.md",
      state: { description: "Make slides" },
      content: `---\ndescription: Make slides\n---\n\nCreate $ARGUMENTS`,
    });
    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
    });
    const ctx = buildCtx(c);
    const result = await runForTest(tool, { name: "pptx", input: "Q2 deck" }, ctx);
    expect(result.skill).toBe("pptx");
    expect(result.mode).toBe("inline");
    expect((ctx as { session: { state: { activeSkills?: unknown[] } } }).session.state.activeSkills).toHaveLength(1);
  });

  it("rejects unknown skill names with the available list", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/foo/SKILL.md", {
      name: "skills/foo/SKILL.md",
      state: { description: "foo" },
      content: `---\ndescription: foo\n---\n\nbody`,
    });
    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
    });
    await expect(runForTest(tool, { name: "missing" }, buildCtx(c))).rejects.toThrow(
      /Unknown skill/,
    );
  });

  it("rejects skills with disable-model-invocation: true", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/private/SKILL.md", {
      name: "skills/private/SKILL.md",
      state: { description: "private", disableModelInvocation: true },
      content: `---\ndescription: private\ndisable-model-invocation: true\n---\n\nbody`,
    });
    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
    });
    await expect(runForTest(tool, { name: "private" }, buildCtx(c))).rejects.toThrow(
      /disable-model-invocation/,
    );
  });
});

describe("createRunSkillTool — fork mode", () => {
  it("dispatches to the fork generator with the substituted body and resolved tools", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/researcher/SKILL.md", {
      name: "skills/researcher/SKILL.md",
      state: {
        description: "Research a topic",
        contextMode: "fork",
        allowedTools: ["webSearch"],
      },
      content: `---\ndescription: Research a topic\ncontext: fork\nallowed-tools: [webSearch]\n---\n\nResearch $ARGUMENTS thoroughly.`,
    });

    const webSearch = handler({
      name: "webSearch",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });

    let seenPrompt: string | undefined;
    let seenToolNames: string[] | undefined;
    const generate = vi.fn(async (options: { messages?: Array<{ role: string; content: string }>; tools?: Array<{ name: string }> }) => {
      seenPrompt = options.messages?.find((m) => m.role === "system")?.content;
      seenToolNames = (options.tools ?? []).map((t) => t.name);
      return { text: "forked result" };
    });

    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: { webSearch },
    });

    const ctx = buildCtx(c);
    (ctx as { resolveModel: unknown }).resolveModel = () => ({ modelId: "test", generate });

    const result = await runForTest(tool, { name: "researcher", input: "quantum" }, ctx);

    expect(result.skill).toBe("researcher");
    expect(result.mode).toBe("fork");
    expect(result.result).toBe("forked result");

    // Body substitution happened: $ARGUMENTS → "quantum".
    expect(seenPrompt).toContain("Research quantum thoroughly.");
    // Frontmatter was stripped from the system prompt.
    expect(seenPrompt).not.toContain("---");

    // Only allowed-tools from the catalog are exposed to the subagent.
    expect(seenToolNames).toEqual(["webSearch"]);
  });

  it("warns on and skips unknown allowed-tools entries", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/misconfig/SKILL.md", {
      name: "skills/misconfig/SKILL.md",
      state: {
        description: "Misconfigured fork skill",
        contextMode: "fork",
        allowedTools: ["doesNotExist"],
      },
      content: `---\ndescription: Misconfigured fork skill\ncontext: fork\nallowed-tools: [doesNotExist]\n---\n\nBody`,
    });

    let seenToolCount: number | undefined;
    const generate = vi.fn(async (options: { tools?: unknown[] }) => {
      seenToolCount = (options.tools ?? []).length;
      return { text: "done" };
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tool = createRunSkillTool({
        collectionKey: "skills",
        catalog: {},
      });
      const ctx = buildCtx(c);
      (ctx as { resolveModel: unknown }).resolveModel = () => ({ modelId: "test", generate });

      const result = await runForTest(tool, { name: "misconfig" }, ctx);
      expect(result.mode).toBe("fork");
      expect(seenToolCount).toBe(0);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('unknown tool "doesNotExist"'),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
