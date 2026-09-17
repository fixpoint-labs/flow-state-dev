/**
 * `workerConfigSchema()` — the admission contract every hireable kind composes.
 *
 * Two things are under test and they are different. The SCHEMA's own behaviour
 * (what parses, what defaults, what refuses) is checked directly. What that
 * buys a kind — that extending it leaves the framework's closing intact, and
 * that a kind's own required setting still refuses — is checked through
 * `defineFlow`, because the closing is the framework's and asserting it on a
 * bare zod object would prove nothing about a real flow.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { hireWorkforce } from "../src/hire";
import type { WorkerManifest } from "../src/manifest";
import { INSTRUCTIONS_KEY, SEAT_SKILLS_KEY, TEAM_INSTRUCTIONS_KEY } from "../src/manifest";
import { workerConfigSchema, type WorkerConfig } from "../src/worker-config";

const inputSchema = z.object({ note: z.string() });

const work = handler({
  name: "contract-work",
  inputSchema,
  outputSchema: inputSchema,
  execute: (input) => input
});

function record(over: Partial<WorkerManifest> & { id: string }): WorkerManifest {
  return { declared: {}, body: "", ...over };
}

function refusalOf(manifests: WorkerManifest[], kinds: Record<string, never>): string {
  try {
    hireWorkforce(manifests, { kinds });
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("expected a refusal, got seats");
}

describe("workerConfigSchema — the bag itself", () => {
  // The whole contract in one assertion: an empty bag is valid, and what comes
  // out of it is an empty skills list and nothing else. Present-and-empty is
  // the answer for "nothing to give".
  it("parses an empty bag into an empty seatSkills and no other key", () => {
    const parsed = workerConfigSchema().parse({});
    expect(parsed).toEqual({ [SEAT_SKILLS_KEY]: [] });
  });

  // Absent, not empty — both of them. An empty string would be a different
  // value for every seat with no body and every team with no file, and
  // downstream that reads as "instructions that say nothing".
  it("leaves both instruction keys absent rather than defaulting them to empty", () => {
    const parsed = workerConfigSchema().parse({});
    expect(Object.hasOwn(parsed, INSTRUCTIONS_KEY)).toBe(false);
    expect(Object.hasOwn(parsed, TEAM_INSTRUCTIONS_KEY)).toBe(false);
  });

  it("carries a worker's own instructions and its team's as two separate values", () => {
    const parsed = workerConfigSchema().parse({
      [INSTRUCTIONS_KEY]: "You hold the desk.",
      [TEAM_INSTRUCTIONS_KEY]: "This team answers within the hour."
    });
    expect(parsed[INSTRUCTIONS_KEY]).toBe("You hold the desk.");
    expect(parsed[TEAM_INSTRUCTIONS_KEY]).toBe("This team answers within the hour.");
  });

  // Structural, not a second parser — but a skill that lost its body on the way
  // is a skill that will fail much later, in the seeder, per seat.
  it("refuses a skill record whose shape did not survive the trip", () => {
    expect(() =>
      workerConfigSchema().parse({ [SEAT_SKILLS_KEY]: [{ name: "triage" }] })
    ).toThrow();
    expect(() =>
      workerConfigSchema().parse({ [SEAT_SKILLS_KEY]: [{ name: "", skillMd: "x" }] })
    ).toThrow();
  });

  // A fresh object per call. A kind that overrides one of the contract's keys
  // — the built-in `agent` does — must not be editing a value other kinds hold.
  it("returns a new schema each call rather than a shared one", () => {
    expect(workerConfigSchema()).not.toBe(workerConfigSchema());
  });

  it("types the parsed bag as WorkerConfig", () => {
    const parsed: WorkerConfig = workerConfigSchema().parse({});
    expect(parsed[SEAT_SKILLS_KEY]).toEqual([]);
  });
});

describe("workerConfigSchema — what composing it buys a kind", () => {
  /** A kind that extends the contract with one setting of its own. */
  const triage = defineFlow({
    kind: "contract-triage",
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
    actions: { run: { inputSchema, block: work } }
  });

  /** The same, but its own setting is REQUIRED — a kind's call to make. */
  const strictTriage = defineFlow({
    kind: "contract-triage-strict",
    cardinality: "collection",
    configSchema: workerConfigSchema().extend({ desk: z.string() }),
    actions: { run: { inputSchema, block: work } }
  });

  const kinds = { "contract-triage": triage, "contract-triage-strict": strictTriage } as never;

  it("hires a seat and hands it both its own setting and the contract's", () => {
    const [seat] = hireWorkforce(
      [record({ id: "support.desk", declared: { flow: "contract-triage", desk: "mezzanine" } })],
      { kinds }
    );
    expect(seat!.config).toMatchObject({ desk: "mezzanine", [SEAT_SKILLS_KEY]: [] });
  });

  // BR-13 — extending the contract does NOT open the schema. The framework
  // still closes the set, and an undeclared key refuses by name. This is the
  // whole reason a kind's own settings live at the top level.
  it("still refuses a top-level key the kind never declared", () => {
    const message = refusalOf(
      [
        record({
          id: "support.desk",
          declared: { flow: "contract-triage", temperature: "0.2" }
        })
      ],
      kinds
    );
    expect(message).toContain('worker "support.desk"');
    expect(message).toContain("temperature");
  });

  // BR-12 — omitting a key is not a way around the kind's schema. The rule the
  // bag already applies, not a second one: a bag always goes, so an empty one
  // is parsed and a required setting refuses here rather than at run time.
  it("refuses when the kind requires a setting and no worker file wrote one", () => {
    const message = refusalOf(
      [record({ id: "support.desk", declared: { flow: "contract-triage-strict" } })],
      kinds
    );
    expect(message).toContain('worker "support.desk"');
    expect(message).toContain("desk");
  });
});
