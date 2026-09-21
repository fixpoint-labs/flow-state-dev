/**
 * The skills domain's projection into the discovery door (FIX-817).
 *
 * Graded on one question throughout: does the door advertise exactly what
 * `loadSkill` will accept? Every case here is a skill the catalog could list
 * and the load tool would then refuse, which is the failure a discovery
 * surface built on `listEnabledSkills` alone would ship with — a model that
 * calls what it was told exists and gets an error back has been sent somewhere
 * by the catalog, and it has no way to learn otherwise.
 *
 * The refusals the load tool makes, and where each is proved:
 *
 *   - `disable-model-invocation`  → BR-7   ("refuses to load", below)
 *   - not `inline` mode           → BR-7a  (fork/pattern skills)
 *   - outside the binding's set   → BR-7a  (`allowed`)
 */
import { describe, expect, it } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import { createLoadSkillTool } from "../../src/skills/load-tool";
import { skillsManifestSource } from "../../src/skills/manifest-source";
import { createMockSkillsCollection } from "./mocks";

type Collection = ReturnType<typeof createMockSkillsCollection>;

/**
 * A ctx with one skills collection mounted, and nothing else the source reads.
 *
 * Session state is writable because the load tool below writes an activation
 * to it on the one call it accepts — a ctx that could not take the write would
 * make the accepting case indistinguishable from a refusal.
 */
function buildCtx(collection: Collection, key = "skills"): never {
  const sessionState: Record<string, unknown> = {};
  return {
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: sessionState,
      patchState: async (updates: Record<string, unknown>) => {
        Object.assign(sessionState, updates);
      },
      atomicState: async (updater: (s: Record<string, unknown>) => Record<string, unknown>) => {
        Object.assign(sessionState, await updater({ ...sessionState }));
      },
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: {
      [key]: collection,
      get: (k: string) => (k === key ? collection : undefined),
      list: () => [collection],
    },
    signal: new AbortController().signal,
    response: { emit: async () => {} },
    cap: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  } as never;
}

function put(
  collection: Collection,
  name: string,
  state: Record<string, unknown>,
): void {
  collection._store.set(`skills/${name}/SKILL.md`, {
    name: `skills/${name}/SKILL.md`,
    state,
    content: null,
  });
}

/** Every skill the catalog shipped, by id. */
async function ids(
  source: ReturnType<typeof skillsManifestSource>,
  ctx: never,
): Promise<string[]> {
  return (await source.entries(ctx)).map((entry) => entry.id).sort();
}

/**
 * What `loadSkill` says when asked for `name` — the message, or `null` when it
 * accepted the call.
 *
 * The point of asking the real tool rather than restating its rules: a catalog
 * that filters on a rule the tool has since changed is a catalog that lies
 * again, and this check would go red where a hand-written expectation would
 * stay green.
 */
async function loadRefusal(ctx: never, name: string, allowed?: string[]): Promise<string | null> {
  const tool = createLoadSkillTool({
    collectionKey: "skills",
    // Explicit session storage rather than the block-state default: this ctx
    // is a bare object with no host generator, and the default path refuses
    // for want of one. Where the activation lands is not what is being
    // graded — whether the tool accepts the name is.
    location: { kind: "explicit", scope: "session", field: "activeSkills" },
    ...(allowed ? { allowed } : {}),
  });
  try {
    await runForTest(tool as never, { name } as never, ctx);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

describe("the skills manifest source advertises only what loadSkill accepts", () => {
  it("lists an enabled inline skill, with its description as the purpose line", async () => {
    const collection = createMockSkillsCollection();
    put(collection, "triage", { description: "Sorts incoming reports by severity." });
    const ctx = buildCtx(collection);

    const entries = await skillsManifestSource().entries(ctx);

    expect(entries).toEqual([
      {
        id: "triage",
        kind: "skill",
        purpose: "Sorts incoming reports by severity.",
        contract: 'If you have a `loadSkill` tool, load it with loadSkill({ name: "triage" }).',
      },
    ]);
    // The other half of the claim: the tool really does accept it. Without
    // this the case is only "the source returned a row".
    expect(await loadRefusal(ctx, "triage")).toBeNull();
  });

  it("BR-7 · withholds a disable-model-invocation skill, which loadSkill refuses", async () => {
    const collection = createMockSkillsCollection();
    put(collection, "open", { description: "Anyone may load this." });
    put(collection, "draft", { description: "Private.", disableModelInvocation: true });
    const ctx = buildCtx(collection);

    expect(await ids(skillsManifestSource(), ctx)).toEqual(["open"]);
    expect(await loadRefusal(ctx, "draft")).toMatch(/disable-model-invocation/);
  });

  it("BR-7a · withholds a fork/pattern skill, which loadSkill refuses", async () => {
    const collection = createMockSkillsCollection();
    put(collection, "inline-one", { description: "Loadable." });
    put(collection, "forked", { description: "Dispatched.", contextMode: "fork" });
    const ctx = buildCtx(collection);

    expect(await ids(skillsManifestSource(), ctx)).toEqual(["inline-one"]);
    expect(await loadRefusal(ctx, "forked")).toMatch(/cannot be loaded inline/);
  });

  it("BR-7a · withholds a skill outside the binding's allowed set, which loadSkill refuses", async () => {
    const collection = createMockSkillsCollection();
    put(collection, "permitted", { description: "In the set." });
    put(collection, "excluded", { description: "Enabled, inline, and not in the set." });
    const ctx = buildCtx(collection);

    // The refused case is the one that matters: `excluded` passes every filter
    // `listEnabledSkills` applies, so a source built on that reader alone
    // would advertise it.
    expect(await ids(skillsManifestSource({ allowed: ["permitted"] }), ctx)).toEqual([
      "permitted",
    ]);
    expect(await loadRefusal(ctx, "excluded", ["permitted"])).toMatch(/not in this generator/);
  });

  it("falls back to the skill's name when its file declares no description", async () => {
    const collection = createMockSkillsCollection();
    put(collection, "bare", {});
    const [entry] = await skillsManifestSource().entries(buildCtx(collection));
    expect(entry!.purpose).toBe('Skill "bare".');
  });

  it("reports a problem rather than an empty catalog when the collection is not mounted", async () => {
    // A different key AND a different pattern: `resolveResourceCollection`
    // falls back to a pattern-prefix scan, so a collection still patterned
    // `skills/**` would be found under any key and this case would prove
    // nothing.
    const collection = createMockSkillsCollection("library/**");
    collection._store.set("library/triage/SKILL.md", {
      name: "library/triage/SKILL.md",
      state: { description: "Sorts reports." },
      content: null,
    });
    const ctx = buildCtx(collection, "library");

    await expect(skillsManifestSource().entries(ctx)).rejects.toThrow(
      /Skills collection "skills" is not registered/,
    );
  });
});
