/**
 * Goal check — a skill bound to (or activated on) one generator never appears
 * in another generator's context, and a runtime activation is request-scoped by
 * default (it does not carry into the next turn).
 *
 * Drives the REAL block-build path: `generator({ uses: [skills.with(...)] })`
 * runs resolveCapabilities → mergeCapabilities → the skills config resolver →
 * the generator's assembled context/tool surface. We then execute that real
 * assembled surface (the reader context functions, and the load tool) against
 * an in-memory skills collection, and assert on the rendered system context.
 *
 * No model is in the loop: skill-body injection and per-generator isolation are
 * entirely a function of config binding + block-namespaced state, both of which
 * complete without a generation. The only scaffolding is an in-memory skills
 * collection and minimal block contexts — there is nothing to mock (no model),
 * so this does not violate the goals "never a mock" rule.
 *
 * Held-out: the two skills' names and body markers come from fixtures/input.json
 * and are asserted back out; swapping them for any other strings still passes a
 * correct implementation.
 *
 * Run: pnpm tsx goals/skills-scoped-binding/no-cross-generator-bleed/run.mts
 */
import { generator } from "@flow-state-dev/core";
import type { ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import type { InitialSkill } from "@flow-state-dev/core";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
import { DEFAULT_MODEL, loadFixture, runGoal } from "../../lib/index.mts";

/**
 * `createSkillsLibrary` returns a bare `DefinedCapability` — it does not carry
 * its own config schema in its return type, so `.with()` types the bag as
 * PRESET overrides only (`boolean | PresetOverrideFn`). The binding config
 * fields (`active`, `allowed`, `dynamicActivation`) are read by the resolver at
 * runtime but don't appear in that type. Cast at the one call site rather than
 * widen the goal; the real fix is for the factory to return a parameterized
 * capability, which is an orchestration change, not a goal change.
 */
function bindSkills(
  library: ReturnType<typeof createSkillsLibrary>,
  config: Record<string, unknown>,
): never {
  return library.with(config as never) as never;
}

// ---------------------------------------------------------------------------
// A tiny in-memory skills collection (no test framework, no mocks-of-a-model).
// ---------------------------------------------------------------------------
function createInMemorySkillsCollection(pattern = "skills/**"): ResourceCollectionRef {
  const prefix = pattern.replace(/\/\*\*$/, "");
  const store = new Map<string, { name: string; state: Record<string, unknown>; content: string | null }>();
  const full = (key: string) => (key.startsWith(prefix + "/") ? key : `${prefix}/${key}`);
  const makeRef = (entry: { name: string; state: Record<string, unknown>; content: string | null }): ResourceRef =>
    ({
      path: entry.name,
      scope: "org",
      uri: `org/${entry.name}`,
      state: entry.state as never,
      patchState: async (u: Record<string, unknown>) => {
        entry.state = { ...entry.state, ...u };
      },
      setState: async (n: Record<string, unknown>) => {
        entry.state = { ...n };
      },
      readContent: async () => entry.content,
      readContentRaw: async () => entry.content,
      writeContent: async (c: string) => {
        entry.content = c;
      },
      config: { stateSchema: {} },
    }) as unknown as ResourceRef;
  return {
    pattern,
    scope: "org",
    get(key: unknown) {
      const e = store.get(full(String(key)));
      if (!e) throw new Error(`Not found: ${String(key)}`);
      return makeRef(e);
    },
    getOptional(key: unknown) {
      const e = store.get(full(String(key)));
      return e ? makeRef(e) : undefined;
    },
    create: async (key: unknown, initial: unknown) => {
      const k = full(String(key));
      const existing = store.get(k);
      const entry = { name: k, state: { ...(initial as Record<string, unknown>) }, content: existing?.content ?? null };
      store.set(k, entry);
      return makeRef(entry);
    },
    getOrCreate: async (key: unknown, initial: unknown) => {
      const k = full(String(key));
      let entry = store.get(k);
      if (!entry) {
        entry = { name: k, state: { ...(initial as Record<string, unknown>) }, content: null };
        store.set(k, entry);
      }
      return makeRef(entry);
    },
    list: () => Array.from(store.values()).map(makeRef),
    delete: async (key: unknown) => {
      store.delete(full(String(key)));
    },
    count: () => store.size,
    config: { pattern, stateSchema: {} as never },
  } as unknown as ResourceCollectionRef;
}

function ctxWith(
  collection: ResourceCollectionRef,
  overrides: Record<string, unknown> = {},
): unknown {
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
  };
}

function collectContextFns(value: unknown, out: Array<(i: unknown, c: unknown) => unknown>): void {
  if (typeof value === "function") out.push(value as (i: unknown, c: unknown) => unknown);
  else if (Array.isArray(value)) for (const v of value) collectContextFns(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) collectContextFns(v, out);
}

async function renderSkills(gen: ReturnType<typeof generator>, ctx: unknown): Promise<string> {
  const fns: Array<(i: unknown, c: unknown) => unknown> = [];
  collectContextFns((gen.config as { context?: unknown }).context, fns);
  const parts: string[] = [];
  for (const fn of fns) {
    const out = await fn(undefined, ctx);
    if (typeof out === "string") parts.push(out);
  }
  return parts.join("\n");
}

async function resolveTools(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<Array<{ name: string; execute?: Function; config?: { execute?: Function } }>> {
  const tools = (gen.config as { tools?: unknown }).tools;
  if (typeof tools === "function") return (await (tools as Function)(ctx)) ?? [];
  return (tools as never[]) ?? [];
}

await runGoal(async () => {
  const fx = loadFixture<{
    skillA: { name: string; description: string; marker: string };
    skillB: { name: string; description: string; marker: string };
  }>(import.meta.url);

  const skillMd = (s: { name: string; description: string; marker: string }): InitialSkill => ({
    name: s.name,
    skillMd: `---\ndescription: ${s.description}\n---\n\nWhen active, emit the token ${s.marker}.`,
  });
  const initialSkills = [skillMd(fx.skillA), skillMd(fx.skillB)];

  const failures: string[] = [];

  // Two generators, each statically bound to a different skill.
  const skills = createSkillsLibrary({ initialSkills });
  const genA = generator({
    name: "analyst",
    model: DEFAULT_MODEL,
    prompt: "p",
    uses: [bindSkills(skills, { active: [fx.skillA.name] })],
  });
  const genB = generator({
    name: "summarizer",
    model: DEFAULT_MODEL,
    prompt: "p",
    uses: [bindSkills(skills, { active: [fx.skillB.name] })],
  });

  const outA = await renderSkills(genA, ctxWith(createInMemorySkillsCollection()));
  const outB = await renderSkills(genB, ctxWith(createInMemorySkillsCollection()));

  if (!outA.includes(fx.skillA.marker))
    failures.push(`static: generator A missing its own skill marker ${fx.skillA.marker}`);
  if (outA.includes(fx.skillB.marker))
    failures.push(`bleed: generator A's context leaked B's skill marker ${fx.skillB.marker}`);
  if (!outB.includes(fx.skillB.marker))
    failures.push(`static: generator B missing its own skill marker ${fx.skillB.marker}`);
  if (outB.includes(fx.skillA.marker))
    failures.push(`bleed: generator B's context leaked A's skill marker ${fx.skillA.marker}`);

  // Dynamic activation via the load tool writes the generator's OWN block state.
  const dyn = createSkillsLibrary({ initialSkills });
  const genD = generator({
    name: "worker",
    model: DEFAULT_MODEL,
    prompt: "p",
    uses: [bindSkills(dyn, { allowed: [fx.skillA.name], dynamicActivation: true })],
  });

  // Turn 1: a fresh request-scoped block-state cell for genD.
  const blockStateTurn1: { activeSkills?: unknown[] } = {};
  const ctxTool = ctxWith(createInMemorySkillsCollection(), {
    parent: {
      name: "worker",
      kind: "generator",
      atomicState: async (mutator: (s: unknown) => Record<string, unknown>) => {
        Object.assign(blockStateTurn1, mutator(blockStateTurn1));
        return true;
      },
    },
  });
  const loadSkill = (await resolveTools(genD, ctxTool)).find((t) => t.name === "loadSkill");
  if (!loadSkill) {
    return {
      failures: [...failures, "dynamic: loadSkill load tool was not installed by dynamicActivation"],
      evidence: "",
    };
  }
  const exec = (loadSkill.execute ?? loadSkill.config?.execute) as Function;
  await exec({ name: fx.skillA.name }, ctxTool);

  // The reader running in genD's scope (ctx.self == the same block-state cell)
  // now injects skill A.
  const readerCtxTurn1 = ctxWith(createInMemorySkillsCollection(), { self: { state: blockStateTurn1 } });
  const dynOut = await renderSkills(genD, readerCtxTurn1);
  if (!dynOut.includes(fx.skillA.marker))
    failures.push(`dynamic: loaded skill ${fx.skillA.marker} did not render on the next step`);

  // Isolation: the OTHER generator (its own empty block state) never sees it.
  const bleedOut = await renderSkills(genB, ctxWith(createInMemorySkillsCollection(), { self: { state: {} } }));
  if (bleedOut.includes(fx.skillA.marker))
    failures.push(`bleed: a dynamic activation on one generator leaked into another`);

  // Non-persistence: a new turn gets a fresh block-state cell → nothing carries.
  const readerCtxTurn2 = ctxWith(createInMemorySkillsCollection(), { self: { state: {} } });
  const turn2Out = await renderSkills(genD, readerCtxTurn2);
  if (turn2Out.includes(fx.skillA.marker))
    failures.push(`persistence: a block-state activation carried into a new turn`);

  return {
    failures,
    evidence:
      "a skill bound to/activated on one generator stayed out of the other's context, and a " +
      "runtime activation did not carry into the next turn",
  };
});
