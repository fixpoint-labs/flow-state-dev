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

const thenAndTap = sequencer<string>({ name: "then-and-tap" })
  .then(parseNumber)
  .then(toLabel)
  .then((value) => value.value, addOne)
  .tap((value) => {
    void value;
  })
  .tap((value) => value, addOne)
  .thenIf((value) => value > 0, square)
  .thenIf((value) => value > 0, (value) => value, square);

const looping = sequencer<number>({ name: "looping" })
  .doWhile((value) => value < 10, addOne)
  .doUntil((value) => value > 12, addOne);

const collections = sequencer<number>({ name: "collections" })
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

const typedThenAndTap: SequencerDefinition<string, number> = thenAndTap;
const typedLooping: SequencerDefinition<number, number> = looping;
const typedCollections: SequencerDefinition<number, number> = collections;

void typedThenAndTap;
void typedLooping;
void typedCollections;
export const sequencerDslTypeSmoke = true;
