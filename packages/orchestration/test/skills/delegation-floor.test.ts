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
import { FLOOR_WORKER_KEY } from "../../src/skills/delegation-surface";
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

    // Exactly one worker was materialized — the floor — under the reserved key.
    expect(materializeWorkerSpy).toHaveBeenCalledTimes(1);
    expect(materializeWorkerSpy.mock.calls[0]![0]).toBe(FLOOR_WORKER_KEY);
    // The board was built with a defaultWorker.
    expect(taskBoardSpy).toHaveBeenCalledTimes(1);
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
