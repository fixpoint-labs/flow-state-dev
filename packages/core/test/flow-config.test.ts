/**
 * The instance create-time config bag (FIX-1331).
 *
 * Two copies of one definition differ by the settings they were created with:
 * the flow declares the shape with `configSchema`, the factory parses and
 * freezes the bag, and every block inside that copy reads it as
 * `ctx.flow.config`. A block says what it needs of any flow that installs it
 * with `flowConfigSchema`, and the flow refuses when it cannot meet that.
 *
 * The fence these tests exist to hold: anything the copy is GIVEN goes in the
 * bag; anything the copy LEARNS goes in its own instance-isolated state.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineFlow, generator, handler, router, sequencer } from "../src";
import type { FlowInstance } from "../src/types/flow";
import { createMockContext, runForTest } from "./helpers";

const seatConfig = z.object({
  harness: z.enum(["claude-code", "codex", "cursor"]),
  model: z.string(),
  personaPath: z.string().optional()
});

/** What each of the four kinds below declares it needs of its flow. */
const needsModel = z.object({ model: z.string() });

const needsModelHandler = (name: string) =>
  handler({
    name,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    flowConfigSchema: needsModel,
    execute: async () => ({})
  });

const needsModelGenerator = (name: string) =>
  generator({
    name,
    inputSchema: z.object({}),
    model: "openai/gpt-5.4-mini",
    prompt: () => "go",
    flowConfigSchema: needsModel,
    itemVisibility: { client: true, history: true }
  });

const needsModelRouter = (name: string) => {
  const only = handler({
    name: `${name}-route`,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    execute: async () => ({})
  });
  return router({
    name,
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    flowConfigSchema: needsModel,
    routes: [only],
    execute: () => only
  });
};

const needsModelSequencer = (name: string) =>
  sequencer({ name, inputSchema: z.object({}), flowConfigSchema: needsModel }).step(
    handler({
      name: `${name}-step`,
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({})
    })
  );

/** A block context whose `flow` is a real minted instance, not a stub. */
function ctxFor(instance: FlowInstance) {
  return createMockContext({ flow: instance as unknown as { config: Readonly<Record<string, unknown>> } });
}

describe("flow config bag — the value and its door", () => {
  /**
   * Behaviour 1. Frozen, and frozen SHALLOWLY — the two asserted together so
   * nobody later reads this suite as a promise of deep immutability. A nested
   * mutation succeeds and is visible to every later block in the process; that
   * is a documented limitation, not a defence.
   */
  it("freezes the bag at the top level and does not deep-freeze it", () => {
    const flow = defineFlow({
      kind: "frozen-seat",
      configSchema: z.object({
        model: z.string(),
        limits: z.object({ retries: z.number() })
      }),
      actions: {}
    });
    const instance = flow({ config: { model: "opus", limits: { retries: 2 } } });

    expect(Object.isFrozen(instance.config)).toBe(true);
    expect(() => {
      (instance.config as { model: string }).model = "haiku";
    }).toThrow(TypeError);
    expect(instance.config.model).toBe("opus");

    // And the honest half: one level down is ordinary and mutable.
    (instance.config.limits as { retries: number }).retries = 99;
    expect(instance.config.limits.retries).toBe(99);
  });

  /**
   * Behaviour 2. A copy may only carry settings the definition declared. The
   * compile-time half is in `types/tests/flow-config.type-test.ts`; this is
   * the runtime half, for the caller who reaches past the types.
   */
  it("refuses a bag when the definition declared no configSchema, naming the flow", () => {
    const flow = defineFlow({ kind: "undeclared-seat", actions: {} });

    expect(() => flow({ config: { model: "opus" } } as never)).toThrow(
      /Flow "undeclared-seat" instance "undeclared-seat" was created with a config bag, but the flow declares no configSchema/
    );
  });

  /**
   * Behaviour 3. The behaviour a strip-by-default parse passes SILENTLY, and
   * the one that makes "declared or refused" true rather than merely promised.
   *
   * The bag is built as a plain object from string keys — the shape a roster
   * read from a file has — so what refuses is the schema, not TypeScript's
   * excess-property check on a fresh literal.
   */
  it("refuses a key nobody declared, naming the flow, the id and the key", () => {
    const engineer = defineFlow({
      kind: "engineer",
      cardinality: "collection",
      configSchema: seatConfig,
      actions: {}
    });

    const fromRoster: Record<string, unknown> = {};
    for (const [key, value] of Object.entries({ harnes: "codex", model: "gpt-5.4" })) {
      fromRoster[key] = value;
    }

    expect(() => engineer({ id: "eng-carol", config: fromRoster as never })).toThrow(
      /Flow "engineer" instance "eng-carol" has an invalid config bag: .*"harnes" is not a declared setting/
    );
  });

  /**
   * Behaviour 6. The value rides the context spread, so reading it in a root
   * handler proves nothing about a step inside a sequencer. This is the second
   * path (BP-035), and the one a naive suite misses.
   */
  it("reaches a block nested inside a sequencer, not just the root", async () => {
    const seen: string[] = [];

    const readKnob = handler({
      name: "read-knob",
      inputSchema: z.object({}),
      outputSchema: z.object({ model: z.string() }),
      flowConfigSchema: seatConfig,
      execute: async (_input, ctx) => {
        seen.push(ctx.flow.config.model);
        return { model: ctx.flow.config.model };
      }
    });

    const chain = sequencer({ name: "seat-chain", inputSchema: z.object({}) })
      .step(readKnob)
      .tap(
        handler({
          name: "read-knob-again",
          inputSchema: z.object({ model: z.string() }),
          outputSchema: z.void(),
          flowConfigSchema: seatConfig,
          execute: async (_input, ctx) => {
            seen.push(`tap:${ctx.flow.config.harness}`);
          }
        })
      );

    const engineer = defineFlow({
      kind: "engineer-nested",
      cardinality: "collection",
      configSchema: seatConfig,
      actions: { work: { block: chain } }
    });
    const alice = engineer({ id: "eng-alice", config: { harness: "codex", model: "gpt-5.4" } });

    await runForTest(chain, {}, ctxFor(alice as unknown as FlowInstance));

    expect(seen).toEqual(["gpt-5.4", "tap:codex"]);
  });

  /**
   * Behaviour 7's first half. The trap: `defineFlow` builds the blueprint's
   * mirrored properties at definition time, so parsing a required-field schema
   * THERE would throw before the first mint could run — and the two-seat
   * example would be unrunnable with nothing saying so.
   */
  it("defines a flow whose configSchema has required fields, and mints it", () => {
    const work = handler({
      name: "seat-work",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      execute: async () => ({})
    });
    const engineer = defineFlow({
      kind: "engineer-required",
      cardinality: "collection",
      configSchema: seatConfig,
      actions: { work: { block: work } }
    });

    expect(engineer.kind).toBe("engineer-required");
    expect(engineer.cardinality).toBe("collection");
    // The blueprint says it cannot run bare, and carries the empty bag rather
    // than a half-parsed one.
    expect(engineer.requiresConfig).toBe(true);
    expect(engineer.config).toEqual({});

    const alice = engineer({ id: "eng-alice", config: { harness: "claude-code", model: "opus" } });
    const bob = engineer({ id: "eng-bob", config: { harness: "codex", model: "gpt-5.4" } });

    expect(alice.config).toEqual({ harness: "claude-code", model: "opus" });
    expect(bob.config).toEqual({ harness: "codex", model: "gpt-5.4" });
    // One action tree, two copies — the point of the whole change. Both
    // copies carry the SAME block, not a per-copy rebuild of it.
    expect(alice.actions.work.block).toBe(work);
    expect(bob.actions.work.block).toBe(work);

    expect(() => engineer({ id: "eng-carol" })).toThrow(
      /Flow "engineer-required" instance "eng-carol" was created without a config bag/
    );
  });

  /**
   * Behaviour 8. Omitting the bag is not a way around the schema: `{}` is
   * parsed, so defaults apply rather than a bare empty object landing.
   */
  it("applies the schema's defaults when a mint omits the bag", () => {
    const flow = defineFlow({
      kind: "defaulted-seat",
      configSchema: z.object({
        harness: z.string().default("claude-code"),
        retries: z.number().default(3)
      }),
      actions: {}
    });

    expect(flow({ id: "defaulted-seat" }).config).toEqual({ harness: "claude-code", retries: 3 });
    // And a bare-registered blueprint reads exactly the same value, so the two
    // can never diverge.
    expect(flow.config).toEqual({ harness: "claude-code", retries: 3 });
    expect(flow.requiresConfig).toBe(false);
  });

  /**
   * Behaviour 9. What must not change (BP-030): every flow written before this
   * option existed declares nothing, passes nothing, and reads a frozen empty
   * object.
   */
  it("gives a flow that declares neither option a frozen empty bag", () => {
    const flow = defineFlow({ kind: "plain-flow", actions: {} });
    const instance = flow();

    expect(instance.config).toEqual({});
    expect(Object.isFrozen(instance.config)).toBe(true);
    expect(flow.requiresConfig).toBe(false);
    // The block-side requirements are build-time only and never ride onto an
    // instance: they are derived from the definition, identical for every
    // copy, and read nowhere after the mint has parsed the bag against them.
    expect(Object.hasOwn(instance, "requiredFlowConfig")).toBe(false);
  });

  /** `configSchema` is the definition's, like `cardinality` — not an instance option. */
  it("refuses configSchema passed as an instance option, by name", () => {
    const flow = defineFlow({ kind: "instance-schema", actions: {} });

    expect(() => flow({ configSchema: seatConfig } as never)).toThrow(
      /Flow "instance-schema" instance options set "configSchema", which is not an instance option/
    );
  });

  /**
   * Closing undeclared keys needs a real `ZodObject`, so anything that is not
   * one is refused where it is declared — and the message says which shapes
   * are accepted, so an author is not left guessing.
   */
  it("refuses a configSchema that is not a plain object schema", () => {
    expect(() =>
      defineFlow({
        kind: "refined-schema",
        configSchema: z.object({ a: z.number(), b: z.number() }).refine((v) => v.a < v.b),
        actions: {}
      })
    ).toThrow(/Flow "refined-schema" declares a configSchema that is not an object schema/);

    expect(() =>
      defineFlow({
        kind: "union-schema",
        configSchema: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        actions: {}
      })
    ).toThrow(/not an object schema/);
  });
});

/**
 * Each promise this feature makes, and the path where it would not hold.
 * Grouped deliberately: these are one class of defect — a guarantee stated in
 * the docs or the types with a door left open behind it — not five unrelated
 * bugs.
 */
describe("flow config bag — the promises, and their second paths", () => {
  /**
   * "The type you infer is the value you get."
   *
   * A block-side `.default()` type-checks `ctx.flow.config.x` as `string`,
   * parses clean, and its OUTPUT is discarded — the bag a block actually reads
   * is the flow's, so the block would read `undefined` through a type that
   * says `string`. A type lie is the worst failure available here: invisible
   * until the value is used, and then wrong somewhere else entirely.
   *
   * Preserving the block's output instead is not an option: the bag is ONE
   * frozen object every block reads, so one block's default would appear to
   * every other block as a setting the definition never declared — which
   * decision 2 forbids outright.
   */
  it("refuses a block requirement whose schema would change the bag", () => {
    const contributes = handler({
      name: "contributes-a-default",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: z.object({ model: z.string().default("fallback") }),
      execute: async () => ({})
    });

    const flow = defineFlow({
      kind: "block-default",
      cardinality: "collection",
      configSchema: z.object({ region: z.string() }),
      actions: { work: { block: contributes } }
    });

    expect(() => flow({ id: "bd-1", config: { region: "eu" } } as never)).toThrow(
      /block "contributes-a-default" declares a flowConfigSchema that would change the bag.*"model"/s
    );
  });

  /** A requirement that only READS the bag is untouched by that rule. */
  it("accepts a block requirement that reads without contributing", () => {
    const reads = handler({
      name: "reads-only",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: z.object({ model: z.string() }),
      execute: async () => ({})
    });

    const flow = defineFlow({
      kind: "block-reads",
      cardinality: "collection",
      configSchema: z.object({ model: z.string(), region: z.string().default("eu") }),
      actions: { work: { block: reads } }
    });

    // The FLOW's default still applies — that is the definition declaring it.
    expect(flow({ id: "br-1", config: { model: "opus" } } as never).config).toEqual({
      model: "opus",
      region: "eu"
    });
  });

  /**
   * "The bag is closed, so a typo fails loudly."
   *
   * `.strict()` does NOT clear a `catchall`, so `z.object({...}).catchall(...)`
   * passes the object check and then accepts and KEEPS every undeclared key —
   * the exact silent-default failure closing the schema exists to prevent.
   */
  it("refuses a configSchema with a catchall, which strict mode cannot close", () => {
    expect(() =>
      defineFlow({
        kind: "catchall-flow",
        configSchema: z.object({ model: z.string() }).catchall(z.string()),
        actions: {}
      })
    ).toThrow(/Flow "catchall-flow" declares a configSchema with a catchall/);
  });

  /**
   * "A block's declared requirement is always checked."
   *
   * The definition-time walk takes a generator's STATIC `tools` array. A
   * function-valued slot resolves per call, so a tool it returns is invisible
   * to that walk — the same fail-quiet door the sequencer builder had, reached
   * a different way. It is checkable at the moment the tool becomes known,
   * which is still before the block runs.
   */
  it("checks a tool the generator resolves dynamically, at resolution time", async () => {
    const needsIndex = handler({
      name: "dynamic-lookup",
      description: "look something up",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ hit: z.string() }),
      flowConfigSchema: z.object({ index: z.string() }),
      execute: async () => ({ hit: "x" })
    });

    const agent = generator({
      name: "dynamic-agent",
      inputSchema: z.object({}),
      model: "m",
      prompt: "go",
      outputSchema: z.object({ ok: z.boolean() }),
      // Resolved per call, so `defineFlow`'s walk cannot see it.
      tools: () => [needsIndex],
      itemVisibility: { client: true, history: true }
    });

    const flow = defineFlow({
      kind: "dynamic-tools",
      cardinality: "collection",
      configSchema: z.object({ index: z.string().optional() }),
      actions: { ask: { block: agent } }
    });
    // The mint cannot refuse — the tool is not in the walk — so the copy exists.
    const instance = flow({ id: "dyn-1", config: {} } as never);

    const ctx = createMockContext({
      flow: instance as unknown as { config: Readonly<Record<string, unknown>> },
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { ok: true } };
        }
      }) as never
    });

    await expect(runForTest(agent, {}, ctx)).rejects.toThrow(
      /block "dynamic-lookup" cannot read/
    );
  });

  /** And it runs when the bag does satisfy the dynamically-resolved tool. */
  it("runs a dynamically resolved tool whose requirement the bag satisfies", async () => {
    const needsIndex = handler({
      name: "dynamic-ok",
      description: "look something up",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ hit: z.string() }),
      flowConfigSchema: z.object({ index: z.string() }),
      execute: async () => ({ hit: "x" })
    });

    const agent = generator({
      name: "dynamic-agent-ok",
      inputSchema: z.object({}),
      model: "m",
      prompt: "go",
      outputSchema: z.object({ ok: z.boolean() }),
      tools: () => [needsIndex],
      itemVisibility: { client: true, history: true }
    });

    const flow = defineFlow({
      kind: "dynamic-tools-ok",
      cardinality: "collection",
      configSchema: z.object({ index: z.string().optional() }),
      actions: { ask: { block: agent } }
    });
    const instance = flow({ id: "dyn-2", config: { index: "main" } } as never);

    const ctx = createMockContext({
      flow: instance as unknown as { config: Readonly<Record<string, unknown>> },
      resolveModel: () => ({
        modelId: "m",
        async generate() {
          return { structuredOutput: { ok: true } };
        }
      }) as never
    });

    await expect(runForTest(agent, {}, ctx)).resolves.toEqual({ ok: true });
  });
});

describe("flow config bag — what a block's declaration is worth", () => {
  /**
   * Behaviour 12. The build-time half of the check, and the only half that IS
   * a build-time answer: the flow declares no schema at all, so nothing could
   * ever satisfy the block.
   */
  it("refuses at definition time when a reachable block requires config and the flow declares none", () => {
    const engineerBlock = handler({
      name: "engineer-work",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: seatConfig,
      execute: async () => ({})
    });

    expect(() =>
      defineFlow({ kind: "reviewer", actions: { review: { block: engineerBlock } } })
    ).toThrow(
      /Flow "reviewer" reaches block "engineer-work", which requires flow config, but the flow declares no configSchema/
    );
  });

  /**
   * Behaviour 13. The mint-time half — AND the fact that `defineFlow` did not
   * throw for that same pair.
   *
   * This is decision 6's stated limit, asserted rather than argued: the check
   * is a parse of the real bag, so it is exact, but it happens per COPY and
   * not per definition. A flow merely LOOSER than a block needs is refused at
   * the mint of each copy that omits the field, not where the two were
   * written. A test that only checked the refusal would let someone later
   * "fix" this into a build-time check nobody costed.
   */
  it("refuses a looser flow at the mint, and NOT where the flow was defined", () => {
    const needsModel = handler({
      name: "needs-model",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: z.object({ model: z.string() }),
      execute: async () => ({})
    });

    // The flow marks `model` optional; the block requires it. These two can
    // never fit for a copy that omits it — and that is NOT reported here.
    let loose!: ReturnType<typeof defineFlow>;
    expect(() => {
      loose = defineFlow({
        kind: "loose-flow",
        cardinality: "collection",
        configSchema: z.object({ model: z.string().optional() }),
        actions: { work: { block: needsModel } }
      });
    }).not.toThrow();

    // It is reported at the mint of every copy that omits the field…
    expect(() => loose({ id: "seat-a", config: {} } as never)).toThrow(
      /Flow "loose-flow" instance "seat-a" has a config bag that block "needs-model" cannot read/
    );

    // …and copies that supply it run. Every instance that CAN run has been
    // fully checked; you just learn one step later, and per seat.
    expect(loose({ id: "seat-b", config: { model: "opus" } } as never).config).toEqual({
      model: "opus"
    });
  });

  /**
   * Behaviour 14, first half. The block names no flow, so the same block drops
   * into any flow whose `configSchema` satisfies it — checked independently at
   * each, reading each flow's own values.
   */
  it("checks one declaring block against each flow that installs it", () => {
    const readModel = handler({
      name: "read-model",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: z.object({ model: z.string() }),
      execute: async () => ({})
    });

    const east = defineFlow({
      kind: "east",
      configSchema: z.object({ model: z.string(), region: z.string() }),
      actions: { work: { block: readModel } }
    })({ id: "east", config: { model: "opus", region: "eu" } } as never);

    const west = defineFlow({
      kind: "west",
      configSchema: z.object({ model: z.string(), retries: z.number().default(1) }),
      actions: { work: { block: readModel } }
    })({ id: "west", config: { model: "gpt-5.4" } } as never);

    expect(east.config).toEqual({ model: "opus", region: "eu" });
    expect(west.config).toEqual({ model: "gpt-5.4", retries: 1 });
  });

  /**
   * Behaviour 14, second half — the case that fails if collection is taken off
   * the action roots instead of the block walk. A tool block has no action
   * root of its own, so a root-based collection would skip it silently.
   */
  it("collects a declaring block reachable only through a generator's static tools", () => {
    const lookup = handler({
      name: "lookup-tool",
      description: "look something up",
      inputSchema: z.object({ q: z.string() }),
      outputSchema: z.object({ hit: z.string() }),
      flowConfigSchema: z.object({ index: z.string() }),
      execute: async () => ({ hit: "x" })
    });

    const agent = generator({
      name: "agent",
      inputSchema: z.object({}),
      model: "openai/gpt-5.4-mini",
      prompt: () => "go",
      tools: [lookup],
      itemVisibility: { client: true, history: true }
    });

    // Reached only as a tool, and still refused where the flow declares nothing.
    expect(() =>
      defineFlow({ kind: "tool-edge-bare", actions: { ask: { block: agent } } })
    ).toThrow(/reaches block "lookup-tool", which requires flow config/);

    // And still checked at the mint when the flow's bag cannot satisfy it.
    const withSchema = defineFlow({
      kind: "tool-edge",
      cardinality: "collection",
      configSchema: z.object({ index: z.string().optional() }),
      actions: { ask: { block: agent } }
    });
    expect(() => withSchema({ id: "ask-1", config: {} } as never)).toThrow(
      /instance "ask-1" has a config bag that block "lookup-tool" cannot read/
    );
  });

  /**
   * All four kinds, one behaviour. The slot lives on `BlockConfig`, which every
   * kind extends, but each builder hands its own config to `buildBlock` — so
   * "the type compiles" and "the declaration is enforced" are different claims,
   * and only the second one matters.
   *
   * A sequencer is the kind this catches: it rebuilds its config from an
   * explicit field list rather than spreading, so a new slot is dropped at
   * runtime while the generic still type-checks. That is a silent no-op on a
   * declaration the author believes is load-bearing — exactly the fail-quiet
   * class this whole design exists to remove — so it is asserted per kind
   * rather than assumed from the shared type.
   */
  describe.each([
    ["handler", () => needsModelHandler("kind-handler")],
    ["generator", () => needsModelGenerator("kind-generator")],
    ["router", () => needsModelRouter("kind-router")],
    ["sequencer", () => needsModelSequencer("kind-sequencer")]
  ])("a %s's flowConfigSchema is enforced, not just typed", (kind, build) => {
    it("refuses at definition time when the flow declares no configSchema", () => {
      expect(() =>
        defineFlow({ kind: `bare-${kind}`, actions: { work: { block: build() } } })
      ).toThrow(
        new RegExp(`reaches block "kind-${kind}", which requires flow config, but the flow declares no configSchema`)
      );
    });

    it("refuses at the mint when the bag cannot satisfy it", () => {
      const flow = defineFlow({
        kind: `loose-${kind}`,
        cardinality: "collection",
        configSchema: z.object({ model: z.string().optional() }),
        actions: { work: { block: build() } }
      });

      expect(() => flow({ id: `${kind}-1`, config: {} } as never)).toThrow(
        new RegExp(`instance "${kind}-1" has a config bag that block "kind-${kind}" cannot read`)
      );
      // And the copy that supplies it mints, so the check is a refusal and not
      // a blanket rejection of the kind.
      expect(flow({ id: `${kind}-2`, config: { model: "opus" } } as never).config).toEqual({
        model: "opus"
      });
    });

    it("carries the declaration onto the built block", () => {
      const built = build() as unknown as { config: { flowConfigSchema?: unknown } };
      expect(built.config.flowConfigSchema).toBe(needsModel);
    });
  });

  /**
   * Two blocks wanting incompatible things is not reconciled — the collected
   * requirements are a list, not a merge, so whichever the bag fails refuses
   * by name and no silent last-writer-wins can happen.
   */
  it("refuses by name when two blocks declare contradictory requirements", () => {
    const wantsString = handler({
      name: "wants-string",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: z.object({ model: z.string() }),
      execute: async () => ({})
    });
    const wantsNumber = handler({
      name: "wants-number",
      inputSchema: z.object({}),
      outputSchema: z.object({}),
      flowConfigSchema: z.object({ model: z.number() }),
      execute: async () => ({})
    });

    const flow = defineFlow({
      kind: "contradictory",
      cardinality: "collection",
      configSchema: z.object({ model: z.string() }),
      actions: { a: { block: wantsString }, b: { block: wantsNumber } }
    });

    expect(() => flow({ id: "c-1", config: { model: "opus" } } as never)).toThrow(
      /block "wants-number" cannot read/
    );
  });

  /** One shared schema across several blocks is one collected entry. */
  it("dedupes collected requirements by schema reference", () => {
    const shared = z.object({ model: z.string() });
    const make = (name: string) =>
      handler({
        name,
        inputSchema: z.object({}),
        outputSchema: z.object({}),
        flowConfigSchema: shared,
        execute: async () => ({})
      });

    const flow = defineFlow({
      kind: "deduped",
      configSchema: shared,
      actions: { a: { block: make("a") }, b: { block: make("b") }, c: { block: make("c") } }
    });

    // Observed through the work it avoids, not through an internal field: the
    // shared schema is parsed against the bag ONCE per mint, not once per
    // declaring block. WHICH of the three names it is the walk's order and is
    // not a contract; that it is one and not three is.
    const parse = vi.spyOn(shared, "safeParse");
    flow({ config: { model: "opus" } } as never);
    expect(parse).toHaveBeenCalledTimes(1);
    parse.mockRestore();
  });
});
