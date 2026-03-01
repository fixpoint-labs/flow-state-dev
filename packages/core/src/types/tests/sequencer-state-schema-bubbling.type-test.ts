import { z } from "zod";
import { generator } from "../../blocks/generator";
import { handler } from "../../blocks/handler";
import { router } from "../../blocks/router";
import { sequencer } from "../../blocks/sequencer";

const routeA = handler({
  name: "route-a",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input) => input
});

const routeB = handler({
  name: "route-b",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input) => input
});

const handlerWithSequencerState = handler({
  name: "handler-with-sequencer-state",
  inputSchema: z.object({ count: z.number() }),
  outputSchema: z.number(),
  sequencerStateSchema: z.object({ progress: z.number(), step: z.string().optional() }),
  execute: (input, ctx) => {
    const progress: number = ctx.sequencer!.state.progress;
    const maybeStep: string | undefined = ctx.sequencer!.state.step;
    void maybeStep;
    return input.count + progress;
  }
});

const generatorWithSequencerState = generator({
  name: "generator-with-sequencer-state",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  sequencerStateSchema: z.object({ progress: z.number() }),
  model: "demo-model",
  prompt: (_input, ctx) => `progress:${ctx.sequencer!.state.progress}`,
  user: (input) => input.message
});

const routerWithSequencerState = router({
  name: "router-with-sequencer-state",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sequencerStateSchema: z.object({ progress: z.number() }),
  routes: [routeA, routeB],
  execute: (_input, ctx) => (ctx.sequencer!.state.progress > 0 ? routeA : routeB)
});

const handlerWithoutSequencerState = handler({
  name: "handler-without-sequencer-state",
  inputSchema: z.string(),
  outputSchema: z.string(),
  execute: (input, ctx) => {
    const maybeSequencer = ctx.sequencer;
    void maybeSequencer;
    return input;
  }
});

const sequencerWithStateSchema = sequencer({
  name: "typed-sequencer",
  inputSchema: z.string(),
  stateSchema: z.object({ progress: z.number() })
});

void handlerWithSequencerState;
void generatorWithSequencerState;
void routerWithSequencerState;
void handlerWithoutSequencerState;
void sequencerWithStateSchema;
export const sequencerStateSchemaBubblingTypeSmoke = true;
