/**
 * Goal check — a REAL model's generator tool loop suspends for approval and,
 * on resume, continues past the approved tool call on the same request.
 *
 * Real path, REAL model (no mock), out of CI. See goal.md for the contract.
 *
 * This is the real-model complement to the deterministic engine suite
 * (`packages/engine/test/generator-suspension-resume.test.ts`), which proves
 * the same behaviour with a scripted `stepModel`. The value here is exercising
 * the REAL AI-SDK adapter's `generateStep` / framework-owned tool-loop
 * suspension path (FIX-814 PR3) end to end:
 *   1. dispatch  → the real model calls the single gated tool; the tool calls
 *                  ctx.suspend() at the turn boundary → the request suspends
 *                  BEFORE the tool's real work runs.
 *   2. approve   → mark the suspension approved with a distinct operator
 *                  payload (the approver id — NOT the tool's result).
 *   3. resume    → the SAME request rebuilds its conversation from the durable
 *                  item log (step 0 is NOT re-issued to the model), re-enters
 *                  the gated tool which now produces its REAL result (a
 *                  held-out confirmation id), and the model writes a final
 *                  answer that quotes that id.
 *
 * The grade is content-based and anti-game: passing requires the tool to have
 * actually executed AFTER approval — the final answer must carry the tool's
 * held-out confirmation id (which the model could not produce without the tool
 * running post-approval), the tool's side effect must have fired exactly once,
 * and the model must NOT have been re-called for step 0 (the first model call
 * on resume already carries the tool result). None of `status==="completed"`,
 * a suspension merely existing, or the approval payload being echoed can
 * satisfy it. See the Anti-game note in goal.md.
 *
 * Mechanism: the dispatch and the resume must happen in ONE process so the
 * in-memory durable store carries the suspension between them, and that process
 * must resolve both the kitchen-sink `@/*` aliases and the `@flow-state-dev/*`
 * workspace packages (incl. `@ai-sdk/gateway` for real inference). Only files
 * under `apps/kitchen-sink` (run with that cwd) resolve both. So this runner
 * writes a tiny transient driver there, runs it, reads back a JSON verdict, and
 * deletes it — keeping the goal self-contained.
 *
 * Run: pnpm tsx goals/suspension/generator-resumes-after-tool-approval/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const KITCHEN_SINK = fileURLToPath(new URL("../../../apps/kitchen-sink", import.meta.url));
const DRIVER_NAME = `.goal-gen-tool-resume-driver.${process.pid}.mts`;
const DRIVER_PATH = `${KITCHEN_SINK}/${DRIVER_NAME}`;
const RESULT_MARKER = "__GOAL_RESULT__";
const MODEL = "vercel/openai/gpt-5.4-mini"; // openai/gpt-5.4-mini via the Vercel gateway

// Held-out fixture — nothing below hardcodes the title, confirmation id, or
// approver. Swapping them for any other valid triple must still pass a correct
// implementation: the runner reads them from the fixture and asserts against
// what it read.
const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/publish.json", import.meta.url), "utf8"),
) as { title: string; confirmationId: string; approver: string };

// The driver runs INSIDE apps/kitchen-sink so `@flow-state-dev/*` and
// `@ai-sdk/gateway` resolve from its node_modules. It defines a minimal durable
// generator flow whose one tool suspends for approval, drives the real
// dispatch → approve → resume round trip against a real model, and prints one
// JSON verdict line of RAW observations (graded by the outer runner).
const driver = `
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

const out = (r) => console.log(${JSON.stringify(RESULT_MARKER)} + JSON.stringify(r));

const TITLE = process.env.KS_GOAL_TITLE;
const CONFIRMATION_ID = process.env.KS_GOAL_CONFIRMATION_ID; // held out: only the tool returns it
const APPROVER = process.env.KS_GOAL_APPROVER;               // the approve payload (NOT the result)

// --- Observability -------------------------------------------------------
// Count real model calls per phase. If step 0 is re-issued on resume, the
// first resume-phase call would carry NO tool results; a correct resume
// continues at step 1 with the gated tool's result already in context.
let phase = "initial";
const modelCalls = []; // { phase, toolResults } per generateStep call
let sideEffects = 0;    // the tool's real post-approval work, counted once

// Tool-result parts (v7 role:"tool" messages) present in a step's messages.
function toolResultCount(messages) {
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

try {
  // Real AI-SDK adapter via the Vercel gateway. env:{} so ambient
  // FSDEV_INTENT_*/FSDEV_DEFAULT_MODEL overrides (no declared intents here)
  // don't abort resolver construction.
  const resolver = createModelResolver({
    gateways: { vercel: createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY }) },
    env: {},
  });
  const realModel = resolver(${JSON.stringify(MODEL)}, "agent");
  if (typeof realModel.generateStep !== "function") {
    out({ ok: false, reason: "resolved model is not step-capable (no generateStep) — cannot exercise the owned loop" });
    process.exit(0);
  }

  // Wrap the REAL model to observe the framework-owned loop, exposing ONLY the
  // non-streaming step methods (modelId + generate + generateStep) — the same
  // shape the deterministic engine suite drives. This forces runAction /
  // continueRequest onto the observable generateStep loop rather than a
  // forwarded streamStep, so per-step model calls are counted. generate is
  // forwarded to the real adapter but the owned loop never calls it.
  const model = {
    modelId: realModel.modelId,
    generate: realModel.generate ? realModel.generate.bind(realModel) : async () => { throw new Error("generate not implemented"); },
    async generateStep(options) {
      modelCalls.push({ phase, toolResults: toolResultCount(options.messages) });
      return realModel.generateStep(options);
    },
  };

  // Single obvious gated tool. It suspends FIRST, then does its real work,
  // so the side effect can only fire after approval — and exactly once.
  const publish = handler({
    name: "publish_document",
    description: "Publish a document to production. Requires human approval before it takes effect.",
    inputSchema: z.object({ title: z.string().describe("The title of the document to publish") }),
    outputSchema: z.object({
      status: z.string(),
      publishedTitle: z.string(),
      confirmationId: z.string(),
    }),
    execute: async (input, ctx) => {
      // Gate BEFORE the real work: nothing published until an operator approves.
      const decision = await ctx.suspend({
        reason: "approval",
        message: "Approve publishing the document titled \\"" + input.title + "\\"?",
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
    model,
    tools: [publish],
    user: (input) => input.message,
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
  registry.register(flow);

  // 1. dispatch — the real model should call publish_document, which suspends.
  const initial = await runAction({
    flow,
    actionName: "run",
    input: { message: "Please publish the document titled \\"" + TITLE + "\\"." },
    userId: "goal-user",
    stores,
    runtimeConfig: { durabilityProvider: provider },
  });
  const requestId = initial.requestId;

  const status1 = (await stores.request.get(requestId))?.status;
  if (status1 !== "suspended") {
    out({
      ok: false,
      reason: "initial run did not suspend (the real model may not have called the gated tool)",
      status: status1 ?? "unknown",
      output: initial.output ?? null,
      modelCalls,
    });
    process.exit(0);
  }

  const pending = await provider.listSuspended({ status: "pending" });
  const suspension = pending.find((s) => s.requestId === requestId) ?? pending[0];
  if (!suspension) {
    out({ ok: false, reason: "suspended status but no pending suspension record", modelCalls });
    process.exit(0);
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
  //    continueRequest returns finished as a PROMISE (the re-entered
  //    runAction); await it so the resume actually runs to its terminal.
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
    outputType: typeof (finished?.output),
    error: finished?.error ?? null,
    sideEffects,               // total tool real-work executions
    sideEffectsAtSuspend,      // must be 0: nothing published before approval
    initialModelCalls,         // model calls before suspend (step 0)
    resumeModelCalls: resumeCalls.length,
    firstResumeToolResults: resumeCalls.length > 0 ? resumeCalls[0].toolResults : -1,
  });
} catch (err) {
  out({ ok: false, reason: "driver threw: " + (err instanceof Error ? (err.stack ?? err.message) : String(err)) });
}
process.exit(0);
`;

function fail(msg: string): never {
  console.error("FAIL — " + msg);
  process.exit(1);
}

const MAX_ATTEMPTS = 3; // a real model is nondeterministic; retry pure flakiness
let lastFlaky = "";

for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  writeFileSync(DRIVER_PATH, driver, "utf8");
  let stdout = "";
  try {
    // Strip the ambient FSDEV_INTENT_* / FSDEV_DEFAULT_MODEL overrides: the
    // engine builds an internal model resolver in createExecutionContext, and
    // this isolated flow declares no intents, so those overrides would abort
    // resolver construction. The generator here uses a directly-supplied model
    // instance (the wrapped real adapter), so the internal resolver never
    // resolves anything — dropping the overrides only avoids a spurious throw.
    const childEnv: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      if (k.startsWith("FSDEV_INTENT_") || k === "FSDEV_DEFAULT_MODEL") continue;
      childEnv[k] = v;
    }
    stdout = execFileSync("pnpm", ["tsx", DRIVER_NAME], {
      cwd: KITCHEN_SINK,
      encoding: "utf8",
      env: {
        ...childEnv,
        FSD_ENV: "dev",
        KS_GOAL_TITLE: fixture.title,
        KS_GOAL_CONFIRMATION_ID: fixture.confirmationId,
        KS_GOAL_APPROVER: fixture.approver,
      },
    });
  } catch (err: any) {
    rmSync(DRIVER_PATH, { force: true });
    fail(`driver process failed:\n${err?.stdout ?? ""}\n${err?.stderr ?? err?.message ?? ""}`);
  } finally {
    rmSync(DRIVER_PATH, { force: true });
  }

  const line = stdout.split("\n").find((l) => l.startsWith(RESULT_MARKER));
  if (line === undefined) fail(`no result line from driver. stdout:\n${stdout}`);
  const result = JSON.parse(line.slice(RESULT_MARKER.length));

  // Model flakiness (not a bug): the model didn't call the gated tool, so no
  // suspension occurred. Retry rather than fail — the resume path was never
  // exercised. A genuine driver error (ok:false with another reason) fails now.
  if (result.ok !== true) {
    if (typeof result.reason === "string" && result.reason.includes("did not suspend")) {
      lastFlaky = `attempt ${attempt}: ${result.reason} (status=${result.status}, output=${JSON.stringify(result.output)})`;
      console.error(`(retrying) ${lastFlaky}`);
      continue;
    }
    fail(result.reason ?? "driver reported failure");
  }
  if (result.error) fail(`resume errored: ${JSON.stringify(result.error)}`);

  // --- The goal grade: held-out, content-based, anti-game ------------------
  const output = result.output;
  const outputStr = typeof output === "string" ? output : JSON.stringify(output ?? "");
  const failures: string[] = [];

  // (a) The tool ACTUALLY RAN AFTER APPROVAL — the final answer quotes the
  //     tool's held-out confirmation id, which the model never saw except as
  //     the tool's post-approval result. This is the core anti-game signal.
  if (!outputStr.includes(fixture.confirmationId)) {
    failures.push(
      `final answer is missing the tool's held-out confirmation id "${fixture.confirmationId}" — ` +
        `the approved tool did not run post-approval, or its real result never reached the model`,
    );
  }
  // (b) The final answer must NOT merely echo the approval payload. If the
  //     approver id appears but the confirmation id does not, that is a payload
  //     echo, not the tool's result. (Belt-and-suspenders with (a).)
  if (outputStr.includes(fixture.approver) && !outputStr.includes(fixture.confirmationId)) {
    failures.push(`final answer echoed the approval payload "${fixture.approver}" instead of the tool's real result`);
  }
  // (c) Request reached completion on the same request id.
  if (result.status !== "completed") {
    failures.push(`resumed request status is "${result.status}", expected "completed"`);
  }
  // (d) The tool's side effect fired exactly once — nothing before approval,
  //     exactly one execution total. Not zero (payload echoed), not two (loop
  //     re-ran the pre-suspension work).
  if (result.sideEffectsAtSuspend !== 0) {
    failures.push(`tool did real work BEFORE approval (sideEffectsAtSuspend=${result.sideEffectsAtSuspend}); the gate did not run first`);
  }
  if (result.sideEffects !== 1) {
    failures.push(`tool side effect fired ${result.sideEffects} times, expected exactly 1`);
  }
  // (e) The model was NOT re-called for step 0 on resume. A correct resume
  //     rebuilds step 0 from the durable log and re-enters the model at step 1
  //     WITH the gated tool's result already in the messages — so the first
  //     resume-phase model call must carry >=1 tool result. Step 0 (initial)
  //     is exactly one model call, before the suspend.
  if (result.initialModelCalls !== 1) {
    failures.push(`expected exactly 1 model call before suspend (step 0), saw ${result.initialModelCalls}`);
  }
  if (result.resumeModelCalls < 1) {
    failures.push(`expected the model to be re-called on resume (step 1+), saw ${result.resumeModelCalls} resume-phase calls`);
  }
  if (result.firstResumeToolResults < 1) {
    failures.push(
      `first resume-phase model call carried ${result.firstResumeToolResults} tool results — ` +
        `step 0 appears to have been re-issued to the model instead of replayed from the durable log`,
    );
  }

  if (failures.length > 0) {
    fail("\n  - " + failures.join("\n  - ") + `\n  resumed output: ${outputStr}`);
  }

  console.log(
    `PASS — a real ${MODEL} generator suspended inside its owned tool loop for approval and, on resume, ` +
      `continued past the approved call on the same request. ` +
      `Evidence: tool ran exactly once (0 before approval, 1 after); step 0 was replayed from the durable log ` +
      `(${result.initialModelCalls} model call before suspend, first resume call carried ` +
      `${result.firstResumeToolResults} tool result → step 0 NOT re-called); request reached "completed"; and the ` +
      `final answer quotes the tool's held-out confirmation id "${fixture.confirmationId}" (not the approval payload). ` +
      `Final answer: ${outputStr}` +
      (attempt > 1 ? ` [passed on attempt ${attempt}; earlier flakiness: ${lastFlaky}]` : ""),
  );
  process.exit(0);
}

fail(`model did not call the gated tool in ${MAX_ATTEMPTS} attempts (no suspension induced) — last: ${lastFlaky}`);
