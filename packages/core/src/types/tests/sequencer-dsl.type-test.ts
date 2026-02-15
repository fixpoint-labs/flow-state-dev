import { handler, sequencer } from "../../blocks";
import type { SequencerDefinition } from "../../blocks";

const parseNumber = handler<string, number>({
  name: "parse-number",
  execute: (value) => Number(value)
});

const toLabel = handler<number, { label: string; value: number }>({
  name: "to-label",
  execute: (value) => ({
    label: `v:${value}`,
    value
  })
});

const addOne = handler<number, number>({
  name: "add-one",
  execute: (value) => value + 1
});

const square = handler<number, number>({
  name: "square",
  execute: (value) => value * value
});

const toStringBlock = handler<number, string>({
  name: "to-string",
  execute: (value) => value.toString()
});

const pipeline = sequencer<string>({
  name: "dsl-smoke"
})
  .then(parseNumber)
  .then(toLabel)
  .then((value) => value.value, addOne)
  .tap((value) => value)
  .tap((value) => value, addOne)
  .thenIf((value) => value > 0, square)
  .thenIf((value) => value > 0, (value) => value, square)
  .map((value) => [value, value + 1])
  .forEach(addOne)
  .doWhile((value) => value < 10, addOne)
  .doUntil((value) => value > 10, addOne)
  .parallel({
    raw: addOne,
    mapped: {
      connector: (value) => value.raw,
      block: toStringBlock
    }
  })
  .branch({
    small: [(value) => value.raw, (value) => value < 100, addOne],
    large: [(value) => value.raw, (value) => value >= 100, square]
  });

const typedPipeline: SequencerDefinition<string, number> = pipeline;

void typedPipeline;
export const sequencerDslTypeSmoke = true;
