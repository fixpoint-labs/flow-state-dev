/**
 * Compile-time assertions for the `ctx` an evaluator's `questions` and
 * `state` callbacks receive: the block's declarations (session state schema,
 * resources, targets, flow config, `uses`) type it the same way they type a
 * handler's `execute`. Without that, a supported declaration such as
 * `sessionStateSchema` leaves `ctx.session.state.tenant` untyped and a typo
 * compiles.
 */
import { z } from "zod";
import type { EvaluationModel } from "@flow-state-dev/core";
import { choice, defineCapability, defineResource, evaluator, handler } from "@flow-state-dev/core";

declare const model: EvaluationModel;

const notes = defineResource({ scope: "session", stateSchema: z.object({ count: z.number() }) });
const greeter = defineCapability({
  name: "greeter",
  fns: () => ({ greet: (who: string) => `hi ${who}` }),
});

// Reference: what a handler's ctx sees for the same declarations.
handler({
  name: "reference",
  inputSchema: z.string(),
  outputSchema: z.string(),
  sessionStateSchema: z.object({ tenant: z.string() }),
  execute: (_input, ctx) => ctx.session.state.tenant,
});

evaluator({
  name: "typed-ctx",
  model,
  inputSchema: z.object({ message: z.string() }),
  sessionStateSchema: z.object({ tenant: z.string() }),
  resources: { notes },
  targetStateSchemas: { board: z.object({ lane: z.string() }) },
  flowConfigSchema: z.object({ region: z.string() }),
  uses: [greeter],
  questions: (input, ctx) => {
    const message: string = input.message;
    const tenant: string = ctx.session.state.tenant;
    const count: number = ctx.resources.notes.state.count;
    const lane: string | undefined = ctx.targets.board?.state.lane;
    const region: string = ctx.flow.config.region;
    const greeting: string = ctx.cap.greeter.greet(tenant);
    void message;
    void count;
    void lane;
    void region;
    void greeting;
    // @ts-expect-error "tenant" is a string in sessionStateSchema, not a number
    const wrongTenant: number = ctx.session.state.tenant;
    void wrongTenant;
    // @ts-expect-error "region" is a string, not a number
    const wrongRegion: number = ctx.flow.config.region;
    void wrongRegion;
    return { team: choice("Which team?", { billing: null, technical: null }) };
  },
  state: (input, ctx) => {
    const tenant: string = ctx.session.state.tenant;
    const greeting: string = ctx.cap.greeter.greet(tenant);
    // @ts-expect-error the capability's greet takes a string
    ctx.cap.greeter.greet(42);
    return `${greeting}: ${input.message}`;
  },
});
