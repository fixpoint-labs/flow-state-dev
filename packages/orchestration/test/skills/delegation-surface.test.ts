/**
 * Tests for the runtime delegation surface (FIX-918): a bound skill with
 * `agents:` gives its generator the board-commanded surface — the eight
 * `taskTools` plus `runBoard`, and NO per-agent tool. Work reaches an agent
 * only by being assigned as a task and drained.
 *
 * The drain test is load-bearing: the executive plans tasks on its own-state
 * ledger (`addTask` with assignee/deps/input), then `runBoard` executes the
 * graph — analysts before the dep-gated synthesizer. To keep it deterministic
 * (no model), the agents are `agent-ref`s whose injected `materializeAgent`
 * returns handler board-workers. A second plan-then-run on the SAME ledger
 * drains only the new pending tasks: run identity comes from task status, not a
 * manufactured per-call collection id.
 */
import { describe, expect, it, vi } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { runForTest, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { createSkillsLibrary } from "../../src/skills/library";
import { collectAgentSources } from "../../src/skills/delegation-surface";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";
import { taskWorkerInputSchema } from "../../src/task-board";
import { createMockSkillsCollection } from "./mocks";

// ---------------------------------------------------------------------------
// Fixtures — deterministic handler board-workers, staffed via agent-ref +
// an injected materializeAgent (no model in the loop).
// ---------------------------------------------------------------------------

const analystBlock = handler({
  name: "analyst",
  inputSchema: taskWorkerInputSchema.extend({
    input: z.object({ subject: z.string() }).optional(),
  }),
  outputSchema: z.object({ findings: z.string() }),
  execute: (input) => ({ findings: `findings: ${input.input?.subject ?? "unknown"}` }),
});

const synthesizerBlock = handler({
  name: "synthesizer",
  inputSchema: taskWorkerInputSchema,
  outputSchema: z.object({ report: z.string() }),
  execute: (input) => ({
    report: Object.values(input.deps ?? {})
      .map((d) => (d as { findings?: string })?.findings ?? "?")
      .join(" | "),
  }),
});

/** A registry + materializer that staff each agent key with a handler worker. */
function deterministicAgents() {
  const agentRegistry = {
    get: vi.fn(async (name: string) => ({ name })),
    list: vi.fn(async () => [{ name: "analyst-agent" }, { name: "synthesizer-agent" }]),
  };
  const materializeAgent = vi.fn((_agent: unknown, opts: { workerKey?: string }) =>
    (opts.workerKey === "synthesizer" ? synthesizerBlock : analystBlock) as never,
  );
  return { agentRegistry, materializeAgent };
}

const teamSkill: InitialSkill = {
  name: "research-team",
  skillMd: [
    "---",
    "description: research team skill",
    "agents:",
    "  analyst:",
    "    agent-ref: analyst-agent",
    "  synthesizer:",
    "    agent-ref: synthesizer-agent",
    "---",
    "",
    "Plan tasks with addTask, then call runBoard.",
  ].join("\n"),
};

const promptSkill: InitialSkill = {
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

/**
 * A mock generator execution context. `self` is the generator's own-state ref
 * (the board lives there); `parent` mirrors it the way a tool child sees the
 * host generator. atomicState follows the real contract: the mutator returns
 * a partial patch that is merged.
 */
function buildExecCtx(collection = createMockSkillsCollection()) {
  const selfState: Record<string, unknown> = { [DELEGATION_BOARD_FIELD]: {} };
  const stateRef = {
    name: "executive",
    instanceId: "executive#0",
    get state() {
      return selfState;
    },
    atomicState: async (
      fn: (
        state: Record<string, unknown>,
      ) => Promise<Record<string, unknown>> | Record<string, unknown>,
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
      state: {},
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

/** Resolve the generator's merged tool surface with the mock execution ctx. */
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

function toolNamed(tools: GeneratorTool[], name: string): GeneratorTool {
  const tool = tools.find((t) => toolName(t) === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

function buildTeamGenerator() {
  const skills = createSkillsLibrary({
    catalog: {},
    initialSkills: [teamSkill],
    ...deterministicAgents(),
  });
  return generator({
    name: "executive",
    model: "openai/gpt-5.4-mini",
    prompt: "delegate",
    inputSchema: z.object({}),
    uses: [skills.with({ active: ["research-team"] } as never)],
  });
}

// ---------------------------------------------------------------------------
// Surface shape — board-only, no per-agent tools
// ---------------------------------------------------------------------------

describe("delegation surface — installed tools", () => {
  it("installs taskTools + runBoard, and NO per-agent tool, for an active agent skill", async () => {
    const gen = buildTeamGenerator();
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).toEqual(expect.arrayContaining(["addTask", "listTasks", "runBoard"]));
    // The board commands agents; the host never calls an agent as a tool.
    expect(names).not.toContain("analyst");
    expect(names).not.toContain("synthesizer");
  });

  it("installs nothing for a skill without agents", async () => {
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [
        { name: "plain", skillMd: "---\ndescription: plain\n---\n\nbody" },
      ],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["plain"] } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).not.toContain("runBoard");
    expect(names).not.toContain("addTask");
  });
});

// ---------------------------------------------------------------------------
// The board: plan → run → results (and again on the same ledger)
// ---------------------------------------------------------------------------

describe("delegation surface — runBoard drains the own-state ledger", () => {
  it("executes an addTask-planned dependency graph and returns settled results", async () => {
    const gen = buildTeamGenerator();
    const { ctx, selfState } = buildExecCtx();
    const tools = await resolveTools(gen, ctx);
    const addTask = toolNamed(tools, "addTask");
    const runBoard = toolNamed(tools, "runBoard");

    // The executive plans: two analyst tasks in parallel, a synthesizer gated on both.
    const a = (await runForTest(
      addTask,
      { goal: "market analysis", assignee: "analyst", input: { subject: "ACME market" } },
      ctx,
    )) as { taskId: string };
    const b = (await runForTest(
      addTask,
      { goal: "financial analysis", assignee: "analyst", input: { subject: "ACME financials" } },
      ctx,
    )) as { taskId: string };
    await runForTest(
      addTask,
      { goal: "synthesize", assignee: "synthesizer", deps: [a.taskId, b.taskId] },
      ctx,
    );

    const run = await testBlock(runBoard as never, { input: {} as never });
    expect(run.error).toBeNull();
    const output = run.output as {
      status: string;
      tasks: Array<{ status: string; assignee?: string; output?: unknown }>;
    };
    expect(output.status).toBe("drained");
    expect(output.tasks).toHaveLength(3);
    expect(output.tasks.every((t) => t.status === "completed")).toBe(true);

    // The synthesizer ran AFTER its deps and saw their outputs.
    const synth = output.tasks.find((t) => t.assignee === "synthesizer")!;
    expect((synth.output as { report: string }).report).toContain("findings: ACME market");
    expect((synth.output as { report: string }).report).toContain("findings: ACME financials");

    // The ledger is the generator's own state — settled in place.
    const board = selfState[DELEGATION_BOARD_FIELD] as Record<string, { status: string }>;
    expect(Object.values(board).every((t) => t.status === "completed")).toBe(true);
  });

  it("a second plan-then-run on the same ledger drains only the new tasks", async () => {
    // Run identity comes from task status (generated ids, pending-only claims),
    // not from a per-call collection id — no UUID run bookkeeping.
    const gen = buildTeamGenerator();
    const { ctx } = buildExecCtx();
    const tools = await resolveTools(gen, ctx);
    const addTask = toolNamed(tools, "addTask");
    const runBoard = toolNamed(tools, "runBoard");

    await runForTest(
      addTask,
      { goal: "first", assignee: "analyst", input: { subject: "first" } },
      ctx,
    );
    const first = await testBlock(runBoard as never, { input: {} as never });
    expect(first.error).toBeNull();
    expect((first.output as { tasks: unknown[] }).tasks).toHaveLength(1);

    await runForTest(
      addTask,
      { goal: "second", assignee: "analyst", input: { subject: "second" } },
      ctx,
    );
    const second = await testBlock(runBoard as never, { input: {} as never });
    expect(second.error).toBeNull();
    const output = second.output as {
      status: string;
      tasks: Array<{ goal: string; status: string; output?: unknown }>;
    };
    // Both runs' tasks are on the ledger, all settled; the second run claimed
    // only the new pending task (the first stayed completed, was not re-run).
    expect(output.status).toBe("drained");
    expect(output.tasks).toHaveLength(2);
    expect(output.tasks.every((t) => t.status === "completed")).toBe(true);
    const secondTask = output.tasks.find((t) => t.goal === "second")!;
    expect((secondTask.output as { findings: string }).findings).toBe("findings: second");
  });

  it("reports status 'blocked' when a task is parked via blockTask", async () => {
    // A blocked task means the board did not fully drain — settle must report
    // `blocked`, not `drained`, or the coordinator treats stuck work as done.
    const gen = buildTeamGenerator();
    const { ctx } = buildExecCtx();
    const tools = await resolveTools(gen, ctx);
    const addTask = toolNamed(tools, "addTask");
    const blockTask = toolNamed(tools, "blockTask");
    const runBoard = toolNamed(tools, "runBoard");

    const t = (await runForTest(
      addTask,
      { goal: "waits on a human", assignee: "analyst" },
      ctx,
    )) as { taskId: string };
    await runForTest(blockTask, { taskId: t.taskId, reason: "pending external input" }, ctx);

    const run = await testBlock(runBoard as never, { input: {} as never });
    expect(run.error).toBeNull();
    const output = run.output as { status: string; tasks: Array<{ status: string }> };
    expect(output.status).toBe("blocked");
  });
});

describe("delegation surface — active ∪ runtime activation input", () => {
  it("carries a runtime activation's input onto an already-static agent skill", async () => {
    // A skill preloaded via `active` AND loaded at runtime with an input arg:
    // the body reader lets the dynamic activation win, so the skill's agents
    // must see the same $ARGUMENTS substitution instead of an empty one.
    const { ctx } = buildExecCtx();
    (ctx as { session: { state: Record<string, unknown> } }).session.state.activeSkills = [
      { name: "brief", mode: "inline", input: "topic-42", activatedAt: 1 },
    ];
    const sources = await collectAgentSources(ctx, {
      catalog: {},
      collectionKey: "skills",
      location: { kind: "explicit", scope: "session", field: "activeSkills" },
      staticSources: [
        { skillName: "brief", agents: { briefer: { prompt: "Brief about $ARGUMENTS." } } },
      ],
      bundledAgentIndex: new Map(),
      dynamicEligible: true,
    } as never);

    const brief = sources.filter((s) => s.skillName === "brief");
    expect(brief).toHaveLength(1); // not duplicated
    expect(brief[0]!.input).toBe("topic-42");
  });
});

// ---------------------------------------------------------------------------
// Cross-skill agent dedupe
// ---------------------------------------------------------------------------

describe("delegation surface — two active skills sharing an agent", () => {
  it("dedupes an identical agent spec across skills; a divergent spec fails loud at build", async () => {
    const skillA: InitialSkill = {
      name: "team-a",
      skillMd: [
        "---",
        "description: a",
        "agents:",
        "  analyst:",
        "    agent-ref: analyst-agent",
        "  synthesizer:",
        "    agent-ref: synthesizer-agent",
        "---",
        "",
        "a",
      ].join("\n"),
    };
    const skillB: InitialSkill = {
      name: "team-b",
      skillMd: [
        "---",
        "description: b",
        "agents:",
        "  synthesizer:",
        "    agent-ref: synthesizer-agent",
        "---",
        "",
        "b",
      ].join("\n"),
    };
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [skillA, skillB],
      ...deterministicAgents(),
    });
    // Identical `synthesizer` spec across both skills → builds without collision.
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["team-a", "team-b"] } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).toEqual(expect.arrayContaining(["addTask", "runBoard"]));
    expect(names).not.toContain("synthesizer");

    // A DIFFERENT spec under the same key is a real collision — fails at build.
    const conflicting: InitialSkill = {
      name: "team-c",
      skillMd: [
        "---",
        "description: c",
        "agents:",
        "  synthesizer:",
        "    prompt: You synthesize differently.",
        "---",
        "",
        "c",
      ].join("\n"),
    };
    const skills2 = createSkillsLibrary({
      catalog: {},
      initialSkills: [skillA, conflicting],
      ...deterministicAgents(),
    });
    expect(() =>
      generator({
        name: "g2",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        inputSchema: z.object({}),
        uses: [skills2.with({ active: ["team-a", "team-c"] } as never)],
      }),
    ).toThrow(/different spec/);
  });
});

// ---------------------------------------------------------------------------
// agent-ref agents
// ---------------------------------------------------------------------------

describe("delegation surface — agent-ref agents", () => {
  const agentSkill: InitialSkill = {
    name: "agent-team",
    skillMd: [
      "---",
      "description: agent-ref skill",
      "agents:",
      "  scout:",
      "    agent-ref: scout-agent",
      "---",
      "",
      "Delegate to the scout.",
    ].join("\n"),
  };

  it("materializes an agent-ref agent through the injected registry — no host tool", async () => {
    const scoutBlock = handler({
      name: "scout",
      inputSchema: taskWorkerInputSchema,
      outputSchema: z.string(),
      execute: async () => "scouted",
    });
    const agent = { name: "scout-agent" };
    const agentRegistry = {
      get: vi.fn(async (name: string) => (name === "scout-agent" ? agent : undefined)),
      list: vi.fn(async () => [agent]),
    };
    const materializeAgent = vi.fn(() => scoutBlock as never);
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [agentSkill],
      agentRegistry: agentRegistry as never,
      materializeAgent: materializeAgent as never,
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["agent-team"] } as never)],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    // The agent is a board participant, resolved through the registry — but it
    // is NOT a host tool.
    expect(agentRegistry.get).toHaveBeenCalledWith("scout-agent");
    expect(materializeAgent).toHaveBeenCalled();
    expect(names).toEqual(expect.arrayContaining(["addTask", "runBoard"]));
    expect(names).not.toContain("scout");
  });

  it("a static agent-ref skill without registry wiring fails loud at build time", () => {
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [agentSkill],
    });
    expect(() =>
      generator({
        name: "g",
        model: "openai/gpt-5.4-mini",
        prompt: "p",
        inputSchema: z.object({}),
        uses: [skills.with({ active: ["agent-team"] } as never)],
      }),
    ).toThrow(/agent-ref "scout-agent".*agentRegistry/s);
  });
});

// ---------------------------------------------------------------------------
// Runtime-activated agent skills
// ---------------------------------------------------------------------------

describe("delegation surface — runtime activations", () => {
  it("an agent skill activated at an explicit location contributes tools on resolution", async () => {
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [promptSkill],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [
        skills.with({
          activeState: { scope: "session", field: "activeSkills" },
        } as never),
      ],
    });
    const { ctx } = buildExecCtx();
    (ctx as { session: { state: Record<string, unknown> } }).session.state.activeSkills = [
      { name: "brief", mode: "inline", activatedAt: 1 },
    ];
    const names = (await resolveTools(gen, ctx)).map(toolName);
    // The board surface installs on activation; the inline agent is a board
    // participant, not a host tool.
    expect(names).toEqual(expect.arrayContaining(["addTask", "runBoard"]));
    expect(names).not.toContain("briefer");
  });

  it("no activation → no delegation tools (board stays a dormant declaration)", async () => {
    const skills = createSkillsLibrary({
      catalog: {},
      initialSkills: [promptSkill],
    });
    const gen = generator({
      name: "g",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      inputSchema: z.object({}),
      uses: [
        skills.with({
          activeState: { scope: "session", field: "activeSkills" },
        } as never),
      ],
    });
    const { ctx } = buildExecCtx();
    const names = (await resolveTools(gen, ctx)).map(toolName);
    expect(names).not.toContain("runBoard");
  });
});

// ---------------------------------------------------------------------------
// Guidance
// ---------------------------------------------------------------------------

describe("delegation surface — guidance", () => {
  it("renders the playbook plus the live agent roster", async () => {
    const gen = buildTeamGenerator();
    const { ctx } = buildExecCtx();
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
    const rendered = parts.join("\n");
    expect(rendered).toContain("runBoard");
    expect(rendered).toContain("- analyst:");
    expect(rendered).toContain("- synthesizer:");
  });
});
