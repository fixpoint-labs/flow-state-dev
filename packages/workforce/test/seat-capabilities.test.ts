/**
 * A seat's own `capabilities:` key — what it picks up, what it is refused, and
 * the one thing that must not happen twice.
 *
 * Graded on what reached the MODEL, not on what the config parsed to. A seat
 * whose settings hold the right selection and whose generator was handed
 * nothing is exactly the failure this key exists to remove, and every shape
 * assertion survives it. So the checks below read the messages the provider
 * was given and the tool list it was offered.
 *
 * Two markers per capability, each written in exactly one preset, so a seat
 * carrying the wrong one — or carrying one twice — is visible rather than
 * merely absent.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineCapability, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, mockGenerator } from "@flow-state-dev/testing";
import { AGENT_KIND, defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";

// Markers, not prose: each appears in exactly one preset on one capability, so
// "carried", "not carried" and "carried twice" are three different readings of
// one string.
const BRIEFING = "BRIEFING-4471";
const LEDGER = "LEDGER-8830";
const TONE = "TONE-2216";
const EXTRA = "EXTRA-9074";
const SHARED = "SHARED-3308";

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
 * the kind's own fence tests grade on.
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
      survey: { tools: [lookup] },
      default: []
    }
  });
  return { capability, calls: () => calls };
}

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

/**
 * Hire a roster and address the seats by id.
 *
 * By id and never by position: `hireWorkforce` returns the roster sorted, so a
 * positional read silently hands one seat's assertions the other seat's
 * settings — which is the one mix-up every check in this file is blind to,
 * since both seats are the same kind.
 */
function hire(
  manifests: WorkerManifest[],
  kinds: HireOptions["kinds"] = {}
): (id: string) => FlowInstance {
  const seats = hireWorkforce(manifests, { kinds });
  return (id) => {
    const seat = seats.find((candidate) => candidate.id === id);
    if (!seat) throw new Error(`no seat "${id}" in [${seats.map((s) => s.id).join(", ")}]`);
    return seat;
  };
}

function refusalOf(manifests: WorkerManifest[], kinds: HireOptions["kinds"] = {}): string {
  try {
    hireWorkforce(manifests, { kinds });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got seats");
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
  seat: FlowInstance,
  script: Parameters<typeof mockGenerator>[0]["script"] = [{ text: "done" }],
  message = "what do you know?"
) {
  const answer = mockGenerator({ name: "agent-answer", script });
  const runtime = await createTestContext({
    flow: { ...seat, cardinality: "singleton" },
    orgId: "test-org",
    org: { state: {} },
    sessionId: `session-${seat.id}`,
    sequencerName: seat.actions.run!.block.name,
    declaredResources: seat.actions.run!.block.declaredResources,
    generators: { "agent-answer": answer },
    unmockedGeneratorPolicy: "allow"
  });

  const result = await executeBlock({
    block: seat.actions.run.block,
    input: { message },
    ctx: runtime.ctx
  });

  return { error: result.error, prompt: JSON.stringify(answer.calls[0]?.input ?? []) };
}

/** How many times a marker appears in what the provider was sent. */
function occurrences(prompt: string, marker: string): number {
  return prompt.split(marker).length - 1;
}

describe("a seat picks presets from what its kind carries", () => {
  // BR-11 and BR-15 together, and they only mean anything together: one shared
  // kind is always right for somebody, so a seat carrying its own selection is
  // evidence only beside a sibling that does not carry it.
  it("gives two seats of one kind the presets their own files named, and not each other's", async () => {
    const kind = defineAgentWorkerFlow({ uses: [research] });
    const seat = hire(
      [
        record({ id: "engineering.reader", declared: { capabilities: { research: ["briefing"] } } }),
        record({ id: "engineering.scout", declared: { capabilities: { research: ["ledger"] } } })
      ],
      { [AGENT_KIND]: kind }
    );

    const read = await turn(seat("engineering.reader"));
    const scouted = await turn(seat("engineering.scout"));

    expect(read.error).toBeUndefined();
    expect(scouted.error).toBeUndefined();
    expect(read.prompt).toContain(BRIEFING);
    expect(read.prompt).not.toContain(LEDGER);
    expect(scouted.prompt).toContain(LEDGER);
    expect(scouted.prompt).not.toContain(BRIEFING);
  });

  // BR-12. The seat that names nothing is the control for every other check in
  // this file: it must behave as it did before the key existed.
  it("gives a seat that names nothing the capability's own defaults, and nothing else", async () => {
    const kind = defineAgentWorkerFlow({ uses: [houseStyle] });
    const seat = hire([record({ id: "engineering.ghost" })], { [AGENT_KIND]: kind });

    const said = await turn(seat("engineering.ghost"));

    expect(said.error).toBeUndefined();
    // `tone` is this capability's default; `extra` is not.
    expect(occurrences(said.prompt, TONE)).toBe(1);
    expect(said.prompt).not.toContain(EXTRA);
  });

  // BR-22 — the check the whole per-seat mechanism is shaped around. The
  // framework merges static and dynamic `uses` independently and dedupes
  // across neither, so a capability contributing its presets on both paths
  // hands this seat TONE twice. `toBe(1)` is what fails when that happens;
  // `toContain` would pass.
  it("carries a preset that is already on by default exactly once when a seat names it", async () => {
    const kind = defineAgentWorkerFlow({ uses: [houseStyle] });
    const seat = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { "house-style": ["tone"] } } })],
      { [AGENT_KIND]: kind }
    );

    const said = await turn(seat("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, TONE)).toBe(1);
  });

  // The same doubling, reached the other way: core flattens `uses` depth-first,
  // so `desk`'s nested `research` ref is recorded BEFORE the top-level
  // `research` beside it, and the top-level one is then skipped as a diamond.
  // A catalogue that reads the top-level array alone sees the bare ref, thinks
  // `briefing` is off, and adds it again on the seat's path.
  it("carries a preset a composing capability already turned on exactly once", async () => {
    const kind = defineAgentWorkerFlow({ uses: [desk, research] });
    const seat = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_KIND]: kind }
    );

    const said = await turn(seat("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
  });

  // The additive half of the same capability: naming the default preset AND
  // the one that is off gets one copy of each, not two of the default.
  it("adds an off-by-default preset on top of the defaults, each carried once", async () => {
    const kind = defineAgentWorkerFlow({ uses: [houseStyle] });
    const seat = hire(
      [
        record({
          id: "engineering.lead",
          declared: { capabilities: { "house-style": ["tone", "extra"] } }
        })
      ],
      { [AGENT_KIND]: kind }
    );

    const said = await turn(seat("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, TONE)).toBe(1);
    expect(occurrences(said.prompt, EXTRA)).toBe(1);
  });

  // A preset's TOOLS travel the same per-seat path as its context. Graded on
  // the tool's own `execute`: a name the generator never registered resolves
  // to a synthesized result inside the mock's loop and never reaches it, so
  // the counter only moves when the tool really got there. The sibling, asked
  // to call the same name, is the red state this check needs to be worth
  // anything.
  it("gives a selected preset's tool to that seat and not to its sibling", async () => {
    const { capability, calls } = fieldwork();
    const kind = defineAgentWorkerFlow({ uses: [capability] });
    const seat = hire(
      [
        record({
          id: "engineering.surveyor",
          declared: { capabilities: { fieldwork: ["survey"] } }
        }),
        record({ id: "engineering.ghost" })
      ],
      { [AGENT_KIND]: kind }
    );

    const surveyed = await turn(seat("engineering.surveyor"), callsTool("lookup"));
    expect(surveyed.error).toBeUndefined();
    expect(calls()).toBe(1);

    const said = await turn(seat("engineering.ghost"), callsTool("lookup"));
    expect(said.error).toBeUndefined();
    expect(calls()).toBe(1);
  });

  // An empty list is the same as saying nothing — it is how an author leaves a
  // line in place while wanting the defaults.
  it("treats a named capability with no presets as naming nothing", async () => {
    const kind = defineAgentWorkerFlow({ uses: [houseStyle] });
    const seat = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { "house-style": [] } } })],
      { [AGENT_KIND]: kind }
    );

    const said = await turn(seat("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, TONE)).toBe(1);
    expect(said.prompt).not.toContain(EXTRA);
  });

  // A capability that COMPOSES another. The nested one is already installed by
  // the static entry — the framework flattens a capability's own `uses` at
  // build time — so the per-seat entry must contribute the top-level
  // capability's named presets and nothing below them. Graded on the nested
  // marker's COUNT: a per-seat entry that re-walked the subtree hands this seat
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
    const kind = defineAgentWorkerFlow({ uses: [composing] });
    const seat = hire(
      [
        record({ id: "engineering.ghost" }),
        record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })
      ],
      { [AGENT_KIND]: kind }
    );

    // The control: a seat that named nothing gets the nested surface once, from
    // the static entry. Without it, "once" for the selecting seat could mean
    // the nested capability simply never arrived.
    const quiet = await turn(seat("engineering.ghost"));
    expect(quiet.error).toBeUndefined();
    expect(occurrences(quiet.prompt, SHARED)).toBe(1);

    const said = await turn(seat("engineering.lead"));
    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
    expect(occurrences(said.prompt, SHARED)).toBe(1);
  });

  // The same axis, and the sharper failure. The framework refuses a
  // config-declaring capability on the per-seat path outright, so a per-seat
  // entry that reached into what the named capability composes would take a
  // seat that hired cleanly and break every turn it ever runs — the mid-turn
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
    const kind = defineAgentWorkerFlow({ uses: [composing] });
    const seat = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_KIND]: kind }
    );

    const said = await turn(seat("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
  });

  // The app's own `.presets()` is not lost when a seat adds to the capability:
  // the seat's ref is cloned from the app's, so a preset the app left on stays
  // on for the seat that named a different one.
  it("keeps what the app turned on when a seat adds a preset beside it", async () => {
    const kind = defineAgentWorkerFlow({ uses: [research.presets({ ledger: true })] });
    const seat = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_KIND]: kind }
    );

    const said = await turn(seat("engineering.lead"));

    expect(said.error).toBeUndefined();
    expect(occurrences(said.prompt, LEDGER)).toBe(1);
    expect(occurrences(said.prompt, BRIEFING)).toBe(1);
  });
});

describe("a seat's capability selection is refused at the hire, never mid-turn", () => {
  // BR-13.
  it("refuses a capability the kind does not carry, naming it and listing what the kind has", () => {
    const kind = defineAgentWorkerFlow({ uses: [research] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { memory: ["recall"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain("engineering.lead");
    expect(message).toContain('"memory"');
    expect(message).toContain('"research"');
  });

  it("lists nothing when the kind installs no capabilities at all", () => {
    const message = refusalOf([
      record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })
    ]);

    expect(message).toContain('"research"');
    expect(message).toContain("(none)");
  });

  // BR-14 — and the reason it is at the mint: `capabilities` is one setting,
  // so the whole rule fits in the closed schema the hire step already parses.
  it("refuses a preset the capability does not declare, listing the ones it does", () => {
    const kind = defineAgentWorkerFlow({ uses: [research] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["breifing"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain('"breifing"');
    expect(message).toContain('"briefing"');
    expect(message).toContain('"ledger"');
  });

  it("names every bad selection on a seat, not just the first", () => {
    const kind = defineAgentWorkerFlow({ uses: [research] });
    const message = refusalOf(
      [
        record({
          id: "engineering.lead",
          declared: { capabilities: { research: ["breifing"], memory: ["recall"] } }
        })
      ],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain('"breifing"');
    expect(message).toContain('"memory"');
  });

  // Selecting is not widening. The app's `false` is a statement about the
  // whole kind — the recipe that keeps a tool-bearing preset away from the
  // model is written exactly this way — and a worker file does not reverse it.
  it("refuses a preset the app turned off where it installed the capability", () => {
    const kind = defineAgentWorkerFlow({ uses: [research.presets({ briefing: false })] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain('"briefing"');
    expect(message).toContain("turned off");
  });

  // The framework refuses a config-declaring capability on the dynamic path
  // outright. Caught here, at boot, rather than thrown inside the seat's first
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
    const kind = defineAgentWorkerFlow({ uses: [configured] });
    const message = refusalOf(
      [
        record({
          id: "engineering.lead",
          declared: { capabilities: { "briefing-service": ["summary"] } }
        })
      ],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain('"summary"');
    expect(message).toContain("takes config");
  });

  // A preset whose surface has to exist before a request runs cannot be half
  // delivered. Refused by name rather than selected and silently short.
  it("refuses a preset whose surface the per-seat path cannot carry", () => {
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
    const kind = defineAgentWorkerFlow({ uses: [stateful] });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { casework: ["history"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain('"history"');
    expect(message).toContain("sessionStateSchema");
  });

  // The inverse of the rule above: a build-time-only preset the app already
  // has ON is installed statically, so naming it is naming what the seat
  // already carries and is not refused.
  it("allows a seat to name a build-time-only preset the app already turned on", () => {
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
    const kind = defineAgentWorkerFlow({ uses: [stateful] });
    const seat = hire(
      [record({ id: "engineering.lead", declared: { capabilities: { casework: ["history"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(seat("engineering.lead").kind).toBe(AGENT_KIND);
  });

  // Same capability listed twice — which the framework resolves off the FIRST
  // ref, skipping the later one. So a seat's options have to be read off the
  // first ref too, or a file would be allowed a preset the block never
  // resolves.
  it("reads a repeated capability off the first entry, as the framework does", () => {
    const kind = defineAgentWorkerFlow({
      uses: [research.presets({ briefing: false }), research]
    });
    const message = refusalOf(
      [record({ id: "engineering.lead", declared: { capabilities: { research: ["briefing"] } } })],
      { [AGENT_KIND]: kind }
    );

    expect(message).toContain("turned off");
  });
});
