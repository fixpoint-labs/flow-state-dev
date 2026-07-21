/**
 * Regression: an `allowed`-scoped activator must constrain the matcher tiers,
 * not just the final write. Otherwise a slash hit for a non-allowed skill
 * resolves the turn and starves an allowed skill a later tier would match
 * (e.g. `/draft please research` with `allowed: ["research"]`).
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { createSkillSlashMatch } from "../../src/skills/skill-slash-match";
import { createSkillKeywordMatch } from "../../src/skills/skill-keyword-match";
import { createMockSkillsCollection } from "./mocks";

function seed(
  collection: ReturnType<typeof createMockSkillsCollection>,
  name: string,
  state: Record<string, unknown>,
) {
  collection._store.set(`skills/${name}/SKILL.md`, {
    name: `skills/${name}/SKILL.md`,
    state,
    content: null,
  });
}

function buildCtx(collection: ReturnType<typeof createMockSkillsCollection>) {
  const seqState: Record<string, unknown> = { resolved: false, skills: [] };
  return {
    request: { state: {} },
    session: { state: {} },
    user: {},
    org: {},
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
    sequencer: {
      state: seqState,
      patchState: async (u: Record<string, unknown>) => {
        Object.assign(seqState, u);
      },
    },
    signal: new AbortController().signal,
  } as never;
}

describe("allowed-scoped activator tiers", () => {
  it("slash tier falls through for a non-allowed skill (doesn't resolve)", async () => {
    const c = createMockSkillsCollection();
    seed(c, "draft", { description: "draft" });
    seed(c, "research", { description: "research" });
    const slash = createSkillSlashMatch({ collectionKey: "skills", allowed: ["research"] });
    const ctx = buildCtx(c);

    const out = await runForTest(slash, { message: "/draft please research" }, ctx);
    expect((out as { matched: boolean }).matched).toBe(false);
    // Not resolved → a later tier still gets a chance.
    expect((ctx as { sequencer: { state: { resolved: boolean } } }).sequencer.state.resolved).toBe(
      false,
    );
  });

  it("keyword tier then matches only the allowed skill in the same message", async () => {
    const c = createMockSkillsCollection();
    seed(c, "draft", { description: "draft", keywords: ["draft"] });
    seed(c, "research", { description: "research", keywords: ["research"] });
    const keyword = createSkillKeywordMatch({ collectionKey: "skills", allowed: ["research"] });
    const ctx = buildCtx(c);

    await runForTest(keyword, { message: "/draft please research" }, ctx);
    const skills = (ctx as { sequencer: { state: { skills: Array<{ name: string }> } } }).sequencer
      .state.skills;
    expect(skills.map((s) => s.name)).toEqual(["research"]);
  });
});
