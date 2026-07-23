/**
 * Tests for the per-execution delegation memo (FIX-928).
 *
 * The delegation tools are contributed as an async function, so the generator
 * re-resolves them before EVERY step of the tool loop. Materializing every
 * agent into a board worker each step is wasted work when the roster is
 * unchanged. The memo keyed on the (execution-stable) BlockContext caches the
 * expensive build and reuses it across steps, rebuilding only when the resolved
 * source list changes.
 *
 * The safety boundary is load-bearing: `collectAgentSources` (the live-manifest
 * disable read) still runs every step; only the downstream build is cached. A
 * skill disabled mid-turn shrinks the snapshot, busts the cache, and is dropped
 * from both the tools and the roster — on every collection path, including the
 * bundled runtime shortcut FIX-918 left unguarded.
 */
import { describe, expect, it, vi } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { z } from "zod";
import { createSkillsLibrary } from "../../src/skills/library";
import {
  buildDelegationGuidance,
  collectAgentSources,
  snapshotSources,
  type DelegationAgentSource,
} from "../../src/skills/delegation-surface";
import { specsCollide } from "../../src/skills/internal/agent-key-reconcile";
import { workerInputSchema } from "../../src/skills/worker-materializer";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";
import { taskWorkerInputSchema } from "../../src/task-board";
import { createMockSkillsCollection } from "./mocks";

// ---------------------------------------------------------------------------
// Harness — a mock generator execution ctx (board on own state) plus a
// deterministic agent-ref materializer so the materialization spy covers the
// registry/materializeAgent I/O path, not just inline allocation.
// ---------------------------------------------------------------------------

function buildExecCtx(collection = createMockSkillsCollection()) {
  const selfState: Record<string, unknown> = { [DELEGATION_BOARD_FIELD]: {} };
  const stateRef = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return selfState;
    },
    atomicState: async (
      fn: (s: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>,
    ): Promise<void> => {
      Object.assign(selfState, await fn(selfState));
    },
    patchState: async (updates: Record<string, unknown>) => {
      Object.assign(selfState, updates);
    },
  };
  const ctx = {
    self: stateRef,
    parent: stateRef,
    request: { identity: { id: "r1", userId: "u1" }, state: {} },
    session: {
      identity: { id: "s1", userId: "u1" },
      state: {} as Record<string, unknown>,
      patchState: async () => {},
    },
    org: { identity: { type: "org" as const, id: "p1" } },
    user: {},
    resources: {
      skills: collection,
      get: (k: string) => (k === "skills" ? collection : undefined),
      list: () => [collection],
    },
    signal: new AbortController().signal,
    response: { emit: async () => {}, getItems: () => [] },
    cap: {},
    getTarget: () => undefined,
    getBlockOutput: () => undefined,
    getBlockResult: () => ({ status: "not_started" as const }),
    targets: {},
    emit: { message: () => {}, component: () => {}, status: () => {} },
  };
  return { ctx: ctx as never, selfState, collection };
}

function deterministicAgents() {
  const agentBlock = handler({
    name: "worker",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.string(),
    execute: async () => "done",
  });
  const agentRegistry = {
    get: vi.fn(async (name: string) => ({ name })),
    list: vi.fn(async () => [{ name: "scout-agent" }]),
  };
  const materializeAgent = vi.fn(() => agentBlock as never);
  return { agentRegistry, materializeAgent };
}

const scoutSkill: InitialSkill = {
  name: "scout-team",
  skillMd: [
    "---",
    "description: scout team",
    "agents:",
    "  scout:",
    "    agent-ref: scout-agent",
    "---",
    "",
    "Delegate to the scout.",
  ].join("\n"),
};

async function resolveTools(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<GeneratorTool[]> {
  const tools = (gen.config as { tools?: unknown }).tools;
  if (typeof tools === "function") return (await (tools as Function)(undefined, ctx)) ?? [];
  return (tools as GeneratorTool[]) ?? [];
}

function toolName(t: GeneratorTool): string | undefined {
  return (t as { config?: { name?: string } }).config?.name ?? (t as { name?: string }).name;
}

function buildScoutGenerator() {
  const agents = deterministicAgents();
  const skills = createSkillsLibrary({
    catalog: {},
    initialSkills: [scoutSkill],
    ...agents,
  });
  const gen = generator({
    name: "executive",
    model: "openai/gpt-5.4-mini",
    prompt: "delegate",
    inputSchema: z.object({}),
    uses: [skills.with({ active: ["scout-team"] } as never)],
  });
  return { gen, materializeAgent: agents.materializeAgent };
}

// ---------------------------------------------------------------------------
// C — materialize once per execution across ≥2 steps
// ---------------------------------------------------------------------------

describe("delegation memo — materialize once per execution", () => {
  it("materializes the board worker once across two steps with an unchanged roster", async () => {
    const { gen, materializeAgent } = buildScoutGenerator();
    const { ctx } = buildExecCtx();

    await resolveTools(gen, ctx); // step 0
    await resolveTools(gen, ctx); // step 1 — same ctx, unchanged roster

    // Two steps, one materialization: the memo returned the built tools early.
    expect(materializeAgent).toHaveBeenCalledTimes(1);
  });

  it("two separate executions each build (memo keyed per execution, no cross-leak)", async () => {
    const { gen, materializeAgent } = buildScoutGenerator();
    const a = buildExecCtx();
    const b = buildExecCtx();

    await resolveTools(gen, a.ctx);
    await resolveTools(gen, b.ctx);

    expect(materializeAgent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// D1 — the guidance path shares the same per-execution build
// ---------------------------------------------------------------------------

describe("delegation memo — guidance shares the tools build (D1)", () => {
  it("guidance served from the entry the tools resolver built (unchanged snapshot)", async () => {
    // A prompt agent whose roster purpose is derived from its (mutable) body.
    const staticSources: DelegationAgentSource[] = [
      { skillName: "brief", agents: { briefer: { prompt: "First-line-v1 purpose" } } },
    ];
    const deps = {
      catalog: {},
      collectionKey: "skills",
      location: { kind: "explicit", scope: "session", field: "activeSkills" },
      staticSources,
      bundledAgentIndex: new Map(),
      dynamicEligible: false,
    } as never;

    const { ctx } = buildExecCtx();
    const guidanceFn = buildDelegationGuidance(deps);

    // Warm the shared entry via the guidance resolver.
    const g1 = await guidanceFn(undefined, ctx);
    expect(g1).toContain("First-line-v1 purpose");

    // Mutate the agent body under an UNCHANGED key/skill/input — the snapshot
    // (skill/input/agentKeys) is identical, so the cache is not busted.
    staticSources[0]!.agents.briefer = { prompt: "Changed-v2 purpose" };
    const g2 = await guidanceFn(undefined, ctx);

    // Served from the cached build: still the v1 roster. If guidance re-walked
    // and rebuilt every call it would show v2. (Accepted-staleness, §6 dec. 2.)
    expect(g2).toBe(g1);
    expect(g2).toContain("First-line-v1 purpose");
    expect(g2).not.toContain("Changed-v2 purpose");
  });
});

// ---------------------------------------------------------------------------
// Disable-safety — collectAgentSources drops disabled skills on EVERY path
// ---------------------------------------------------------------------------

describe("collectAgentSources — bundled runtime disable gap (§7.1)", () => {
  it("drops a bundled runtime activation whose live manifest is disabled", async () => {
    const collection = createMockSkillsCollection();
    collection._store.set("skills/brief/SKILL.md", {
      name: "skills/brief/SKILL.md",
      state: { description: "brief", disableModelInvocation: true },
      content: null,
    });
    const { ctx } = buildExecCtx(collection);
    (ctx as { session: { state: Record<string, unknown> } }).session.state.activeSkills = [
      { name: "brief", mode: "inline", activatedAt: 1 },
    ];
    const sources = await collectAgentSources(ctx, {
      catalog: {},
      collectionKey: "skills",
      location: { kind: "explicit", scope: "session", field: "activeSkills" },
      staticSources: [],
      // "brief" resolves via the bundled index — the path FIX-918 left unguarded.
      bundledAgentIndex: new Map([
        ["brief", { agents: { briefer: { prompt: "You write briefs." } } }],
      ]),
      dynamicEligible: true,
    } as never);
    expect(sources).toHaveLength(0);
  });

  it("drops a static skill also present in activeState (bundled) when disabled", async () => {
    const collection = createMockSkillsCollection();
    collection._store.set("skills/brief/SKILL.md", {
      name: "skills/brief/SKILL.md",
      state: { description: "brief", disableModelInvocation: true },
      content: null,
    });
    const { ctx } = buildExecCtx(collection);
    (ctx as { session: { state: Record<string, unknown> } }).session.state.activeSkills = [
      { name: "brief", mode: "inline", activatedAt: 1 },
    ];
    const sources = await collectAgentSources(ctx, {
      catalog: {},
      collectionKey: "skills",
      location: { kind: "explicit", scope: "session", field: "activeSkills" },
      staticSources: [
        { skillName: "brief", agents: { briefer: { prompt: "You write briefs." } } },
      ],
      bundledAgentIndex: new Map([
        ["brief", { agents: { briefer: { prompt: "You write briefs." } } }],
      ]),
      dynamicEligible: true,
    } as never);
    // static loop drops it AND the bundled branch does not re-add under the name.
    expect(sources).toHaveLength(0);
  });

  it("keeps an enabled bundled runtime activation (no false drop)", async () => {
    const collection = createMockSkillsCollection();
    collection._store.set("skills/brief/SKILL.md", {
      name: "skills/brief/SKILL.md",
      state: { description: "brief" },
      content: null,
    });
    const { ctx } = buildExecCtx(collection);
    (ctx as { session: { state: Record<string, unknown> } }).session.state.activeSkills = [
      { name: "brief", mode: "inline", activatedAt: 1 },
    ];
    const sources = await collectAgentSources(ctx, {
      catalog: {},
      collectionKey: "skills",
      location: { kind: "explicit", scope: "session", field: "activeSkills" },
      staticSources: [],
      bundledAgentIndex: new Map([
        ["brief", { agents: { briefer: { prompt: "You write briefs." } } }],
      ]),
      dynamicEligible: true,
    } as never);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.skillName).toBe("brief");
  });
});

// ---------------------------------------------------------------------------
// Disable-safety with a WARM memo — a mid-turn disable drops the skill from
// both tools and roster even though the previous step cached the build.
// ---------------------------------------------------------------------------

describe("delegation memo — mid-turn disable busts the cache", () => {
  it("drops a disabled skill's tools and roster at the next step despite a warm memo", async () => {
    const collection = createMockSkillsCollection();
    collection._store.set("skills/scout-team/SKILL.md", {
      name: "skills/scout-team/SKILL.md",
      state: { description: "scout team" },
      content: null,
    });
    const { gen, materializeAgent } = buildScoutGenerator();
    const { ctx } = buildExecCtx(collection);
    const guidanceFn = buildDelegationGuidance(
      // Rebuild the surface deps by resolving through the generator; simplest is
      // to assert via the generator's own guidance context. Instead we assert on
      // the tool surface + a direct guidance resolver over the same deps shape.
      {
        catalog: {},
        collectionKey: "skills",
        location: { kind: "explicit", scope: "session", field: "activeSkills" },
        staticSources: [
          { skillName: "scout-team", agents: { scout: { prompt: "You scout." } } },
        ],
        bundledAgentIndex: new Map(),
        dynamicEligible: false,
      } as never,
    );

    // Step 0: enabled → tools + roster present, one materialization.
    const step0 = (await resolveTools(gen, ctx)).map(toolName);
    expect(step0).toContain("runBoard");
    expect(await guidanceFn(undefined, ctx)).toContain("scout");
    expect(materializeAgent).toHaveBeenCalledTimes(1);

    // Disable mid-turn.
    collection._store.set("skills/scout-team/SKILL.md", {
      name: "skills/scout-team/SKILL.md",
      state: { description: "scout team", disableModelInvocation: true },
      content: null,
    });

    // Step 1: snapshot shrinks → cache busts → tools gone, roster null, and no
    // extra materialization (rebuild yields an empty roster).
    const step1 = (await resolveTools(gen, ctx)).map(toolName);
    expect(step1).not.toContain("runBoard");
    expect(await guidanceFn(undefined, ctx)).toBeNull();
    expect(materializeAgent).toHaveBeenCalledTimes(1);
  });

  it("rebuilds when a new skill is activated between steps", async () => {
    // Base roster active (scout-team, static); a second agent-declaring skill
    // (helper-team, bundled but NOT statically active) gets activated mid-turn
    // via the binding's block-state activation field — the snapshot grows →
    // the memo busts → a second materialization at step 1.
    const helperSkill: InitialSkill = {
      name: "helper-team",
      skillMd: [
        "---",
        "description: helper team",
        "agents:",
        "  helper:",
        "    prompt: You help.",
        "---",
        "",
        "Delegate to the helper.",
      ].join("\n"),
    };
    const agents = deterministicAgents();
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [scoutSkill, helperSkill],
      ...agents,
    });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["scout-team"], dynamicActivation: true } as never)],
    });
    const { ctx, selfState } = buildExecCtx();

    const step0 = (await resolveTools(gen, ctx)).map(toolName);
    expect(step0).toContain("runBoard");
    expect(agents.materializeAgent).toHaveBeenCalledTimes(1); // scout-team only

    // Activate helper-team mid-turn (block-state location — the binding's
    // default when no `activeState` is configured).
    selfState.activeSkills = [
      { name: "helper-team", mode: "inline", activatedAt: Date.now() },
    ];

    // Step 1: snapshot now covers scout-team + helper-team → cache busts →
    // a full rebuild re-materializes scout-team's agent-ref agent, so the
    // count grows (helper-team's inline agent needs no materializeAgent call).
    const step1 = (await resolveTools(gen, ctx)).map(toolName);
    expect(step1).toContain("runBoard");
    expect(agents.materializeAgent).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// snapshotSources — structural, order-independent projection
// ---------------------------------------------------------------------------

describe("snapshotSources", () => {
  const src = (skillName: string, keys: string[], input?: string): DelegationAgentSource => ({
    skillName,
    agents: Object.fromEntries(keys.map((k) => [k, { prompt: `body-${k}` }])),
    ...(input !== undefined ? { input } : {}),
  });

  it("is order-independent across sources and agent keys", () => {
    const a = snapshotSources([src("z", ["b", "a"]), src("a", ["c"])]);
    const b = snapshotSources([src("a", ["c"]), src("z", ["a", "b"])]);
    expect(a).toEqual(b);
  });

  it("is sensitive to the activation input", () => {
    const a = snapshotSources([src("s", ["k"], "topic-1")]);
    const b = snapshotSources([src("s", ["k"], "topic-2")]);
    expect(a).not.toEqual(b);
  });

  it("changes when a skill drops out (disable)", () => {
    const before = snapshotSources([src("s1", ["k"]), src("s2", ["k"])]);
    const after = snapshotSources([src("s1", ["k"])]);
    expect(before).not.toEqual(after);
  });

  it("ignores an agent's body under an unchanged key (accepted staleness)", () => {
    const a = snapshotSources([src("s", ["k"])]);
    const withDifferentBody: DelegationAgentSource = {
      skillName: "s",
      agents: { k: { prompt: "a completely different body" } },
    };
    expect(a).toEqual(snapshotSources([withDifferentBody]));
  });
});

// ---------------------------------------------------------------------------
// specsCollide — the shared agent-key collision predicate (D3)
// ---------------------------------------------------------------------------

describe("specsCollide", () => {
  it("false for identical specs (dedupe into one board worker)", () => {
    expect(specsCollide({ prompt: "x" }, { prompt: "x" })).toBe(false);
  });

  it("true for divergent specs under a shared key (real collision)", () => {
    expect(specsCollide({ prompt: "x" }, { prompt: "y" })).toBe(true);
    expect(specsCollide({ agentRef: "a" }, { prompt: "y" })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D2 — workerInputSchema is the substrate's schema (accepts title/context)
// ---------------------------------------------------------------------------

describe("workerInputSchema (aliased to taskWorkerInputSchema)", () => {
  it("validates a board dispatch carrying the superset's optional fields", () => {
    const parsed = workerInputSchema.safeParse({
      taskId: "t1",
      goal: "do the thing",
      title: "Thing",
      context: "surrounding context",
      attempts: 0,
    });
    expect(parsed.success).toBe(true);
  });

  it("is the same schema object as the substrate owner", () => {
    expect(workerInputSchema).toBe(taskWorkerInputSchema);
  });
});
