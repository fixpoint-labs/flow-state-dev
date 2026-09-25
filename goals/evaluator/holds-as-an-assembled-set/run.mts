/**
 * Goal check — the evaluator epic's pieces hold together in the app a reader
 * copies (FIX-1556, epic FIX-1553).
 *
 * Real models, real path, out of CI. See goal.md for the contract.
 *
 * Legs (a), (c) and (d) drive the Routing with evaluators example through
 * `fsdev run`, on Jev through Vercel's AI Gateway and on OpenAI's evaluation
 * model. Leg (b) builds the example's classifier on a real text model and
 * expects the refusal. Legs (e) and (f) belong to sibling issues: each is one
 * placeholder line below, and its owner replaces that line with the leg's
 * assertions. Nothing else in this file has to change when they do.
 *
 * Every failure line starts with its leg letter. The run is FAIL until every
 * leg is wired and green; this issue's bar is no `[a]` to `[d]` line.
 *
 * Retries: only a provider-unavailable error on a model call is retried, up
 * to `goalAttempts()` times, and each retry is printed and counted in the
 * evidence. A wrong answer is never retried.
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
import {
  ROUTING_WITH_EVALUATORS,
  fail as bail,
  goalAttempts,
  goalTmpDir,
  loadFixture,
  readCapture,
  runFsdev,
  runGoal,
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
const ATTEMPTS = goalAttempts(3);
const HAS_GATEWAY = Boolean(process.env.AI_GATEWAY_API_KEY);
const HAS_NO_CONFIDENCE_MODEL = HAS_GATEWAY || Boolean(process.env.OPENAI_API_KEY);

/** An error a provider returns when it can't serve the call right now. Retried. */
const PROVIDER_UNAVAILABLE = /temporarily unavailable|service unavailable|\b503\b|overloaded/i;
/** A credential the provider refused. The leg is blocked, never skipped. */
const CREDENTIAL_REJECTED = /\b401\b|\b403\b|unauthori[sz]ed|invalid api key|authentication/i;

const retries: string[] = [];
let seq = 0;

type Run = { output: unknown; items: CapturedItem[]; error?: string };

function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" ? message : JSON.stringify(error);
}

/** One `fsdev run` of the example, retried only on a provider-unavailable error. */
function drive(leg: string, action: string, message: string, config?: string): Run {
  for (let attempt = 1; ; attempt++) {
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
    const run: Run = existsSync(capture)
      ? (() => {
          const parsed = readCapture(capture);
          return {
            output: parsed.result.output,
            items: parsed.items,
            ...(parsed.result.success === false ? { error: errorText(parsed.result.error) } : {}),
          };
        })()
      : { output: undefined, items: [], error: `fsdev exited ${exit} and wrote no capture` };
    if (run.error !== undefined && PROVIDER_UNAVAILABLE.test(run.error) && attempt < ATTEMPTS) {
      const line = `${leg} ${action} attempt ${attempt}/${ATTEMPTS}: ${run.error}`;
      retries.push(line);
      console.log(`[retry] ${line}`);
      continue;
    }
    return run;
  }
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
  /** Report a run that errored: blocked on a refused credential, failed otherwise. */
  const errored = (leg: string, what: string, run: Run): boolean => {
    if (run.error === undefined) return false;
    fail(leg, `${CREDENTIAL_REJECTED.test(run.error) ? "blocked: credential rejected" : "failed"}: ${what}: ${run.error}`);
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

  // ---- (f) memory ----
  fail("f", "not yet wired — owned by FIX-1555");

  if (retries.length > 0) evidence.push(`${retries.length} provider-unavailable retr${retries.length === 1 ? "y" : "ies"}: ${retries.join("; ")}`);
  else evidence.push("no retries");
  if (failures.length > 0) console.log(`Evidence: ${evidence.join("; ")}`);
  return { failures, evidence: evidence.join("; ") };
});
