/**
 * Goal check for the registry grammar on real routes. Contract: goal.md.
 *
 * Run: pnpm tsx goals/model-strings/registry-grammar/run.mts
 * Control: GOAL_CONTROL=colon-off (must FAIL on g:colon-text and e:colon-decision)
 */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  boolean,
  defineFlow,
  evaluator,
  generator,
  parseModelString,
  DEFAULT_ORG_ID,
  type ModelResolver,
} from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import {
  createInMemoryStores,
  createModelResolver,
  createResponseEmitter,
  runAction,
} from "@flow-state-dev/engine";
import { z } from "zod";
import { fail, loadFixture, runGoal, stripIntentOverrides } from "../../lib/index.mts";

type Fixture = { question: string; ticket: string; urgent: string };
const fx = loadFixture<Fixture>(import.meta.url);

stripIntentOverrides();
delete process.env.FSDEV_DEFAULT_MODEL;

const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "colon-off") {
  fail(`unknown GOAL_CONTROL "${CONTROL}" (known: colon-off)`);
}
if (!process.env.AI_GATEWAY_API_KEY) {
  fail("AI_GATEWAY_API_KEY is not set: this goal needs Vercel's AI Gateway");
}
const HAS_OPENAI = Boolean(process.env.OPENAI_API_KEY);
/** OpenRouter needs its key and its AI SDK package, which this repo does not install. */
const HAS_OPENROUTER = (() => {
  if (!process.env.OPENROUTER_API_KEY) return false;
  try {
    createRequire(import.meta.url).resolve("@openrouter/ai-sdk-provider");
    return true;
  } catch {
    return false;
  }
})();
const REPO = new URL("../../../", import.meta.url).pathname;

/** True when `s` is in the colon lane. A string the parser rejects is not. */
const isColon = (s: string) => {
  try {
    return parseModelString(s).type === "alias";
  } catch {
    return false;
  }
};

/**
 * Under `colon-off`, the resolver refuses every colon string, which is how
 * the colon lane looks when it is not there: the strings never reach a route.
 */
function withControl(base: ModelResolver): ModelResolver {
  if (CONTROL !== "colon-off") return base;
  const off = (s: string) => new Error(`colon lane off (control): "${s}"`);
  const wrapped = ((id: string, block?: string) => {
    if (isColon(id)) throw off(id);
    return base(id, block);
  }) as ModelResolver;
  wrapped.resolveId = (id) => base.resolveId(id);
  wrapped.resolveEvaluationModel = async (id, block) => {
    if (isColon(id)) throw off(id);
    return base.resolveEvaluationModel!(id, block);
  };
  return wrapped;
}

let seq = 0;
async function run(block: unknown, input: Record<string, unknown>, modelResolver: ModelResolver) {
  const requestId = `req_registry_grammar_${++seq}`;
  const flow = defineFlow({
    kind: "registry-grammar-goal",
    actions: { run: { inputSchema: z.record(z.unknown()), block: block as never } },
  })();
  const response = createResponseEmitter({ requestId, now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: "run",
    input,
    requestId,
    userId: "goal_user",
    sessionId: `goal_session_${seq}`,
    stores: createInMemoryStores(),
    responseEmitter: response,
    runtimeConfig: { modelResolver },
  });
  const row = (response.getItems() as unknown as BlockTraceItem[]).find((i) => i.type === "block_trace");
  return { result, row };
}

/** Count requests that leave the process while `fn` runs. */
async function countingFetch<T>(fn: () => Promise<T>): Promise<{ value: T; requests: number }> {
  let requests = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    requests += 1;
    return realFetch(...args);
  }) as typeof fetch;
  try {
    return { value: await fn(), requests };
  } finally {
    globalThis.fetch = realFetch;
  }
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const resolver = withControl(createModelResolver());

  // ---- Leg (g): generator strings reach the route they name ----------------
  type Case = { model: string; gateway: string | undefined; id: string };
  const cases: Case[] = [
    { model: "vercel:openai/gpt-5.4-mini", gateway: "vercel", id: "gpt-5.4-mini" },
    // Bare slash: direct with a key, else the configured gateway.
    { model: "openai/gpt-5.4-mini", gateway: HAS_OPENAI ? undefined : "vercel", id: "gpt-5.4-mini" },
  ];
  if (HAS_OPENAI) cases.push({ model: "openai:gpt-5.4-mini", gateway: undefined, id: "gpt-5.4-mini" });
  if (HAS_OPENROUTER) {
    cases.push({ model: "openrouter:openai/gpt-oss-20b:free", gateway: "openrouter", id: "gpt-oss-20b" });
  } else {
    evidence.push("openrouter:openai/gpt-oss-20b:free not run (no OpenRouter key or package)");
  }

  for (const c of cases) {
    const block = generator({ name: "ask", model: c.model, prompt: fx.question });
    const { result, row } = await run(block, {}, resolver);
    const tag = isColon(c.model) ? "g:colon-text" : "g:slash-text";
    if (result.error !== undefined || typeof result.output !== "string" || result.output.trim() === "") {
      failures.push(`${tag}: ${c.model} returned no text: ${result.error?.message ?? JSON.stringify(result.output)}`);
      continue;
    }
    const identity = row?.model;
    if (identity?.gateway !== c.gateway) {
      failures.push(`g:route: ${c.model} was served by gateway ${String(identity?.gateway)}, expected ${String(c.gateway)}`);
    }
    if (!String(identity?.actual).includes(c.id)) {
      failures.push(`g:id: ${c.model} answered as ${String(identity?.actual)}, expected an id containing ${c.id}`);
    }
    evidence.push(`${c.model} -> "${result.output.trim().slice(0, 40)}" via ${identity?.gateway ?? "direct"} as ${identity?.actual}`);
  }

  // A pinned provider with no key fails naming the key; it never falls through.
  if (!HAS_OPENAI) {
    const { result } = await run(generator({ name: "ask", model: "openai:gpt-5.4-mini", prompt: fx.question }), {}, resolver);
    if (CONTROL !== "colon-off" && !/OPENAI_API_KEY/.test(result.error?.message ?? "")) {
      failures.push(`g:pinned: openai:gpt-5.4-mini with no OpenAI key did not fail naming it: ${result.error?.message ?? "it ran"}`);
    } else {
      evidence.push(`openai:gpt-5.4-mini (no OPENAI_API_KEY) refused: ${result.error?.message.slice(0, 80)}`);
    }
  }

  // Joined so this file does not quote the spelling the guard refuses.
  const legacy = ["vercel", "openai", "gpt-5.4-mini"].join("/");
  const { value: legacyRun, requests } = await countingFetch(() =>
    run(generator({ name: "ask", model: legacy, prompt: fx.question }), {}, resolver)
  );
  if (!(legacyRun.result.error?.message ?? "").includes('"vercel:openai/gpt-5.4-mini"')) {
    failures.push(`g:legacy: ${legacy} did not fail naming its colon spelling: ${legacyRun.result.error?.message ?? "it ran"}`);
  }
  if (requests !== 0) failures.push(`g:legacy: ${requests} request(s) left the process for ${legacy}`);
  evidence.push(`${legacy} refused with ${requests} requests`);

  // ---- Leg (e): evaluator strings, gateway and registered provider ---------
  const questions = { urgent: boolean(fx.urgent) };
  const gatewayEval = await run(
    evaluator({ name: "triage", model: "vercel:typesafe-ai/jev", inputSchema: z.object({ ticket: z.string() }), state: (i) => i.ticket, questions }),
    { ticket: fx.ticket },
    resolver
  );
  const gwAnswer = (gatewayEval.result.output as { answers?: Record<string, { probability?: number }> } | undefined)?.answers?.urgent;
  if (gatewayEval.result.error !== undefined || typeof gwAnswer?.probability !== "number") {
    failures.push(`e:colon-decision: vercel:typesafe-ai/jev returned no decision: ${gatewayEval.result.error?.message ?? JSON.stringify(gwAnswer)}`);
  } else {
    if (gatewayEval.row?.model?.gateway !== "vercel") {
      failures.push(`e:route: vercel:typesafe-ai/jev reported gateway ${String(gatewayEval.row?.model?.gateway)}`);
    }
    evidence.push(`vercel:typesafe-ai/jev P(urgent)=${gwAnswer.probability} via ${gatewayEval.row?.model?.gateway}`);
  }

  // Jev, re-wrapped so it carries no gateway record. "No gateway" can only come from the provider lookup.
  const jev = await createModelResolver().resolveEvaluationModel!("vercel:typesafe-ai/jev");
  const triage = {
    languageModel: () => {
      throw new Error("triage serves evaluation models only");
    },
    evaluationModel: (id: string) => {
      if (id !== "native") throw new Error(`triage has no evaluation model "${id}"`);
      return Object.create(jev as object);
    },
  };
  const providerResolver = withControl(createModelResolver({ providers: { triage } }));
  const providerEval = await run(
    evaluator({ name: "triage", model: "triage:native", inputSchema: z.object({ ticket: z.string() }), state: (i) => i.ticket, questions }),
    { ticket: fx.ticket },
    providerResolver
  );
  const pAnswer = (providerEval.result.output as { answers?: Record<string, { probability?: number }> } | undefined)?.answers?.urgent;
  if (providerEval.result.error !== undefined || typeof pAnswer?.probability !== "number") {
    failures.push(`e:colon-decision: triage:native returned no decision: ${providerEval.result.error?.message ?? JSON.stringify(pAnswer)}`);
  } else {
    if (providerEval.row?.model?.gateway !== undefined) {
      failures.push(`e:route: triage:native reported gateway ${providerEval.row?.model?.gateway}; expected the provider lookup`);
    }
    evidence.push(`triage:native P(urgent)=${pAnswer.probability} with no gateway in its identity`);
  }

  // ---- Leg (r): the guard ----------------------------------------------------
  const guard = () => spawnSync(process.execPath, ["scripts/validate-model-strings.mjs"], { cwd: REPO, encoding: "utf8" });
  const clean = guard();
  if (clean.status !== 0) failures.push(`r:clean: the guard failed on the repo:\n${clean.stderr}`);
  const planted = join(REPO, "goals/model-strings/registry-grammar/planted.tmp.ts");
  writeFileSync(planted, `export const model = "${["vercel", "openai", "x"].join("/")}";\n`);
  let plantedStatus: number | null = null;
  try {
    plantedStatus = guard().status;
  } finally {
    rmSync(planted, { force: true });
  }
  if (plantedStatus === 0) failures.push("r:planted: the guard passed with a planted slash multi-hop string");
  evidence.push(`guard: clean exit ${clean.status}, planted exit ${plantedStatus}`);

  return { failures, evidence: evidence.join("; ") };
});
