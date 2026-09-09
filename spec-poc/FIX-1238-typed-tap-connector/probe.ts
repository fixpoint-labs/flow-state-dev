import { sequencer, handler, type SequencerDefinition } from "@flow-state-dev/core";
import { z } from "zod";

const checkBoardOutputSchema = z.object({
  shouldContinue: z.boolean(),
  reason: z.enum(["drained", "exit", "claimed", "idle", "blocked"]),
  excusedParked: z.boolean().optional(),
});
type CheckBoardOutput = z.infer<typeof checkBoardOutputSchema>;

const checkBoard = handler({
  name: "cb",
  inputSchema: z.unknown(),
  outputSchema: checkBoardOutputSchema,
  execute: async () => ({ shouldContinue: false, reason: "drained" as const }),
});

const meta = handler({ name: "m", inputSchema: z.unknown(), execute: async () => undefined });

const unrelated = handler({
  name: "u",
  inputSchema: z.unknown(),
  outputSchema: z.object({ totallyDifferent: z.string() }),
  execute: async () => ({ totallyDifferent: "x" }),
});

const unknownOut = handler({ name: "uk", inputSchema: z.unknown(), execute: async () => undefined });

function makeWorker(id: number) {
  return sequencer({ name: `w-${id}` }).step(checkBoard);
}

declare function reveal<T>(d: SequencerDefinition<any, T, any, any>): T;

// PROBE A: what is TOutput after a forEach over a SEQUENCER factory?
const afterForEachSeq = sequencer({ name: "d1" }).forEach(
  () => [0, 1],
  (workerId: number) => makeWorker(workerId),
  { maxConcurrency: 2 }
);
const probeA: string = reveal(afterForEachSeq); // deliberate error: prints the real type

// PROBE B: what is TOutput after a forEach over a plain HANDLER?
const afterForEachHandler = sequencer({ name: "d2" }).forEach(() => [0, 1], checkBoard);
const probeB: string = reveal(afterForEachHandler); // deliberate error: prints the real type

// PROBE C: typed connector on the tap, correct adjacency (should be fine)
const okAdjacent = afterForEachSeq.tap((exits: readonly CheckBoardOutput[]) => exits, meta);

// PROBE D: a step INSERTED between forEach and the typed tap, unrelated output.
const brokenAdjacency = afterForEachSeq
  .step(unrelated)
  .tap((exits: readonly CheckBoardOutput[]) => exits, meta);

// PROBE E: inserted step whose output schema is undeclared (the common case here)
const brokenAdjacencyUnknown = afterForEachSeq
  .step(unknownOut)
  .tap((exits: readonly CheckBoardOutput[]) => exits, meta);

// PROBE F: same as D but on a forEach over a handler (element type known)
const brokenTyped = afterForEachHandler
  .step(unrelated)
  .tap((exits: readonly CheckBoardOutput[]) => exits, meta);

export { probeA, probeB, okAdjacent, brokenAdjacency, brokenAdjacencyUnknown, brokenTyped };

// PROBE G: a `.tap` inserted between forEach and the typed tap.
// tap preserves TOutput at type level AND returns `{ value }` at runtime,
// so this is a false-positive check: it must NOT error.
const tapInserted = afterForEachSeq
  .tap(unknownOut)
  .tap((exits: readonly CheckBoardOutput[]) => exits, meta);

// PROBE H: a `.stepIf` inserted — the conditional-path case the drain tests
// might not exercise.
const stepIfInserted = afterForEachSeq
  .stepIf(() => true, unrelated)
  .tap((exits: readonly CheckBoardOutput[]) => exits, meta);

export { tapInserted, stepIfInserted };
