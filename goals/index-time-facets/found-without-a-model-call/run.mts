/**
 * Goal check: a facet written at index time is found by a search that makes
 * no model call (FIX-1557, leg (e) of the evaluator epic's assembled goal).
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * On one store, the example flow's `write` action stores held-out tickets and
 * a real evaluation model classifies each body as it is written. Then one
 * `search` turn asks for a facet value read back from what was stored. It must
 * return the ticket that value was stored on, and its trace must hold no
 * evaluator or generator row and spend no tokens.
 *
 * `checkFoundWithoutAModelCall()` is exported so the assembled goal can run
 * this leg as it is; running this file runs it standalone.
 *
 * Run: pnpm tsx goals/index-time-facets/found-without-a-model-call/run.mts
 * Control: GOAL_CONTROL=classify-at-query (must FAIL on e2)
 */
import { pathToFileURL } from "node:url";
import {
  defineFlow,
  evaluator,
  handler,
  sequencer,
  DEFAULT_ORG_ID,
  type FlowInstance,
} from "@flow-state-dev/core";
import type { BlockTraceItem } from "@flow-state-dev/core/items";
import {
  createInMemoryStores,
  createModelResolver,
  createResponseEmitter,
  runAction,
  type StoreRegistry,
} from "@flow-state-dev/engine";
import { z } from "zod";
import { ticketQuestions, type FacetQuery } from "../../../examples/guides/index-time-facets/src/facets.ts";
import { ticketsFlow } from "../../../examples/guides/index-time-facets/src/flow.ts";
import type { TicketState } from "../../../examples/guides/index-time-facets/src/index-facets.ts";
import { loadFixture, runGoal, stripIntentOverrides, type GoalResult } from "../../lib/index.mts";

type Fixture = { tickets: Array<{ key: string; title: string; body: string }> };

const USER = "goal_user";
const CONTROLS = ["classify-at-query"] as const;

/** Jev through the gateway when its key is set, OpenAI's evaluation model otherwise. */
function evaluationModelId(): string | undefined {
  if (process.env.AI_GATEWAY_API_KEY) return "typesafe-ai/jev";
  if (process.env.OPENAI_API_KEY) return "openai/gpt-5.4-mini";
  return undefined;
}

async function runTurn(flow: FlowInstance, stores: StoreRegistry, action: string, input: unknown, id: string) {
  const response = createResponseEmitter({ requestId: id, now: () => Date.now() });
  const result = await runAction({
    orgId: DEFAULT_ORG_ID,
    flow,
    actionName: action,
    input,
    requestId: id,
    userId: USER,
    sessionId: `goal_session_${id}`,
    stores,
    responseEmitter: response,
    runtimeConfig: { modelResolver: createModelResolver() },
  });
  const traces = (response.getItems() as unknown as BlockTraceItem[]).filter((i) => i.type === "block_trace");
  return { result, traces };
}

/**
 * The control: a search that classifies the query with the same evaluator
 * before filtering. It finds the right ticket, so only the no-model-call legs
 * can catch it.
 */
function classifyAtQueryFlow(flow: FlowInstance, triage: ReturnType<typeof evaluator>, value: FacetQuery) {
  const searchBlock = (flow.actions as Record<string, { block: never }>).search.block;
  const toQuery = handler({
    name: "answers-to-query",
    inputSchema: z.object({ answers: z.record(z.string(), z.unknown()) }),
    execute: async () => value,
  });
  const search = sequencer({ name: "classify-then-search", inputSchema: z.object({ text: z.string() }) })
    .step((q) => q.text, triage)
    .step(toQuery)
    .step(searchBlock);
  return defineFlow({ kind: "index-time-facets", actions: { search: { block: search } } })();
}

/**
 * Leg (e): write held-out tickets on a real evaluation model, then find one
 * by a stored facet with a search that makes no model call.
 */
export async function checkFoundWithoutAModelCall(
  control: string | undefined = process.env.GOAL_CONTROL,
): Promise<GoalResult> {
  if (control !== undefined && !(CONTROLS as readonly string[]).includes(control)) {
    return { failures: [`unknown GOAL_CONTROL "${control}" (known: ${CONTROLS.join(", ")})`], evidence: "" };
  }
  const modelId = evaluationModelId();
  if (modelId === undefined) {
    return { failures: ["e0: set AI_GATEWAY_API_KEY (Jev) or OPENAI_API_KEY: this leg needs a real evaluation model"], evidence: "" };
  }
  // The default resolver declares no intents; ambient intent pins would make it throw.
  stripIntentOverrides();

  const fx = loadFixture<Fixture>(import.meta.url);
  const triage = evaluator({ name: "ticket-facets", model: modelId, questions: ticketQuestions });
  const flow = ticketsFlow(triage);
  const stores = createInMemoryStores();
  const failures: string[] = [];

  // Turn 1: write every held-out ticket; each body is classified as it lands.
  // A failed classification leaves the ticket without facets by design; keep
  // the cause so e1 can name it instead of just "no facets".
  let writeTokens = 0;
  const classifyErrors: string[] = [];
  for (const [n, t] of fx.tickets.entries()) {
    const { result, traces } = await runTurn(flow, stores, "write", t, `req_write_${n}`);
    if (result.error !== undefined) failures.push(`e0: writing ${t.key} failed: ${result.error.message}`);
    writeTokens += traces.reduce((sum, r) => sum + (r.modelUsage?.totalTokens ?? 0), 0);
    for (const r of traces) {
      if (r.status === "failed" && r.blockKind === "evaluator") {
        classifyErrors.push(`${t.key}: ${r.error?.message ?? "evaluator failed"}`);
      }
    }
  }

  // Take the search value from what was stored, never from an expected label.
  const target = fx.tickets[0]!;
  const stored = (await stores.resourceState.get("user", USER, `tickets/${target.key}`))?.state as TicketState | undefined;
  const topic = stored?.facets?.topic.choice;
  if (topic === undefined) {
    const cause = classifyErrors.length > 0 ? ` (classification failed: ${classifyErrors.join("; ")})` : "";
    failures.push(`e1: ${target.key} has no stored facets after its write${cause}: ${JSON.stringify(stored)}`);
    return { failures, evidence: "" };
  }
  const query: FacetQuery = { topic };

  // Turn 2: the search.
  const searchFlow = control === "classify-at-query" ? classifyAtQueryFlow(flow, triage, query) : flow;
  const searchInput = control === "classify-at-query" ? { text: `tickets about ${topic}` } : query;
  const { result, traces } = await runTurn(searchFlow, stores, "search", searchInput, "req_search");
  if (result.error !== undefined) {
    failures.push(`e1: the search failed: ${result.error.message}`);
    return { failures, evidence: "" };
  }
  const keys = (result.output as { keys: string[] }).keys;
  if (!keys.includes(target.key)) {
    failures.push(`e1: searching topic=${topic} did not return ${target.key}, which stored it: ${JSON.stringify(keys)}`);
  }
  const modelRows = traces.filter((r) => r.blockKind === "evaluator" || r.blockKind === "generator");
  if (modelRows.length > 0) {
    failures.push(`e2: the search turn ran a model: ${modelRows.map((r) => `${r.blockKind}:${r.blockName}`).join(", ")}`);
  }
  const searchTokens = traces.reduce((sum, r) => sum + (r.modelUsage?.totalTokens ?? 0), 0);
  if (searchTokens !== 0) failures.push(`e2: the search turn spent ${searchTokens} tokens`);
  if (writeTokens === 0) failures.push("e0: the write turns spent no tokens, so nothing was classified on a real model");

  return {
    failures,
    evidence:
      `${modelId} classified ${fx.tickets.length} held-out tickets at write (${writeTokens} tokens); ` +
      `${target.key} stored topic=${topic}; search topic=${topic} returned ${JSON.stringify(keys)} ` +
      `with ${traces.length} trace rows, no evaluator or generator row, 0 tokens.`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await runGoal(() => checkFoundWithoutAModelCall());
}
