/**
 * A worker's own `capabilities:` key — what it picks up, what it is refused, and
 * the one thing that must not happen twice.
 *
 * Graded on what reached the MODEL, not on what the config parsed to. A worker
 * whose settings hold the right selection and whose generator was handed
 * nothing is exactly the failure this key exists to remove, and every shape
 * assertion survives it. So the checks below read the messages the provider
 * was given and the tool list it was offered.
 *
 * Two markers per capability, each written in exactly one preset, so a worker
 * carrying the wrong one — or carrying one twice — is visible rather than
 * merely absent.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { AGENT_FLOW, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";

// Markers, not prose: each appears in exactly one preset on one capability, so
// "carried", "not carried" and "carried twice" are three different readings of
// one string.
const BRIEFING = "BRIEFING-4471";
const LEDGER = "LEDGER-8830";
const TONE = "TONE-2216";
const EXTRA = "EXTRA-9074";
const SHARED = "SHARED-3308";
const SURVEY = "SURVEY-1902";
const RADIO = "RADIO-5517";

/** Nothing on by default — the shape a discovered `research.ts` has. */
const research = defineCapability({
  name: "research",
  presets: {
    briefing: { context: [BRIEFING] },
    ledger: { context: [LEDGER] },
    default: []
  }
});

/**
 * Composes `research` and turns one of its presets on. Installed BESIDE the
 * capability it composes, which is the one shape where core's depth-first walk
 * of `uses` and a top-level-only reading of that array disagree about which ref
 * won.
 */
const desk = defineCapability({
  name: "desk",
  uses: [research.presets({ briefing: true })],
  presets: { default: [] }
});

/** One preset on by default and one off — what BR-22 needs to be visible. */
const houseStyle = defineCapability({
  name: "house-style",
  presets: {
    tone: { context: [TONE] },
    extra: { context: [EXTRA] },
    default: ["tone"]
  }
});

/**
 * A preset carrying a TOOL rather than context — the other half of the path.
 *
 * Built per test rather than shared, so each run gets its own call counter.
 * Whether the tool reached the model is read off that counter: a tool the
 * generator never registered resolves to a synthesized result inside the
 * mock's tool loop and never reaches this `execute`, which is the same signal
 * the worker flow's own fence tests grade on.
 */
function fieldwork() {
  let calls = 0;
  const lookup = handler({
    name: "lookup",
    description: "Looks something up.",
    inputSchema: z.object({}),
    outputSchema: z.object({ rows: z.number() }),
    execute: () => {
      calls += 1;
      return { rows: 0 };
    }
  });
  const capability = defineCapability({
    name: "fieldwork",
    presets: {
      survey: { context: [SURVEY], tools: [lookup] },
      default: []
    }
  });
  return { capability, calls: () => calls };
}

/**
 * A preset carrying a CONTROL rather than a catalog tool — the exemption.
 *
 * Same shape as {@link fieldwork}, and deliberately so: the two differ in one
 * key, so the opposite results below are attributable to that key and nothing
 * else.
 */
function dispatch() {
  let calls = 0;
  const ping = handler({
    name: "ping",
    description: "A framework control.",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.boolean() }),
    execute: () => {
      calls += 1;
      return { ok: true };
    }
  });
  const capability = defineCapability({
    name: "dispatch",
    presets: {
      radio: { context: [RADIO], controlTools: [ping] },
      default: []
    }
  });
  return { capability, calls: () => calls };
}

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

/**
 * Hire a roster and address the workers by id.
 *
 * By id and never by position: `hireWorkforce` returns the roster sorted, so a
 * positional read silently hands one worker's assertions the other worker's
 * settings — which is the one mix-up every check in this file is blind to,
 * since both workers are on the same worker flow.
 */
function hire(
  manifests: WorkerManifest[],
  flows: HireOptions["workerFlows"] = {}
): (id: string) => FlowInstance {
  const workers = mintWorkers(manifests, { workerFlows: flows });
  return (id) => {
    const worker = workers.find((candidate) => candidate.id === id);
    if (!worker) throw new Error(`no worker "${id}" in [${workers.map((s) => s.id).join(", ")}]`);
    return worker;
  };
}

function refusalOf(manifests: WorkerManifest[], flows: HireOptions["workerFlows"] = {}): string {
  try {
    mintWorkers(manifests, { workerFlows: flows });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got workers");
}

/** A model script that "calls" a tool by name, then finishes. */
const callsTool = (toolName: string) => [
  { toolCalls: [{ toolCallId: "call-1", toolName, args: {} }] },
  { text: "done" }
];

/**
 * Run one turn and report what the provider actually saw.
 *
 * `prompt` is the whole message payload serialised, because a context entry
 * can land in the system message or as its own message depending on its shape,
 * and this file grades on a marker being present rather than on where it sat.
 */
async function turn(
  worker: FlowInstance,
  script: Parameters<typeof mockGenerator>[0]["script"] = [{ text: "done" }],
  message = "what do you know?"
) {
  const answer = mockGenerator({ name: "agent-answer", script });
  const runtime = await createTestContext({
    flow: { ...worker, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: `session-${worker.id}`,
    sequencerName: worker.actions.respond!.block.name,
    declaredResources: worker.actions.respond!.block.declaredResources,
    generators: { "agent-answer": answer },
    unmockedGeneratorPolicy: "allow"
  });

  const result = await executeBlock({
    block: worker.actions.respond.block,
    input: { message },
    ctx: runtime.ctx
  });

  return { error: result.error, prompt: JSON.stringify(answer.calls[0]?.input ?? []) };
}

/** How many times a marker appears in what the provider was sent. */
function occurrences(prompt: string, marker: string): number {
  return prompt.split(marker).length - 1;
}

describe("a worker picks presets from what its worker flow carries", () => {
  // BR-11 and BR-15 together, and they only mean anything together: one shared
  // worker flow is always right for somebody, so a worker carrying its own selection is
  // evidence only beside a sibling that does not carry it.
  it("gives two workers on one worker flow the presets their own files named, and not each other's", async () => {
    const flow = defineAgentWorkerFlow({ uses: [research] });
    const worker = hire(
      [
        record({ id: "engineering.reader", declared: { capabilities: { research: ["briefing"] } } }),
        record({ id: "engineering.scout", declared: { capabilities: { research: ["ledger"] } } })
      ],
      { [AGENT_FLOW]: flow }
    );

    const read = await turn(worker("engineering.reader"));
    const scouted = await turn(worker("engineering.scout"));

    expect(read.error).toBeUndefined();
    expect(scouted.error).toBeUndefined();
    expect(read.prompt).toContain(BRIEFING);
    expect(read.prompt).not.toContain(LEDGER);
    expect(scouted.prompt).toContain(LEDGER);
    expect(scouted.prompt).not.toContain(BRIEFING);
  });

  // BR-12. The worker that names nothing is the control for every other check in
  // this file: it must behave as it did before the key existed.
  it("gives a worker that names nothing the capability's own defaults, and nothing else", async () => {
    const flow = defineAgentWorkerFlow({ uses: [houseStyle] });
    const worker = hire([record({ id: "engineering.ghost" })], { [AGENT_FLOW]: flow });

    const said = await turn(worker("engineering.ghost"));

    expect(said.error).toBeUndefined();
    // `tone` is this capability's default; `extra` is not.
    expect(occurrences(said.prompt, TONE)).toBe(1);
    expect(said.prompt).not.toContain(EXTRA);
  });

  // BR-22 — the check the whole per-worker mechanism is shaped around. The
  // framework merges static and dynamic `uses` independently and dedupes
  // across neither, so a capability contributing its presets on both paths
  // hands this worker TONE twice. `toBe(1)` is what fails when that happens;
  // `toContain` would pass.
  it("carries a preset that is already on by default exactly once when a worker names it", async () => {
    const flow = defineAgentWorkerFlow({ uses: [houseStyle] });
    const worker = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { "house-style": ["tone"] } } })],
      { [AGENT_FLOW]: flow }
    );

    const said = await turn(worker("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, TONE)).toBe(1);
  });

  // The same doubling, reached the other way: core flattens `uses` depth-first,
  // so `desk`'s nested `research` ref is recorded BEFORE the top-level
  // `research` beside it, and the top-level one is then skipped as a diamond.
  // A catalogue that reads the top-level array alone sees the bare ref, thinks
  // `briefing` is off, and adds it again on the worker's path.
  it("carries a preset a composing capability already turned on exactly once", async () => {
    const flow = defineAgentWorkerFlow({ uses: [desk, research] });
    const worker = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_FLOW]: flow }
    );

    const said = await turn(worker("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
  });

  // The additive half of the same capability: naming the default preset AND
  // the one that is off gets one copy of each, not two of the default.
  it("adds an off-by-default preset on top of the defaults, each carried once", async () => {
    const flow = defineAgentWorkerFlow({ uses: [houseStyle] });
    const worker = hire(
      [
        record({
          id: "engineering.lead",
          declared: { capabilities: { "house-style": ["tone", "extra"] } }
        })
      ],
      { [AGENT_FLOW]: flow }
    );

    const said = await turn(worker("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, TONE)).toBe(1);
    expect(occurrences(said.prompt, EXTRA)).toBe(1);
  });

  // V7 · BR-16, BR-17 — a preset's CONTEXT travels the per-worker path; its
  // catalog TOOLS do not get past the worker's `tools:`. Core's fence (FIX-1393)
  // drops a capability's catalog tools whenever the consuming block declares
  // `tools:`, and this worker flow declares it on every worker.
  //
  // Both halves are asserted on purpose. The marker proves the selection
  // actually landed, so a zero call count reads as "the fence held" rather
  // than "nothing was selected" — without it this check would pass just as
  // happily if per-worker resolution were removed entirely.
  //
  // The tool is graded on its own `execute`: a name the generator never
  // registered resolves to a synthesized result inside the mock's loop and
  // never reaches it, so the counter moves only if the tool really got there.
  it("carries a selected preset's context but not its tool past the worker's fence", async () => {
    const { capability, calls } = fieldwork();
    const flow = defineAgentWorkerFlow({ uses: [capability] });
    const worker = hire(
      [
        record({
          id: "engineering.surveyor",
          declared: { tools: [], capabilities: { fieldwork: ["survey"] } }
        }),
        record({ id: "engineering.ghost" })
      ],
      { [AGENT_FLOW]: flow }
    );

    const surveyed = await turn(worker("engineering.surveyor"), callsTool("lookup"));
    expect(surveyed.error).toBeUndefined();
    expect(occurrences(surveyed.prompt, SURVEY)).toBe(1);
    expect(calls()).toBe(0);

    // The sibling selected nothing, so it gets neither half.
    const said = await turn(worker("engineering.ghost"), callsTool("lookup"));
    expect(said.error).toBeUndefined();
    expect(said.prompt).not.toContain(SURVEY);
    expect(calls()).toBe(0);
  });

  // The exemption, and the reason the fence above is about CATALOG tools
  // rather than tools. A control is not something a `tools:` list could have
  // named — it is usually built inside the capability and never exported — so
  // the capability being composed IS the declaration, and the worker's empty
  // `tools:` does not reach it. Same worker shape as the check above, one key
  // different on the preset, opposite result.
  it("lets a selected preset's CONTROL tool through the same empty tools list", async () => {
    const { capability, calls } = dispatch();
    const flow = defineAgentWorkerFlow({ uses: [capability] });
    const worker = hire(
      [
        record({
          id: "engineering.operator",
          declared: { tools: [], capabilities: { dispatch: ["radio"] } }
        }),
        record({ id: "engineering.ghost" })
      ],
      { [AGENT_FLOW]: flow }
    );

    const operated = await turn(worker("engineering.operator"), callsTool("ping"));
    expect(operated.error).toBeUndefined();
    expect(occurrences(operated.prompt, RADIO)).toBe(1);
    expect(calls()).toBe(1);

    // Still a selection, not a gift to the worker flow: the sibling named nothing.
    const said = await turn(worker("engineering.ghost"), callsTool("ping"));
    expect(said.error).toBeUndefined();
    expect(said.prompt).not.toContain(RADIO);
    expect(calls()).toBe(1);
  });

  // An empty list is the same as saying nothing — it is how an author leaves a
  // line in place while wanting the defaults.
  it("treats a named capability with no presets as naming nothing", async () => {
    const flow = defineAgentWorkerFlow({ uses: [houseStyle] });
    const worker = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { "house-style": [] } } })],
      { [AGENT_FLOW]: flow }
    );

    const said = await turn(worker("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, TONE)).toBe(1);
    expect(said.prompt).not.toContain(EXTRA);
  });

  // A capability that COMPOSES another. The nested one is already installed by
  // the static entry — the framework flattens a capability's own `uses` at
  // build time — so the per-worker entry must contribute the top-level
  // capability's named presets and nothing below them. Graded on the nested
  // marker's COUNT: a per-worker entry that re-walked the subtree hands this worker
  // SHARED twice, and `toContain` would call that a pass.
  it("adds only the named capability's own presets, not the surface of what it composes", async () => {
    const shared = defineCapability({
      name: "shared-voice",
      presets: { house: { context: [SHARED] } }
    });
    const composing = defineCapability({
      name: "research",
      uses: [shared],
      presets: { briefing: { context: [BRIEFING] }, default: [] }
    });
    const flow = defineAgentWorkerFlow({ uses: [composing] });
    const worker = hire(
      [
        record({ id: "engineering.ghost" }),
        record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })
      ],
      { [AGENT_FLOW]: flow }
    );

    // The control: a worker that named nothing gets the nested surface once, from
    // the static entry. Without it, "once" for the selecting worker could mean
    // the nested capability simply never arrived.
    const quiet = await turn(worker("engineering.ghost"));
    expect(quiet.error).toBeUndefined();
    expect(occurrences(quiet.prompt, SHARED)).toBe(1);

    const said = await turn(worker("engineering.lead"));
    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
    expect(occurrences(said.prompt, SHARED)).toBe(1);
  });

  // The same axis, and the sharper failure. The framework refuses a
  // config-declaring capability on the per-worker path outright, so a per-worker
  // entry that reached into what the named capability composes would take a
  // worker that hired cleanly and break every turn it ever runs — the mid-turn
  // failure this key's mint-time checks exist to rule out.
  it("hires and answers when the named capability composes one that declares open config", async () => {
    const tuned = defineCapability({
      name: "tuned",
      presets: { house: { context: [SHARED] } },
      config: {
        schema: z.object({ endpoint: z.string() }).default({ endpoint: "local" }),
        resolve: () => ({})
      }
    });
    const composing = defineCapability({
      name: "research",
      uses: [tuned],
      presets: { briefing: { context: [BRIEFING] }, default: [] }
    });
    const flow = defineAgentWorkerFlow({ uses: [composing] });
    const worker = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_FLOW]: flow }
    );

    const said = await turn(worker("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
  });

  // The app's own `.presets()` is not lost when a worker adds to the capability:
  // the worker's ref is cloned from the app's, so a preset the app left on stays
  // on for the worker that named a different one.
  it("keeps what the app turned on when a worker adds a preset beside it", async () => {
    const flow = defineAgentWorkerFlow({ uses: [research.presets({ ledger: true })] });
    const worker = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_FLOW]: flow }
    );

    const said = await turn(worker("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, LEDGER)).toBe(1);
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
  });
});

describe("a worker's capability selection is refused at the hire, never mid-turn", () => {
  // BR-13.
  it("refuses a capability the worker flow does not carry, naming it and listing what the flow has", () => {
    const flow = defineAgentWorkerFlow({ uses: [research] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { memory: ["recall"] } } })],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain("engineering.lead");
    expect(message).toContain('"memory"');
    expect(message).toContain('"research"');
  });

  it("lists nothing when the worker flow installs no capabilities at all", () => {
    const message = refusalOf([
      record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })
    ]);

    expect(message).toContain('"research"');
    expect(message).toContain("(none)");
  });

  // BR-14 — and the reason it is at the mint: `capabilities` is one setting,
  // so the whole rule fits in the closed schema the hire step already parses.
  it("refuses a preset the capability does not declare, listing the ones it does", () => {
    const flow = defineAgentWorkerFlow({ uses: [research] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["breifing"] } } })],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain('"breifing"');
    expect(message).toContain('"briefing"');
    expect(message).toContain('"ledger"');
  });

  it("names every bad selection on a worker, not just the first", () => {
    const flow = defineAgentWorkerFlow({ uses: [research] });
    const message = refusalOf(
      [
        record({
          id: "engineering.lead",
          declared: { capabilities: { research: ["breifing"], memory: ["recall"] } }
        })
      ],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain('"breifing"');
    expect(message).toContain('"memory"');
  });

  // Selecting is not widening. The app's `false` is a statement about the
  // whole worker flow — the recipe that keeps a tool-bearing preset away from the
  // model is written exactly this way — and a worker file does not reverse it.
  it("refuses a preset the app turned off where it installed the capability", () => {
    const flow = defineAgentWorkerFlow({ uses: [research.presets({ briefing: false })] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain('"briefing"');
    expect(message).toContain("turned off");
  });

  // The framework refuses a config-declaring capability on the dynamic path
  // outright. Caught here, at boot, rather than thrown inside the worker's first
  // answer.
  it("refuses a selection on a capability that declares open config", () => {
    const configured = defineCapability({
      name: "briefing-service",
      presets: { summary: { context: ["summary"] }, default: [] },
      config: {
        schema: z.object({ endpoint: z.string() }).default({ endpoint: "local" }),
        resolve: () => ({})
      }
    });
    const flow = defineAgentWorkerFlow({ uses: [configured] });
    const message = refusalOf(
      [
        record({
          id: "engineering.lead",
          declared: { capabilities: { "briefing-service": ["summary"] } }
        })
      ],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain('"summary"');
    expect(message).toContain("takes config");
  });

  // A preset whose surface has to exist before a request runs cannot be half
  // delivered. Refused by name rather than selected and silently short.
  it("refuses a preset whose surface the per-worker path cannot carry", () => {
    const stateful = defineCapability({
      name: "casework",
      presets: {
        history: {
          context: ["history"],
          sessionStateSchema: z.object({ caseId: z.string().nullable().default(null) })
        },
        default: []
      }
    });
    const flow = defineAgentWorkerFlow({ uses: [stateful] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { casework: ["history"] } } })],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain('"history"');
    expect(message).toContain("sessionStateSchema");
  });

  // The inverse of the rule above: a build-time-only preset the app already
  // has ON is installed statically, so naming it is naming what the worker
  // already carries and is not refused.
  it("allows a worker to name a build-time-only preset the app already turned on", () => {
    const stateful = defineCapability({
      name: "casework",
      presets: {
        history: {
          context: ["history"],
          sessionStateSchema: z.object({ caseId: z.string().nullable().default(null) })
        }
        // no `default` key — every preset is on
      }
    });
    const flow = defineAgentWorkerFlow({ uses: [stateful] });
    const worker = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { casework: ["history"] } } })],
      { [AGENT_FLOW]: flow }
    );

    expect(worker("engineering.lead").kind).toBe(AGENT_FLOW);
  });

  // Same capability listed twice — which the framework resolves off the FIRST
  // ref, skipping the later one. So a worker's options have to be read off the
  // first ref too, or a file would be allowed a preset the block never
  // resolves.
  it("reads a repeated capability off the first entry, as the framework does", () => {
    const flow = defineAgentWorkerFlow({
      uses: [research.presets({ briefing: false }), research]
    });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_FLOW]: flow }
    );

    expect(message).toContain("turned off");
  });
});
