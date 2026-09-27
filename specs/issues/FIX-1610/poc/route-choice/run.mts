/**
 * FIX-1610 · route-choice POC.
 *
 * Throwaway experiment retained as design evidence. Not production code, not a
 * workspace package, outside default test, lint and knip discovery. Run it by
 * hand; see README.md.
 *
 * The question: does ONE core `evaluator` block, asking one `choice` question
 * whose options are the channel's members (each member's id, described by its
 * WORKER.md `description:`), pick the right specialist on a real model, when
 * the state it reads is a fixed recent transcript plus the new post?
 *
 * The block runs on the real path: a flow whose action is the evaluator,
 * executed by the engine's `runAction` with in-memory stores. Nothing is
 * mocked below the model.
 *
 *   --model sonnet   the owner's model through the AI Gateway, as a language
 *                    model wrapped in the AI SDK's generic evaluation adapter
 *   --model nano     the cheap model, same adapter
 *   --model jev      the gateway's own evaluation model, `typesafe-ai/jev`
 *   --model string   the owner's model named as a plain string, resolved by
 *                    core's resolver the way an app's config would name it
 *   --repeat N       runs per leg (default 3)
 *
 * POC_CONTROL=no-transcript drops the transcript from the state, so the
 * evaluator sees the post alone. The follow-up leg must then fail: that shows
 * the transcript is what carries a follow-up, and that the check can fail.
 *
 * Exit 0 when every run of every leg picked its expected member.
 */

import { createRequire } from "node:module";
import { z } from "zod";
import {
  choice,
  createModelResolver,
  defineFlow,
  evaluator,
  DEFAULT_ORG_ID,
} from "../../../../../packages/core/src/index.ts";
import type { EvaluationModel } from "../../../../../packages/core/src/types/index.ts";
import {
  createInMemoryStores,
  createResponseEmitter,
  runAction,
} from "../../../../../packages/engine/src/index.ts";

// ---------------------------------------------------------------------------
// The fixed member set: D7's roster, described the way a WORKER.md would.
// ---------------------------------------------------------------------------

const MEMBERS = {
  "support.devices": "Printers, laptops, phones, wifi and anything else with a power button.",
  "support.accounts": "Sign-in, passwords, billing, refunds and subscriptions.",
  "support.fsd": "Questions about building apps with the flow-state-dev framework.",
  "support.general": "Anything that fits none of the other specialists.",
} as const;

type Member = keyof typeof MEMBERS;

// ---------------------------------------------------------------------------
// The fixed transcript: the recent lines of `support.help`, oldest first.
// A person asked about wifi; `support.devices` answered with a question.
// ---------------------------------------------------------------------------

const TRANSCRIPT = [
  { from: "customer", text: "Hi, my laptop won't join the office wifi since this morning." },
  {
    from: "support.devices",
    text: "Sorry about that. Does the laptop see the network at all, or does it fail after you type the password?",
  },
];

type Leg = { id: string; intent: string; post: string; expect: Member };

const LEGS: Leg[] = [
  { id: "L1", intent: "device", post: "My phone stopped charging, and it's a brand new cable.", expect: "support.devices" },
  {
    id: "L2",
    intent: "account",
    post: "Different thing: I was charged twice for my subscription this month.",
    expect: "support.accounts",
  },
  {
    id: "L3",
    intent: "fsd",
    post: "How do I make a generator return structured output in flow-state-dev?",
    expect: "support.fsd",
  },
  { id: "L4", intent: "follow-up", post: "It sees it. It fails right after the password.", expect: "support.devices" },
  { id: "L5", intent: "unclear", post: "Who do I ask about getting a parking pass?", expect: "support.general" },
];

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1] ?? fallback;
};
const which = argValue("--model", "sonnet");
const repeat = Number(argValue("--repeat", "3"));
const control = process.env.POC_CONTROL;

const ksRequire = createRequire(new URL("../../../../../apps/kitchen-sink/package.json", import.meta.url));
const gatewayPath = ksRequire.resolve("@ai-sdk/gateway");
const { createGateway } = (await import(gatewayPath)) as typeof import("@ai-sdk/gateway");
const gwRequire = createRequire(gatewayPath);
const { Experimental_EvaluationLanguageModel } = (await import(
  gwRequire.resolve("@ai-sdk/provider-utils/experimental-evaluation")
)) as { Experimental_EvaluationLanguageModel: new (o: { model: unknown }) => EvaluationModel };

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error("AI_GATEWAY_API_KEY is not set: this POC calls real models through the AI Gateway.");
  process.exit(2);
}
const gateway = createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY });

/** The evaluator's `model`, and a label for the report. */
function modelFor(name: string): { model: string | EvaluationModel; label: string } {
  switch (name) {
    case "sonnet":
      return {
        model: new Experimental_EvaluationLanguageModel({ model: gateway.languageModel("anthropic/claude-sonnet-5") }),
        label: "anthropic/claude-sonnet-5 via gateway, generic evaluation adapter",
      };
    case "nano":
      return {
        model: new Experimental_EvaluationLanguageModel({ model: gateway.languageModel("openai/gpt-5-nano") }),
        label: "openai/gpt-5-nano via gateway, generic evaluation adapter",
      };
    case "jev":
      return { model: gateway.evaluationModel("typesafe-ai/jev") as EvaluationModel, label: "typesafe-ai/jev via gateway" };
    case "string":
      return { model: "vercel/anthropic/claude-sonnet-5", label: 'the string "vercel/anthropic/claude-sonnet-5"' };
    default:
      throw new Error(`unknown --model ${name}`);
  }
}

// ---------------------------------------------------------------------------
// The route question, as the route step would ask it
// ---------------------------------------------------------------------------

const inputSchema = z.object({ post: z.string() });

function routeEvaluator(model: string | EvaluationModel) {
  return evaluator({
    name: "channel-route",
    model,
    inputSchema,
    state: (input: { post: string }) =>
      control === "no-transcript"
        ? { post: { from: "customer", text: input.post } }
        : { recent: TRANSCRIPT, post: { from: "customer", text: input.post } },
    questions: {
      member: choice(
        "Which specialist should answer the post? A post that answers a question a specialist just asked goes to that specialist.",
        MEMBERS,
      ),
    },
  });
}

async function runOnce(block: ReturnType<typeof routeEvaluator>, post: string, n: number) {
  const flow = defineFlow({
    kind: `route-choice-${n}`,
    actions: { route: { inputSchema, block } },
  })();
  const requestId = `req_route_${n}`;
  const started = Date.now();
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "route",
    input: { post },
    requestId,
    userId: "user_poc",
    sessionId: `sess_${n}`,
    stores: createInMemoryStores(),
    responseEmitter: createResponseEmitter({ requestId, now: () => Date.now() }),
    runtimeConfig: {
      modelResolver: createModelResolver({ gateways: { vercel: gateway as never } }),
      // Quiet: the report below is the output. Errors still surface on `result.error`.
      logger: {},
    },
  });
  const ms = Date.now() - started;
  if (result.error) return { pick: undefined, error: result.error.message, ms };
  const out = result.output as { answers: { member: { choice: string; confidence?: number } } };
  return { pick: out.answers.member.choice, confidence: out.answers.member.confidence, ms };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const { model, label } = modelFor(which);
const block = routeEvaluator(model);
console.log(`model: ${label}`);
console.log(`repeat: ${repeat}${control ? ` · POC_CONTROL=${control}` : ""}\n`);

let failures = 0;
let n = 0;
const times: number[] = [];
for (const leg of LEGS) {
  const picks: string[] = [];
  for (let r = 0; r < repeat; r++) {
    const out = await runOnce(block, leg.post, n++);
    times.push(out.ms);
    picks.push(out.error ? `ERROR(${out.error.slice(0, 160)})` : `${out.pick}${out.confidence === undefined ? "" : `@${out.confidence.toFixed(2)}`}`);
    if (out.pick !== leg.expect) failures++;
  }
  const ok = picks.every((p) => p.startsWith(leg.expect));
  console.log(`${ok ? "PASS" : "FAIL"}  ${leg.id} ${leg.intent.padEnd(9)} expect ${leg.expect.padEnd(16)} got ${picks.join(", ")}`);
}
times.sort((a, b) => a - b);
console.log(`\nlatency ms: median ${times[Math.floor(times.length / 2)]}, max ${times[times.length - 1]}`);
console.log(failures === 0 ? "\nALL LEGS PASS" : `\n${failures} run(s) picked the wrong member or failed`);
process.exit(failures === 0 ? 0 : 1);
