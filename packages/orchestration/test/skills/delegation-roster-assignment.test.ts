/**
 * Tests for roster-aware task assignment on the delegation surface (FIX-924).
 *
 * The gate itself is unit-tested in `task-tools-capability.test.ts`. What is
 * proven here is the wiring that makes it trustworthy: the roster the tools
 * validate against is derived from the board's real worker registry, in the
 * same loop that builds it — so the agents the coordinator is TOLD about, the
 * agents it may assign to, and the agents the board can actually dispatch are
 * one list.
 *
 * This tightens the tradeoff FIX-940 shipped with. The default worker (the
 * floor) stays reachable by INTENT — leave the assignee unset — but no longer
 * by ACCIDENT: a mistyped agent name is refused at `addTask` instead of quietly
 * running a generic worker under the specialist's name. A board with no
 * declared agents has no roster to check against, so it keeps accepting
 * anything and everything lands on the floor.
 */
import { describe, expect, it } from "vitest";
import { generator } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { createMockSkillsCollection } from "./mocks";
import { createSkillsLibrary } from "../../src/skills/library";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";

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

function pickTool(tools: GeneratorTool[], name: string): GeneratorTool {
  const tool = tools.find((t) => (t as { config?: { name?: string } }).config?.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

/** A two-agent skill — the roster assignment is validated against. */
const researchSkill: InitialSkill = {
  name: "research",
  skillMd: [
    "---",
    "description: research and write",
    "agents:",
    "  researcher:",
    "    prompt: Researches sources and returns findings.",
    "  writer:",
    "    prompt: Drafts prose from findings.",
    "---",
    "",
    "Delegate research, then writing.",
  ].join("\n"),
};

/** A plain skill with NO agents — the rosterless coordinator. */
const coordinatorSkill: InitialSkill = {
  name: "coordinator",
  skillMd: [
    "---",
    "description: farm work out",
    "---",
    "",
    "Plan on your board, then call runBoard.",
  ].join("\n"),
};

function rosterSurface() {
  const skills = createSkillsLibrary({ catalog: {}, initialSkills: [researchSkill] });
  const gen = generator({
    name: "executive",
    model: "openai/gpt-5.4-mini",
    prompt: "delegate",
    inputSchema: z.object({}),
    uses: [skills.with({ active: ["research"] } as never)],
  });
  return { gen, ...buildExecCtx() };
}

function board(selfState: Record<string, unknown>): Record<string, { assignee?: string }> {
  return selfState[DELEGATION_BOARD_FIELD] as Record<string, { assignee?: string }>;
}

// ---------------------------------------------------------------------------

describe("delegation surface — assignment validated against the declared roster", () => {
  it("rejects a typo'd assignee at addTask, never letting it reach the board", async () => {
    const { gen, ctx, selfState } = rosterSurface();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "Find sources", assignee: "reseacher" }, ctx);

    expect((result as { ok: boolean }).ok).toBe(false);
    // The correction the model needs is in the message: the bad name, and the
    // real roster derived from the board's workers.
    const error = (result as { error: string }).error;
    expect(error).toContain("unknown_assignee");
    expect(error).toContain('"reseacher"');
    expect(error).toContain("researcher");
    expect(error).toContain("writer");
    // Fail-at-creation means exactly this: no task is left to error at drain.
    expect(Object.keys(board(selfState))).toEqual([]);
  });

  it("accepts each declared agent", async () => {
    const { gen, ctx, selfState } = rosterSurface();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    for (const assignee of ["researcher", "writer"]) {
      const result = await runForTest(addTask, { goal: `work for ${assignee}`, assignee }, ctx);
      expect((result as { ok: boolean }).ok).toBe(true);
    }
    expect(Object.values(board(selfState)).map((t) => t.assignee).sort()).toEqual([
      "researcher",
      "writer",
    ]);
  });

  it("still accepts an unassigned task, so the floor stays reachable by intent", async () => {
    // FIX-940's floor is not withdrawn — only the accidental route to it is.
    const { gen, ctx, selfState } = rosterSurface();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "anyone can do this" }, ctx);

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(board(selfState))[0]?.assignee).toBeUndefined();
  });

  it("rejects a reassignment to an undeclared agent", async () => {
    const { gen, ctx, selfState } = rosterSurface();
    const tools = await resolveTools(gen, ctx);
    const created = await runForTest(
      pickTool(tools, "addTask"),
      { goal: "draft", assignee: "writer" },
      ctx,
    );
    const taskId = (created as { taskId: string }).taskId;

    const result = await runForTest(
      pickTool(tools, "assignTask"),
      { taskId, assignee: "editor" },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(false);
    expect(board(selfState)[taskId]?.assignee).toBe("writer");
  });

  it("validates against the same roster the guidance advertises", async () => {
    // One source of truth. If these two could disagree, the coordinator would
    // be handed a name it is then refused for using.
    const { gen, ctx } = rosterSurface();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");
    const rejection = await runForTest(addTask, { goal: "x", assignee: "nobody" }, ctx);
    const guidance = await buildGuidanceText(gen, ctx);

    for (const agent of ["researcher", "writer"]) {
      expect(guidance).toContain(agent);
      expect((rejection as { error: string }).error).toContain(agent);
    }
  });

  it("no longer tells the coordinator an unrecognized assignee will run anyway", async () => {
    // FIX-940's guidance promised the floor catches an unrecognized assignee.
    // With the gate in place that promise is false for a roster board, and a
    // false promise in context is worse than no promise.
    const { gen, ctx } = rosterSurface();
    const guidance = await buildGuidanceText(gen, ctx);
    expect(guidance).toContain("Your agents:");
    expect(guidance).toContain("rejected");
    expect(guidance).not.toContain("unrecognized");
  });
});

describe("delegation surface — a rosterless board validates nothing", () => {
  it("accepts any assignee when no agents are declared", async () => {
    // `delegation: true` with no `agents:` means the floor IS the team. There
    // is no roster to check against, so the gate must stay inert rather than
    // reject every assignee against an empty list.
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"], delegation: true } as never)],
    });
    const { ctx, selfState } = buildExecCtx();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "x", assignee: "whoever" }, ctx);

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(board(selfState))[0]?.assignee).toBe("whoever");
  });

  it("tells a rosterless coordinator to leave the assignee unset, with no rejection warning", async () => {
    const skills = createSkillsLibrary({ catalog: {}, initialSkills: [coordinatorSkill] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["coordinator"], delegation: true } as never)],
    });
    const { ctx } = buildExecCtx();
    const guidance = await buildGuidanceText(gen, ctx);
    expect(guidance).toContain("default worker");
    expect(guidance).not.toContain("Your agents:");
    expect(guidance).not.toContain("rejected");
  });
});

/** Render every guidance context function the generator carries. */
async function buildGuidanceText(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<string> {
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
