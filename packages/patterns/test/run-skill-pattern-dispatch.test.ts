/**
 * Regression: end-to-end pattern-skill dispatch via runSkill.
 *
 * The existing skill-registry tests call `factory.fromConfig(...)`
 * directly and assert on the materialized block. They don't exercise
 * the runSkill router's pattern route — and the bug we're guarding
 * against here only fires inside that route, when its async `execute`
 * returns a SequencerDefinition.
 *
 * Historically the SequencerDefinition's sequential-step method was named
 * `.then(...)`, which collided with the JS Promise/thenable protocol: when an
 * async function returns a value, JS wraps it via `Promise.resolve`, which
 * recursively unwraps thenables — so `Promise.resolve(sequencer)` would call
 * `sequencer.then(resolve, reject)`, interpret `resolve` as a block step, and
 * crash on `resolve.config.outputSchema` (`Cannot read properties of undefined
 * (reading 'outputSchema')`).
 *
 * The DSL method is now `.step(...)` (FIX-595), so a SequencerDefinition is no
 * longer a thenable. `pattern-run.ts` returns the materialized sequencer
 * directly from its async execute; the defensive `wrapMaterializedBlock`
 * passthrough router that previously dodged the trap has been removed. This
 * test pins that the trap stays closed.
 */
import { describe, expect, it, vi } from "vitest";
import { runForTest } from "@flow-state-dev/testing";
import {
  createRunSkillTool,
  type ActiveSkillEntry,
} from "@flow-state-dev/orchestration";
import { defaultPatternRegistry } from "../src/skill-registry";

function buildCtx(opts: { sessionStateOverrides?: Record<string, unknown> } = {}) {
  const sessionState: Record<string, unknown> = {
    activeSkills: [] as ActiveSkillEntry[],
    ...opts.sessionStateOverrides,
  };
  const requestState: Record<string, unknown> = {};
  const skillsCollection = makeMockSkillsCollection();
  return {
    ctx: {
      request: {
        identity: { id: "r1", userId: "u1" },
        state: requestState,
        patchState: async (u: Record<string, unknown>) => Object.assign(requestState, u),
        setState: async () => {},
        incState: async () => {},
        pushState: async () => {},
        setStateRecord: async (r: string, k: string, v: unknown) => {
          const rec = (requestState[r] as Record<string, unknown>) ?? {};
          rec[k] = v;
          requestState[r] = rec;
        },
        deleteStateRecord: async () => {},
        atomicState: async <T>(fn: (s: Record<string, unknown>) => Promise<T> | T) =>
          fn(requestState),
      },
      session: {
        identity: { id: "s1", userId: "u1" },
        state: sessionState,
        patchState: async (u: Record<string, unknown>) => Object.assign(sessionState, u),
      },
      org: { identity: { type: "org" as const, id: "p1" } },
      user: {},
      resources: {
        skills: skillsCollection,
        get: (k: string) => (k === "skills" ? skillsCollection : undefined),
        list: () => [skillsCollection],
      },
      signal: new AbortController().signal,
      response: { emit: async () => {}, getItems: () => [] },
      // Mock model resolver — any generator dispatched inside the board
      // resolves through this so workers never reach a real provider.
      resolveModel: () => ({
        modelId: "test",
        generate: vi.fn(async () => ({ text: "ok" })),
      }),
      cap: {},
      getTarget: () => undefined,
      getBlockOutput: () => undefined,
      getBlockResult: () => ({ status: "not_started" as const }),
      targets: {},
      emit: { message: () => {}, component: () => {}, status: () => {} },
    } as never,
    skillsCollection,
  };
}

/** Tiny mock skills collection that supports the runSkill lookup path. */
function makeMockSkillsCollection() {
  const store = new Map<string, { name: string; state: Record<string, unknown>; content: string | null }>();
  const make = (entry: { name: string; state: Record<string, unknown>; content: string | null }) => ({
    path: entry.name,
    scope: "org" as const,
    uri: `org/${entry.name}`,
    state: entry.state as never,
    readContent: async () => entry.content,
    writeContent: async (c: string) => { entry.content = c; },
    setState: async (next: Record<string, unknown>) => { entry.state = { ...next }; },
    patchState: async (u: Record<string, unknown>) => { entry.state = { ...entry.state, ...u }; },
    config: { stateSchema: {} as never },
  });
  return {
    pattern: "skills/**",
    scope: "org" as const,
    _store: store,
    get(key: unknown) {
      const k = typeof key === "string" ? key : "";
      const full = `skills/${k}`;
      const e = store.get(full);
      if (!e) throw new Error(`Not found: ${k}`);
      return make(e);
    },
    getOptional(key: unknown) {
      const k = typeof key === "string" ? key : "";
      const e = store.get(`skills/${k}`);
      return e ? make(e) : undefined;
    },
    create: vi.fn(async (key: unknown, initial: unknown) => {
      const k = typeof key === "string" ? key : "";
      const full = `skills/${k}`;
      const entry = { name: full, state: { ...(initial as Record<string, unknown>) }, content: null };
      store.set(full, entry);
      return make(entry);
    }) as never,
    getOrCreate: vi.fn() as never,
    list() { return Array.from(store.values()).map(make); },
    delete: vi.fn() as never,
    count() { return store.size; },
    config: { pattern: "skills/**", stateSchema: {} as never } as never,
  };
}

describe("runSkill → pattern dispatch (real default registry)", () => {
  it("does not throw the SequencerDefinition thenable trap when materializing a task-board", async () => {
    const { ctx, skillsCollection } = buildCtx();
    skillsCollection._store.set("skills/competitor/SKILL.md", {
      name: "skills/competitor/SKILL.md",
      state: {
        description: "Competitor analysis",
        contextMode: "pattern",
        patternBinding: {
          pattern: "task-board",
          // Inline prompt avoids any prompt-ref file lookup. taskTools
          // exercises the capability composition path inside the worker
          // materializer too.
          workers: { w: { prompt: "do", tools: ["taskTools"] } },
          initialTasks: [],
          patternConfig: { concurrency: 1, "on-idle": "complete" },
        },
        _seededAt: new Date().toISOString(),
      },
      content: "---\ndescription: Competitor analysis\n---\n\nbody",
    });

    const tool = createRunSkillTool({
      collectionKey: "skills",
      catalog: {},
      patternRegistry: defaultPatternRegistry,
    });

    // The assertion: no "Cannot read properties of undefined (reading
    // 'outputSchema')" thenable-trap error during route dispatch.
    //
    // The mock ctx here is intentionally narrow — once route resolution
    // succeeds and the framework starts dispatching INTO the task-board
    // sequencer, deeper machinery (ctx.sequencer state, scope handles)
    // would need fuller mocks. We don't model those here; the run may
    // throw downstream for an unrelated reason. The test only guards
    // the specific failure mode the fix addresses.
    let caught: unknown;
    try {
      await runForTest(tool, { name: "competitor" }, ctx);
    } catch (err) {
      caught = err;
    }
    if (caught !== undefined) {
      const msg = (caught as Error).message ?? String(caught);
      expect(msg).not.toMatch(/Cannot read propert.*outputSchema/);
    }
  });
});
