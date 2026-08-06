/**
 * Tests for the Skills v2 per-generator binding (FIX-911): `createSkillsLibrary`
 * bound per generator via `.with({ active, allowed, activeState, dynamicActivation })`.
 *
 * The core guarantee is isolation: a skill bound to one generator never appears
 * in another's context, and a dynamic activation is request-scoped by default
 * (no carry into the next turn). These drive the real `generator({ uses })`
 * build path and then execute the assembled context/tool surface against a
 * mock skills collection — no model in the loop.
 */
import { describe, expect, it } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import { mergeCapabilities } from "@flow-state-dev/core/capability";
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
  // The merged resolver has the generator's dynamic-tools signature
  // `(input, ctx)`; capability-contributed entries receive `ctx`.
  if (typeof tools === "function") return (await (tools as Function)(undefined, ctx)) ?? [];
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
        uses: [skills.with({ active: ["typo-skill"] })],
      }),
    ).toThrow(/unknown skill "typo-skill"/);
  });

  it("fails loud when binding by name with no bundled catalog to validate against", () => {
    const skills = createSkillsLibrary({}); // no initialSkills → empty index
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        uses: [skills.with({ active: ["anything"] })],
      }),
    ).toThrow(/no bundled skills are available to validate against/);
  });

  it("rejects an unknown/misspelled config key (fails loud, not silently stripped)", () => {
    const skills = createSkillsLibrary({ initialSkills: [inlineSkill("valid", "body")] });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        // `actve` is a typo for `active` — must not be silently ignored.
        uses: [skills.with({ actve: ["valid"] } as never)],
      }),
    ).toThrow();
  });

  it("rejects a binding to an invalidly-named bundled skill (seeding would drop it)", () => {
    // A bundled skill whose name the seeder would reject (uppercase / reserved)
    // must not pass build validation — otherwise it never seeds and the reader
    // omits it. A valid skill is present so the index isn't empty.
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("valid", "body"), { name: "BadName", skillMd: "---\ndescription: x\n---\n\nbody" }],
    });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        uses: [skills.with({ active: ["BadName"] })],
      }),
    ).toThrow(/unknown skill "BadName"/);
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
      uses: [skillsA.with({ active: ["alpha"] })],
    });
    const genB = generator({
      name: "b",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skillsB.with({ active: ["beta"] })],
    });

    const outA = await renderGeneratorSkills(genA, buildReaderCtx(createMockSkillsCollection()));
    const outB = await renderGeneratorSkills(genB, buildReaderCtx(createMockSkillsCollection()));

    expect(outA).toContain("ALPHA-BODY-MARKER");
    expect(outA).not.toContain("BETA-BODY-MARKER");
    expect(outB).toContain("BETA-BODY-MARKER");
    expect(outB).not.toContain("ALPHA-BODY-MARKER");
  });

  it("enforces a bound skill's allowed-tools against the model-facing catalog", async () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const ctx = buildReaderCtx(createMockSkillsCollection());
    const skills = createSkillsLibrary({
      catalog: { search: mk("search"), fetch: mk("fetch") },
      initialSkills: [inlineSkill("narrow", "body", ["search"])],
    });
    const gen = generator({
      name: "s",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ active: ["narrow"] })],
    });
    const toolNames = (await resolveTools(gen, ctx)).map((t) => t.name);
    expect(toolNames).toEqual(["search"]);
  });

  it("re-resolves allowed-tools after a live manifest edit", async () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const collection = createMockSkillsCollection();
    const ctx = buildReaderCtx(collection);
    const skills = createSkillsLibrary({
      catalog: { search: mk("search"), fetch: mk("fetch") },
      initialSkills: [inlineSkill("editable", "body", ["search"])],
    });
    const gen = generator({
      name: "s",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ active: ["editable"] })],
    });

    expect((await resolveTools(gen, ctx)).map((t) => t.name)).toEqual(["search"]);
    collection._store.get("skills/editable/SKILL.md")!.state.allowedTools = ["fetch"];
    expect((await resolveTools(gen, ctx)).map((t) => t.name)).toEqual(["fetch"]);
  });

  it("validates every bound skill's declared tools, even after an unrestricted one", () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const skills = createSkillsLibrary({
      catalog: { search: mk("search") },
      initialSkills: [
        inlineSkill("open", "body"), // unrestricted (no allowed-tools)
        inlineSkill("needs-db", "body", ["db"]), // declares a tool not in the catalog
      ],
    });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        uses: [skills.with({ active: ["open", "needs-db"] })],
      }),
    ).toThrow(/skill "needs-db" declares tool "db", which is not in the catalog/);
  });
});

describe("createSkillsLibrary — dynamicActivation load tool", () => {
  const loadSkillExecute = (
    tool: { execute?: Function; config?: { execute?: Function } },
  ): Function => (tool.execute ?? tool.config?.execute) as Function;

  it("validates every bundled inline skill's tools in whole-catalog dynamic mode (allowed omitted)", () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const skills = createSkillsLibrary({
      catalog: { search: mk("search") },
      // `allowed` omitted → whole catalog loadable; `needs-db` declares a tool
      // not in the catalog, so the build must fail loud.
      initialSkills: [inlineSkill("ok", "body", ["search"]), inlineSkill("needs-db", "body", ["db"])],
    });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        uses: [skills.with({ dynamicActivation: true })],
      }),
    ).toThrow(/skill "needs-db" declares tool "db", which is not in the catalog/);
  });

  it("skips disabled skills in whole-catalog validation (they can't reach the model)", () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    // A disabled draft declares a tool absent from the catalog. It's omitted
    // from the catalog and renderer, so it must NOT fail whole-catalog build.
    const draft: InitialSkill = {
      name: "draft",
      skillMd: "---\ndescription: draft\ndisable-model-invocation: true\nallowed-tools: [db]\n---\n\nbody",
    };
    const skills = createSkillsLibrary({
      catalog: { search: mk("search") },
      initialSkills: [inlineSkill("ok", "body", ["search"]), draft],
    });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        uses: [skills.with({ dynamicActivation: true })],
      }),
    ).not.toThrow();
  });

  it("installs the loadSkill load tool when dynamicActivation is on", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
    });
    const toolNames = (await resolveTools(gen, buildReaderCtx(createMockSkillsCollection()))).map(
      (t) => t.name,
    );
    expect(toolNames).toContain("loadSkill");
  });

  it("load tool writes the host generator's block state via ctx.parent", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
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
    const loadSkill = (await resolveTools(gen, ctx)).find((t) => t.name === "loadSkill")!;

    const result = await loadSkillExecute(loadSkill)({ name: "deep-research" }, ctx);
    expect(result.mode).toBe("inline");
    expect(parentState.activeSkills).toHaveLength(1);
    expect((parentState.activeSkills as Array<{ name: string }>)[0]!.name).toBe("deep-research");
  });

  it("block-state default installs the generator's own `activeSkills` field (no hand-declared stateSchema)", () => {
    // FIX-914 PR2: the binding contributes the block-state field itself, so the
    // generator no longer needs `stateSchema: { activeSkills }`. The resolver's
    // surface flows through the own-state merge, so a merged `stateSchema` with
    // `activeSkills` is present on the block-state (dynamicActivation) default.
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body")],
    });
    const merged = mergeCapabilities(
      [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
      "generator",
    );
    expect(merged.stateSchema).toBeDefined();
    expect(Object.keys((merged.stateSchema as z.ZodObject<z.ZodRawShape>).shape)).toContain(
      "activeSkills",
    );
  });

  it("an explicit `activeState` does NOT contribute own-block state (it lives at the named scope)", () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body")],
    });
    const merged = mergeCapabilities(
      [
        skills.with({
          allowed: ["deep-research"],
          activeState: { scope: "session", field: "activeAnalystSkills" },
          dynamicActivation: true,
        }),
      ],
      "generator",
    );
    // Block-state own field is only for the block-state default; the explicit
    // field is declared where it's written, not as generator own-state.
    expect(merged.stateSchema).toBeUndefined();
  });

  it("load tool rejects a skill outside the allowed set", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("deep-research", "body"), inlineSkill("other", "body")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ allowed: ["deep-research"], dynamicActivation: true })],
    });
    const ctx = buildReaderCtx(createMockSkillsCollection(), {
      parent: { name: "g", kind: "generator", atomicState: async () => true },
    });
    const loadSkill = (await resolveTools(gen, ctx)).find((t) => t.name === "loadSkill")!;
    await expect(loadSkillExecute(loadSkill)({ name: "other" }, ctx)).rejects.toThrow(
      /not in this generator's allowed set/,
    );
  });
});

describe("createSkillsLibrary — block-state default reader", () => {
  it("does not render a statically-bound skill flagged disable-model-invocation", async () => {
    const skills = createSkillsLibrary({ initialSkills: [inlineSkill("draft", "DRAFT-MARKER")] });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ active: ["draft"] })],
    });
    const collection = createMockSkillsCollection();
    collection._store.set("skills/_meta", {
      name: "skills/_meta",
      state: { seededNames: ["draft"] },
      content: null,
    });
    collection._store.set("skills/draft/SKILL.md", {
      name: "skills/draft/SKILL.md",
      state: { description: "draft", disableModelInvocation: true },
      content: "---\ndescription: draft\ndisable-model-invocation: true\n---\n\nDRAFT-MARKER",
    });
    const out = await renderGeneratorSkills(gen, buildReaderCtx(collection));
    expect(out).not.toContain("DRAFT-MARKER");
  });

  it("a dynamic load with an input arg wins over the static copy of the same skill", async () => {
    // `dual` is preloaded via `active` (no $ARGUMENTS) and also loadable. When
    // the model loads it with an input, the argument-bearing body must render —
    // the static copy must not dedupe out the loaded arguments.
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("dual", "ARG=[$ARGUMENTS]")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ active: ["dual"], dynamicActivation: true })],
    });
    const collection = createMockSkillsCollection();
    const ctx = buildReaderCtx(collection, {
      self: {
        state: { activeSkills: [{ name: "dual", mode: "inline", input: "topic-42", activatedAt: 1 }] },
      },
    });
    const out = await renderGeneratorSkills(gen, ctx);
    expect(out).toContain("ARG=[topic-42]");
    // The static (argument-less) copy is not also rendered.
    expect(out).not.toContain("ARG=[]");
  });

  it("renders dynamic entries from the generator's own block state (ctx.self)", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("loaded", "LOADED-BODY-MARKER")],
    });
    // No activeState → block-state default. The reader reads ctx.self.
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ allowed: ["loaded"], dynamicActivation: true })],
    });
    const collection = createMockSkillsCollection();
    const ctx = buildReaderCtx(collection, {
      self: { state: { activeSkills: [{ name: "loaded", mode: "inline", activatedAt: 1 }] } },
    });
    const out = await renderGeneratorSkills(gen, ctx);
    expect(out).toContain("LOADED-BODY-MARKER");
  });
});

describe("createSkillsLibrary — delegation gating", () => {
  const agentSkill = (name: string, disabled: boolean): InitialSkill => ({
    name,
    skillMd: [
      "---",
      `description: ${name} skill`,
      ...(disabled ? ["disable-model-invocation: true"] : []),
      "agents:",
      "  researcher:",
      "    prompt: You research things.",
      "---",
      "",
      "addTask then runBoard.",
    ].join("\n"),
  });

  const boardField = (skills: ReturnType<typeof createSkillsLibrary>, active: string[]) => {
    const resolved = skills.__configDef!.resolve(
      { active } as never,
      { presets: new Set(), blockKind: "generator" },
    ) as { stateSchema?: { shape?: Record<string, unknown> } };
    return resolved.stateSchema?.shape?.delegationBoard;
  };

  it("installs the delegation board for an enabled agent skill", () => {
    const skills = createSkillsLibrary({ initialSkills: [agentSkill("team", false)] });
    expect(boardField(skills, ["team"])).toBeDefined();
  });

  it("does NOT install delegation for a disable-model-invocation agent skill, even when force-bound via active", () => {
    // A disabled skill is invisible to the model (its body is suppressed). The
    // delegation surface is model-facing too, so it must not install — otherwise
    // a draft/private skill's agents would be reachable through addTask/runBoard.
    const skills = createSkillsLibrary({ initialSkills: [agentSkill("draft-team", true)] });
    expect(boardField(skills, ["draft-team"])).toBeUndefined();
  });
});

describe("createSkillsLibrary — explicit activeState", () => {
  it("does not return a no-op scope state schema from the resolver", () => {
    // A config resolver's returned surface reaches only the generator's
    // context/tools; the framework does not apply a merged-surface
    // sessionStateSchema to the block state contract. Returning one would be a
    // silent no-op, so the resolver must not claim to contribute it — the field
    // is declared by the writer (matcher / flow) instead.
    const skills = createSkillsLibrary({ initialSkills: [inlineSkill("s", "body")] });
    const resolved = skills.__configDef!.resolve(
      { activeState: { scope: "session", field: "activeAnalystSkills" } } as never,
      { presets: new Set(), blockKind: "generator" },
    ) as Record<string, unknown>;
    expect(resolved.sessionStateSchema).toBeUndefined();
  });

  it("contributes allowed skills' declared tools on the explicit-activeState path (no dynamicActivation)", async () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const search = mk("search");
    const skills = createSkillsLibrary({
      catalog: { search },
      initialSkills: [inlineSkill("uses-search", "body", ["search"])],
    });
    // Upstream-matcher path: explicit activeState + allowed, but no load tool.
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [
        skills.with({
          allowed: ["uses-search"],
          activeState: { scope: "session", field: "activeAnalystSkills" },
        }),
      ],
    });
    const toolNames = (
      await resolveTools(
        gen,
        buildReaderCtx(createMockSkillsCollection(), {
          session: {
            state: { activeAnalystSkills: [{ name: "uses-search", mode: "inline" }] },
          },
        }),
      )
    ).map((t) => t.name);
    // The activated skill's body can reference `search`, so it must be registered.
    expect(toolNames).toContain("search");
    // ...but the load tool is NOT installed (dynamicActivation off).
    expect(toolNames).not.toContain("loadSkill");
  });

  it("registers the full catalog for an unscoped activeState binding (no allowed, no load tool)", async () => {
    const mk = (name: string) =>
      handler({ name, inputSchema: z.object({}), outputSchema: z.object({}), execute: async () => ({}) });
    const skills = createSkillsLibrary({
      catalog: { search: mk("search"), fetch: mk("fetch") },
      initialSkills: [inlineSkill("s", "body")],
    });
    // activeState with no `allowed` and no dynamicActivation: a writer can place
    // any inline skill in the field, so the whole catalog must be available.
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ activeState: { scope: "session", field: "activeAnalystSkills" } })],
    });
    const toolNames = (
      await resolveTools(
        gen,
        buildReaderCtx(createMockSkillsCollection(), {
          session: { state: { activeAnalystSkills: [{ name: "s", mode: "inline" }] } },
        }),
      )
    ).map((t) => t.name);
    expect(toolNames).toEqual(expect.arrayContaining(["search", "fetch"]));
    expect(toolNames).not.toContain("loadSkill");
  });

  it("reader reads dynamic entries from the explicit field, inline only", async () => {
    const skills = createSkillsLibrary({
      initialSkills: [inlineSkill("s", "S-BODY-MARKER"), inlineSkill("f", "F-BODY-MARKER")],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [skills.with({ activeState: { scope: "session", field: "activeAnalystSkills" } })],
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
