/**
 * Where a custom worker flow's data lives (D6), as the docs tell its author.
 *
 * One registered copy of a custom worker flow, two standard workers on it,
 * and two users. What the flow keeps at user scope is shared by one user's
 * workers and never reaches the other user. What it keys by the worker
 * `resolveWorker` loaded stays with that worker.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { z } from "zod";
import { workerConfigSchema } from "../src/worker-config";
import { createWorkerInstallation } from "../src/workers/installation";

/** One row per worker, in the user's scope: keyed by the worker, so kept per worker. */
const workerNotes = defineResourceCollection({
  pattern: "worker-notes/*",
  scope: "user",
  stateSchema: z.object({ text: z.string().default("") })
});

/** One row per user: every one of that user's workers on the flow reads it. */
const userNotes = defineResource({
  ref: "user-notes",
  scope: "user",
  stateSchema: z.object({ text: z.string().default("") }),
  default: { text: "" }
});

const input = z.object({ message: z.string() });

function host() {
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: [
      { id: "researcher", declared: { flow: "research" }, body: "Research." },
      { id: "scribe", declared: { flow: "research" }, body: "Take notes." }
    ],
    workerFlows: () => flows as never
  });
  const door = handler({
    name: "research-run",
    inputSchema: input,
    resources: { workerNotes, userNotes, ...installation.resources },
    execute: async ({ message }, ctx) => {
      const worker = await installation.resolveWorker(ctx, "research");
      if (message.startsWith("write:")) {
        const text = message.slice("write:".length);
        await ctx.resources.workerNotes.upsert(worker.id, { text });
        await ctx.resources.userNotes.setState({ text });
      }
      const own = await ctx.resources.workerNotes.getOptional(worker.id);
      return { mine: own?.state.text ?? null, user: ctx.resources.userNotes.state.text };
    }
  });
  const research = defineFlow({
    kind: "research",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { run: { inputSchema: input, block: door, userMessage: (i: { message: string }) => i.message } }
  });
  flows = { research };
  const copy = research() as unknown as FlowInstance;
  return { copy, state: createFlowState({ flows: { research: copy }, stores: { default: { primary: inMemoryStores() } } }) };
}

describe("a custom worker flow's data (D6)", () => {
  it("shares user-scoped data among one user's workers, never across users; a key by worker keeps it apart", async () => {
    const { copy, state } = host();
    try {
      const runtime = await state.getRuntime();
      const router = await state.getRouter();
      const turn = async (userId: string, worker: string, message: string) => {
        const sessionId = `${userId}-${worker}`;
        if ((await runtime.stores.session.get(sessionId)) == null) {
          const created = await router.POST(
            new Request("http://localhost/api/flows/research/sessions", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ userId, sessionId, state: { workerId: worker } })
            }),
            { params: { path: ["research", "sessions"] } }
          );
          expect(created.status).toBe(201);
        }
        const result = await runAction({
          orgId: DEFAULT_ORG_ID,
          flow: copy,
          actionName: "run",
          input: { message },
          userId,
          sessionId,
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        });
        expect(result.error).toBeUndefined();
        return result.output as { mine: string | null; user: string };
      };

      await turn("alice", "researcher", "write:the launch moved");
      // Alice's other worker on the flow reads her user-scoped row, not the researcher's own.
      expect(await turn("alice", "scribe", "read")).toEqual({ mine: null, user: "the launch moved" });
      // The researcher reads both.
      expect(await turn("alice", "researcher", "read")).toEqual({ mine: "the launch moved", user: "the launch moved" });
      // Bob, with the same worker, reads neither.
      expect(await turn("bob", "researcher", "read")).toEqual({ mine: null, user: "" });
    } finally {
      await state.dispose();
    }
  });
});
