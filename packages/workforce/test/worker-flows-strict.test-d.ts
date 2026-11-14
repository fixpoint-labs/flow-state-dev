/**
 * Compile-time check that the documented way to register a worker flow of your
 * own typechecks in an app on `strict: true`: a `defineFlow(...)` value built
 * on the installation the workforce kit hands its builder, taking a
 * coordinator's routed tasks on `work`, in the kit's `workerFlows` slot.
 *
 * The repo's own configs leave `strictFunctionTypes` off, so this file is also
 * compiled by `tsconfig.test-d-strict.json`, which turns `strict` on and reads
 * the packages the way an app does, through their built declarations. Under it
 * a flow's call signature is checked contravariantly, which once refused a
 * worker flow (TS2322). The flows below follow the docs' "Making your own flow
 * a delegate", whose door answers with the worker's own instructions through
 * `workerConfigOf`.
 */
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import { createFlowState } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  defineCoordinatorFlow,
  workerConfigOf,
  workerConfigSchema,
  workerFlow,
  workerTaskEntry,
  type WorkerFlowEntry,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { workforce } from "@flow-state-dev/workforce/kit";

const inputSchema = z.object({ message: z.string() });
const door = handler({ name: "door", inputSchema, outputSchema: z.string(), execute: (input) => input.message });

/** A worker flow of the app's own, built on the installation its workers run with. */
function researchFlow(installation: WorkerInstallation) {
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
    history: true,
    prompt: (_input, ctx) => {
      const { instructions } = workerConfigOf(ctx);
      return typeof instructions === "string" ? instructions : "You answer research questions in two or three sentences.";
    },
    user: (input) => input.message,
  });
  return defineFlow({
    kind: "research",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    request: { onStarted: loadWorker },
    actions: { respond: { inputSchema, block: researchAnswer, userMessage: (input) => input.message } },
    task: { actions: { work: workerTaskEntry({ name: "research", turn: researchAnswer }) } },
  });
}

/** A worker flow that declares no settings of its own. */
function plainFlow(installation: WorkerInstallation) {
  return defineFlow({
    kind: "plain",
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { respond: { inputSchema, block: door, userMessage: (input) => input.message } },
  });
}

const workerFlows: Record<string, WorkerFlowEntry> = {
  research: workerFlow(researchFlow, { roles: ["contributor"] }),
  plain: workerFlow(plainFlow, { standardOnly: true }),
  coordinator: workerFlow((installation) => defineCoordinatorFlow({ installation, routeModel: "typesafe-ai/jev" })),
};

createFlowState({ kits: [workforce()], fill: { [workforce.slots.workerFlows]: workerFlows } });
