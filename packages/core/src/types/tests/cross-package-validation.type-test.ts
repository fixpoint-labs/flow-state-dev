import { z } from "zod";
import { handler, sequencer } from "../../blocks";
import { defineFlow } from "../../flow/defineFlow";
import type { SequencerDefinition } from "../../blocks";
import type { ZodTypeAny } from "zod";
import type {
  ActionConfig,
  BlockOutput,
  FlowActionInput,
  InferFlowBlockContext,
  InferFlowStateMap
} from "../index";

type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

const parse = handler({
  name: "parse",
  inputSchema: z.string(),
  outputSchema: z.object({ raw: z.number() }),
  execute: (input) => ({ raw: Number(input) })
});

const toNumber = handler({
  name: "to-number",
  inputSchema: z.object({ raw: z.number() }),
  outputSchema: z.number(),
  execute: (input) => input.raw
});

const toLabel = handler({
  name: "to-label",
  inputSchema: z.number(),
  outputSchema: z.string(),
  execute: (value) => `value:${value}`
});

const scale = handler({
  name: "scale",
  inputSchema: z.number(),
  outputSchema: z.number(),
  execute: (value) => value * 10
});

const stage = sequencer({ name: "cross-package-validation", inputSchema: z.string() })
  .step(parse)
  .step(toNumber)
  .stepIf((value) => value > 0, toLabel)
  .map((value) => [value])
  .forEach((entry) =>
    handler({
      name: "to-array-number",
      inputSchema: z.union([z.number(), z.string()]),
      outputSchema: z.number(),
      execute: (input) => (typeof input === "number" ? input : Number(input.replace("value:", "")))
    })
  )
  .parallel({
    numbers: handler({
      name: "collect-numbers",
      inputSchema: z.array(z.number()),
      outputSchema: z.array(z.number()),
      execute: (values) => values
    }),
    joined: {
      connector: (values: number[]) => values.join(","),
      block: handler({
        name: "join-values",
        inputSchema: z.string(),
        outputSchema: z.string(),
        execute: (input) => input
      })
    }
  })
  .work((value) => value.numbers[0] ?? 0, scale)
  .waitForWork({ failOnError: true })
  .rescue([
    {
      when: [Error],
      block: handler({
        name: "recover",
        inputSchema: z.any(),
        outputSchema: z.object({ numbers: z.array(z.number()), joined: z.string() }),
        execute: () => ({ numbers: [0], joined: "0" })
      })
    }
  ]);

type StageOutput = BlockOutput<typeof stage>;
const stageValue: StageOutput = { numbers: [1], joined: "1" };

const typedSequencer: SequencerDefinition<string, StageOutput> = stage;
void typedSequencer;
void stageValue;

const perform = handler({
  name: "perform",
  inputSchema: z.object({ prompt: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: (input) => ({ ok: input.prompt.length > 0 })
});

const flow = defineFlow({
  kind: "cross-package-validation",
  actions: {
    run: {
      inputSchema: z.object({ prompt: z.string() }),
      block: perform,
      userMessage: (input) => input.prompt
    }
  },
  request: {
    stateSchema: z.object({ attempt: z.number() })
  },
  session: {
    stateSchema: z.object({ mode: z.string() }),
    resources: {
      artifacts: {
        stateSchema: z.object({
          order: z.array(z.string())
        })
      }
    },
    clientData: {
      activeMode: (ctx) => ctx.state.mode
    }
  }
});

type RunAction = typeof flow.actions.run;
type RunActionInput = FlowActionInput<RunAction>;
type RunActionInputAssertion = Assert<Equals<RunActionInput, { prompt: string }>>;

type SchemaOf<T> = ZodTypeAny & { _output: T };

type DemoFlowDefinition = {
  request: { stateSchema: SchemaOf<{ attempt: number }> };
  session: { stateSchema: SchemaOf<{ mode: string }> };
  user: { stateSchema: SchemaOf<{ role: "admin" | "member" }> };
  org: { stateSchema: SchemaOf<{ orgId: string }> };
} & { actions: Record<string, ActionConfig>; kind: string };

type DemoStateMap = InferFlowStateMap<DemoFlowDefinition>;
type DemoCtx = InferFlowBlockContext<DemoFlowDefinition>;
const demoSessionState: DemoStateMap["session"] = { mode: "active" };

const flowCtxProof = {} as DemoCtx;
void flowCtxProof.session.state.mode;
void demoSessionState;
void (false as RunActionInputAssertion);
void flow;

export const crossPackageValidationTypeSmoke = true;
