/**
 * Type-level tests for the instance config bag (FIX-1331). Both ends are
 * typed, from two different declarations:
 *
 * - **Minting** is typed from the FLOW's `configSchema`. This is where a roster
 *   typo happens, so `engineer({ id, config })` has to fail at the line that
 *   writes the bag, not three steps into the first run.
 * - **Reading** is typed from the BLOCK's own `flowConfigSchema`, with no
 *   annotation and no flow named — so the block stays portable and its type
 *   has an actual check behind it.
 *
 * These live under `src/` for the same reason the boundary tripwire does: this
 * package's `typecheck` runs `tsc -p tsconfig.json`, whose `include` is
 * `src/**` only, and vitest transpiles test files without checking types. A
 * `@ts-expect-error` under `test/` would be inert.
 */
import { z } from "zod";
import { defineFlow } from "../../flow/defineFlow";
import { handler } from "../../blocks/handler";
import { sequencer } from "../../blocks/sequencer";

const seatConfig = z.object({
  harness: z.enum(["claude-code", "codex", "cursor"]),
  model: z.string(),
  personaPath: z.string().optional()
});

// ── Reading: typed from the block's own declaration ───────────────────────

const engineerBlock = handler({
  name: "engineer-work",
  inputSchema: z.object({}),
  outputSchema: z.object({ used: z.string() }),
  flowConfigSchema: seatConfig,
  execute: async (_input, ctx) => {
    // Typed, with no annotation and no flow named anywhere in this block.
    const harness: "claude-code" | "codex" | "cursor" = ctx.flow.config.harness;
    const persona: string | undefined = ctx.flow.config.personaPath;
    void harness;
    void persona;

    // @ts-expect-error a knob this block did not declare is not on its view.
    void ctx.flow.config.temperature;

    return { used: ctx.flow.config.model };
  }
});

// A block that declares nothing reads the open read-only record — the honest
// type for a block that never said what it wanted.
const undeclaredBlock = handler({
  name: "undeclared",
  inputSchema: z.object({}),
  outputSchema: z.object({}),
  execute: async (_input, ctx) => {
    const raw: unknown = ctx.flow.config.model;
    void raw;

    // @ts-expect-error `unknown` has to be parsed before it can be used.
    void ctx.flow.config.model.length;

    return {};
  }
});
void undeclaredBlock;

// The fourth kind is covered too: a sequencer's own DSL callbacks read the bag
// like anything else, so leaving it out would be a hole an author finds by
// hitting it.
const seatChain = sequencer({
  name: "seat-chain",
  inputSchema: z.object({}),
  flowConfigSchema: seatConfig
}).tap(
  handler({
    name: "note-harness",
    inputSchema: z.object({}),
    outputSchema: z.void(),
    execute: async () => undefined
  })
);
void seatChain;

// ── Minting: typed from the flow's schema ─────────────────────────────────

const engineer = defineFlow({
  kind: "engineer",
  cardinality: "collection",
  configSchema: seatConfig,
  actions: { work: { block: engineerBlock } }
});

const alice = engineer({ id: "eng-alice", config: { harness: "claude-code", model: "opus" } });
const knownModel: string = alice.config.model;
void knownModel;

// @ts-expect-error a wrong-typed knob fails at the line that writes it.
engineer({ id: "eng-bob", config: { harness: "claude-code", model: 42 } });

// @ts-expect-error and so does a value outside the declared enum.
engineer({ id: "eng-bob", config: { harness: "aider", model: "opus" } });

// @ts-expect-error a key nobody declared fails on a fresh object literal.
engineer({ id: "eng-carol", config: { harness: "codex", model: "opus", temperature: 0.2 } });

// The runtime half of that last one — a bag built elsewhere, which TypeScript's
// excess-property check never sees — is `flow-config.test.ts` behaviour 3.

// ── A flow that declares no schema takes no bag at all ────────────────────

const plain = defineFlow({ kind: "plain", actions: {} });

// @ts-expect-error a copy may only carry settings the definition declared.
plain({ config: { model: "opus" } });

// @ts-expect-error and `configSchema` is the definition's, not an instance option.
plain({ configSchema: seatConfig });

// It still reads a bag — the open record, which is `{}` at run time.
const plainConfig: Readonly<Record<string, unknown>> = plain().config;
void plainConfig;
