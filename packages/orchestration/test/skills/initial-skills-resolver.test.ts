/**
 * `initialSkills` as a per-execution resolver, and the two things it changes.
 *
 * What it buys: two executions of one library seed two different catalogs, so a
 * consumer whose catalog belongs to the INSTANCE rather than the definition has
 * a channel that does not require this layer to know what an instance is.
 *
 * What it costs, and the part a test has to pin: binding a skill BY NAME stops
 * being checkable at build time. That must fail loud. A silent skip is the
 * failure mode worth a test — it would leave a typo'd binding to resolve into
 * nothing at run time, which is exactly what the name check exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { generator } from "@flow-state-dev/core";
import type { DefinedCapability } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { createSkillsLibrary } from "../../src/skills/library";
import { defineSkillsCollection } from "../../src/skills/collection";
import { resolveInitialSkills } from "../../src/skills/initial-skills";

/**
 * Build a generator around one binding. A binding's config resolves when the
 * generator is built, not when `.with()` is called, so that is where a refusal
 * has to be asserted.
 */
const buildWith = (skills: DefinedCapability, config: Record<string, unknown>) =>
  generator({
    name: "g",
    model: "openai/gpt-5.4-mini",
    prompt: "p",
    uses: [skills.with(config as never)],
  });

const skillNamed = (name: string): InitialSkill => ({
  name,
  skillMd: `---\ndescription: The ${name} skill\n---\n\nBody of ${name}.`,
});

/** A context stub carrying just the flow config a resolver reads. */
const ctxWithConfig = (config: Record<string, unknown>): BlockContext =>
  ({ flow: { config } }) as unknown as BlockContext;

describe("initialSkills as a resolver", () => {
  it("resolves a different set per execution", () => {
    const resolver = (ctx: BlockContext): InitialSkill[] =>
      (ctx.flow.config as { own: InitialSkill[] }).own;

    const first = resolveInitialSkills(resolver, ctxWithConfig({ own: [skillNamed("alpha")] }));
    const second = resolveInitialSkills(resolver, ctxWithConfig({ own: [skillNamed("beta")] }));

    expect(first!.map((s) => s.name)).toEqual(["alpha"]);
    expect(second!.map((s) => s.name)).toEqual(["beta"]);
  });

  it("passes a plain array through untouched", () => {
    const skills = [skillNamed("alpha")];
    expect(resolveInitialSkills(skills, ctxWithConfig({}))).toBe(skills);
  });

  it("builds a library that binds no names", () => {
    expect(() =>
      createSkillsLibrary({ initialSkills: (ctx) => (ctx.flow.config as { own: InitialSkill[] }).own }),
    ).not.toThrow();
  });

  // The loud refusal. It must name the RESOLVER as the reason — "unknown skill"
  // would send an author hunting for a typo in a name that may well be correct,
  // and a silent skip would let a binding widen the surface with a name nothing
  // answers to. Asserted where the binding resolves: at the generator build.
  it("refuses `with({ active })` under a resolver, naming why", () => {
    const skills = createSkillsLibrary({ initialSkills: () => [skillNamed("alpha")] });
    expect(() => buildWith(skills, { active: ["alpha"] })).toThrow(/per-execution resolver/);
  });

  it("refuses `with({ allowed })` under a resolver too", () => {
    const skills = createSkillsLibrary({ initialSkills: () => [skillNamed("alpha")] });
    expect(() => buildWith(skills, { allowed: ["alpha"] })).toThrow(/per-execution resolver/);
  });

  // The two empty cases must stay distinguishable. A library with no bundled
  // skills at all still says "pass valid initialSkills"; only a resolver gets
  // the resolver wording, because only one of them is fixable by passing
  // skills.
  it("still gives the no-bundled-skills refusal when there is no resolver", () => {
    const skills = createSkillsLibrary({});
    expect(() => buildWith(skills, { active: ["alpha"] })).toThrow(
      /no bundled skills are available to validate against/,
    );
  });

  // A binding that names nothing is unaffected — which is what the built-in
  // worker kind uses, so this is the path that has to keep working.
  it("builds a binding that names no skills", () => {
    const skills = createSkillsLibrary({ initialSkills: () => [skillNamed("alpha")] });
    expect(() =>
      buildWith(skills, { activeState: { scope: "session", field: "activeSkills" } }),
    ).not.toThrow();
  });
});

describe("defineSkillsCollection flowIsolation", () => {
  it("forwards the flag so each registered copy holds its own catalog", () => {
    const isolated = defineSkillsCollection({ flowIsolation: true }) as unknown as {
      flowIsolation?: boolean;
    };
    expect(isolated.flowIsolation).toBe(true);
  });

  // Omitted, not stamped `false`: a flow that isolates its org state wholesale
  // must keep deciding for a collection that says nothing.
  it("leaves the flag unset when the caller says nothing", () => {
    const plain = defineSkillsCollection({}) as unknown as { flowIsolation?: boolean };
    expect(plain.flowIsolation).toBeUndefined();
  });

  // Session scope is already flow-bound, so the combination is refused upstream
  // — passing it through must not have created a way around that.
  it("still refuses isolation at session scope", () => {
    expect(() => defineSkillsCollection({ scope: "session", flowIsolation: true })).toThrow(
      /session/i,
    );
  });

  it("forwards it through the library's collectionConfig", () => {
    const library = createSkillsLibrary({
      collectionConfig: { flowIsolation: true },
    }) as unknown as { resources: Record<string, { flowIsolation?: boolean }> };
    expect(library.resources.skills!.flowIsolation).toBe(true);
  });
});
