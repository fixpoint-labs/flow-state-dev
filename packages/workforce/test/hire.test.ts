/**
 * `hireWorkforce` — the seat factory.
 *
 * Every case here is a record arriving from the loader (or hand-built the same
 * way) and the copy — or the refusal — it produces. The refusals are the point
 * of most of them: what the factory does NOT do is decided by the flow's own
 * config schema, so these tests check that the flow's refusal reaches the
 * caller naming the worker, rather than being caught and softened.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { hireWorkforce, type HireOptions } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";

const inputSchema = z.object({ note: z.string() });

const work = handler({
  name: "worker-work",
  inputSchema,
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input
});

/** The opinionated kind: it declares that it takes a persona. */
const workerAgentFlow = defineFlow({
  kind: "worker-agent",
  cardinality: "collection",
  configSchema: z.object({
    persona: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([])
  }),
  actions: { run: { inputSchema, block: work } }
});

/** The thin kind: it declares settings, and `persona` is not one of them. */
const intakeFlow = defineFlow({
  kind: "intake",
  cardinality: "collection",
  configSchema: z.object({ desk: z.string().default("front") }),
  actions: { run: { inputSchema, block: work } }
});

/** A thin kind that declares no settings at all — the bagless case. */
const doorFlow = defineFlow({
  kind: "door",
  cardinality: "collection",
  actions: { run: { inputSchema, block: work } }
});

const kinds: HireOptions["kinds"] = {
  "worker-agent": workerAgentFlow,
  intake: intakeFlow,
  door: doorFlow
};

const LEAD_BODY = "You are the engineering lead. You break work into tasks and report back.";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

const lead = record({
  id: "engineering.lead",
  declared: {
    description: "Holds the engineering board.",
    flow: "worker-agent",
    model: "openai/gpt-5.4-mini",
    tools: ["board", "search"]
  },
  body: LEAD_BODY
});

const intake = record({
  id: "engineering.intake",
  declared: { description: "The front door.", flow: "intake" }
});

function hireOne(manifest: WorkerManifest): FlowInstance {
  const [seat] = hireWorkforce([manifest], { kinds });
  return seat!;
}

function refusalOf(manifests: WorkerManifest[]): string {
  let seats: FlowInstance[] | undefined;
  try {
    seats = hireWorkforce(manifests, { kinds });
  } catch (error) {
    expect(seats).toBeUndefined();
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`expected a refusal, got ${seats.length} seat(s)`);
}

describe("hireWorkforce", () => {
  // 1
  it("mints one copy per record, carrying its own id, in id order", () => {
    const seats = hireWorkforce([lead, intake], { kinds });
    expect(seats.map((s) => s.id)).toEqual(["engineering.intake", "engineering.lead"]);
    expect(seats.map((s) => s.kind)).toEqual(["intake", "worker-agent"]);
  });

  // 2
  it("gives each copy its own settings, frozen, with no trace of its sibling's", () => {
    const seats = hireWorkforce([lead, intake], { kinds });
    const [thin, opinionated] = seats as [FlowInstance, FlowInstance];

    expect(opinionated.config).toMatchObject({
      model: "openai/gpt-5.4-mini",
      tools: ["board", "search"]
    });
    expect(Object.isFrozen(opinionated.config)).toBe(true);
    // The sibling's setting is absent, not merely different — one shared bag
    // is always right for somebody.
    expect(Object.hasOwn(opinionated.config, "desk")).toBe(false);
    expect(thin.config).toEqual({ desk: "front" });
    expect(Object.hasOwn(thin.config, "model")).toBe(false);
  });

  // 3
  it("hands a record's body to its flow as `persona`, verbatim, beside its declared settings", () => {
    const seat = hireOne(lead);
    expect(seat.config).toEqual({
      persona: LEAD_BODY,
      model: "openai/gpt-5.4-mini",
      tools: ["board", "search"]
    });
  });

  // 4
  it("contributes no `persona` key for an empty or whitespace-only body, and still hires", () => {
    for (const body of ["", "   \n\t  \n"]) {
      const seat = hireOne(record({ id: "engineering.intake", declared: { flow: "intake" }, body }));
      expect(Object.hasOwn(seat.config, "persona")).toBe(false);
      expect(seat.id).toBe("engineering.intake");
    }
  });

  // 4 (continued) — a kind that declares no settings at all still hires a thin
  // seat: a record that declared nothing is handed no bag.
  it("hires a thin seat into a flow kind that declares no settings", () => {
    const seat = hireOne(record({ id: "engineering.door", declared: { flow: "door" } }));
    expect(seat.config).toEqual({});
  });

  // 5
  it("refuses a body handed to a flow kind that never declared a persona, naming both", () => {
    const message = refusalOf([record({ ...intake, body: "You greet people." })]);
    expect(message).toContain('worker "engineering.intake"');
    expect(message).toContain("persona");
  });

  // 6
  it("refuses a record naming a kind the app did not pass, listing the kinds it did", () => {
    const message = refusalOf([record({ id: "engineering.scribe", declared: { flow: "note-taker" } })]);
    expect(message).toContain('worker "engineering.scribe"');
    expect(message).toContain('"note-taker"');
    expect(message).toContain('"worker-agent"');
    expect(message).toContain('"intake"');
  });

  // 6 (the inherited-key case) — a `flow` naming an Object.prototype member is
  // an unknown kind, not a factory found on the prototype.
  it("refuses a record whose `flow` names an inherited property", () => {
    const message = refusalOf([record({ id: "engineering.sneak", declared: { flow: "constructor" } })]);
    expect(message).toContain('worker "engineering.sneak"');
    expect(message).toContain('"constructor"');
  });

  // 6 (the mis-keyed map) — a flow filed under another kind's name would mint
  // and register fine, and then run the wrong worker's graph.
  it("refuses a flow passed under a key that is not its own kind", () => {
    let seats: FlowInstance[] | undefined;
    let message = "";
    try {
      seats = hireWorkforce([lead], { kinds: { ...kinds, "worker-agent": intakeFlow } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(seats).toBeUndefined();
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain('"worker-agent"');
    expect(message).toContain('"intake"');
  });

  // 7
  it("refuses a record with no `flow`, naming the worker", () => {
    const message = refusalOf([record({ id: "engineering.ghost", declared: { description: "no kind" } })]);
    expect(message).toContain('worker "engineering.ghost"');
    expect(message).toContain("flow");
  });

  // 8
  it("lets the flow's own refusal through for an undeclared setting, prefixed with the worker", () => {
    const message = refusalOf([
      record({ ...lead, declared: { ...lead.declared, temperature: 0.2 } })
    ]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain('"temperature"');
    expect(message).toContain("not a declared setting");
  });

  // 8 (the other half) — a required setting the record omits refuses at the mint.
  it("lets the flow refuse a record that omits a required setting", () => {
    const message = refusalOf([record({ id: "engineering.lead", declared: { flow: "worker-agent" } })]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("persona");
  });

  // 9
  it("reports every bad record in one error", () => {
    const message = refusalOf([
      record({ id: "engineering.scribe", declared: { flow: "note-taker" } }),
      record({ id: "engineering.ghost", declared: {} })
    ]);
    expect(message).toContain('worker "engineering.scribe"');
    expect(message).toContain('worker "engineering.ghost"');
    expect(message).toContain("refused 2 of 2");
  });

  // 10
  it("builds nothing partially — one bad record takes the whole call", () => {
    let seats: FlowInstance[] | undefined;
    expect(() => {
      seats = hireWorkforce([lead, intake, record({ id: "engineering.ghost", declared: {} })], {
        kinds
      });
    }).toThrow();
    expect(seats).toBeUndefined();
  });

  // 11
  it("refuses duplicate ids as a roster problem", () => {
    const message = refusalOf([lead, record({ ...lead, declared: { flow: "intake" } })]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("twice");
  });

  // 12
  it("returns an empty roster for empty input", () => {
    expect(hireWorkforce([], { kinds })).toEqual([]);
  });

  // 13
  it("refuses `persona` in frontmatter beside a body, naming both sources, applying no precedence", () => {
    const message = refusalOf([
      record({ ...lead, declared: { ...lead.declared, persona: "from the frontmatter" } })
    ]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("frontmatter");
    expect(message).toContain("body");
    // No winner was picked: the hire refused rather than returning a seat.
  });

  it("reads `description` for nothing, and keeps it out of the settings bag", () => {
    const seat = hireOne(lead);
    expect(Object.hasOwn(seat.config, "description")).toBe(false);
  });
});
