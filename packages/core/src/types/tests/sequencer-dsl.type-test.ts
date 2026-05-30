import { z } from "zod";
import { handler, sequencer } from "../../blocks";
import type { SequencerDefinition } from "../../blocks";

const parseNumber = handler({
  name: "parse-number",
  inputSchema: z.string(),
  outputSchema: z.number(),
  execute: (value) => Number(value)
});

const toLabel = handler({
  name: "to-label",
  inputSchema: z.number(),
  outputSchema: z.object({ label: z.string(), value: z.number() }),
  execute: (value) => ({
    label: `v:${value}`,
    value
  })
});

const addOne = handler({
  name: "add-one",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (value) => value + 1
});

const square = handler({
  name: "square",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (value) => value * value
});

const toStringBlock = handler({
  name: "to-string",
  inputSchema: z.number(),
  outputSchema: z.string(),
  execute: (value) => value.toString()
});

const thenAndTap = sequencer({ name: "then-and-tap", inputSchema: z.string() })
  .step(parseNumber)
  .step(toLabel)
  .step((value) => value.value, addOne)
  .tap((value) => {
    void value;
  })
  .tap((value) => value, addOne)
  .stepIf((value) => value > 0, square)
  .stepIf((value) => value > 0, (value) => value, square);

const looping = sequencer({ name: "looping", inputSchema: z.number() })
  .doWhile((value) => value < 10, addOne)
  .doUntil((value) => value > 12, addOne);

const collections = sequencer({ name: "collections", inputSchema: z.number() })
  .map((value) => [value, value + 1])
  .forEach(addOne)
  .parallel({
    raw: {
      connector: (value) => value[0],
      block: addOne
    },
    mapped: {
      connector: (value) => value[0],
      block: toStringBlock
    }
  })
  .branch({
    small: [(value) => value.raw, (value) => value < 100, addOne],
    large: [(value) => value.raw, (value) => value >= 100, square]
  });

/**
 * Inline block definitions — factory + config pattern.
 * The sequencer auto-injects inputSchema from the previous step's outputSchema.
 */

// then(handler, { outputSchema, execute }) — inline handler after a block
const inlineThen = sequencer({ name: "inline-then", inputSchema: z.string() })
  .step(parseNumber)
  .step(handler, {
    outputSchema: z.string(),
    execute: (input) => `#${input}`
  });

// Chained inline blocks — output from first inline flows into second
const inlineChain = sequencer({ name: "inline-chain", inputSchema: z.string() })
  .step(parseNumber)
  .step(handler, {
    outputSchema: z.object({ doubled: z.number() }),
    execute: (input) => ({ doubled: input * 2 })
  })
  .step(handler, {
    outputSchema: z.string(),
    execute: (input) => `doubled: ${input.doubled}`
  });

// tap(handler, { execute }) — no outputSchema required, chain type unchanged
const inlineTap = sequencer({ name: "inline-tap", inputSchema: z.number() })
  .step(addOne)
  .tap(handler, {
    execute: (input) => {
      void input;
    }
  });

// stepIf(condition, handler, { outputSchema, execute }) — conditional inline, union output
const inlineThenIf = sequencer({ name: "inline-then-if", inputSchema: z.string() })
  .step(parseNumber)
  .stepIf(
    (input) => input > 0,
    handler,
    {
      outputSchema: z.string(),
      execute: (input) => `positive: ${input}`
    }
  );

// Mixed inline + pre-defined blocks in same chain
const mixedChain = sequencer({ name: "mixed", inputSchema: z.string() })
  .step(parseNumber)
  .step(handler, {
    outputSchema: z.number(),
    execute: (input) => input * 2
  })
  .step(toLabel)
  .step(handler, {
    outputSchema: z.string(),
    execute: (input) => input.label
  });

void thenAndTap;
void looping;
void collections;
void inlineThen;
void inlineChain;
void inlineTap;
void inlineThenIf;
void mixedChain;
export const sequencerDslTypeSmoke = true;
