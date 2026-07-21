/**
 * Tests for the Skills v2 per-generator binding (FIX-911): `createSkillsLibrary`
 * + `.config({ active, allowed, activeState })` + `.presets({ dynamicActivation })`.
 *
 * The core guarantee is isolation: a skill bound to one generator never appears
 * in another's context, and a dynamic activation is request-scoped by default
 * (no carry into the next turn). These drive the real `generator({ uses })`
 * build path and then execute the assembled context/tool surface against a
 * mock skills collection — no model in the loop.
 */
import { describe, expect, it } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import { z } from "zod";
import { createSkillsLibrary } from "../../src/skills/library";
import { createMockSkillsCollection } from "./mocks";

/** Resolve a generator's assembled tools (the merged surface is a function). */
async function resolveTools(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<Array<{ name: string; execute?: Function; config?: { execute?: Function } }>> {
  const tools = (gen.config as { tools?: unknown }).tools;
  if (typeof tools === "function") return (await (tools as Function)(ctx)) ?? [];
  return (tools as never[]) ?? [];
}

const inlineSkill = (name: string, body: string, allowedTools?: string[]): InitialSkill => ({
  name,
  skillMd: [
    "---",
    `description: ${name} skill`,
    ...(allowedTools ? [`allowed-tools: [${allowedTools.join(", ")}]`] : []),
    "---",
    "",
    body,
  ].join("\n"),
});

/** Recursively collect every function found in an assembled `context` value. */
function collectContextFns(value: unknown, out: Array<(i: unknown, c: unknown) => unknown>): void {
  if (typeof value === "function") {
    out.push(value as (i: unknown, c: unknown) => unknown);
  } else if (Array.isArray(value)) {
    for (const v of value) collectContextFns(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectContextFns(v, out);
  }
}

function buildReaderCtx(
  collection: ReturnType<typeof createMockSkillsCollection>,
  overrides: Record<string, unknown> = {},
) {
  return {
    session: { state: {} },
    user: { state: {} },
    request: { state: {} },
    self: { state: {} },
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
    ...overrides,
  } as never;
}

/** Build a generator via the real `uses` path and render its assembled skills context. */
async function renderGeneratorSkills(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<string> {
  const fns: Array<(i: unknown, c: unknown) => unknown> = [];
  collectContextFns((gen.config as { context?: unknown }).context, fns);
  const parts: string[] = [];
  for (const fn of fns) {
    const out = await fn(undefined, ctx);
    if (typeof out === "string") parts.push(out);
  }
  return parts.join("\n");
}

describe("createSkillsLibrary — shape", () => {
  it("returns a branded capability with a config resolver and dynamicActivation preset", () => {
    const skills = createSkillsLibrary();
    expect(skills.__brand).toBe("Capability");
    expect(skills.name).toBe("skills");
    expect(skills.__configDef).toBeDefined();
    expect(skills.__presetDefs?.dynamicActivation).toBeDefined();
  });

  it("registers the skills collection at org scope by default", () => {
    const skills = createSkillsLibrary();
    expect((skills.resources?.skills as { scope?: string }).scope).toBe("org");
  });
});

describe("createSkillsLibrary — static active binding", () => {
  it("fails loud on an unknown skill name", () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("known", "Known body")],
    });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        uses: [skills.config({ active: ["typo-skill"] })],
      }),
    ).toThrow(/unknown skill "typo-skill"/);
  });

  it("renders the bound skill body — and only that generator's skill", async () => {
    const initialSkills = [
      inlineSkill("alpha", "ALPHA-BODY-MARKER"),
      inlineSkill("beta", "BETA-BODY-MARKER"),
    ];
    const skillsA = createSkillsLibrary({ initialSkills });
    const skillsB = createSkillsLibrary({ initialSkills });

    const genA = generator({
      name: "a",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skillsA.config({ active: ["alpha"] })],
    });
    const genB = generator({
      name: "b",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skillsB.config({ active: ["beta"] })],
    });

    const outA = await renderGeneratorSkills(genA, buildReaderCtx(createMockSkillsCollection()));
    const outB = await renderGeneratorSkills(genB, buildReaderCtx(createMockSkillsCollection()));

    expect(outA).toContain("ALPHA-BODY-MARKER");
    expect(outA).not.toContain("BETA-BODY-MARKER");
    expect(outB).toContain("BETA-BODY-MARKER");
    expect(outB).not.toContain("ALPHA-BODY-MARKER");
  });

  it("contributes the bound skills' declared tools; omitted allowed-tools → full catalog", async () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const search = mk("search");
    const fetchTool = mk("fetch");
    const ctx = buildReaderCtx(createMockSkillsCollection());

    const scoped = createSkillsLibrary({
      catalog: { search, fetch: fetchTool },
      initialSkills: [inlineSkill("narrow", "body", ["search"])],
    });
    const gScoped = generator({
      name: "s",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [scoped.config({ active: ["narrow"] })],
    });
    const scopedTools = (await resolveTools(gScoped, ctx)).map((t) => t.name);
    expect(scopedTools).toContain("search");
    expect(scopedTools).not.toContain("fetch");

    const wide = createSkillsLibrary({
      catalog: { search, fetch: fetchTool },
      initialSkills: [inlineSkill("open", "body")], // no allowed-tools → full catalog
    });
    const gWide = generator({
      name: "w",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [wide.config({ active: ["open"] })],
    });
    const wideTools = (await resolveTools(gWide, ctx)).map((t) => t.name);
    expect(wideTools).toEqual(expect.arrayContaining(["search", "fetch"]));
  });
});

describe("createSkillsLibrary — dynamicActivation load tool", () => {
  const runSkillExecute = (
    tool: { execute?: Function; config?: { execute?: Function } },
  ): Function => (tool.execute ?? tool.config?.execute) as Function;

  it("installs the runSkill load tool when dynamicActivation is on", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.config({ allowed: ["deep-research"] }).presets({ dynamicActivation: true })],
    });
    const toolNames = (await resolveTools(gen, buildReaderCtx(createMockSkillsCollection()))).map(
      (t) => t.name,
    );
    expect(toolNames).toContain("runSkill");
  });

  it("load tool writes the host generator's block state via ctx.parent", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.config({ allowed: ["deep-research"] }).presets({ dynamicActivation: true })],
    });
    const collection = createMockSkillsCollection();
    let parentState: { activeSkills?: unknown[] } = {};
    const ctx = buildReaderCtx(collection, {
      parent: {
        name: "g",
        kind: "generator",
        atomicState: async (mutator: (s: unknown) => Record<string, unknown>) => {
          parentState = { ...parentState, ...mutator(parentState) };
          return true;
        },
      },
    });
    const runSkill = (await resolveTools(gen, ctx)).find((t) => t.name === "runSkill")!;

    const result = await runSkillExecute(runSkill)({ name: "deep-research" }, ctx);
    expect(result.mode).toBe("inline");
    expect(parentState.activeSkills).toHaveLength(1);
    expect((parentState.activeSkills as Array<{ name: string }>)[0]!.name).toBe("deep-research");
  });

  it("load tool rejects a skill outside the allowed set", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body"), inlineSkill("other", "body")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.config({ allowed: ["deep-research"] }).presets({ dynamicActivation: true })],
    });
    const ctx = buildReaderCtx(createMockSkillsCollection(), {
      parent: { name: "g", kind: "generator", atomicState: async () => true },
    });
    const runSkill = (await resolveTools(gen, ctx)).find((t) => t.name === "runSkill")!;
    await expect(runSkillExecute(runSkill)({ name: "other" }, ctx)).rejects.toThrow(
      /not in this generator's allowed set/,
    );
  });
});

describe("createSkillsLibrary — block-state default reader", () => {
  it("renders dynamic entries from the generator's own block state (ctx.self)", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("loaded", "LOADED-BODY-MARKER")],
    });
    // No activeState → block-state default. The reader reads ctx.self.
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.config({ allowed: ["loaded"] }).presets({ dynamicActivation: true })],
    });
    const collection = createMockSkillsCollection();
    const ctx = buildReaderCtx(collection, {
      self: { state: { activeSkills: [{ name: "loaded", mode: "inline", activatedAt: 1 }] } },
    });
    const out = await renderGeneratorSkills(gen, ctx);
    expect(out).toContain("LOADED-BODY-MARKER");
  });
});

describe("createSkillsLibrary — explicit activeState", () => {
  it("contributes the field schema at the chosen scope", () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("s", "body")],
    });
    // The resolver owns the schema contribution; it's merged into the scope's
    // state schema (not surfaced on gen.config), so assert on the resolver's
    // returned surface for the chosen scope.
    const resolved = skills.__configDef!.resolve(
      { activeState: { scope: "session", field: "activeAnalystSkills" } } as never,
      { presets: new Set(), blockKind: "generator" },
    ) as { sessionStateSchema?: { safeParse: Function } };
    expect(resolved.sessionStateSchema).toBeDefined();
    const parsed = resolved.sessionStateSchema!.safeParse({
      activeAnalystSkills: [{ name: "s", mode: "inline", activatedAt: 1 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("reader reads dynamic entries from the explicit field, inline only", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("s", "S-BODY-MARKER"), inlineSkill("f", "F-BODY-MARKER")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.config({ activeState: { scope: "session", field: "activeAnalystSkills" } })],
    });
    const collection = createMockSkillsCollection();
    const ctx = buildReaderCtx(collection, {
      session: {
        state: {
          activeAnalystSkills: [
            { name: "s", mode: "inline", activatedAt: 1 },
            { name: "f", mode: "fork", activatedAt: 2 }, // must not render
          ],
        },
      },
    });
    const out = await renderGeneratorSkills(gen, ctx);
    expect(out).toContain("S-BODY-MARKER");
    expect(out).not.toContain("F-BODY-MARKER");
  });
});
