/**
 * What a worker with no `tools:` line can call: the tools of the capability
 * presets its own file picked. A written `tools:` line stays the whole grant.
 *
 * Graded on the tool list the MODEL was offered, read off a recording model
 * resolver with the real generator running. The settings a seat parsed to are
 * a neighbour of that claim, not the claim: the framework re-merges a block's
 * declarations, and a check on the map passed in has passed before while the
 * built worker disagreed.
 *
 * Every "offered nothing" assertion sits beside a check that the model was
 * reached at all, because an empty list is evidence only if something looked.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { hiredSeatManifestFromStored, hiredSeatRowFromManifest, toHiredSeatRow } from "../src/roster/rows";

/** A named tool that does nothing; the checks read whether it was OFFERED. */
function tool(name: string) {
  return handler({
    name,
    description: `The ${name} tool.`,
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => ({ ok: true })
  });
}

const lookup = tool("lookup");
const ledger = tool("ledger");
const ownBlock = tool("own-block");

const ping = tool("ping");
const dial = tool("dial");
const scan = tool("scan");

/** A capability whose one tool-bearing preset is ON by default for the kind. */
const radar = defineCapability({
  name: "radar",
  presets: {
    sweep: { context: ["SWEEP-7731"], tools: [scan] },
    quiet: { context: ["QUIET-2210"] },
    default: ["sweep"]
  }
});

/** A preset whose tools are a function, resolved per turn rather than listed. */
const phone = defineCapability({
  name: "phone",
  presets: {
    line: { context: ["LINE-3380"], tools: () => [dial] },
    default: []
  }
});

/** A preset carrying a CONTROL, which no `tools:` line governs. */
const dispatch = defineCapability({
  name: "dispatch",
  presets: {
    radio: { context: ["RADIO-5517"], controlTools: [ping] },
    default: []
  }
});

/** One tool-bearing preset, off by default: the shape a team's own capability has. */
const fieldwork = defineCapability({
  name: "fieldwork",
  presets: {
    survey: { context: ["SURVEY-1902"], tools: [lookup] },
    notes: { context: ["NOTES-4410"] },
    default: []
  }
});

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

/** Hire a roster and address the seats by id — never by position. */
function hire(
  manifests: WorkerManifest[],
  kinds: HireOptions["kinds"],
  seatBlocks?: HireOptions["seatBlocks"]
): (id: string) => FlowInstance {
  const seats = hireWorkforce(manifests, { kinds, ...(seatBlocks ? { seatBlocks } : {}) });
  return (id) => {
    const seat = seats.find((candidate) => candidate.id === id);
    if (!seat) throw new Error(`no seat "${id}" in [${seats.map((s) => s.id).join(", ")}]`);
    return seat;
  };
}

/**
 * Run one real turn and return the tool names the provider was offered.
 *
 * The real generator has to run for its tools slot to resolve at all, so the
 * model is a recording resolver rather than a mocked generator. `orgId` is
 * the organization a stored row's seat is pinned to.
 */
async function offered(seat: FlowInstance, orgId = "test-org"): Promise<string[]> {
  const seen: string[] = [];
  let generateCalls = 0;
  const recording = ((): GeneratorModel => ({
    modelId: "m",
    async generate(options: { tools?: Array<{ name: string }> }) {
      generateCalls += 1;
      seen.push(...(options.tools ?? []).map((t) => t.name));
      return { text: "done" };
    }
  })) as unknown as ModelResolver;
  recording.resolveId = (modelId: string) => modelId;

  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId,
    org: { state: {} },
    sessionId: `session-${seat.id}`,
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    modelResolver: recording
  });

  const result = await executeBlock({
    block: seat.actions.run.block,
    input: { message: "go" },
    ctx: runtime.ctx
  });

  if (result.error) throw result.error;
  // The control every "offered nothing" below rests on.
  expect(generateCalls).toBeGreaterThan(0);
  return seen.sort();
}

describe("a worker with no `tools:` line can call what its file picked", () => {
  it("offers a picked preset's tools to a worker that wrote no `tools:` line (BR-4)", async () => {
    const seat = hire(
      [
        record({ id: "eng.surveyor", declared: { capabilities: { fieldwork: ["survey"] } } }),
        record({ id: "eng.ghost" })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork] }) }
    );

    expect(await offered(seat("eng.surveyor"))).toEqual(["lookup"]);
    // The sibling picked nothing, so it gains nothing.
    expect(await offered(seat("eng.ghost"))).toEqual([]);
  });
});

describe("a written `tools:` line is the whole grant", () => {
  // The case the flag exists for. The hire moves a name that resolved to the
  // worker's own folder out of `tools` and onto its own blocks, so a worker
  // listing ONLY its own blocks reaches the kind with an empty catalog list.
  // That list must still read as written, or the worker gains its presets'
  // tools because of where its one tool happened to live.
  it("gives a worker listing only its own block exactly that block, whatever it picked (BR-3)", async () => {
    const seat = hire(
      [
        record({
          id: "eng.builder",
          declared: { tools: ["own-block"], capabilities: { fieldwork: ["survey"] } }
        })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork] }) },
      { "eng.builder": { "own-block": ownBlock } }
    );

    expect(await offered(seat("eng.builder"))).toEqual(["own-block"]);
  });

  // An existing list-writer's reach does not change on upgrade: what it picked
  // is not added to what it listed.
  it("gives a worker that lists a catalog tool exactly that tool, whatever it picked (BR-33)", async () => {
    const seat = hire(
      [
        record({
          id: "eng.clerk",
          declared: { tools: ["ledger"], capabilities: { fieldwork: ["survey"] } }
        })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork], catalog: { ledger } }) }
    );

    expect(await offered(seat("eng.clerk"))).toEqual(["ledger"]);
  });

  it("gives a worker with `tools: []` no tool, whatever it picked (BR-5)", async () => {
    const seat = hire(
      [record({ id: "eng.mute", declared: { tools: [], capabilities: { fieldwork: ["survey"] } } })],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork] }) }
    );

    expect(await offered(seat("eng.mute"))).toEqual([]);
  });
});

describe("only what the worker's own file picked grants", () => {
  it("offers a picked preset's tools when the preset lists them as a function (BR-6)", async () => {
    const seat = hire(
      [record({ id: "eng.caller", declared: { capabilities: { phone: ["line"] } } })],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [phone] }) }
    );

    expect(await offered(seat("eng.caller"))).toEqual(["dial"]);
  });

  // The grant resolves a function-valued preset itself. The framework's own
  // capability path must not resolve it a second time only to drop the result
  // behind the fence: a resolver may be costly or have effects.
  it("resolves a function-valued picked preset once per tool resolution", async () => {
    let resolved = 0;
    const counted = defineCapability({
      name: "counted",
      presets: {
        line: {
          tools: () => {
            resolved += 1;
            return [dial];
          }
        },
        default: []
      }
    });
    const seat = hire(
      [record({ id: "eng.counter", declared: { capabilities: { counted: ["line"] } } })],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [counted] }) }
    );

    const before = resolved;
    expect(await offered(seat("eng.counter"))).toEqual(["dial"]);
    // One turn with a text answer is one model step, so one tool resolution.
    expect(resolved - before).toBe(1);
  });

  // The kind switching a preset on is the app's default, not the worker's
  // choice. A worker that picks nothing from it gains nothing — and neither
  // does one that picks a DIFFERENT preset of the same capability.
  it("offers nothing from a preset the kind switches on that the worker did not pick (BR-29)", async () => {
    const seat = hire(
      [
        record({ id: "eng.plain" }),
        record({ id: "eng.quiet", declared: { capabilities: { radar: ["quiet"] } } })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [radar] }) }
    );

    expect(await offered(seat("eng.plain"))).toEqual([]);
    expect(await offered(seat("eng.quiet"))).toEqual([]);
  });

  // Picking a preset that is already on is still picking it. The per-turn
  // resolver skips such a preset (its context is carried once, by the kind),
  // so the grant has to read the selection as written.
  it("offers a picked preset's tools even when the kind already switches it on (BR-31)", async () => {
    const seat = hire(
      [record({ id: "eng.watch", declared: { capabilities: { radar: ["sweep"] } } })],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [radar] }) }
    );

    expect(await offered(seat("eng.watch"))).toEqual(["scan"]);
  });

  // The off state: a kind carrying a tool-bearing capability, a worker that
  // picks nothing and lists nothing. Exactly what it was offered before.
  it("offers a worker that picks nothing and lists nothing no tool at all (BR-7)", async () => {
    const seat = hire([record({ id: "eng.plain", body: "Plain." })], {
      [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork, radar], catalog: { ledger } })
    });

    expect(await offered(seat("eng.plain"))).toEqual([]);
  });
});

describe("a preset's control is outside the list, with or without a line", () => {
  // The control rides the capability, not the grant, so it is offered once in
  // both cases: not added a second time by the grant, not withheld by `[]`.
  it("offers a picked preset's control once, whether the worker wrote no line or `tools: []` (BR-2, BR-5)", async () => {
    const seat = hire(
      [
        record({ id: "eng.open", declared: { capabilities: { dispatch: ["radio"] } } }),
        record({ id: "eng.shut", declared: { tools: [], capabilities: { dispatch: ["radio"] } } })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [dispatch] }) }
    );

    expect(await offered(seat("eng.open"))).toEqual(["ping"]);
    expect(await offered(seat("eng.shut"))).toEqual(["ping"]);
  });
});

describe("omitted and empty stay apart after the schema", () => {
  it("keeps an omitted `tools:` absent on the hired seat, and a written `[]` as `[]` (V1)", () => {
    const seat = hire(
      [
        record({ id: "eng.none", declared: { capabilities: { fieldwork: ["survey"] } } }),
        record({ id: "eng.empty", declared: { tools: [], capabilities: { fieldwork: ["survey"] } } }),
        record({ id: "eng.own", declared: { tools: ["own-block"] } })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork] }) },
      { "eng.own": { "own-block": ownBlock } }
    );

    expect(seat("eng.none").config).not.toHaveProperty("tools");
    expect(seat("eng.empty").config).toMatchObject({ tools: [] });
    // Emptied by the hire moving its one name onto its own blocks — and still
    // a written line, not an omitted one.
    expect(seat("eng.own").config).toMatchObject({ tools: [] });
  });

  // A stored row is read the way a file is. Round-tripped through JSON, as
  // storage does, so a key written as `undefined` could not survive by accident.
  it("reads a stored row with no `tools:` as omitted, and a stored `tools: []` as a withhold (BR-8)", async () => {
    const stored = (settings: Record<string, unknown>, seatId: string) =>
      JSON.parse(
        JSON.stringify(
          toHiredSeatRow({ seatId, flow: AGENT_KIND, settings, owningOrgId: "acme" })
        )
      ) as unknown;
    const manifestOf = (value: unknown): WorkerManifest => {
      const read = hiredSeatManifestFromStored("acme", value);
      if ("problem" in read) throw new Error(read.problem);
      return read.manifest;
    };

    const open = manifestOf(stored({ capabilities: { fieldwork: ["survey"] } }, "eng.open"));
    const shut = manifestOf(
      stored({ tools: [], capabilities: { fieldwork: ["survey"] } }, "eng.shut")
    );

    // Written back, the omitted line is still omitted.
    const again = hiredSeatRowFromManifest("acme", open);
    if ("problem" in again) throw new Error(again.problem);
    expect(again.row.settings).not.toHaveProperty("tools");

    const seat = hire([open, shut], {
      [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork] })
    });
    expect(await offered(seat("acme.eng.open"), "acme")).toEqual(["lookup"]);
    expect(await offered(seat("acme.eng.shut"), "acme")).toEqual([]);
  });
});

describe("chosen tools that cannot all be granted are refused at the hire", () => {
  it("refuses two picked presets whose tools share a name, naming the tool (S2)", () => {
    const other = defineCapability({
      name: "archive",
      presets: { shelf: { tools: [tool("lookup")] }, default: [] }
    });

    let message = "";
    try {
      hireWorkforce(
        [
          record({
            id: "eng.clash",
            declared: { capabilities: { fieldwork: ["survey"], archive: ["shelf"] } }
          })
        ],
        { kinds: { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork, other] }) } }
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain('worker "eng.clash"');
    expect(message).toContain('"lookup"');
    expect(message).toContain('"fieldwork"');
    expect(message).toContain('"archive"');
  });

  // The refusal is about what a worker with no line would be GRANTED. A worker
  // that writes a line is granted exactly that line, so two picked presets
  // sharing a tool name cost it nothing and it hires as it always has (BR-33).
  it("hires a worker that wrote a `tools:` line, whatever its picked presets' tools are named (BR-33)", async () => {
    const other = defineCapability({
      name: "archive",
      presets: { shelf: { tools: [tool("lookup")] }, default: [] }
    });

    const seat = hire(
      [
        record({
          id: "eng.clerk",
          declared: { tools: ["ledger"], capabilities: { fieldwork: ["survey"], archive: ["shelf"] } }
        })
      ],
      {
        [AGENT_KIND]: defineAgentWorkerFlow({ uses: [fieldwork, other], catalog: { ledger } })
      }
    );

    expect(await offered(seat("eng.clerk"))).toEqual(["ledger"]);
  });
});

describe("chosen tools do not travel to a delegate", () => {
  /** A tool that counts its own runs, on a preset the kind switches on. */
  function countedRadar() {
    let calls = 0;
    const counted = handler({
      name: "scan",
      description: "Scans.",
      inputSchema: z.object({}),
      outputSchema: z.object({ ok: z.boolean() }),
      execute: () => {
        calls += 1;
        return { ok: true };
      }
    });
    const capability = defineCapability({
      name: "radar",
      presets: { sweep: { tools: [counted] }, default: ["sweep"] }
    });
    return { capability, calls: () => calls };
  }

  /** A skill the worker holds that declares an agent listing `scan`. */
  const delegating = {
    name: "delegate",
    skillMd: [
      "---",
      "description: Hands work to an analyst",
      "agents:",
      "  analyst:",
      "    prompt: You analyse.",
      "    tools: [scan]",
      "---",
      "",
      "addTask then runBoard."
    ].join("\n")
  };

  async function turnWith(seat: FlowInstance, generators: Record<string, ReturnType<typeof mockGenerator>>) {
    const runtime = await createTestContext({
      flow: { ...seat, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: `session-${seat.id}`,
      sequencerName: seat.actions.run!.block.name,
      declaredResources: seat.actions.run!.block.declaredResources,
      generators
    });
    return executeBlock({
      block: seat.actions.run.block,
      input: { message: "/delegate do it" },
      ctx: runtime.ctx
    });
  }

  /**
   * The host hands the analyst a task and drains the board; the analyst's own
   * generator then reaches for `scan`. Returned with the analyst's mock, so a
   * caller can prove the delegate actually ran.
   */
  function delegation() {
    const analyst = mockGenerator({
      name: "skillWorker_delegate_analyst",
      script: [
        { toolCalls: [{ toolCallId: "call-3", toolName: "scan", args: {} }] },
        { text: "analysed" }
      ] as never
    });
    return {
      analyst,
      generators: {
        "agent-answer": mockGenerator({
          name: "agent-answer",
          script: [
            {
              toolCalls: [
                {
                  toolCallId: "call-1",
                  toolName: "addTask",
                  args: { goal: "scan it", assignee: "analyst" }
                }
              ]
            },
            { toolCalls: [{ toolCallId: "call-2", toolName: "runBoard", args: {} }] },
            { text: "done" }
          ] as never
        }),
        skillWorker_delegate_analyst: analyst
      }
    };
  }

  // The delegate is fenced to the names the worker LISTED, and a worker with
  // no line listed none. The first half proves the worker itself was granted
  // the tool, so the zero below is the fence and not a tool that never arrived.
  it("lets the worker call a chosen tool and keeps it from the agent it delegates to (BR-30)", async () => {
    const { capability, calls } = countedRadar();
    const seat = hire(
      [
        record({
          id: "eng.lead",
          declared: { capabilities: { radar: ["sweep"] } },
          skills: [delegating]
        }),
        // The positive control: the same skill on a seat that LISTS `scan`.
        record({ id: "eng.lister", declared: { tools: ["scan"] }, skills: [delegating] })
      ],
      { [AGENT_KIND]: defineAgentWorkerFlow({ uses: [capability] }) }
    );

    const direct = await turnWith(seat("eng.lead"), {
      "agent-answer": mockGenerator({
        name: "agent-answer",
        script: [
          { toolCalls: [{ toolCallId: "call-1", toolName: "scan", args: {} }] },
          { text: "done" }
        ] as never
      })
    });
    expect(direct.error).toBeUndefined();
    expect(calls()).toBe(1);

    // The control first: through a seat that listed `scan`, this exact
    // delegation reaches the tool. Without it the zero below could mean the
    // analyst never ran rather than that the fence held.
    const listed = delegation();
    const controlRun = await turnWith(seat("eng.lister"), listed.generators);
    expect(controlRun.error).toBeUndefined();
    expect(listed.analyst.calls.length).toBeGreaterThan(0);
    expect(calls()).toBe(2);

    const chosen = delegation();
    const delegated = await turnWith(seat("eng.lead"), chosen.generators);
    expect(delegated.error).toBeUndefined();
    expect(chosen.analyst.calls.length).toBeGreaterThan(0);
    expect(calls()).toBe(2);
  });
});
