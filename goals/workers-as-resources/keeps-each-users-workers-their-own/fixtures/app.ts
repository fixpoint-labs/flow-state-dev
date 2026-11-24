/**
 * The app the goal runs: workers as data, on two worker flows.
 *
 * - `agent`, the workforce kit's built-in, registered once and bound to the
 *   installation;
 * - `research`, a worker flow the app writes, whose door answers with the
 *   worker the turn loaded and its instructions, and whose `reassign` action
 *   tries to move the session to another worker;
 * - the kit's roster flow, with `hire`, `fork` and `fire`.
 *
 * A caller is the user and org two headers name: the stand-in for a host's
 * verified identity. `agent` answers from a scripted model that says which of
 * the run's markers its prompt held, so a turn shows what it was configured
 * with, never what a test wished it said.
 *
 * The goal's two controls patch workforce's source, never this app: see
 * `run.mts`.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createMockModelResolver, type MockGeneratorInstance } from "@flow-state-dev/testing";
import { messageReceivedEntry, workerConfigSchema, workerFlow, workerMessagesResources, type WorkerInstallation } from "@flow-state-dev/workforce";
import { installWorkers } from "../../../lib/index.mts";
import { z } from "zod";

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
    resources: { ...installation.resources, ...workerMessagesResources },
    // Every worker on a flow the kit hires can hear another worker's message.
    internal: { actions: { onMessageReceived: messageReceivedEntry({ installation, flowKind: RESEARCH }) } },
    actions: {
      respond: {
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
      reassign: handler({
          name: "research-reassign",
          inputSchema: z.object({ to: z.string() }).strict(),
          execute: async (input, ctx) => {
            await (ctx.session as unknown as { patchState(p: object): Promise<void> }).patchState({ workerId: input.to });
            return { reassigned: input.to };
          },
        }),
    },
  });
}

/** One host's flows, from the workforce kit over `directory`: one copy each of `agent`, `research` and the roster flow. */
export async function appFlows(directory: string): Promise<FlowInstance[]> {
  return (await installWorkers(directory, { [RESEARCH]: workerFlow(researchFlow) })).copies;
}
