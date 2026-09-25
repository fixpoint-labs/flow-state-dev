/**
 * Goal check — the evaluator epic's pieces hold together in the app a reader
 * copies (FIX-1556, epic FIX-1553).
 *
 * Real models, real path, out of CI. See goal.md for the contract.
 *
 * Legs (a), (c) and (d) drive the Routing with evaluators example through
 * `fsdev run`, on Jev through Vercel's AI Gateway and on OpenAI's evaluation
 * model. Leg (b) builds the example's classifier on a real text model and
 * expects the refusal. Legs (e) and (f) belong to sibling issues: (f) calls
 * memory's own check (`checkCapturesWithoutAnEvaluator`) on its own held-out
 * fixture; (e) is one placeholder line until index-time facets lands, and its
 * owner replaces that line the same way.
 *
 * Every failure line starts with its leg letter. The run is FAIL until every
 * leg is wired and green; this issue's bar is no `[a]` to `[d]` line.
 *
 * Nothing retries. A provider-unavailable error fails its leg as
 * `provider unavailable`, a refused credential as `blocked: credential
 * rejected`, so neither reads as a wrong answer. Re-running is a manual
 * call, and every run goes in goal.md's verdict log.
 *
 * Run: pnpm tsx goals/evaluator/holds-as-an-assembled-set/run.mts
 * Control: GOAL_CONTROL=fake-confidence (must FAIL leg c, and only leg c)
 */
import { openai } from "@ai-sdk/openai";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { classifyTicket } from "../../../examples/guides/routing-with-evaluators/src/classify.ts";
import { checkCapturesWithoutAnEvaluator } from "../../memory-evaluator-seam/captures-without-an-evaluator/check.mts";
import {
  DEFAULT_MODEL,
  ROUTING_WITH_EVALUATORS,
  fail as bail,
  goalTmpDir,
  loadFixture,
  readCapture,
  runFsdev,
  runGoal,
  stripIntentOverrides,
  type CapturedItem,
} from "../../lib/index.mts";

type Fixture = {
  classifyTicket: string;
  urgentBillingTicket: string;
  offTopicTicket: string;
  noConfidenceTickets: Array<{ id: string; message: string }>;
  skillByDescription: { message: string; expect: string };
  skillBySlash: { message: string; expect: string };
  smallTalk: string;
};
type Verdict = { level: string; on: string; edge?: string; confidence?: number; ambiguous?: string; choice?: string };
type Answer = { type?: string; choice?: string; score?: number; probability?: number; confidence?: unknown };

const fx = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL;
if (CONTROL !== undefined && CONTROL !== "fake-confidence") {
  bail(`unknown GOAL_CONTROL "${CONTROL}" (known: fake-confidence)`);
}
const CONTROL_CONFIG = fileURLToPath(new URL("./control.fsdev.config.ts", import.meta.url));
const TMP = goalTmpDir("evaluator-assembled");
const HAS_GATEWAY = Boolean(process.env.AI_GATEWAY_API_KEY);
const HAS_NO_CONFIDENCE_MODEL = HAS_GATEWAY || Boolean(process.env.OPENAI_API_KEY);

/** An error a provider returns when it can't serve the call right now. Fails the leg, named as such. */
const PROVIDER_UNAVAILABLE = /temporarily unavailable|service unavailable|\b503\b|overloaded/i;
/**
 * A credential the provider refused. The leg is blocked, never skipped. The
 * capture carries no HTTP status (the engine flattens provider errors to a
 * message), so a status is used when one is present and the providers'
 * rejected-key wording otherwise: the gateway's "authentication failed" and
 * OpenAI's "Incorrect API key provided".
 */
const CREDENTIAL_REJECTED = /\b401\b|\b403\b|unauthori[sz]ed|invalid api key|incorrect api key|authentication failed/i;

let seq = 0;

type Run = { output: unknown; items: CapturedItem[]; error?: string; status?: number };

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

/** An HTTP status on any error the run recorded (the result's or a trace row's), if one survived. */
function errorStatus(errors: unknown[]): number | undefined {
  for (const e of errors) {
    const r = e as { status?: unknown; statusCode?: unknown } | undefined;
    const n = typeof r?.statusCode === "number" ? r.statusCode : typeof r?.status === "number" ? r.status : undefined;
    if (n !== undefined) return n;
  }
  return undefined;
}

/** One `fsdev run` of the example. Never retried. */
function drive(leg: string, action: string, message: string, config?: string): Run {
  const capture = join(TMP, `${leg}-${++seq}.json`);
  const exit = runFsdev({
    app: ROUTING_WITH_EVALUATORS,
    flow: "routing-with-evaluators",
    action,
    input: { message },
    capture,
    quiet: true,
    silent: true,
    ...(config === undefined ? {} : { config }),
  });
  if (!existsSync(capture)) return { output: undefined, items: [], error: `fsdev exited ${exit} and wrote no capture` };
  const parsed = readCapture(capture);
  if (parsed.result.success !== false) return { output: parsed.result.output, items: parsed.items };
  const status = errorStatus([parsed.result.error, ...parsed.items.map((i) => i.error)]);
  return {
    output: parsed.result.output,
    items: parsed.items,
    error: errorText(parsed.result.error),
    ...(status === undefined ? {} : { status }),
  };
}

/** The block_trace rows of a run, with inline outputs unwrapped. */
function rows(run: Run) {
  return run.items
    .filter((i) => i.type === "block_trace")
    .map((i) => ({
      name: String(i.blockName),
      kind: String(i.blockKind),
      output: (i.output as { kind?: string; value?: unknown } | undefined)?.kind === "inline"
        ? (i.output as { value: unknown }).value
        : undefined,
      model: (i.model as { actual?: string } | undefined)?.actual,
    }));
}

const verdictsOf = (run: Run): Verdict[] =>
  rows(run)
    .filter((r) => r.name.endsWith("/gate"))
    .map((r) => (r.output as { verdict: Verdict }).verdict);

const answersOf = (run: Run, block: string) =>
  (rows(run).find((r) => r.kind === "evaluator" && r.name === block)?.output as { answers?: Record<string, Answer> } | undefined)
    ?.answers;

const inUnit = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);
  /**
   * Report a run that errored, naming the cause: a refused credential is
   * blocked, a provider that couldn't serve the call is unavailable, anything
   * else failed. None of them is retried.
   */
  const errored = (leg: string, what: string, run: Run): boolean => {
    if (run.error === undefined) return false;
    const rejected = run.status === 401 || run.status === 403 || CREDENTIAL_REJECTED.test(run.error);
    const unavailable = run.status === 503 || PROVIDER_UNAVAILABLE.test(run.error);
    const cause = rejected ? "blocked: credential rejected" : unavailable ? "provider unavailable" : "failed";
    fail(leg, `${cause} — ${what}: ${run.error}`);
    return true;
  };

  // ---- (a) classify on Jev: typed answers, confidence only where Jev gave it ----
  if (!HAS_GATEWAY) {
    fail("a", "blocked: AI_GATEWAY_API_KEY is not set, so Jev can't be reached");
  } else {
    const run = drive("a", "classify", fx.classifyTicket);
    if (!errored("a", "classify", run)) {
      const answers = (run.output as { answers?: Record<string, Answer> } | undefined)?.answers ?? {};
      if (answers.team?.type !== "choice" || !["billing", "technical"].includes(String(answers.team.choice))) {
        fail("a", `team is not a choice among billing/technical: ${JSON.stringify(answers.team)}`);
      }
      for (const id of ["team", "frustration"]) {
        if (!inUnit(answers[id]?.confidence)) fail("a", `${id} carries no reported confidence: ${JSON.stringify(answers[id])}`);
      }
      if (!inUnit(answers.urgent?.probability) || (answers.urgent !== undefined && "confidence" in answers.urgent)) {
        fail("a", `urgent must have a probability and no confidence: ${JSON.stringify(answers.urgent)}`);
      }
      const row = rows(run).find((r) => r.name === "classify-ticket");
      if (row?.kind !== "evaluator" || row.model !== "typesafe-ai/jev") {
        fail("a", `the trace row does not show Jev answering: ${JSON.stringify(row && { kind: row.kind, model: row.model })}`);
      }
      evidence.push(
        `(a) classify on Jev: team=${String(answers.team?.choice)} (${String(answers.team?.confidence)}), ` +
          `frustration=${String(answers.frustration?.score)} (${String(answers.frustration?.confidence)}), ` +
          `urgent P=${String(answers.urgent?.probability)} with no confidence`,
      );
    }
  }

  // ---- (b) the example's classifier refuses a model that can only generate ----
  {
    let requests = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
      requests += 1;
      return realFetch(...args);
    }) as typeof fetch;
    let refusal = "";
    try {
      classifyTicket(openai("gpt-5.4-mini") as never);
    } catch (err) {
      refusal = err instanceof Error ? err.message : String(err);
    } finally {
      globalThis.fetch = realFetch;
    }
    if (!/^Evaluator "classify-ticket": the model can generate but not evaluate\./.test(refusal) || !/evaluationModel\(/.test(refusal)) {
      fail("b", `openai("gpt-5.4-mini") was not refused with the shipped error: ${JSON.stringify(refusal)}`);
    }
    if (requests !== 0) fail("b", `${requests} request(s) left the process for a refused model`);
    evidence.push(`(b) openai("gpt-5.4-mini") refused at build, ${requests} requests`);
  }

  // ---- (c) the same tree routes on Jev and hands everything to review without confidence ----
  if (!HAS_GATEWAY) {
    fail("c", "blocked: AI_GATEWAY_API_KEY is not set, so Jev can't be reached");
  } else {
    const urgent = drive("c", "route", fx.urgentBillingTicket);
    if (!errored("c", "route on an urgent billing ticket", urgent)) {
      const verdicts = verdictsOf(urgent);
      if ((urgent.output as { queue?: string } | undefined)?.queue !== "billing-urgent") {
        fail("c", `an urgent billing ticket did not reach billing-urgent: ${JSON.stringify({ output: urgent.output, verdicts })}`);
      }
      if (verdicts.map((v) => v.edge).join(">") !== "billing>urgent" || !verdicts.every((v) => inUnit(v.confidence))) {
        fail("c", `expected edges billing>urgent, each on Jev's confidence: ${JSON.stringify(verdicts)}`);
      }
      evidence.push(`(c) route on Jev: ${verdicts.map((v) => `${v.edge ?? v.ambiguous}(${String(v.confidence ?? "-")})`).join(" > ")} > ${JSON.stringify(urgent.output)}`);
    }
    const offTopic = drive("c", "route", fx.offTopicTicket);
    if (!errored("c", "route on an off-topic ticket", offTopic)) {
      const verdicts = verdictsOf(offTopic);
      const last = verdicts.at(-1);
      if ((offTopic.output as { queue?: string } | undefined)?.queue !== "review" || last?.ambiguous === undefined || last.ambiguous === "no-confidence") {
        fail("c", `an off-topic ticket on Jev did not land on review for a low or missing branch: ${JSON.stringify({ output: offTopic.output, verdicts })}`);
      }
      evidence.push(`off-topic → ${JSON.stringify(offTopic.output)} (${last?.ambiguous ?? "?"}, chose ${last?.choice ?? "?"})`);
    }
  }
  if (!HAS_NO_CONFIDENCE_MODEL) {
    fail("c", "blocked: neither OPENAI_API_KEY nor AI_GATEWAY_API_KEY is set, so the no-confidence model can't be reached");
  } else {
    const routed: string[] = [];
    for (const ticket of fx.noConfidenceTickets) {
      const run = drive("c", "routeWithoutConfidence", ticket.message, CONTROL === "fake-confidence" ? CONTROL_CONFIG : undefined);
      if (errored("c", `routeWithoutConfidence on ${ticket.id}`, run)) continue;
      const verdicts = verdictsOf(run);
      if ((run.output as { queue?: string } | undefined)?.queue !== "review") {
        fail("c", `${ticket.id} on a model with no confidence did not land on review: ${JSON.stringify({ output: run.output, verdicts })}`);
      }
      if (verdicts.length !== 1 || verdicts[0]!.level !== "root" || verdicts[0]!.ambiguous !== "no-confidence") {
        fail("c", `${ticket.id} expected one verdict, no-confidence at root: ${JSON.stringify(verdicts)}`);
      }
      const team = answersOf(run, "department")?.team;
      if (team === undefined || "confidence" in team) {
        fail("c", `${ticket.id}: the department answer should be there with no confidence: ${JSON.stringify(team)}`);
      }
      routed.push(`${ticket.id} chose ${String(team?.choice)} → ${JSON.stringify(run.output)}`);
    }
    evidence.push(`routeWithoutConfidence${CONTROL ? ` [${CONTROL}]` : ""}: ${routed.join("; ")}`);
  }

  // ---- (d) the activator: slash first, the evaluator's pick is final, and none built without one ----
  if (!HAS_GATEWAY) {
    fail("d", "blocked: AI_GATEWAY_API_KEY is not set, so Jev can't be reached");
  } else {
    const activated = (run: Run) =>
      ((run.output as { activeSkills?: Array<{ name: string; source?: string }> } | undefined)?.activeSkills ?? []);
    const asked = (run: Run) => rows(run).some((r) => r.kind === "evaluator");

    const described = drive("d", "activate", fx.skillByDescription.message);
    if (!errored("d", "activate by description", described)) {
      const got = activated(described);
      if (got.length !== 1 || got[0]!.name !== fx.skillByDescription.expect || got[0]!.source !== "classifier") {
        fail("d", `a message that matches ${fx.skillByDescription.expect} by description activated ${JSON.stringify(got)}`);
      }
      if (!asked(described)) fail("d", "no evaluator row: tier 3 never ran on the description message");
      evidence.push(`(d) description → ${JSON.stringify(got)}`);
    }
    const slash = drive("d", "activate", fx.skillBySlash.message);
    if (!errored("d", "activate by slash", slash)) {
      const got = activated(slash);
      if (got.length !== 1 || got[0]!.name !== fx.skillBySlash.expect || got[0]!.source !== "slash") {
        fail("d", `a slash command activated ${JSON.stringify(got)}, expected ${fx.skillBySlash.expect} by slash`);
      }
      if (asked(slash)) fail("d", "the evaluator was asked although a slash command matched");
      evidence.push(`slash → ${JSON.stringify(got)}, evaluator not asked`);
    }
    const chat = drive("d", "activate", fx.smallTalk);
    if (!errored("d", "activate on small talk", chat)) {
      const got = activated(chat);
      if (got.length !== 0) fail("d", `small talk activated ${JSON.stringify(got)}, expected nothing`);
      if (!asked(chat)) fail("d", "no evaluator row: tier 3 never ran on small talk");
      evidence.push(`small talk → nothing (answered ${String(answersOf(chat, "skill-evaluator")?.skill?.choice)})`);
    }
  }
  // Without an evaluator: no evaluator built or resolved. Spied at the builders
  // and at model resolution, which only a test runner can do.
  try {
    execFileSync("pnpm", ["exec", "vitest", "run", "test/activate-without-evaluator.test.ts"], {
      cwd: ROUTING_WITH_EVALUATORS,
      stdio: "pipe",
    });
    evidence.push("no evaluator → none built, none resolved");
  } catch (err) {
    const out = `${String((err as { stdout?: unknown }).stdout ?? "")}${String((err as { stderr?: unknown }).stderr ?? "")}`;
    fail("d", `the activator without an evaluator built or resolved one: ${out.split("\n").filter((l) => /×|Error/.test(l)).join(" | ")}`);
  }

  // ---- (e) index-time facets ----
  fail("e", "not yet wired — owned by FIX-1557");

  // ---- (f) memory captures with no evaluator installed (FIX-1555's check, its fixture) ----
  if (!HAS_NO_CONFIDENCE_MODEL) {
    fail("f", "blocked: neither AI_GATEWAY_API_KEY nor OPENAI_API_KEY is set, so the observer model can't be reached");
  } else {
    // Memory's resolver declares no intents, and ambient intent pins make it
    // throw. Every fsdev run above has finished, so stripping here changes none of them.
    stripIntentOverrides();
    const memory = loadFixture<{ turn: string }>(
      new URL("../../memory-evaluator-seam/captures-without-an-evaluator/run.mts", import.meta.url).href,
    );
    const cause = (text: string, otherwise: string) =>
      CREDENTIAL_REJECTED.test(text) ? "blocked: credential rejected" : PROVIDER_UNAVAILABLE.test(text) ? "provider unavailable" : otherwise;
    try {
      const leg = await checkCapturesWithoutAnEvaluator({ turn: memory.turn, model: DEFAULT_MODEL });
      for (const line of leg.failures) fail("f", `${cause(line, "failed")} — ${line}`);
      if (leg.failures.length === 0) evidence.push(`(f) ${leg.evidence}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      fail("f", `${cause(message, "failed")} — memory check threw: ${message}`);
    }
  }

  if (failures.length > 0) console.log(`Evidence: ${evidence.join("; ")}`);
  return { failures, evidence: evidence.join("; ") };
});
