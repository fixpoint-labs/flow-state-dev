/**
 * Tool seats on the delegation board (FIX-925).
 *
 * The board already dispatches any block by `task.assignee`, and a catalog tool
 * already IS a block — so a tool needs no declaration to be assignable. Every
 * tool a skill allows is a seat, keyed by its catalog key:
 *
 *   - `allowed-tools` when the skill declares one — the skill's own scope;
 *   - the whole catalog when it doesn't, which is also the tool set the
 *     coordinator generator is registered with (`library.ts` pushes
 *     `fullCatalog()`), so a seat opens no reach the model didn't have.
 *
 * What is pinned here is the wiring at the surface: which keys become seats,
 * that a declared agent wins a collision, that assignment validates against
 * agents ∪ seats, and that the always-rendered guidance costs ONE line no
 * matter how big the catalog is. The envelope unwrap itself is unit-tested in
 * `worker-materializer.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { generator, handler } from "@flow-state-dev/core";
import type { GeneratorTool, InitialSkill, ToolCatalog } from "@flow-state-dev/core";
import { runForTest } from "@flow-state-dev/testing";
import { z } from "zod";
import { buildDelegationCtx } from "./delegation-ctx";
import { createSkillsLibrary } from "../../src/skills/library";
import { DELEGATION_BOARD_FIELD } from "../../src/skills/task-tools-capability";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

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

/** Render every context entry the binding contributed. Mirrors the helper in
 *  `delegation-roster-assignment.test.ts` — the entries arrive nested, so a
 *  flat scan of `config.context` finds nothing. */
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

const tool = (name: string, description: string) =>
  handler({
    name,
    description,
    inputSchema: z.object({ url: z.string() }),
    outputSchema: z.object({ body: z.string() }),
    execute: async (input: { url: string }) => ({ body: `body of ${input.url}` }),
  }) as never;

const catalog: ToolCatalog = {
  httpGet: tool("httpGet", "Fetch a URL and return its body."),
  webSearch: tool("webSearch", "Search the web."),
  crawl: tool("crawl", "Crawl a site."),
};

/** A delegating skill. `allowedTools` narrows its seats when supplied. */
function teamSkill(allowedTools?: string[]): InitialSkill {
  return {
    name: "team",
    skillMd: [
      "---",
      "description: research with a team",
      ...(allowedTools ? [`allowed-tools: [${allowedTools.join(", ")}]`] : []),
      "agents:",
      "  analyst:",
      "    prompt: You extract the key claims from fetched pages.",
      "---",
      "",
      "addTask then runBoard.",
    ].join("\n"),
  };
}

function surface(
  skill: InitialSkill,
  toolCatalog: ToolCatalog = catalog,
  toolSeatFence?: () => readonly string[],
) {
  const skills = createSkillsLibrary({
    catalog: toolCatalog,
    initialSkills: [skill],
    ...(toolSeatFence ? { toolSeatFence } : {}),
  });
  const gen = generator({
    name: "executive",
    model: "openai/gpt-5.4-mini",
    prompt: "delegate",
    inputSchema: z.object({}),
    uses: [skills.with({ active: [skill.name] } as never)],
  });
  return { gen, ...buildDelegationCtx() };
}

function board(selfState: Record<string, unknown>): Record<string, { assignee?: string }> {
  return selfState[DELEGATION_BOARD_FIELD] as Record<string, { assignee?: string }>;
}

// ---------------------------------------------------------------------------

describe("delegation tool seats — which tools are assignable", () => {
  it("accepts every catalog key as an assignee when the skill declares no allowed-tools", async () => {
    // This is the whole point: nothing declared these. The coordinator can
    // already call all three directly, and now it can also assign them.
    const { gen, ctx, selfState } = surface(teamSkill());
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    for (const key of ["httpGet", "webSearch", "crawl"]) {
      const result = await runForTest(
        addTask,
        { goal: `run ${key}`, assignee: key, input: { url: "https://a.example" } },
        ctx,
      );
      expect((result as { ok: boolean }).ok).toBe(true);
    }
    expect(
      Object.values(board(selfState))
        .map((t) => t.assignee)
        .sort(),
    ).toEqual(["crawl", "httpGet", "webSearch"]);
  });

  it("narrows seats to `allowed-tools` when the skill declares one", async () => {
    const { gen, ctx } = surface(teamSkill(["httpGet"]));
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const allowed = await runForTest(addTask, { goal: "fetch", assignee: "httpGet" }, ctx);
    expect((allowed as { ok: boolean }).ok).toBe(true);

    // In the catalog, but this skill narrowed itself out of it — so it is not
    // a seat, and naming it is the same mistake as naming a nonexistent agent.
    const refused = await runForTest(addTask, { goal: "search", assignee: "webSearch" }, ctx);
    expect((refused as { ok: boolean }).ok).toBe(false);
    expect((refused as { error: string }).error).toContain("unknown_assignee");
  });

  it("keeps the declared agent alongside the seats, on one namespace", async () => {
    const { gen, ctx } = surface(teamSkill());
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    for (const assignee of ["analyst", "httpGet"]) {
      const result = await runForTest(addTask, { goal: "work", assignee }, ctx);
      expect((result as { ok: boolean }).ok).toBe(true);
    }
  });

  it("still refuses an assignee that is neither an agent nor a tool", async () => {
    const { gen, ctx, selfState } = surface(teamSkill());
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "x", assignee: "httpGett" }, ctx);

    expect((result as { ok: boolean }).ok).toBe(false);
    const error = (result as { error: string }).error;
    // An `unknown_assignee` message is read once, not every turn, so it DOES
    // name each legal option — agents and tools alike.
    expect(error).toContain("analyst");
    expect(error).toContain("httpGet");
    expect(Object.keys(board(selfState))).toEqual([]);
  });

  // BP-031: `allowed-tools` rides a `.passthrough()` manifest an admin can edit
  // after seeding, so it reaches the seat resolver as caller-controllable input.
  // `__proto__` would hit the worker registry's prototype setter instead of
  // creating an own key.
  it("drops an allowed-tools entry whose key could never be a legal assignee", async () => {
    const { gen, ctx } = surface(teamSkill(["httpGet"]));
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "x", assignee: "__proto__" }, ctx);

    expect((result as { ok: boolean }).ok).toBe(false);
    expect((result as { error: string }).error).toContain("unknown_assignee");
  });

  it("does not seat a prototype member that is not an own catalog key", async () => {
    // The catalog is a plain object, so `constructor`/`toString` are truthy on
    // a bare lookup and would seat a function that is not a block at all.
    const { gen, ctx } = surface(teamSkill());
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    for (const key of ["constructor", "toString", "valueOf"]) {
      const result = await runForTest(addTask, { goal: "x", assignee: key }, ctx);
      expect((result as { ok: boolean }).ok).toBe(false);
    }
  });
});

describe("delegation tool seats — collisions", () => {
  it("lets a declared agent shadow a same-named tool", async () => {
    // The agent gets the roster line the coordinator reads, so the agent must
    // also be what actually runs — otherwise the model is told one thing and
    // dispatched another.
    const shadowing: InitialSkill = {
      name: "team",
      skillMd: [
        "---",
        "description: an agent named like a tool",
        "agents:",
        "  httpGet:",
        "    prompt: You are an agent, not the tool.",
        "---",
        "",
        "addTask then runBoard.",
      ].join("\n"),
    };
    const { gen, ctx } = surface(shadowing);
    const guidance = await buildGuidanceText(gen, ctx);

    // One entry, and it's the agent's — the seat did not also claim the key.
    expect(guidance).toContain("- httpGet: You are an agent, not the tool.");
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");
    expect(
      (
        (await runForTest(addTask, { goal: "x", assignee: "httpGet" }, ctx)) as {
          ok: boolean;
        }
      ).ok,
    ).toBe(true);
  });
});

describe("delegation tool seats — guidance cost", () => {
  it("spends ONE line on tools, whatever the catalog's size", async () => {
    // The coordinator already carries every one of these tools in its own tool
    // surface with the provider-rendered descriptions. Re-listing them in the
    // always-rendered guidance would re-pay for that every turn and scale with
    // the app's catalog rather than the skill's team.
    const big: ToolCatalog = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`tool${i}`, tool(`tool${i}`, `Tool ${i}.`)]),
    );
    const { gen, ctx } = surface(teamSkill(), big);
    const guidance = await buildGuidanceText(gen, ctx);

    // The team roster lists the declared agent, and nothing else.
    const rosterLines = guidance.split("\n").filter((l) => l.startsWith("- "));
    expect(rosterLines).toHaveLength(1);
    expect(rosterLines[0]).toContain("analyst");
    // The tools get one sentence between them, naming none.
    expect(guidance).toContain("Any tool you can call directly is also assignable");
    expect(guidance).not.toContain("tool7");
  });

  it("says nothing about tools when the catalog is empty", async () => {
    const { gen, ctx } = surface(teamSkill(), {});
    const guidance = await buildGuidanceText(gen, ctx);
    expect(guidance).toContain("Your team:");
    expect(guidance).not.toContain("also assignable");
  });

  it("tells a seated board its assignments are validated", async () => {
    // A board with seats has something to validate against even with no
    // declared agents, so it must not promise the floor catches a typo.
    const rosterless: InitialSkill = {
      name: "solo",
      skillMd: ["---", "description: no agents", "---", "", "Plan, then runBoard."].join("\n"),
    };
    const skills = createSkillsLibrary({ catalog, initialSkills: [rosterless] });
    const gen = generator({
      name: "executive",
      model: "openai/gpt-5.4-mini",
      prompt: "delegate",
      inputSchema: z.object({}),
      uses: [skills.with({ active: ["solo"], delegation: true } as never)],
    });
    const { ctx } = buildDelegationCtx();
    const guidance = await buildGuidanceText(gen, ctx);

    expect(guidance).not.toContain("Your team:");
    expect(guidance).toContain("also assignable");
    expect(guidance).toContain("rejected");
  });
});

// ---------------------------------------------------------------------------
// The caller's ceiling (`toolSeatFence`)
// ---------------------------------------------------------------------------
//
// The seats above are derived from the SKILL. That is right when the skill and
// the host were configured together, and wrong the moment a host merely HOLDS
// skills it did not choose — a per-instance catalog, where a skill's `agents:`
// would otherwise reach the whole app catalog through a board worker even
// though the host itself was granted nothing. The fence is how a caller that
// owns its own tool registration keeps that closed.
describe("delegation tool seats — the caller's fence", () => {
  it("narrows whole-catalog seats to the fence", async () => {
    const { gen, ctx, selfState } = surface(teamSkill(), catalog, () => ["httpGet"]);
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const inside = await runForTest(addTask, { goal: "fetch", assignee: "httpGet" }, ctx);
    expect((inside as { ok: boolean }).ok).toBe(true);

    const outside = await runForTest(addTask, { goal: "search", assignee: "webSearch" }, ctx);
    expect((outside as { ok: boolean }).ok).toBe(false);
    expect((outside as { error: string }).error).toContain("unknown_assignee");

    expect(Object.values(board(selfState)).map((t) => t.assignee)).toEqual(["httpGet"]);
  });

  // The fence is the HOST's, not the skill's: a skill naming a tool in its own
  // `allowed-tools` must not be able to reach past what the host was granted.
  it("narrows a skill's own `allowed-tools` too", async () => {
    const { gen, ctx } = surface(teamSkill(["httpGet", "crawl"]), catalog, () => ["crawl"]);
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const inside = await runForTest(addTask, { goal: "crawl", assignee: "crawl" }, ctx);
    expect((inside as { ok: boolean }).ok).toBe(true);

    const outside = await runForTest(addTask, { goal: "fetch", assignee: "httpGet" }, ctx);
    expect((outside as { ok: boolean }).ok).toBe(false);
    expect((outside as { error: string }).error).toContain("unknown_assignee");
  });

  // An empty fence is the case that matters most — a host granted no tools at
  // all. It must mean NO seats, not "unset, so all of them".
  it("seats nothing at all on an empty fence", async () => {
    const { gen, ctx } = surface(teamSkill(), catalog, () => []);
    const tools = await resolveTools(gen, ctx);
    const addTask = pickTool(tools, "addTask");

    for (const key of ["httpGet", "webSearch", "crawl"]) {
      const result = await runForTest(addTask, { goal: key, assignee: key }, ctx);
      expect((result as { ok: boolean }).ok).toBe(false);
      expect((result as { error: string }).error).toContain("unknown_assignee");
    }

    // ...and the guidance must not advertise what cannot be assigned.
    const guidance = await buildGuidanceText(gen, ctx);
    expect(guidance).not.toContain("also assignable");
  });

  // A declared agent is not a catalog tool, so the fence must leave the actual
  // roster alone — it narrows seats, it does not dismantle delegation.
  it("leaves the declared roster reachable", async () => {
    const { gen, ctx } = surface(teamSkill(), catalog, () => []);
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");

    const result = await runForTest(addTask, { goal: "analyse", assignee: "analyst" }, ctx);
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  // The default has to stay exactly what it was.
  it("changes nothing when no fence is given", async () => {
    const { gen, ctx } = surface(teamSkill());
    const addTask = pickTool(await resolveTools(gen, ctx), "addTask");
    for (const key of ["httpGet", "webSearch", "crawl"]) {
      const result = await runForTest(addTask, { goal: key, assignee: key }, ctx);
      expect((result as { ok: boolean }).ok).toBe(true);
    }
  });
});
