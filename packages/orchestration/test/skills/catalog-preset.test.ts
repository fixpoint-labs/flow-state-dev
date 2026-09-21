/**
 * The ambient catalog listing, now behind a preset (FIX-817).
 *
 * Two halves of one rule, and only the pair means anything (BP-035). The
 * default state is the one that must not have moved: an app that upgrades and
 * finds its model no longer knows its skills exist has been broken by a
 * refactor it did not ask for. The off state is the one the feature exists for,
 * and a preset nobody can actually turn off is a preset that shipped nothing.
 *
 * Graded on the rendered context — what the model would be sent — rather than
 * on the preset bookkeeping. A resolver that records the preset and contributes
 * the listing anyway is exactly the failure a shape assertion survives.
 */
import { describe, expect, it } from "vitest";
import { generator } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import { createSkillsLibrary } from "../../src/skills/library";
import { createMockSkillsCollection } from "./mocks";

const skillMd = (name: string): InitialSkill => ({
  name,
  skillMd: ["---", `description: ${name} skill`, "---", "", `${name} body`].join("\n"),
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

function ctxWith(collection: ReturnType<typeof createMockSkillsCollection>) {
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
  } as never;
}

/**
 * The `loadSkill` tool's own description, as the provider would be sent it.
 *
 * Graded beside the rendered context because the two are one message to the
 * model: a turn where the listing is gone and the tool still says to read the
 * listing has not moved the model to the door, it has pointed it at nothing.
 */
async function loaderDescription(gen: ReturnType<typeof generator>, ctx: unknown): Promise<string> {
  const tools = await (
    gen.config as { tools: (i: unknown, c: unknown) => Promise<Array<{ name?: string }>> }
  ).tools(undefined, ctx);
  const loader = tools.find((tool) => tool.name === "loadSkill") as
    | { description?: string; config?: { description?: string } }
    | undefined;
  if (!loader) throw new Error(`no loadSkill tool among [${tools.map((t) => t.name).join(", ")}]`);
  return loader.description ?? loader.config?.description ?? "";
}

/** Render a generator's assembled skills context, as the model would receive it. */
async function rendered(gen: ReturnType<typeof generator>, ctx: unknown): Promise<string> {
  const fns: Array<(i: unknown, c: unknown) => unknown> = [];
  collectContextFns((gen.config as { context?: unknown }).context, fns);
  const parts: string[] = [];
  for (const fn of fns) {
    const out = await fn(undefined, ctx);
    if (typeof out === "string") parts.push(out);
  }
  return parts.join("\n");
}

/**
 * Build a generator on a dynamic-activation binding, optionally turning the
 * catalog preset off. Everything else is held constant so the two runs differ
 * by exactly one key.
 */
function build(catalogContext?: false) {
  const initialSkills = [skillMd("triage"), skillMd("summarize")];
  const library = createSkillsLibrary({ initialSkills });
  return generator({
    name: "answerer",
    model: "openai/gpt-5.4-mini",
    prompt: "p",
    uses: [
      // ONE `.with()` bag carrying both the preset flags and the config.
      // `.presets()` and `.with()` each REPLACE the preset overrides a ref
      // already carries rather than merging them, so chaining the two would
      // drop whichever came first — the app-facing spelling is one call.
      library.with({
        dynamicActivation: true,
        ...(catalogContext === false ? { catalogContext: false } : {}),
        activeState: { scope: "session", field: "activeSkills" },
      } as never),
    ],
  });
}

describe("the skills catalog listing ships behind a default-on preset", () => {
  it("BR-13 · reaches the prompt with nothing configured, exactly as it did before", async () => {
    const collection = createMockSkillsCollection();
    const gen = build();
    const ctx = ctxWith(collection);
    const text = await rendered(gen, ctx);

    expect(text).toContain("You can load any of these skills with the `loadSkill` tool");
    expect(text).toContain("triage");
    expect(text).toContain("summarize");
    // And the loader still sends the model to that listing, unchanged.
    expect(await loaderDescription(gen, ctx)).toContain("provided in the system context");
  });

  it("BR-14 · leaves the prompt when the app turns the preset off, and the loader says where to look instead", async () => {
    const collection = createMockSkillsCollection();
    const gen = build(false);
    const ctx = ctxWith(collection);
    const text = await rendered(gen, ctx);

    expect(text).not.toContain("You can load any of these skills");
    // The listing is what leaves — not the binding. A run that dropped the
    // whole skills surface would also satisfy the line above.
    expect(text).not.toContain("summarize skill");

    // The half a context-only assertion misses. With the listing gone, the
    // names live behind the door, and the tool the model must call is the
    // only thing left telling it so.
    const description = await loaderDescription(gen, ctx);
    expect(description).not.toContain("provided in the system context");
    expect(description).toContain("discover");
  });

  it("declares the preset on by default, so `default` is what an app overrides", () => {
    const library = createSkillsLibrary();
    expect(library.__presetDefs?.catalogContext).toBeDefined();
    expect(library.__presetDefs?.default).toEqual(["catalogContext"]);
  });
});
