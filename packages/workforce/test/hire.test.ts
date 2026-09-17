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
import { workerConfigSchema } from "../src/worker-config";

const inputSchema = z.object({ note: z.string() });

const work = handler({
  name: "worker-work",
  inputSchema,
  outputSchema: z.object({ note: z.string() }),
  execute: (input) => input
});

/**
 * The opinionated kind: it composes the contract and makes `instructions`
 * REQUIRED, which is the kind's own call to make — the contract's own
 * `instructions` is optional.
 *
 * Deliberately the fixture an empty bag cannot satisfy, so the one case the
 * refusal wording is admittedly partial in is exercised by a real kind rather
 * than described.
 */
const customAgentFlow = defineFlow({
  kind: "custom-agent",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({
    instructions: z.string(),
    model: z.string().default("openai/gpt-5.4-mini"),
    tools: z.array(z.string()).default([])
  }),
  actions: { run: { inputSchema, block: work } }
});

/**
 * The thin kind: it composes the contract and adds one setting of its own, and
 * `instructions` is not among the ones it requires.
 */
const intakeFlow = defineFlow({
  kind: "intake",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
  actions: { run: { inputSchema, block: work } }
});

/**
 * The kind that never composed the contract — **kept uncomposed on purpose.**
 *
 * It declares no settings at all, which is the thinnest a kind can be and the
 * furthest thing from an opt-in. A bag reaches it like every other kind, so it
 * refuses, and its author is told which door to open. This is the upgrade cost
 * the design accepts, and the fixture that pins it.
 */
const doorFlow = defineFlow({
  kind: "door",
  cardinality: "collection",
  actions: { run: { inputSchema, block: work } }
});

/**
 * A kind whose own settings schema still spells the setting the old way. This
 * is the shape the factory's guard exists for, and the only one that would take
 * the refused key in silence: a flow's config gate is closed, so an unknown key
 * is refused by the flow itself — but a key the flow DOES declare is accepted,
 * and a seat then boots configured the old way with nothing said.
 */
const staleDeskFlow = defineFlow({
  kind: "stale-desk",
  cardinality: "collection",
  configSchema: workerConfigSchema().extend({
    desk: z.string().default("front"),
    persona: z.string().optional()
  }),
  actions: { run: { inputSchema, block: work } }
});

const kinds: HireOptions["kinds"] = {
  "custom-agent": customAgentFlow,
  intake: intakeFlow,
  door: doorFlow,
  "stale-desk": staleDeskFlow
};

const LEAD_BODY = "You are the engineering lead. You break work into tasks and report back.";

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

const lead = record({
  id: "engineering.lead",
  declared: {
    description: "Holds the engineering board.",
    flow: "custom-agent",
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
    expect(seats.map((s) => s.kind)).toEqual(["intake", "custom-agent"]);
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
    expect(thin.config).toEqual({ desk: "front", seatSkills: [] });
    expect(Object.hasOwn(thin.config, "model")).toBe(false);
  });

  // 3
  it("hands a record's body to its flow as `instructions`, verbatim, beside its declared settings", () => {
    const seat = hireOne(lead);
    // Whole-bag equality, not a subset: `seatSkills` is listed because the bag
    // now genuinely carries it for every seat, and a `toMatchObject` here would
    // stop noticing a key the factory started adding by accident.
    expect(seat.config).toEqual({
      instructions: LEAD_BODY,
      seatSkills: [],
      model: "openai/gpt-5.4-mini",
      tools: ["board", "search"]
    });
  });

  // 4
  it("contributes no `instructions` key for an empty or whitespace-only body, and still hires", () => {
    for (const body of ["", "   \n\t  \n"]) {
      const seat = hireOne(record({ id: "engineering.intake", declared: { flow: "intake" }, body }));
      expect(Object.hasOwn(seat.config, "instructions")).toBe(false);
      expect(seat.id).toBe("engineering.intake");
    }
  });

  // 4 (the whitespace corner the docs promise). Because the two-sources refusal
  // sits INSIDE the non-empty-body guard, a record whose body is only
  // whitespace is a record with no body at all — so a frontmatter
  // `instructions:` beside it is the only source and hires on that value rather
  // than being refused. Pinned because the page states it; without this the
  // prose rests on a guard nothing asserts.
  it("hires on the frontmatter value when the body is only whitespace, rather than refusing two sources", () => {
    const seat = hireOne(
      record({
        id: "engineering.lead",
        declared: { flow: "custom-agent", instructions: "From the frontmatter." },
        body: "   \n\t  \n"
      })
    );
    expect(seat.config).toMatchObject({ instructions: "From the frontmatter." });
  });

  // 4 (the other half of "verbatim"). The emptiness test is on the TRIMMED
  // body; the value handed over is not trimmed. A body that has content keeps
  // its own leading and trailing whitespace, which the page also states.
  it("hands a non-empty body over untrimmed, whitespace included", () => {
    const padded = `\n\n  ${LEAD_BODY}  \n\n`;
    const seat = hireOne(record({ ...lead, body: padded }));
    expect(seat.config).toMatchObject({ instructions: padded });
  });

  // 4 (continued) — the thinnest record there is still meets the kind's schema.
  //
  // The positive half: nothing about a record declaring no settings and
  // carrying no body lets it skip admission. It hires, and the bag it was
  // admitted with holds the seat's skills, present and empty.
  it("hires the thinnest possible record into a composed kind, bag and all", () => {
    const seat = hireOne(record({ id: "engineering.intake", declared: { flow: "intake" } }));
    expect(seat.config).toMatchObject({ seatSkills: [], desk: "front" });
  });

  // ...and the refusal half, which is the one that fails on the old code. A
  // kind declaring no settings at all used to hire this record by being handed
  // no bag — admission skipped rather than passed. There is no such record now.
  it("refuses the thinnest possible record on a kind that never composed the contract", () => {
    const message = refusalOf([record({ id: "engineering.door", declared: { flow: "door" } })]);
    expect(message).toContain('worker "engineering.door"');
    expect(message).toContain("workerConfigSchema()");
  });

  // 5 — **this rule changed with the contract, and the change is the point.**
  //
  // A body handed to a kind that did not declare `instructions` used to refuse.
  // No hireable kind is in that position any more: `instructions` is one of the
  // three settings the contract declares, so every composed kind has a door for
  // a worker's body and a bodied record hires into any of them. "Thin" is a
  // property of a SEAT — a record with no body carries no `instructions` key,
  // which case 4 above pins — and no longer a property a kind enforces.
  //
  // What survives is the refusal that now carries that weight: a body, or
  // anything else, handed to a kind that never composed the contract at all.
  it("hires a bodied record into any composed kind, and refuses one whose kind has no door", () => {
    const greeter = hireOne(record({ ...intake, body: "You greet people." }));
    expect(greeter.config).toMatchObject({ instructions: "You greet people." });

    const message = refusalOf([
      record({ id: "engineering.door", declared: { flow: "door" }, body: "You greet people." })
    ]);
    expect(message).toContain('worker "engineering.door"');
    expect(message).toContain("workerConfigSchema()");
  });

  // 6
  it("refuses a record naming a kind the app did not pass, listing the kinds it did", () => {
    const message = refusalOf([record({ id: "engineering.scribe", declared: { flow: "note-taker" } })]);
    expect(message).toContain('worker "engineering.scribe"');
    expect(message).toContain('"note-taker"');
    expect(message).toContain('"custom-agent"');
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
      seats = hireWorkforce([lead], { kinds: { ...kinds, "custom-agent": intakeFlow } });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(seats).toBeUndefined();
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain('"custom-agent"');
    expect(message).toContain('"intake"');
  });

  // 7 — a record with no `flow:` no longer refuses; it hires the built-in
  // `agent` kind (see `agent-worker-flow.test.ts`). What still refuses is a `flow:`
  // that is present and names nothing.
  it("refuses a record whose `flow` is whitespace-only, naming the worker", () => {
    const message = refusalOf([
      record({ id: "engineering.ghost", declared: { description: "no kind", flow: "   " } })
    ]);
    expect(message).toContain('worker "engineering.ghost"');
    expect(message).toContain("flow");
  });

  // 7 (the YAML-valueless case) — a `flow:` key parsed from a file with no
  // value arrives as an own property holding `null`, the same shape a
  // hand-built `flow: null`/`flow: undefined` manifest carries. That is a
  // PRESENT key and must refuse, exactly like the whitespace case above —
  // only an ABSENT key resolves to the built-in.
  it("refuses a record whose `flow` is present but valueless (null), naming the worker", () => {
    const message = refusalOf([
      record({ id: "engineering.ghost", declared: { description: "no kind", flow: null } })
    ]);
    expect(message).toContain('worker "engineering.ghost"');
    expect(message).toContain("flow");
    expect(message).toContain("null");
  });

  // 7 (the non-string case) — a `flow:` that IS present but names no string
  // at all (a hand-built roster, or a stray YAML number) must refuse with
  // what was actually declared, not silently hire the built-in.
  it("refuses a record whose `flow` is present but not a string, naming what was declared", () => {
    const message = refusalOf([record({ id: "engineering.ghost", declared: { flow: 42 } })]);
    expect(message).toContain('worker "engineering.ghost"');
    expect(message).toContain("flow");
    expect(message).toContain("42");
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
    const message = refusalOf([record({ id: "engineering.lead", declared: { flow: "custom-agent" } })]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("instructions");
  });

  // 9
  it("reports every bad record in one error", () => {
    const message = refusalOf([
      record({ id: "engineering.scribe", declared: { flow: "note-taker" } }),
      record({ id: "engineering.ghost", declared: { flow: "   " } })
    ]);
    expect(message).toContain('worker "engineering.scribe"');
    expect(message).toContain('worker "engineering.ghost"');
    expect(message).toContain("refused 2 of 2");
  });

  // 10
  it("builds nothing partially — one bad record takes the whole call", () => {
    let seats: FlowInstance[] | undefined;
    expect(() => {
      seats = hireWorkforce([lead, intake, record({ id: "engineering.ghost", declared: { flow: "   " } })], {
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
  it("refuses `instructions` in frontmatter beside a body, naming both sources, applying no precedence", () => {
    const message = refusalOf([
      record({ ...lead, declared: { ...lead.declared, instructions: "from the frontmatter" } })
    ]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("frontmatter");
    expect(message).toContain("body");
    // No winner was picked: the hire refused rather than returning a seat.
  });

  // 14 — the refused key. `persona` is not a setting the factory imposes and
  // not one it forwards: it is refused, by name, wherever a record still spells
  // it that way.
  it("refuses the refused `persona` key, naming it and the key that replaced it", () => {
    const message = refusalOf([
      record({
        id: "engineering.lead",
        declared: { description: "Holds the board.", flow: "custom-agent", persona: "the old spelling" }
      })
    ]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("persona");
    expect(message).toContain("not a setting a worker declares");
    expect(message).toContain("instructions");
  });

  // 14 (the silent-accept half, and the reason the guard exists at all).
  //
  // A flow's config gate is closed, so for most kinds a stray `persona` is
  // refused by the flow itself — badly, as `"persona" is not a declared
  // setting`, which reads as a typo rather than as a key the framework refuses. The
  // guard's real work is the case below: an app whose own `configSchema` has
  // not been renamed yet still DECLARES `persona`, so the flow accepts it. The
  // seat hires, boots configured the old way, and carries no `instructions` —
  // with nothing said anywhere. That is the failure this refusal exists to stop,
  // so it is the one asserted here.
  it("refuses the refused key where the flow's own schema would still have accepted it in silence", () => {
    // The control, and the thing that makes this test mean something: with the
    // key spelled anything else, this flow really does take it and hire.
    const control = hireOne(
      record({ id: "engineering.desk", declared: { flow: "stale-desk", desk: "mezzanine" } })
    );
    expect(control.config).toMatchObject({ desk: "mezzanine" });

    const message = refusalOf([
      record({ id: "engineering.desk", declared: { flow: "stale-desk", persona: "the old spelling" } })
    ]);
    expect(message).toContain('worker "engineering.desk"');
    expect(message).toContain("not a setting a worker declares");
    expect(message).toContain("instructions");
  });

  // 14 (the body half) — a record carrying BOTH the refused key and a body is
  // refused for the persona key, not for having two sources. The refused key is
  // the more specific fault and the one the author has to fix first.
  it("refuses the refused key ahead of the two-sources rule when a record has both", () => {
    const message = refusalOf([
      record({ ...lead, declared: { ...lead.declared, persona: "the old spelling" } })
    ]);
    expect(message).toContain("not a setting a worker declares");
    expect(message).not.toContain("two sources");
  });

  // The third imposed key, and the sharper case of the two refused ones: every
  // composed kind DECLARES `teamInstructions`, so the closed schema would take
  // an authored one happily and the seat would run on team instructions its
  // team never wrote. The control below is what makes that concrete.
  it("refuses a worker that declares `teamInstructions:` itself, by name", () => {
    // Control: the same kind, same record shape, a key it does declare — hires.
    const control = hireOne(record({ ...lead, declared: { ...lead.declared, model: "openai/gpt-5.4" } }));
    expect(control.config).toMatchObject({ model: "openai/gpt-5.4" });

    const message = refusalOf([
      record({ ...lead, declared: { ...lead.declared, teamInstructions: "We answer within the hour." } })
    ]);
    expect(message).toContain('worker "engineering.lead"');
    expect(message).toContain("teamInstructions");
    expect(message).toContain("not a setting a worker declares");
    expect(message).toContain("belong to its team");
  });

  // The hint must never accuse a kind that is demonstrably fine. This kind
  // ACCEPTS the whole imposed bag, but declares `seatSkills` optional with no
  // default — so its probed default bag carries no such key, and a version of
  // the hint that inferred from probed defaults told its author they had never
  // composed the contract when all they had was a typo in their own setting.
  it("stays silent when the refusal is about the kind's own setting, not the contract", () => {
    const optionalNoDefault = defineFlow({
      kind: "optional-no-default",
      cardinality: "collection",
      configSchema: z.object({
        instructions: z.string().optional(),
        teamInstructions: z.string().optional(),
        seatSkills: z.array(z.object({ name: z.string(), skillMd: z.string() })).optional(),
        retries: z.number().default(3)
      }),
      actions: { run: { inputSchema, block: work } }
    });
    const withKind = { ...kinds, "optional-no-default": optionalNoDefault as never };

    // It really does accept the bag — without this the test below would pass
    // for a kind that is genuinely missing the door.
    const [ok] = hireWorkforce(
      [record({ id: "engineering.ok", declared: { flow: "optional-no-default" }, body: "Work." })],
      { kinds: withKind }
    );
    expect(ok!.config).toMatchObject({ instructions: "Work.", seatSkills: [] });

    let message = "";
    try {
      hireWorkforce(
        [
          record({
            id: "engineering.typo",
            declared: { flow: "optional-no-default", retries: "many" },
            body: "Work."
          })
        ],
        { kinds: withKind }
      );
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("retries");
    // The accusation that must not appear.
    expect(message).not.toContain("workerConfigSchema()");
  });

  // BR-2's other half: a kind with no contract is a ROSTER problem, collected
  // alongside the others so one run names all of them, not thrown on its own.
  it("reports a missing contract alongside the roster's other problems", () => {
    const message = refusalOf([
      record({ id: "engineering.door", declared: { flow: "door" } }),
      record({ id: "engineering.scribe", declared: { flow: "note-taker" } })
    ]);
    expect(message).toContain("refused 2 of 2 workers");
    expect(message).toContain('worker "engineering.door"');
    expect(message).toContain("workerConfigSchema()");
    expect(message).toContain('worker "engineering.scribe"');
  });

  it("reads `description` for nothing, and keeps it out of the settings bag", () => {
    const seat = hireOne(lead);
    expect(Object.hasOwn(seat.config, "description")).toBe(false);
  });
});
