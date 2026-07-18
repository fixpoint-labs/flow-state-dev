import { describe, expect, it } from "vitest";
import { ensureSeeded } from "../../src/skills/seeding";
import { createMockSkillsCollection } from "./mocks";
import type { InitialSkill } from "@flow-state-dev/core";

const linearSkill: InitialSkill = {
  name: "linear",
  skillMd: `---\ndescription: Use when the user wants to manage Linear issues\nallowed-tools: [linear.createIssue]\n---\n\nUse the linear.createIssue tool when asked.`,
};

const codeSkill: InitialSkill = {
  name: "code",
  skillMd: `---\ndescription: Use when writing FSD code\n---\n\nFollow the patterns in reference/fsd-patterns.md.`,
  files: [{ path: "reference/fsd-patterns.md", content: "# Patterns" }],
};

describe("ensureSeeded", () => {
  it("seeds initial skills on first call", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [linearSkill, codeSkill]);

    expect(c._store.has("skills/linear/SKILL.md")).toBe(true);
    expect(c._store.has("skills/code/SKILL.md")).toBe(true);
    expect(c._store.has("skills/code/reference/fsd-patterns.md")).toBe(true);
    expect(c._store.has("skills/_meta")).toBe(true);

    const meta = c._store.get("skills/_meta")!;
    expect(meta.state.seededNames).toContain("linear");
    expect(meta.state.seededNames).toContain("code");
  });

  it("is idempotent on a second call with the same skills", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [linearSkill]);
    const createBefore = (c.create as { mock: { calls: unknown[] } }).mock.calls.length;
    await ensureSeeded(c, [linearSkill]);
    const createAfter = (c.create as { mock: { calls: unknown[] } }).mock.calls.length;
    expect(createAfter).toBe(createBefore);
  });

  it("seeds newly added skills on a later call", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [linearSkill]);
    // Reset memoization by creating a fresh collection — simulates a new
    // process. The seeding sentinel is per-(collection ref), so a different
    // ref triggers a new seed pass. To simulate same ref + new initialSkills,
    // we use the same collection but pass a new list:
    const c2 = createMockSkillsCollection();
    // Copy state into c2 so we look like the same persisted collection.
    for (const [k, v] of c._store) c2._store.set(k, { ...v, state: { ...v.state } });

    await ensureSeeded(c2, [linearSkill, codeSkill]);

    expect(c2._store.has("skills/code/SKILL.md")).toBe(true);
    const meta = c2._store.get("skills/_meta")!;
    expect(meta.state.seededNames).toContain("linear");
    expect(meta.state.seededNames).toContain("code");
  });

  it("respects user deletions — deleted skill name stays in seededNames", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [linearSkill]);
    // User deletes the skill manually.
    c._store.delete("skills/linear/SKILL.md");

    // Simulate a fresh process by passing through a new collection that
    // mirrors persisted state (including _meta).
    const c2 = createMockSkillsCollection();
    for (const [k, v] of c._store) c2._store.set(k, { ...v, state: { ...v.state } });
    await ensureSeeded(c2, [linearSkill]);

    // The deleted skill is NOT re-seeded — the name persists in seededNames.
    expect(c2._store.has("skills/linear/SKILL.md")).toBe(false);
  });

  it("is a no-op when initialSkills is empty/undefined", async () => {
    const c = createMockSkillsCollection();
    await ensureSeeded(c, undefined);
    await ensureSeeded(c, []);
    expect(c._store.size).toBe(0);
  });

  it("skips invalid initial skill names but continues with valid ones", async () => {
    const c = createMockSkillsCollection();
    const bad: InitialSkill = { ...linearSkill, name: "BadName" };
    await ensureSeeded(c, [bad, codeSkill]);
    expect(c._store.has("skills/code/SKILL.md")).toBe(true);
    expect(c._store.has("skills/BadName/SKILL.md")).toBe(false);
  });

  it("rejects malformed SKILL.md before writing anything for that skill", async () => {
    const c = createMockSkillsCollection();
    const bad: InitialSkill = {
      name: "bad",
      skillMd: "not valid frontmatter",
    };
    await ensureSeeded(c, [bad, codeSkill]);
    // The bad skill should not have written anything.
    expect(c._store.has("skills/bad/SKILL.md")).toBe(false);
    // The good skill should still have seeded.
    expect(c._store.has("skills/code/SKILL.md")).toBe(true);
  });

  // Regression: under the original skillStateSchema enum, a pattern skill
  // got persisted with an empty state because the framework's
  // `normalizeResourceState` wiped records that failed schema validation.
  // After the enum widening, fresh seeds work — but already-seeded skills
  // were stuck on the bad state. The re-seed-on-stale path catches them.
  it("re-seeds when the persisted manifest is stale vs. the source SKILL.md", async () => {
    const patternSkill: InitialSkill = {
      name: "team-skill",
      skillMd: `---\ndescription: Multi-worker team\npattern: task-board\nworkers:\n  w:\n    prompt: do the thing\ninitial-tasks:\n  - id: t\n    goal: do it\n    assignee: w\n---\n\nbody`,
    };

    // First seed plants the skill correctly and records it in seededNames.
    const c = createMockSkillsCollection();
    await ensureSeeded(c, [patternSkill]);
    const initialState = c._store.get("skills/team-skill/SKILL.md")!.state;
    expect(initialState.contextMode).toBe("pattern");

    // Simulate the stale-state case: manifest exists, _meta lists it, but
    // contextMode + patternBinding were stripped (what the old schema would
    // have caused). Hand-roll the bad state on a fresh collection.
    const c2 = createMockSkillsCollection();
    for (const [k, v] of c._store) c2._store.set(k, { ...v, state: { ...v.state } });
    const manifest = c2._store.get("skills/team-skill/SKILL.md")!;
    delete manifest.state.contextMode;
    delete manifest.state.patternBinding;

    // Next ensureSeeded should notice the drift and re-write the manifest.
    await ensureSeeded(c2, [patternSkill]);
    const restored = c2._store.get("skills/team-skill/SKILL.md")!.state;
    expect(restored.contextMode).toBe("pattern");
    expect(restored.patternBinding).toBeDefined();
  });
});
