import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { createApplySkillActivation } from "../../src/skills/apply-skill-activation";
import { createMockSkillsCollection } from "./mocks";

/**
 * Apply-intent reads matched-skill names from sequencer state and writes
 * activeSkills entries to session state. The mode of each entry is the
 * matched skill's `contextMode` from the collection (or `"inline"` when
 * undeclared) so the badge and `runSkill` dispatch route line up.
 */
function buildCtx(opts: {
  collection: ReturnType<typeof createMockSkillsCollection>;
  matched: Array<{ name: string; source: string; input?: string }>;
}) {
  const sessionState: Record<string, unknown> = { activeSkills: [] };
  return {
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: sessionState,
      patchState: async (updates: Record<string, unknown>) => {
        Object.assign(sessionState, updates);
      },
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: {
      skills: opts.collection,
      get: (k: string) => (k === "skills" ? opts.collection : undefined),
      list: () => [opts.collection],
    },
    sequencer: { state: { skills: opts.matched } },
    signal: new AbortController().signal,
    response: { emit: async () => {} },
    cap: {},
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}

describe("createApplySkillActivation — honors each skill's contextMode", () => {
  it("stamps inline mode when the skill omits contextMode", async () => {
    const c = createMockSkillsCollection();
    c._store.set("skills/legacy/SKILL.md", {
      name: "skills/legacy/SKILL.md",
      state: { description: "legacy" },
      content: null,
    });
    const handler = createApplySkillActivation();
    const ctx = buildCtx({
      collection: c,
      matched: [{ name: "legacy", source: "keyword" }],
    });
    await runForTest(handler, { message: "x" }, ctx);
    const entries = (ctx as { session: { state: { activeSkills?: Array<{ mode: string }> } } })
      .session.state.activeSkills;
    expect(entries?.[0]?.mode).toBe("inline");
  });

  it("writes to an explicit activeState field and filters to the allowed set", async () => {
    const c = createMockSkillsCollection();
    for (const n of ["bound", "unbound"]) {
      c._store.set(`skills/${n}/SKILL.md`, {
        name: `skills/${n}/SKILL.md`,
        state: { description: n },
        content: null,
      });
    }
    const handler = createApplySkillActivation({
      activeState: { scope: "session", field: "activeAnalystSkills" },
      allowed: ["bound"],
    });
    const ctx = buildCtx({
      collection: c,
      matched: [
        { name: "bound", source: "slash" },
        { name: "unbound", source: "keyword" }, // outside allowed → dropped
      ],
    });
    await runForTest(handler, { message: "/bound" }, ctx);
    const state = (ctx as { session: { state: Record<string, Array<{ name: string }>> } }).session
      .state;
    // Legacy slot untouched; the bound skill lands in the explicit field only.
    expect(state.activeSkills ?? []).toHaveLength(0);
    expect(state.activeAnalystSkills).toHaveLength(1);
    expect(state.activeAnalystSkills[0]!.name).toBe("bound");
  });
});
