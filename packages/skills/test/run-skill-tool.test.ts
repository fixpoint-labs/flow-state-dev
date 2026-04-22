import { describe, expect, it } from "vitest";
import {
  buildRunSkillDescription,
  createRunSkillTool,
  listEnabledSkills,
} from "../src/run-skill-tool";
import { createMockSkillsCollection } from "./mocks";

function buildCtx(collection: ReturnType<typeof createMockSkillsCollection>) {
  // Minimal BlockContext shape used by run-skill-tool — only the bits the
  // tool actually touches.
  const sessionState: Record<string, unknown> = { __activeSkills: [] };
  return {
    session: {
      identity: { id: "s1", userId: "u1" },
      state: sessionState,
      resources: {
        get: (k: string) => (k === "skills" ? collection : undefined),
        list: () => [collection],
      },
      patchState: async (updates: Record<string, unknown>) => {
        Object.assign(sessionState, updates);
      },
    },
    project: {
      identity: { type: "project" as const, id: "p1" },
      resources: {
        get: (k: string) => (k === "skills" ? collection : undefined),
        list: () => [collection],
      },
    },
    user: { resources: { get: () => undefined, list: () => [] } },
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
      scope: "project",
      catalog: {},
    });
    const ctx = buildCtx(c);
    const result = await tool.run({ name: "pptx", input: "Q2 deck" }, ctx);
    expect(result.skill).toBe("pptx");
    expect(result.mode).toBe("inline");
    expect((ctx as { session: { state: { __activeSkills?: unknown[] } } }).session.state.__activeSkills).toHaveLength(1);
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
      scope: "project",
      catalog: {},
    });
    await expect(tool.run({ name: "missing" }, buildCtx(c))).rejects.toThrow(
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
      scope: "project",
      catalog: {},
    });
    await expect(tool.run({ name: "private" }, buildCtx(c))).rejects.toThrow(
      /disable-model-invocation/,
    );
  });
});
