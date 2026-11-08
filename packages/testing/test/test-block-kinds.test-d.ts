/**
 * Compile-time assertions for `testBlock`'s result by the block's kind: a
 * sequencer's result carries its step traces with no cast, and a block whose
 * static type is not a sequencer has none.
 *
 * If the kind conditional collapses (every result gains `steps`, or none
 * does), this file fails to compile.
 */
import { handler, sequencer } from "@flow-state-dev/core";
import type { BlockDefinition } from "@flow-state-dev/core/types";
import { z } from "zod";
import { testBlock } from "../src";

const double = handler({ name: "double", execute: (n: number) => n * 2 });
const pipeline = sequencer({ name: "pipeline", inputSchema: z.number() }).step(double);
declare const someBlock: BlockDefinition<any, any>;

export async function kinds(): Promise<void> {
  const seq = await testBlock(pipeline, { input: 1 });
  const steps: unknown[] = seq.steps;
  const sideChains: unknown[] = seq.sideChainResults;
  const loops: number = seq.loopIterations;

  const leaf = await testBlock(double, { input: 1 });
  // @ts-expect-error a handler's result has no steps
  void leaf.steps;

  const plain = await testBlock(someBlock, { input: 1 });
  // @ts-expect-error a block not typed as a sequencer has no steps
  void plain.steps;

  // Every kind may name a route; only a router's run sets it.
  const route: string | undefined = leaf.selectedRoute;
  void [steps, sideChains, loops, route];
}
