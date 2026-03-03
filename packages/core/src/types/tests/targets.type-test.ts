import { z } from "zod";
import { generator, handler, router } from "../../blocks";
import type { StateHandle } from "../block";

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

const typedHandler = handler({
  name: "typed-handler-targets",
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.number(),
  targetStateSchemas: {
    research: z.object({ progress: z.number() }),
    review: z.object({ status: z.enum(["pending", "done"]) })
  },
  execute: async (input, ctx) => {
    await ctx.targets.research?.patchState({ progress: input.value });
    const reviewStatus = ctx.targets.review?.state.status;
    return reviewStatus === "done" ? input.value : input.value + 1;
  }
});

const typedGenerator = generator({
  name: "typed-generator-targets",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.string(),
  targetStateSchemas: {
    research: z.object({ progress: z.number() })
  },
  model: "mock",
  prompt: "prompt",
  user: (input, ctx) => {
    const progress = ctx.targets.research?.state.progress ?? 0;
    return `progress:${progress}:${input.message}`;
  }
});

const typedRouter = router({
  name: "typed-router-targets",
  inputSchema: z.string(),
  outputSchema: z.string(),
  targetStateSchemas: {
    coordinator: z.object({ step: z.number() })
  },
  routes: [routeA, routeB],
  execute: (_input, ctx) => {
    const step = ctx.targets.coordinator?.state.step ?? 0;
    return step > 0 ? routeA : routeB;
  }
});

type HandlerCtx = Parameters<NonNullable<(typeof typedHandler.config)["execute"]>>[1];
type RouterCtx = Parameters<NonNullable<(typeof typedRouter.config)["execute"]>>[1];

const handlerTargetCheck: StateHandle<{ progress: number }> | undefined =
  (null as unknown as HandlerCtx).targets.research;
const routerTargetCheck: StateHandle<{ step: number }> | undefined =
  (null as unknown as RouterCtx).targets.coordinator;

void handlerTargetCheck;
void routerTargetCheck;

export const targetsTypeSmoke = true;
