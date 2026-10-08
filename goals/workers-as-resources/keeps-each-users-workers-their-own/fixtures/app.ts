/**
 * The app the goal runs: workers as data, on two worker flows.
 *
 * - `agent`, the built-in, registered once and bound to the installation;
 * - `research`, a worker flow the app writes, whose door answers with the
 *   worker the turn loaded and its instructions, and whose `reassign` action
 *   tries to move the session to another worker;
 * - the roster flow, with `hire`, `fork` and `fire`.
 *
 * A caller is the user and org two headers name: the stand-in for a host's
 * verified identity. `agent` answers from a scripted model that says which of
 * the run's markers its prompt held, so a turn shows what it was configured
 * with, never what a test wished it said.
 *
 * Two controls weaken one thing each, in the app's wiring only:
 * `org-scoped-workers` keeps the user's workers at org scope, and
 * `no-create-check` drops the worker flows' create check.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createMockModelResolver, type MockGeneratorInstance } from "@flow-state-dev/testing";
import {
  createWorkerHireBlocks,
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineWorkerCollection,
  defineWorkerRosterFlow,
  workerConfigSchema,
  WORKERS_RESOURCE,
  type WorkerInstallation,
  type WorkerManifest,
} from "@flow-state-dev/workforce";
import { z } from "zod";

export type Control = "org-scoped-workers" | "no-create-check" | undefined;

/** The flow kind of the app's own worker flow. */
export const RESEARCH = "research";

/** Trusts two headers as the verified principal. */
export const verified = {
  resolvePrincipal: (context: { request?: Request }) => {
    const userId = context.request?.headers.get("x-verified-user");
    const orgId = context.request?.headers.get("x-verified-org");
    return userId && orgId ? { userId, orgId } : null;
  },
};

/** A model that answers with every one of `markers` its prompt holds. */
export function markerEchoModel(markers: readonly string[]) {
  const echo = {
    name: "agent-answer",
    calls: [],
    reset: () => undefined,
    next: (input: unknown) => {
      const prompt = JSON.stringify(input);
      const seen = markers.filter((marker) => prompt.includes(marker));
      return { text: `seen: ${seen.length === 0 ? "none" : seen.join(" ")}` };
    },
  } as unknown as MockGeneratorInstance;
  return createMockModelResolver({ generators: { "agent-answer": echo }, policy: "allow" });
}

function researchFlow(installation: WorkerInstallation) {
  const door = z.object({ message: z.string() }).strict();
  return defineFlow({
    kind: RESEARCH,
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      run: {
        inputSchema: door,
        userMessage: (input: { message: string }) => input.message,
        block: handler({
          name: "research-run",
          inputSchema: door,
          resources: { ...installation.resources },
          execute: async (_input, ctx) => {
            const worker = await installation.resolveWorker(ctx, RESEARCH);
            return { answer: `${worker.id}: ${String(worker.config.instructions ?? "")}` };
          },
        }),
      },
      reassign: {
        inputSchema: z.object({ to: z.string() }).strict(),
        block: handler({
          name: "research-reassign",
          inputSchema: z.object({ to: z.string() }).strict(),
          execute: async (input, ctx) => {
            await (ctx.session as unknown as { patchState(p: object): Promise<void> }).patchState({ workerId: input.to });
            return { reassigned: input.to };
          },
        }),
      },
    },
  });
}

/** One host's flows: one copy each of `agent`, `research` and the roster flow. */
export function appFlows(workers: WorkerManifest[], control: Control): FlowInstance[] {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({ standardWorkers: workers, workerFlows: () => flows as never });
  if (control === "org-scoped-workers") {
    (installation.resources as Record<string, unknown>)[WORKERS_RESOURCE] = { ...defineWorkerCollection(), scope: "org" };
  }
  const bound: WorkerInstallation =
    control === "no-create-check"
      ? { ...installation, session: (shape) => ({ ...installation.session(shape), createCheck: undefined as never }) }
      : installation;

  const agent = defineAgentWorkerFlow({ installation: bound });
  const research = researchFlow(bound);
  flows = { agent, [RESEARCH]: research };

  const { hire, fork, fire } = createWorkerHireBlocks(bound);
  const roster = defineWorkerRosterFlow(bound, {
    hire: { inputSchema: hire.inputSchema, block: hire },
    fork: { inputSchema: fork.inputSchema, block: fork },
    fire: { inputSchema: fire.inputSchema, block: fire },
  });
  return [agent({ id: "agent" }), research(), roster()] as unknown as FlowInstance[];
}
