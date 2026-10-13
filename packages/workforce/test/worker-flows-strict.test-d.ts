/**
 * Compile-time check that the documented way to register a worker flow of your
 * own typechecks in an app on `strict: true`: a `defineFlow(...)` value returned
 * from a `workerFlows` function, and the same flow named in `delegateFlows`.
 *
 * The repo's own configs leave `strictFunctionTypes` off, so this file is also
 * compiled by `tsconfig.test-d-strict.json`, which turns `strict` on and reads
 * the packages the way an app does, through their built declarations. Under it
 * a flow's call signature is checked contravariantly, and a worker flow (which
 * declares the installation's session) was refused by `workerFlows` (TS2322).
 * The flows below follow `packages/workforce/README.md` "Workers as data" and
 * the docs' "Making your own flow a delegate", whose door answers with the
 * worker's own instructions through `workerConfigOf`.
 */
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createWorkerInstallation,
  defineCoordinatorFlow,
  DELEGATED_POST_ENTRY,
  delegatedPostEntry,
  delegatedPostHistory,
  delegatedPostOnFinished,
  hireWorkforce,
  workerConfigOf,
  workerConfigSchema,
} from "@flow-state-dev/workforce";

const inputSchema = z.object({ message: z.string() });
const door = handler({ name: "door", inputSchema, outputSchema: z.string(), execute: (input) => input.message });

const installation = createWorkerInstallation({
  workerFlows: () => ({ research: researchFlow, coordinator: coordinatorFlow, plain: { flow: plainFlow, standardOnly: true } }),
});

const loadWorker = handler({
  name: "research-load-worker",
  inputSchema: z.unknown(),
  resources: { ...installation.resources },
  execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "research")).id }),
});

const researchAnswer = generator({
  name: "research-answer",
  inputSchema,
  model: "openai/gpt-5.4-mini",
  history: delegatedPostHistory,
  prompt: (_input, ctx) => {
    const { instructions } = workerConfigOf(ctx);
    return typeof instructions === "string" ? instructions : "You answer research questions in two or three sentences.";
  },
  user: (input) => input.message,
});

const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  request: { onStarted: loadWorker, onFinished: delegatedPostOnFinished },
  actions: { run: { inputSchema, block: researchAnswer, userMessage: (input) => input.message } },
  internal: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(researchAnswer) } },
});

/** A worker flow that declares no settings of its own. */
const plainFlow = defineFlow({
  kind: "plain",
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { run: { inputSchema, block: door, userMessage: (input) => input.message } },
});

const coordinatorFlow = defineCoordinatorFlow({
  installation,
  delegateFlows: [researchFlow],
  routeModel: "typesafe-ai/jev",
});

hireWorkforce(installation);
