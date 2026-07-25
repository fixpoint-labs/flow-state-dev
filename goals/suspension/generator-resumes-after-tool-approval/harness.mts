/**
 * Real-path driver for the generator tool-approval goal check. Run via `tsx -e`
 * from `apps/kitchen-sink` (by run.mts) so `@flow-state-dev/*` AND
 * `@ai-sdk/gateway` resolve from the app's node_modules — `goals/` is not that
 * app, and real inference needs the gateway.
 *
 * Defines a minimal durable generator flow whose one tool suspends for approval,
 * drives the real dispatch → approve → resume round trip against a REAL model in
 * ONE process (the in-memory durable store carries the suspension between the
 * phases), and reports raw observations on a single `__GOAL__<json>` line.
 * run.mts owns the grading and the retry policy.
 *
 * Not typechecked by `goals/tsconfig.json` — its imports resolve against
 * apps/kitchen-sink. See goals/README.md → "Harnesses".
 */
import { createGateway } from "@ai-sdk/gateway";
import { createModelResolver, defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import {
  continueRequest,
  createFlowRegistry,
  createInMemoryStores,
  createCheckpointDurabilityProvider,
  runAction,
} from "@flow-state-dev/engine";
import { z } from "zod";

const out = (r: unknown) => console.log("__GOAL__" + JSON.stringify(r));

const MODEL = process.env.KS_GOAL_MODEL!;
const TITLE = process.env.KS_GOAL_TITLE;
const CONFIRMATION_ID = process.env.KS_GOAL_CONFIRMATION_ID!; // held out: only the tool returns it
const APPROVER = process.env.KS_GOAL_APPROVER; // the approve payload (NOT the result)

// --- Observability ---------------------------------------------------------
// Count real model calls per phase. If step 0 is re-issued on resume, the first
// resume-phase call would carry NO tool results; a correct resume continues at
// step 1 with the gated tool's result already in context.
let phase = "initial";
const modelCalls: { phase: string; toolResults: number }[] = [];
let sideEffects = 0; // the tool's real post-approval work, counted once

/** Tool-result parts (v7 role:"tool" messages) present in a step's messages. */
function toolResultCount(messages: any[]): number {
  let n = 0;
  for (const m of messages ?? []) {
    if (m && m.role === "tool" && Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && part.type === "tool-result") n += 1;
      }
    }
  }
  return n;
}

async function main(): Promise<void> {
  // Real AI-SDK adapter via the Vercel gateway. env:{} so ambient
  // FSDEV_INTENT_*/FSDEV_DEFAULT_MODEL overrides (no declared intents here)
  // don't abort resolver construction.
  const resolver = createModelResolver({
    gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
    env: {},
  });
  const realModel: any = resolver(MODEL, "agent");
  if (typeof realModel.generateStep !== "function") {
    return out({
      ok: false,
      reason: "resolved model is not step-capable (no generateStep) — cannot exercise the owned loop",
    });
  }

  // Wrap the REAL model to observe the framework-owned loop, exposing ONLY the
  // non-streaming step methods (modelId + generate + generateStep) — the same
  // shape the deterministic engine suite drives. This forces runAction /
  // continueRequest onto the observable generateStep loop rather than a
  // forwarded streamStep, so per-step model calls are counted. generate is
  // forwarded to the real adapter but the owned loop never calls it.
  const model = {
    modelId: realModel.modelId,
    generate: realModel.generate
      ? realModel.generate.bind(realModel)
      : async () => {
          throw new Error("generate not implemented");
        },
    async generateStep(options: { messages: any[] }) {
      modelCalls.push({ phase, toolResults: toolResultCount(options.messages) });
      return realModel.generateStep(options);
    },
  };

  // Single obvious gated tool. It suspends FIRST, then does its real work, so
  // the side effect can only fire after approval — and exactly once.
  const publish = handler({
    name: "publish_document",
    description: "Publish a document to production. Requires human approval before it takes effect.",
    inputSchema: z.object({ title: z.string().describe("The title of the document to publish") }),
    outputSchema: z.object({
      status: z.string(),
      publishedTitle: z.string(),
      confirmationId: z.string(),
    }),
    execute: async (input: { title: string }, ctx: any) => {
      // Gate BEFORE the real work: nothing published until an operator approves.
      const decision = await ctx.suspend({
        reason: "approval",
        message: `Approve publishing the document titled "${input.title}"?`,
      });
      // Real work — runs only after approval, exactly once. The confirmation id
      // is produced HERE; the model has never seen it.
      sideEffects += 1;
      void decision;
      return {
        status: "published",
        publishedTitle: input.title,
        confirmationId: CONFIRMATION_ID,
      };
    },
  });

  const agent = generator({
    name: "agent",
    model: model as never,
    tools: [publish],
    user: (input: { message: string }) => input.message,
    prompt:
      "You are a publishing assistant. When the user asks to publish a document, you MUST call the " +
      "publish_document tool exactly once, passing the document title. The tool returns a JSON object " +
      "with a 'confirmationId' field. After the tool succeeds, reply to the user in one short sentence " +
      "confirming the document was published and quote the confirmationId value VERBATIM. Do NOT invent " +
      "a confirmation id, and do NOT call publish_document more than once.",
  });

  const flow = defineFlow({
    kind: "gen-tool-approval",
    actions: {
      run: {
        block: sequencer({ name: "seq", durable: true }).step(agent),
        inputSchema: z.object({ message: z.string() }),
      },
    },
  })({ id: "gen-tool-approval" });

  const stores = createInMemoryStores();
  const provider = createCheckpointDurabilityProvider({
    checkpoints: stores.checkpoints,
    suspensions: stores.suspensions,
    leases: stores.leases,
  });
  const registry = createFlowRegistry();
  registry.register(flow as never);

  // 1. dispatch — the real model should call publish_document, which suspends.
  const initial = await runAction({
    flow: flow as never,
    actionName: "run",
    input: { message: `Please publish the document titled "${TITLE}".` },
    userId: "goal-user",
    stores,
    runtimeConfig: { durabilityProvider: provider },
  });
  const requestId = initial.requestId!;

  const status1 = (await stores.request.get(requestId))?.status;
  if (status1 !== "suspended") {
    return out({
      ok: false,
      reason: "initial run did not suspend (the real model may not have called the gated tool)",
      status: status1 ?? "unknown",
      output: initial.output ?? null,
      modelCalls,
    });
  }

  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s: { requestId: string }) => s.requestId === requestId) ?? pending[0];
  if (!suspension) {
    return out({ ok: false, reason: "suspended status but no pending suspension record", modelCalls });
  }

  const initialModelCalls = modelCalls.length;
  const sideEffectsAtSuspend = sideEffects;

  // 2. approve — persist the operator decision with a payload that is NOT the
  //    tool's real result (proves the final answer can't be a payload echo).
  await provider.suspend({
    ...suspension,
    status: "approved",
    resolvedAt: Date.now(),
    resumeData: { approver: APPROVER },
  });

  // 3. resume the SAME request → past the gate, tool runs for real, completes.
  //    continueRequest returns finished as a PROMISE (the re-entered runAction);
  //    await it so the resume actually runs to its terminal.
  phase = "resume";
  const { finished: finishedPromise } = await continueRequest({
    requestId,
    stores,
    flowRegistry: registry,
    resumeContext: {
      suspensionId: suspension.suspensionId,
      action: "approve",
      data: { approver: APPROVER },
      resumedBy: "reviewer",
    },
    runtimeConfig: { durabilityProvider: provider },
  });
  const finished = await finishedPromise;

  const rec = await stores.request.get(requestId);
  const resumeCalls = modelCalls.filter((c) => c.phase === "resume");

  out({
    ok: true,
    suspended: true,
    status: rec?.status ?? "unknown",
    output: finished?.output ?? null,
    error: finished?.error ?? null,
    sideEffects, // total tool real-work executions
    sideEffectsAtSuspend, // must be 0: nothing published before approval
    initialModelCalls, // model calls before suspend (step 0)
    resumeModelCalls: resumeCalls.length,
    firstResumeToolResults: resumeCalls.length > 0 ? resumeCalls[0].toolResults : -1,
  });
}

main()
  .catch((err) =>
    out({
      ok: false,
      reason: "driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)),
    }),
  )
  .finally(() => process.exit(0));
