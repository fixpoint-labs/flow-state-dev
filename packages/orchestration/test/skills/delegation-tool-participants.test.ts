/**
 * Tool participants on the delegation surface (FIX-925).
 *
 * A `tool:` entry on a skill's `agents:` map is a deterministic board node: the
 * drain invokes the catalog tool directly with the task's `input`, with no model
 * turn. What is proven here is that a tool participant is a full citizen of the
 * ONE participant registry — it reaches the roster the coordinator reads, it is
 * a valid `addTask` assignee (FIX-924's gate), it lands in the per-execution
 * memo snapshot (FIX-928), and it runs end-to-end through the real drain
 * alongside a prompt-driven agent.
 *
 * The substrate is deliberately untouched by FIX-925, so the board being unable
 * to tell a tool from an agent is the property under test, not an accident.
 */
import { describe, expect, it } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill } from "@flow-state-dev/core";
import { mockGenerator, runForTest, testBlock } from "@flow-state-dev/testing";
import { z } from "zod";
import { buildDelegationCtx } from "./delegation-ctx";
import { createSkillsLibrary } from "../../src/skills/library";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";
import { agentPurpose } from "../../src/skills/delegation-surface";

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

/** Render every guidance context function the generator carries. */
async function buildGuidanceText(
  gen: ReturnType<typeof generator>,
  ctx: unknown,
): Promise<string> {
  const fns: Array<(i: unknown, c: unknown) => unknown> = [];
  const walk = (value: unknown): void => {
    if (typeof value === "function") fns.push(value as never);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk((gen.config as { context?: unknown }).context);
  const parts: string[] = [];
  for (const fn of fns) {
    const out = await fn(undefined, ctx);
    if (typeof out === "string") parts.push(out);
  }
  return parts.join("\n");
}

/** Calls the deterministic tool records, so "no model turn" is observable. */
const fetchCalls: Array<{ url: string }> = [];

const httpGet = handler({
  name: "httpGet",
  description: "Fetch a URL and return its body text.",
  inputSchema: z.object({ url: z.string() }),
  outputSchema: z.object({ body: z.string() }),
  execute: async (input: { url: string }) => {
    fetchCalls.push(input);
    return { body: `body of ${input.url}` };
  },
}) as never;

/** A catalog tool with NO description — exercises the pinned roster fallback. */
const bareTool = handler({
  name: "compute",
  inputSchema: z.unknown(),
  outputSchema: z.number(),
  execute: async () => 42,
}) as never;

/** A mixed board: one deterministic tool, one prompt-driven agent. */
const mixedSkill: InitialSkill = {
  name: "research",
  skillMd: [
    "---",
    "description: fetch pages and analyse them",
    "agents:",
    "  fetch:",
    "    tool: httpGet",
    "  analyst:",
    "    prompt: You read fetched page text and extract the key claims.",
    "---",
    "",
    "Fetch each page, then analyse it.",
  ].join("\n"),
};

function mixedSurface(catalog: Record<string, unknown> = { httpGet }) {
  const skills = createSkillsLibrary({
    catalog: catalog as never,
    initialSkills: [mixedSkill],
  });
  const gen = generator({
    name: "executive",
    model: "openai/gpt-5.4-mini",
    prompt: "delegate",
    inputSchema: z.object({}),
    uses: [skills.with({ active: ["research"] } as never)],
  });
  return { gen, ...buildDelegationCtx() };
}

function board(selfState: Record<string, unknown>): Record<string, { assignee?: string }> {
  return selfState[DELEGATION_BOARD_FIELD] as Record<string, { assignee?: string }>;
}

// ---------------------------------------------------------------------------

describe("delegation surface — tool participants in the roster", () => {
  it("lists a tool and an agent in one roster, marking which is deterministic", async () => {
    const { gen, ctx } = mixedSurface();
    const guidance = await buildGuidanceText(gen, ctx);

    // Both participants reach the coordinator...
    expect(guidance).toContain("fetch");
    expect(guidance).toContain("analyst");
    // ...and the tool is marked as one, so the model passes structured `input`
    // rather than expecting prose reasoning from it.
    expect(guidance).toMatch(/fetch:.*tool/);
    // The playbook must not still say assignee names an *agent* only, or the
    // model is told to do the one thing that skips the tool.
    expect(guidance).toMatch(/agents? or tools?|tools? or agents?/i);
  });

  it("accepts a tool key as an addTask assignee (FIX-924's gate covers both kinds)", async () => {
    const { gen, ctx, selfState } = mixedSurface();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(
      addTask,
      { goal: "fetch page A", assignee: "fetch", input: { url: "https://a.example" } },
      ctx,
    );

    expect((result as { ok: boolean }).ok).toBe(true);
    expect(Object.values(board(selfState))[0]?.assignee).toBe("fetch");
  });

  it("still rejects an assignee that names neither an agent nor a tool", async () => {
    const { gen, ctx } = mixedSurface();
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "x", assignee: "fetcher" }, ctx);

    expect((result as { ok: boolean }).ok).toBe(false);
    const error = (result as { error: string }).error;
    expect(error).toContain("unknown_assignee");
    // The correction names both participants, so the model can fix the typo.
    expect(error).toContain("fetch");
    expect(error).toContain("analyst");
  });

  it("describes a tool from its catalog description", () => {
    expect(agentPurpose({ tool: "httpGet" }, undefined, { httpGet } as never)).toContain(
      "Fetch a URL",
    );
  });

  it("falls back to a pinned line for a catalog tool with no description", () => {
    // `BlockDefinition.description` is optional, so the roster line must never
    // render empty — an empty purpose tells the coordinator nothing.
    const purpose = agentPurpose({ tool: "compute" }, undefined, { compute: bareTool } as never);
    expect(purpose.trim()).not.toBe("");
    expect(purpose).toContain("compute");
    expect(purpose).toContain("deterministic");
  });
});

describe("delegation surface — tool participants and the per-execution memo", () => {
  it("keys the memo snapshot on tool keys too, so a changed roster rebuilds", async () => {
    // The snapshot is `Object.keys(agents)`, which includes tool keys — assert
    // it rather than leave it true-by-inspection (BP-035 memo path).
    const { snapshotSources } = await import("../../src/skills/internal/delegation-memo");
    const snapshot = snapshotSources([
      {
        skillName: "research",
        agents: { fetch: { tool: "httpGet" }, analyst: { prompt: "..." } },
      },
    ]);
    expect(snapshot[0]?.agentKeys).toEqual(["analyst", "fetch"]);
  });
});

describe("delegation surface — the drain runs a mixed board", () => {
  it("runs a tool task deterministically and records the tool's own return value", async () => {
    fetchCalls.length = 0;
    const { gen, ctx, selfState } = mixedSurface();
    const tools = await resolveTools(gen, ctx);
    const addTask = pickTool(tools, "addTask");
    const runBoard = pickTool(tools, "runBoard");

    await runForTest(
      addTask,
      { goal: "fetch page A", assignee: "fetch", input: { url: "https://a.example" } },
      ctx,
    );

    // Drive the drain through the real execution kernel: the board collection
    // still closes over the surface's ctx (so it is the same ledger addTask
    // wrote to), but the nested worker sequencers get real per-step state.
    const drained = await testBlock(runBoard as never, { input: {} });
    expect(drained.error).toBeNull();
    const result = drained.output as {
      status: string;
      tasks: Array<{ assignee?: string; status: string; output?: unknown }>;
    };

    expect(result.status).toBe("drained");
    const task = result.tasks.find((t) => t.assignee === "fetch");
    expect(task?.status).toBe("completed");
    // The goal of the whole feature: the deterministic node ran with the task's
    // input as the tool's OWN typed args — the envelope never reached it — and
    // its native return value is what got recorded on the task.
    expect(fetchCalls.length).toBeGreaterThan(0);
    for (const call of fetchCalls) {
      expect(call).toEqual({ url: "https://a.example" });
    }
    expect(task?.output).toEqual({ body: "body of https://a.example" });
    expect(Object.keys(board(selfState))).toHaveLength(1);
  });

  it("gives a tool task dependency ORDERING but no upstream runtime output", async () => {
    // Decision 4, asserted rather than documented-only: a tool receives exactly
    // the `input` fixed at plan time. If deps outputs ever leaked into the
    // tool's args they would break its typed schema.
    fetchCalls.length = 0;
    const { gen, ctx } = mixedSurface();
    const tools = await resolveTools(gen, ctx);
    const addTask = pickTool(tools, "addTask");
    const runBoard = pickTool(tools, "runBoard");

    const first = (await runForTest(
      addTask,
      { goal: "fetch A", assignee: "fetch", input: { url: "https://a.example" } },
      ctx,
    )) as { taskId: string };
    await runForTest(
      addTask,
      {
        goal: "fetch B",
        assignee: "fetch",
        deps: [first.taskId],
        input: { url: "https://b.example" },
      },
      ctx,
    );

    await testBlock(runBoard as never, { input: {} });

    // Ordering held: the dependent never ran before its dep.
    expect(fetchCalls[0]).toEqual({ url: "https://a.example" });
    expect(fetchCalls).toContainEqual({ url: "https://b.example" });
    // ...and the downstream tool got ONLY its plan-time input. If dep outputs
    // were merged into a tool's args (the rejected alternative in Decision 4)
    // this payload would carry the upstream's `{ body: ... }` too and break the
    // tool's typed schema.
    for (const call of fetchCalls) {
      expect(Object.keys(call)).toEqual(["url"]);
    }
  });

  it("chains tool → agent: the tool's output reaches the downstream agent's prompt", async () => {
    // The mixed board's payoff. The tool node takes no model turn; the agent
    // node does, and it receives the tool's recorded output as an upstream
    // result (agents DO get dep outputs — only tools don't).
    fetchCalls.length = 0;
    const analyst = mockGenerator({
      name: "skillWorker_research_analyst",
      // A predicate entry matches repeatedly rather than being consumed once:
      // the fixture's state ref isn't CAS-backed, so the drain's lanes can claim
      // the same task more than once and a one-shot script would run dry.
      script: [{ when: () => true, then: { text: "Claim: the page loaded." } }],
    });
    const { gen, ctx } = mixedSurface();
    const tools = await resolveTools(gen, ctx);
    const addTask = pickTool(tools, "addTask");
    const runBoard = pickTool(tools, "runBoard");

    const fetchTask = (await runForTest(
      addTask,
      { goal: "fetch page A", assignee: "fetch", input: { url: "https://a.example" } },
      ctx,
    )) as { taskId: string };
    await runForTest(
      addTask,
      { goal: "extract claims from A", assignee: "analyst", deps: [fetchTask.taskId] },
      ctx,
    );

    const drained = await testBlock(runBoard as never, {
      input: {},
      generators: { skillWorker_research_analyst: analyst },
      unmockedGeneratorPolicy: "error",
    });
    expect(drained.error).toBeNull();

    // The deterministic node ran as a direct call...
    expect(fetchCalls[0]).toEqual({ url: "https://a.example" });
    // ...and exactly one model turn happened on this board — the agent's.
    expect(analyst.calls.length).toBeGreaterThan(0);
    // The tool's own return value reached that turn as an upstream result.
    const promptText = JSON.stringify(analyst.calls);
    expect(promptText).toContain("body of https://a.example");

    const result = drained.output as {
      tasks: Array<{ assignee?: string; status: string; output?: unknown }>;
    };
    expect(result.tasks.find((t) => t.assignee === "fetch")?.output).toEqual({
      body: "body of https://a.example",
    });
    expect(result.tasks.find((t) => t.assignee === "analyst")?.status).toBe("completed");
  });

  it("fails the offending task when the tool throws, leaving the board settled", async () => {
    // The worker here is a sequencer, a shape that hadn't sat in the worker
    // position before. A throw from inside it must still reach the board's
    // rescue path and fail that task rather than escaping the drain.
    const boom = handler({
      name: "boom",
      description: "Always throws.",
      inputSchema: z.unknown(),
      outputSchema: z.string(),
      execute: async () => {
        throw new Error("tool exploded");
      },
    }) as never;
    const skills = createSkillsLibrary({
      catalog: { httpGet: boom } as never,
      initialSkills: [mixedSkill],
    });
    const failingGen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["research"] } as never)],
    });
    const { ctx } = buildDelegationCtx();
    const tools = await resolveTools(failingGen, ctx);

    await runForTest(
      pickTool(tools, "addTask"),
      { goal: "fetch page A", assignee: "fetch", input: { url: "https://a.example" } },
      ctx,
    );
    const drained = await testBlock(pickTool(tools, "runBoard") as never, { input: {} });

    // The drain itself completes — the failure is recorded, not thrown outward.
    expect(drained.error).toBeNull();
    const result = drained.output as {
      tasks: Array<{ assignee?: string; status: string; error?: string }>;
    };
    const task = result.tasks.find((t) => t.assignee === "fetch");
    expect(task?.status).toBe("errored");
    expect(task?.error).toContain("tool exploded");
  });
});
