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
    emit: { message: () => {}, component: () => {}, status: () => {} },
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
    const list = await listEnabledSkills(c);
    expect(list.map((s) => s.name).sort()).toEqual(["bar", "foo"]);
  });

  it("excludes skills with disable-model-invocation: true", async () => {
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
    const list = await listEnabledSkills(c);
    expect(list.map((s) => s.name)).toEqual(["bar"]);
  });

  it("ignores supporting files (only SKILL.md entries)", async () => {
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
    expect((await listEnabledSkills(c)).map((s) => s.name)).toEqual(["foo"]);
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

  it("omits slash-command guidance — slash routing is handled server-side by createSkillActivator", () => {
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

// ---------------------------------------------------------------------------
// Pattern mode — FIX-450
// ---------------------------------------------------------------------------

import { createPatternRegistry, type PatternFactory } from "../src/pattern-registry";
import { handler as h2 } from "@flow-state-dev/core";

/** Helper: a deterministic factory whose materialized block records the dispatch. */
function recordingFactory(opts: { key: string; impl?: () => void }): PatternFactory {
  return {
    key: opts.key,
    configSchema: z.object({}).passthrough(),
    async fromConfig(_binding, deps) {
      opts.impl?.();
      const block = h2({
        name: "recorded-block",
        inputSchema: z.unknown(),
        outputSchema: z.object({ skill: z.string() }),
        execute: async () => ({ skill: deps.skillName }),
      });
      return {
        block: block as never,
        collectionId: deps.collectionId,
        backing: "request",
      };
    },
  };
}

describe("createRunSkillTool — pattern mode", () => {
  it("dispatches a pattern skill through the pattern route", async () => {
    let dispatched = false;
    const factory = recordingFactory({ key: "task-board", impl: () => (dispatched = true) });
    const c = createMockSkillsCollection();
    c._store.set("skills/research/SKILL.md", {
      name: "skills/research/SKILL.md",
      state: {
        description: "Research stuff",
        contextMode: "pattern",
        patternBinding: {
          pattern: "task-board",
          workers: { w: { prompt: "do" } },
          initialTasks: [{ id: "t", goal: "x", assignee: "w" }],
        },
      },
      content: "---\ndescription: Research stuff\n---\n\nbody",
    });
    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
      patternRegistry: createPatternRegistry([factory]),
    });
    const ctx = buildCtx(c);
    const result = await runForTest(tool, { name: "research" }, ctx);
    expect(dispatched).toBe(true);
    expect(result.mode).toBe("pattern");
    expect(result.skill).toBe("research");
    const activeSkills = (ctx as {
      session: {
        state: {
          activeSkills?: Array<{
            mode: string;
            pattern?: { patternKey: string; collectionId: string; backing: string };
          }>;
        };
      };
    }).session.state.activeSkills;
    expect(activeSkills?.[0]?.mode).toBe("pattern");
    expect(activeSkills?.[0]?.pattern?.patternKey).toBe("task-board");
    // Unique-per-activation id: skill_<name>_<requestId>_<n>
    expect(activeSkills?.[0]?.pattern?.collectionId).toMatch(/^skill_research_r1_1$/);
    expect(activeSkills?.[0]?.pattern?.backing).toBe("request");
  });

  it("fails with a clear error when pattern mode is used but no registry was wired", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/research/SKILL.md", {
      name: "skills/research/SKILL.md",
      state: {
        description: "Research",
        contextMode: "pattern",
        patternBinding: {
          pattern: "task-board",
          workers: { w: { prompt: "do" } },
          initialTasks: [{ id: "t", goal: "x", assignee: "w" }],
        },
      },
      content: "---\ndescription: Research\n---\n\nbody",
    });
    const tool = createRunSkillTool({ collectionKey: "skills", catalog: {} });
    await expect(runForTest(tool, { name: "research" }, buildCtx(c))).rejects.toThrow(
      /no patternRegistry/,
    );
  });

  it("fails with a clear error when binding.pattern misses the registry", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/research/SKILL.md", {
      name: "skills/research/SKILL.md",
      state: {
        description: "Research",
        contextMode: "pattern",
        patternBinding: {
          pattern: "no-such-pattern",
          workers: { w: { prompt: "do" } },
          initialTasks: [{ id: "t", goal: "x", assignee: "w" }],
        },
      },
      content: "---\ndescription: Research\n---\n\nbody",
    });
    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
      patternRegistry: createPatternRegistry([recordingFactory({ key: "task-board" })]),
    });
    await expect(runForTest(tool, { name: "research" }, buildCtx(c))).rejects.toThrow(
      /not in registry/,
    );
  });

  it("rejects unknown pattern-config keys via the factory schema", async () => {
    const strictFactory: PatternFactory = {
      key: "task-board",
      configSchema: z.object({ concurrency: z.number().optional() }).strict(),
      async fromConfig(_binding, deps) {
        const block = h2({
          name: "noop",
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          execute: async () => ({}),
        });
        return { block: block as never, collectionId: `skill_${deps.skillName}`, backing: "request" };
      },
    };
    const c = createMockSkillsCollection();
    c._store.set("skills/r/SKILL.md", {
      name: "skills/r/SKILL.md",
      state: {
        description: "x",
        contextMode: "pattern",
        patternBinding: {
          pattern: "task-board",
          workers: { w: { prompt: "do" } },
          initialTasks: [{ id: "t", goal: "x", assignee: "w" }],
          patternConfig: { bogusKey: 1 },
        },
      },
      content: "---\ndescription: x\n---\n\nbody",
    });
    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
      patternRegistry: createPatternRegistry([strictFactory]),
    });
    await expect(runForTest(tool, { name: "r" }, buildCtx(c))).rejects.toThrow(
      /rejected by schema/,
    );
  });
});

