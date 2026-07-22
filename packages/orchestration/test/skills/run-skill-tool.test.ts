import { describe, expect, it } from "vitest";
import {
  buildRunSkillDescription,
  createRunSkillTool,
  listEnabledSkills,
} from "../../src/skills/run-skill-tool";
import { createMockSkillsCollection } from "./mocks";

import { runForTest } from "@flow-state-dev/testing";
function buildCtx(collection: ReturnType<typeof createMockSkillsCollection>) {
  // Minimal BlockContext shape used by run-skill-tool — only the bits the
  // tool actually touches (request.identity, session state, response.emit).
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
