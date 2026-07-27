/**
 * Tests for the on-demand default worker — the delegation floor (FIX-940).
 *
 * The floor lets a skill delegate without hand-writing a roster: bind with
 * `delegation: true` and no `agents:`, and the surface still installs (board +
 * taskTools + runBoard) with the default worker as its only participant. When a
 * roster IS declared, the floor is additionally wired as the board's fallback so
 * an unknown/absent assignee runs on it (decision 3).
 *
 * The board-routing mechanism itself (unknown/absent → fallback, declared wins,
 * no-floor-still-throws) is proven deterministically at the board layer in
 * `task-board.test.ts`. Here we prove the delegation SURFACE wires it: the floor
 * is materialized and passed as `defaultWorker`, the rosterless surface installs,
 * the guidance advertises the floor, and — load-bearing — a multi-step rosterless
 * turn constructs the board exactly once (the per-execution memo, FIX-928).
 *
 * `taskBoard` and `materializeWorker` are wrapped (not replaced) so we can count
 * construction without changing behavior; nothing here drains a board.
 */
import { describe, expect, it, vi } from "vitest";
import { generator } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { z } from "zod";
import { createMockSkillsCollection } from "./mocks";

// Wrap the real implementations so we can count construction. The wrappers call
// through, so behavior is identical — only observability is added.
vi.mock("../../src/task-board", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/task-board")>();
  return { ...actual, taskBoard: vi.fn(actual.taskBoard) };
});
vi.mock("../../src/skills/worker-materializer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/skills/worker-materializer")>();
  return { ...actual, materializeWorker: vi.fn(actual.materializeWorker) };
});

import { createSkillsLibrary } from "../../src/skills/library";
import {
  buildDelegationGuidance,
  buildDelegationTools,
  FLOOR_WORKER_KEY,
} from "../../src/skills/delegation-surface";
import { taskBoard } from "../../src/task-board";
import { materializeWorker } from "../../src/skills/worker-materializer";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";

const taskBoardSpy = vi.mocked(taskBoard);
const materializeWorkerSpy = vi.mocked(materializeWorker);

// ---------------------------------------------------------------------------
// Harness — a mock generator execution ctx (board on own state).
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
  return { ctx: ctx as never, selfState };
}

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

/** A plain skill (body only, NO agents) — the rosterless coordinator. */
const coordinatorSkill: InitialSkill = {
  name: "coordinator",
  skillMd: [
    "---",
    "description: break work into parts and farm each out",
    "---",
    "",
    "Plan the work on your board, then call runBoard once.",
  ].join("\n"),
};

/** A skill with one inline (prompt) agent — a declared roster. */
const briefSkill: InitialSkill = {
  name: "brief",
  skillMd: [
    "---",
    "description: single inline agent",
    "agents:",
    "  briefer:",
    "    prompt: You write briefs.",
    "---",
    "",
    "Delegate to the briefer.",
  ].join("\n"),
};

// ---------------------------------------------------------------------------
// Rosterless install (delegation: true, no agents)
// ---------------------------------------------------------------------------

describe("delegation floor — rosterless install", () => {
  it("delegation: true with no agents installs taskTools + runBoard", async () => {
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"], delegation: true } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).toEqual(expect.arrayContaining(["addTask", "listTasks", "runBoard"]));
    // The floor is the board's fallback, not a host tool.
    expect(names).not.toContain(FLOOR_WORKER_KEY);
  });

  it("no delegation flag and no agents installs nothing (unchanged)", async () => {
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"] } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).not.toContain("runBoard");
    expect(names).not.toContain("addTask");
  });

  it("delegation: false suppresses the surface even for a roster skill", async () => {
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [briefSkill] });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["brief"], delegation: false } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).not.toContain("runBoard");
  });
});

// ---------------------------------------------------------------------------
// The floor is wired as the board's defaultWorker (rosterless AND roster)
// ---------------------------------------------------------------------------

describe("delegation floor — wiring", () => {
  it("materializes the floor and passes it as the board's defaultWorker (rosterless)", async () => {
    taskBoardSpy.mockClear();
    materializeWorkerSpy.mockClear();
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"], delegation: true } as never)],
    });
    const { ctx } = buildExecCtx();
    await resolveTools(gen, ctx);

    // The materialized roster is exactly the floor — no phantom workers.
    // (Build COUNTS are the memo-once test's job, not this one's.)
    expect(materializeWorkerSpy.mock.calls.map((c) => c[0])).toEqual([FLOOR_WORKER_KEY]);
    // The board was built with a defaultWorker.
    const cfg = taskBoardSpy.mock.calls[0]![0] as { defaultWorker?: unknown };
    expect(cfg.defaultWorker).toBeDefined();
  });

  it("wires the floor alongside a declared roster (roster + floor coexist)", async () => {
    taskBoardSpy.mockClear();
    materializeWorkerSpy.mockClear();
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [briefSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      // agents present → delegation derived on; no `delegation: true` needed.
      uses: [skills.with({ active: ["brief"] } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).toEqual(expect.arrayContaining(["addTask", "runBoard"]));

    // The declared agent AND the floor were both materialized.
    const keys = materializeWorkerSpy.mock.calls.map((c) => c[0]);
    expect(keys).toContain("briefer");
    expect(keys).toContain(FLOOR_WORKER_KEY);
    const cfg = taskBoardSpy.mock.calls[0]![0] as { defaultWorker?: unknown };
    expect(cfg.defaultWorker).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Reserved keys — an agent map that never went through the SKILL.md parser
// ---------------------------------------------------------------------------

describe("delegation floor — reserved agent keys", () => {
  /**
   * `buildDelegationTools` is driven directly here with a hand-built source
   * list. That is the point: `parseAgentsField` rejects these keys on the
   * authoring path, but `collectAgentSources` also reads `agents` straight off
   * a live skill manifest whose state schema is `.passthrough()` and does not
   * describe `agents`, so a manifest written out-of-band arrives unparsed. This
   * pins the re-check that stands between such a map and the board's registry.
   */
  function plantedDeps(agents: Record<string, unknown>, allowEmptyRoster = true) {
    return {
      catalog: {},
      collectionKey: "skills",
      location: { kind: "block" as const },
      staticSources: [{ skillName: "planted", agents: agents as never }],
      bundledAgentIndex: new Map(),
      dynamicEligible: false,
      allowEmptyRoster,
    };
  }

  async function toolsForAgents(agents: Record<string, unknown>) {
    const collection = createMockSkillsCollection();
    const { ctx } = buildExecCtx(collection);
    return buildDelegationTools(ctx, plantedDeps(agents));
  }

  it.each([
    // Would shadow the absent-assignee sentinel: unassigned tasks would route
    // to this agent instead of the floor.
    "__no_assignee__",
    // Would collide with the floor's own reserved worker key.
    FLOOR_WORKER_KEY,
    // Hits the Object.prototype setter rather than creating an own key, which
    // would leave the registry empty and silently disable the surface.
    "__proto__",
    // Uppercase — outside the agent-key pattern.
    "ToString",
  ])("skips the illegal agent key %s and still builds the floor", async (key) => {
    materializeWorkerSpy.mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const names = (await toolsForAgents({ [key]: { prompt: "planted" } })).map(toolName);
      // The surface still installs — on the floor alone.
      expect(names).toEqual(expect.arrayContaining(["addTask", "runBoard"]));
      // The planted key never became a board worker; only the floor was built.
      const built = materializeWorkerSpy.mock.calls.map((c) => c[0]);
      expect(built).toEqual([FLOOR_WORKER_KEY]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(key));
    } finally {
      warn.mockRestore();
    }
  });

  it("keeps a legal agent key declared alongside an illegal one", async () => {
    materializeWorkerSpy.mockClear();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await toolsForAgents({
        briefer: { prompt: "You write briefs." },
        __no_assignee__: { prompt: "planted" },
      });
      const built = materializeWorkerSpy.mock.calls.map((c) => c[0]);
      expect(built).toContain("briefer");
      expect(built).not.toContain("__no_assignee__");
    } finally {
      warn.mockRestore();
    }
  });

  // One roster, not two: the coordinator must never be TOLD about an agent the
  // worker registry refused to build. Otherwise it assigns to a name that
  // silently falls to the generic floor.
  it("does not advertise a rejected agent in the guidance roster", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const collection = createMockSkillsCollection();
      const { ctx } = buildExecCtx(collection);
      const deps = plantedDeps({
        briefer: { prompt: "You write briefs." },
        __no_assignee__: { prompt: "planted" },
      });
      const guidance = await buildDelegationGuidance(deps as never)(undefined, ctx);
      expect(guidance).toContain("briefer");
      expect(guidance).not.toContain("__no_assignee__");
    } finally {
      warn.mockRestore();
    }
  });

  // The degenerate case: every declared key is illegal, and delegation was
  // DERIVED from the roster (allowEmptyRoster false) rather than forced on. The
  // roster is empty, so no tools install and the guidance must not claim a
  // board — but the surface must not vanish SILENTLY either, or a corrupt
  // out-of-band manifest is indistinguishable from a legitimately empty roster
  // (the hardest version to debug: delegation simply isn't there). Exactly one
  // warning — the diagnostic rides the same per-snapshot memo as the build, so
  // repeated tool-loop steps don't spam it.
  it("warns exactly once when every key is rejected and the floor is off", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const collection = createMockSkillsCollection();
      const { ctx } = buildExecCtx(collection);
      const deps = plantedDeps({ __no_assignee__: { prompt: "planted" } }, false);
      const tools = await buildDelegationTools(ctx, deps as never);
      const guidance = await buildDelegationGuidance(deps as never)(undefined, ctx);
      expect(tools).toEqual([]);
      expect(guidance).toBeNull();

      // Both resolver entry points ran on the same ctx, so the memo must have
      // collapsed them into a single diagnostic.
      const rejections = warn.mock.calls.filter((c) =>
        String(c[0]).includes("__no_assignee__"),
      );
      expect(rejections).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });

  // A live manifest gaining an illegal key MID-EXECUTION, with its valid roster
  // otherwise untouched. Filtering removes the new key before the snapshot is
  // taken, so the BUILD identity is unchanged — correctly, since the board,
  // tools and guidance are all identical either way. The diagnostic must not
  // inherit that identity, or the newly rejected key goes unreported until some
  // unrelated roster field happens to change.
  it("reports a key that turns illegal mid-execution under an unchanged roster", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const collection = createMockSkillsCollection();
      const { ctx } = buildExecCtx(collection);

      // Step 1: a clean roster. Builds, caches, warns about nothing.
      await buildDelegationTools(ctx, plantedDeps({ briefer: { prompt: "briefs" } }) as never);
      expect(warn.mock.calls.filter((c) => String(c[0]).includes("__no_assignee__"))).toHaveLength(0);

      // Step 2: same roster PLUS an illegal key — the filtered snapshot is
      // byte-identical, so the build memo legitimately returns its cached entry.
      await buildDelegationTools(
        ctx,
        plantedDeps({
          briefer: { prompt: "briefs" },
          __no_assignee__: { prompt: "planted" },
        }) as never,
      );

      const rejections = warn.mock.calls.filter((c) =>
        String(c[0]).includes("__no_assignee__"),
      );
      expect(rejections).toHaveLength(1);
    } finally {
      warn.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// Board-built-once — the load-bearing memo path (FIX-928 preserved for FIX-940)
// ---------------------------------------------------------------------------

describe("delegation floor — board built exactly once per turn", () => {
  it("a multi-step rosterless turn constructs the board (and floor) once", async () => {
    taskBoardSpy.mockClear();
    materializeWorkerSpy.mockClear();
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"], delegation: true } as never)],
    });
    const { ctx } = buildExecCtx();

    const step0 = await resolveTools(gen, ctx); // build under empty snapshot []
    const step1 = await resolveTools(gen, ctx); // same ctx + empty roster → memo HIT
    const step2 = await resolveTools(gen, ctx);

    // If the empty-roster short-circuit had ignored the floor, the board would
    // rebuild on every step; if it never built, runBoard would be absent.
    expect(taskBoardSpy).toHaveBeenCalledTimes(1);
    expect(materializeWorkerSpy).toHaveBeenCalledTimes(1);

    // The memo returns the SAME built runBoard tool object across steps.
    const runBoard0 = step0.find((t) => toolName(t) === "runBoard");
    const runBoard1 = step1.find((t) => toolName(t) === "runBoard");
    const runBoard2 = step2.find((t) => toolName(t) === "runBoard");
    expect(runBoard0).toBeDefined();
    expect(runBoard1).toBe(runBoard0);
    expect(runBoard2).toBe(runBoard0);
  });
});

// ---------------------------------------------------------------------------
// Guidance advertises the floor (decision 5)
// ---------------------------------------------------------------------------

describe("delegation floor — guidance", () => {
  async function renderGuidance(gen: ReturnType<typeof generator>, ctx: unknown): Promise<string> {
    const fns: Array<(i: unknown, c: unknown) => unknown> = [];
    const collect = (value: unknown): void => {
      if (typeof value === "function") fns.push(value as never);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect((gen.config as { context?: unknown }).context);
    const parts: string[] = [];
    for (const fn of fns) {
      const out = await fn(undefined, ctx);
      if (typeof out === "string") parts.push(out);
    }
    return parts.join("\n");
  }

  it("rosterless guidance leads with the floor and lists no agents", async () => {
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"], delegation: true } as never)],
    });
    const { ctx } = buildExecCtx();
    const rendered = await renderGuidance(gen, ctx);
    expect(rendered).toContain("default worker");
    expect(rendered).not.toContain("Your agents:");
  });

  it("roster guidance shows the roster AND the floor advisory", async () => {
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [briefSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["brief"] } as never)],
    });
    const { ctx } = buildExecCtx();
    const rendered = await renderGuidance(gen, ctx);
    expect(rendered).toContain("Your agents:");
    expect(rendered).toContain("- briefer:");
    expect(rendered).toContain("default worker");
  });
});
