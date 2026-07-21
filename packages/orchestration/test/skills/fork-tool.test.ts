/**
 * Tests for the fork tool (FIX-919) — `createForkSkillTool` and
 * `buildForkCatalogContext`.
 *
 * The tool resolves a `context: fork` skill from the binding's `allowed` set,
 * substitutes its body, and dispatches the fork subagent (which inherits
 * history via its `history` slot). These drive the router against a mock
 * collection with a mocked model; the fork-generator's inheritance path has its
 * own test.
 */
import { describe, expect, it, vi } from "vitest";
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { runForTest } from "@flow-state-dev/testing";
import {
  buildForkCatalogContext,
  createForkSkillTool,
} from "../../src/skills/fork-tool";
import { createMockSkillsCollection } from "./mocks";

/**
 * Minimal ctx for the fork tool. The dispatched fork generator reads
 * `ctx.session.items.history()` (its `history` slot), so provide an empty
 * history — the inheritance path is covered by fork-generator.test.ts.
 */
function buildCtx(collection: ReturnType<typeof createMockSkillsCollection>) {
  const sessionState: Record<string, unknown> = { activeSkills: [] };
  return {
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: sessionState,
      items: { history: async () => [] },
      patchState: async (updates: Record<string, unknown>) => {
        Object.assign(sessionState, updates);
      },
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
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

function forkSkillEntry(name: string, allowedTools?: string[]) {
  const toolsLine = allowedTools ? `\nallowed-tools: [${allowedTools.join(", ")}]` : "";
  return {
    name: `skills/${name}/SKILL.md`,
    state: {
      description: `${name} skill`,
      contextMode: "fork" as const,
      ...(allowedTools ? { allowedTools } : {}),
    },
    content: `---\ndescription: ${name} skill\ncontext: fork${toolsLine}\n---\n\nResearch $ARGUMENTS thoroughly.`,
  };
}

describe("createForkSkillTool — dispatch", () => {
  it("forks an allowed skill: substituted body, resolved tools, result shape", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/researcher/SKILL.md", forkSkillEntry("researcher", ["webSearch"]));

    const webSearch = handler({
      name: "webSearch",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({}),
      execute: async () => ({}),
    });

    let seenPrompt: string | undefined;
    let seenToolNames: string[] | undefined;
    const generate = vi.fn(
      async (options: {
        messages?: Array<{ role: string; content: string }>;
        tools?: Array<{ name: string }>;
      }) => {
        seenPrompt = options.messages?.find((m) => m.role === "system")?.content;
        seenToolNames = (options.tools ?? []).map((t) => t.name);
        return { text: "forked result" };
      },
    );

    const tool = createForkSkillTool({
      collectionKey: "skills",
      catalog: { webSearch },
      allowed: ["researcher"],
    });
    const ctx = buildCtx(c);
    (ctx as { resolveModel: unknown }).resolveModel = () => ({ modelId: "test", generate });

    const result = await runForTest(tool, { name: "researcher", input: "quantum" }, ctx);

    expect(result.skill).toBe("researcher");
    expect(result.mode).toBe("fork");
    expect(result.result).toBe("forked result");
    // $ARGUMENTS → "quantum"; frontmatter stripped from the system prompt.
    expect(seenPrompt).toContain("Research quantum thoroughly.");
    expect(seenPrompt).not.toContain("---");
    // Only the skill's allowed-tools from the catalog reach the subagent.
    expect(seenToolNames).toEqual(["webSearch"]);
  });

  it("warns on and skips unknown allowed-tools entries", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/misconfig/SKILL.md", forkSkillEntry("misconfig", ["doesNotExist"]));

    let seenToolCount: number | undefined;
    const generate = vi.fn(async (options: { tools?: unknown[] }) => {
      seenToolCount = (options.tools ?? []).length;
      return { text: "done" };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const tool = createForkSkillTool({ collectionKey: "skills", catalog: {} });
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

describe("createForkSkillTool — validation", () => {
  it("rejects a name outside the allowed fork set", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/researcher/SKILL.md", forkSkillEntry("researcher"));
    c._store.set("skills/other/SKILL.md", forkSkillEntry("other"));
    const tool = createForkSkillTool({
      collectionKey: "skills",
      catalog: {},
      allowed: ["researcher"],
    });
    await expect(runForTest(tool, { name: "other" }, buildCtx(c))).rejects.toThrow(
      /not in this generator's allowed fork set/,
    );
  });

  it("rejects an inline skill (fork tool only accepts context: fork)", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/inliney/SKILL.md", {
      name: "skills/inliney/SKILL.md",
      state: { description: "inline skill" },
      content: `---\ndescription: inline skill\n---\n\nbody`,
    });
    const tool = createForkSkillTool({ collectionKey: "skills", catalog: {} });
    await expect(runForTest(tool, { name: "inliney" }, buildCtx(c))).rejects.toThrow(
      /is a inline-mode skill and cannot be forked/,
    );
  });

  it("rejects a disable-model-invocation skill", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/private/SKILL.md", {
      name: "skills/private/SKILL.md",
      state: { description: "private", contextMode: "fork", disableModelInvocation: true },
      content: `---\ndescription: private\ncontext: fork\ndisable-model-invocation: true\n---\n\nbody`,
    });
    const tool = createForkSkillTool({ collectionKey: "skills", catalog: {} });
    await expect(runForTest(tool, { name: "private" }, buildCtx(c))).rejects.toThrow(
      /disable-model-invocation/,
    );
  });
});

describe("buildForkCatalogContext", () => {
  it("lists only fork skills within the allowed set", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/researcher/SKILL.md", forkSkillEntry("researcher"));
    c._store.set("skills/deep-dive/SKILL.md", forkSkillEntry("deep-dive"));
    c._store.set("skills/inliney/SKILL.md", {
      name: "skills/inliney/SKILL.md",
      state: { description: "inline skill" },
      content: `---\ndescription: inline skill\n---\n\nbody`,
    });
    const fn = buildForkCatalogContext({ collectionKey: "skills", allowed: ["researcher"] });
    const out = await fn(undefined, buildCtx(c));
    expect(out).toContain("researcher");
    // Outside the allowed set, and inline skills, are excluded.
    expect(out).not.toContain("deep-dive");
    expect(out).not.toContain("inliney");
  });

  it("returns null when no fork skills are available", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/inliney/SKILL.md", {
      name: "skills/inliney/SKILL.md",
      state: { description: "inline skill" },
      content: `---\ndescription: inline skill\n---\n\nbody`,
    });
    const fn = buildForkCatalogContext({ collectionKey: "skills" });
    expect(await fn(undefined, buildCtx(c))).toBeNull();
  });
});
