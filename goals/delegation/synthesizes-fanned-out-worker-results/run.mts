/**
 * Goal check — the shipped delegation substrate (FIX-918/920/927/928) works
 * end-to-end on a real model: a coordinator generator delegates a task to a
 * declared worker via addTask + runBoard, that worker fans out follow-up work
 * mid-drain to a second worker, and both workers' results come back and get
 * synthesized into the coordinator's final answer.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * What makes this a goal check, not a dressed-up unit test:
 *   - It drives the REAL delegation surface: a coordinator generator bound to a
 *     skill that declares an `agents:` roster gets the eight taskTools + runBoard,
 *     and the board drains real worker generators under a real model.
 *   - The two workers hold HELD-OUT secrets pulled from the fixture. The
 *     `researcher` knows `researcherSecret`; the `auditor` knows only how to
 *     append `auditSuffix` to whatever code it is HANDED. Neither secret nor the
 *     suffix appears anywhere in the coordinator's own prompt or the user turn.
 *   - The A/B anti-game contrast: the SAME coordinator prompt + SAME user turn is
 *     run twice — once bound to the team (delegation ON), once bound to nothing
 *     (delegation OFF / baseline). The ON answer must carry the workers' secrets;
 *     the OFF answer, given the identical everything, cannot — the secrets live
 *     only inside the workers. That the baseline cannot produce them is what
 *     proves the ON pass came from delegation actually running, not leakage,
 *     hallucination, or the harness feeding the answer.
 *   - The fan-out proof is `researcherSecret + auditSuffix`. The coordinator is
 *     told to assign ONE task (to `researcher`) and call runBoard ONCE. The
 *     auditor's transformed code can only appear if the researcher enqueued the
 *     auditor mid-drain AND handed it its secret — the researcher is the ONLY
 *     holder of the secret, and the coordinator never learns the suffix, so
 *     `secret+suffix` is unforgeable by anyone but the fanned-out auditor.
 *
 * Run: pnpm tsx goals/delegation/synthesizes-fanned-out-worker-results/run.mts
 */
import { readFileSync } from "node:fs";
import { defineFlow, generator } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import {
  runAction,
  createInMemoryStores,
  createModelResolver,
} from "@flow-state-dev/engine";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
import type { SkillsBindingConfig } from "@flow-state-dev/orchestration";
import { z } from "zod";

const MODEL = "openai/gpt-5.4-mini";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/team.json", import.meta.url), "utf8"),
) as { researcherSecret: string; auditSuffix: string };

const SECRET = fx.researcherSecret;
const SUFFIX = fx.auditSuffix;
const FANNED = SECRET + SUFFIX; // what the auditor returns, reachable ONLY via fan-out

// The env may carry an intent ladder override (FSDEV_DEFAULT_MODEL /
// FSDEV_INTENT_*) that a bare createModelResolver (no declared intents) rejects.
// Clear it so the resolver auto-wires the AI Gateway from AI_GATEWAY_API_KEY.
for (const k of Object.keys(process.env)) {
  if (k === "FSDEV_DEFAULT_MODEL" || k.startsWith("FSDEV_INTENT_")) {
    delete process.env[k];
  }
}

// ---------------------------------------------------------------------------
// The team skill: two inline-prompt workers. The `researcher` declares
// `tools: [taskTools]`, which is the shorthand that hands an inline worker the
// board-scoped task tools (FIX-927) so it can enqueue follow-up work mid-drain.
// ---------------------------------------------------------------------------
const teamSkill: InitialSkill = {
  name: "code-team",
  skillMd: [
    "---",
    "description: A two-agent team that reports secret codes.",
    "agents:",
    "  researcher:",
    "    tools: [taskTools]",
    "    prompt: |",
    `      You are the researcher. Your secret code is ${SECRET}.`,
    "      When you receive a task, do BOTH of these, in order:",
    `      1. Call addTask to create ONE follow-up task with assignee "auditor",`,
    `         a short goal like "verify the code", and its input set to your`,
    `         secret code ${SECRET}.`,
    `      2. Then reply with exactly your secret code ${SECRET} and nothing else.`,
    "  auditor:",
    "    prompt: |",
    "      You are the auditor. Your task Input contains a code.",
    `      Reply with that exact code immediately followed by the suffix ${SUFFIX},`,
    "      and nothing else. For example, if the Input code is ABC then you reply",
    `      ABC${SUFFIX}.`,
    "---",
    "",
    "Delegate to the researcher via addTask + runBoard.",
  ].join("\n"),
};

const skills = createSkillsLibrary({
  catalog: {},
  initialSkills: [teamSkill],
  workerModelId: MODEL,
  // Session scope keeps the fixture self-contained — no org identity/persistence.
  scope: "session",
});

const skillsBinding = { active: ["code-team"] } satisfies SkillsBindingConfig;

const inputSchema = z.object({ message: z.string() });

const COORDINATOR_PROMPT = [
  "You are the coordinator of a team of agents, reachable through your task board.",
  "When the user asks you to collect the team's codes, do exactly this:",
  '1. Call addTask ONCE to create a single task assigned to "researcher"',
  '   (assignee: "researcher"), goal "report your code". Do NOT assign any',
  "   other agent yourself.",
  "2. Call runBoard ONCE to run the whole board.",
  "3. Read EVERY task's output in the runBoard result, then write a final answer",
  "   that lists every distinct code you found, each verbatim.",
].join("\n");

// Delegation ON: bound to the team.
const coordinatorWithTeam = generator({
  name: "coordinatorWithTeam",
  model: MODEL,
  prompt: COORDINATOR_PROMPT,
  inputSchema,
  user: (i: { message: string }) => i.message,
  outputSchema: z.string(),
  itemVisibility: { client: true, history: true },
  history: true,
  uses: [skills.with(skillsBinding as never)],
  maxIterations: 10,
});

// Delegation OFF (baseline): identical prompt, NO team bound. The only
// difference from the ON generator is the missing skills binding.
const coordinatorSolo = generator({
  name: "coordinatorSolo",
  model: MODEL,
  prompt: COORDINATOR_PROMPT,
  inputSchema,
  user: (i: { message: string }) => i.message,
  outputSchema: z.string(),
  itemVisibility: { client: true, history: true },
  history: true,
  maxIterations: 10,
});

const flow = defineFlow({
  kind: "delegation-e2e-goal",
  requireUser: true,
  actions: {
    withTeam: { inputSchema, block: coordinatorWithTeam, userMessage: (i: { message: string }) => i.message },
    solo: { inputSchema, block: coordinatorSolo, userMessage: (i: { message: string }) => i.message },
  },
})({ id: "default" });

const stores = createInMemoryStores();
const runtimeConfig = { modelResolver: createModelResolver() } as never;

async function run(actionName: "withTeam" | "solo", sessionId: string) {
  return runAction({
    flow,
    actionName: actionName as never,
    input: { message: "Collect the codes from your team and report all of them." },
    userId: "goal-user",
    sessionId,
    stores,
    runtimeConfig,
  });
}

/** Assemble the user-visible answer: terminal output + any assistant messages. */
function answerOf(res: {
  output?: unknown;
  items: { type: string; role?: string; content?: unknown; text?: unknown }[];
}): string {
  return [
    typeof res.output === "string" ? res.output : JSON.stringify(res.output ?? ""),
    ...res.items
      .filter((i) => i.type === "message" && i.role === "assistant")
      .map((i) => String(i.content ?? i.text ?? "")),
  ].join("\n");
}

async function runGoalCheck(): Promise<string[]> {
  const failures: string[] = [];

  // Honesty guard: neither secret nor suffix may appear in the coordinator's own
  // prompt or the user turn, or "the answer carried them" would prove nothing.
  const coordinatorContext = (COORDINATOR_PROMPT + "\nCollect the codes from your team and report all of them.").toLowerCase();
  if (coordinatorContext.includes(SECRET.toLowerCase()) || coordinatorContext.includes(SUFFIX.toLowerCase())) {
    return ["setup invalid: a secret/suffix leaked into the coordinator's own context"];
  }

  // --- Delegation ON ---
  const on = await run("withTeam", "deleg-on");
  if (on.error) return [`delegation-ON run failed: ${on.error.message}`];
  const onAnswer = answerOf(on);
  const onHas = (s: string) => onAnswer.toLowerCase().includes(s.toLowerCase());

  // 1. Delegation happened: the researcher's secret came back and was synthesized.
  if (!onHas(SECRET)) {
    failures.push(
      `coordinator's answer is MISSING the researcher's secret "${SECRET}" — delegation ` +
        `did not deliver the worker's result. Answer: ${JSON.stringify(onAnswer.slice(0, 400))}`,
    );
  }

  // 2. Fan-out happened: the auditor's transformed code (secret+suffix) came back.
  //    Only reachable if the researcher enqueued the auditor mid-drain AND handed
  //    it the secret — the coordinator never learns the suffix.
  if (!onHas(FANNED)) {
    failures.push(
      `coordinator's answer is MISSING the fanned-out auditor code "${FANNED}" — the ` +
        `mid-drain fan-out (researcher enqueues auditor, hands it the secret) did not ` +
        `complete. Answer: ${JSON.stringify(onAnswer.slice(0, 400))}`,
    );
  }

  // Corroboration (printed, not graded): the worker generators actually executed.
  const ranAuditor = on.items.some(
    (i: { agentName?: string; name?: string }) =>
      String(i.agentName ?? i.name ?? "").includes("auditor"),
  );

  // --- Delegation OFF (baseline / anti-game) ---
  const off = await run("solo", "deleg-off");
  if (off.error) return [`baseline (solo) run failed: ${off.error.message}`];
  const offAnswer = answerOf(off);
  const offHas = (s: string) => offAnswer.toLowerCase().includes(s.toLowerCase());

  // 3. The baseline — identical prompt + user turn, no team — CANNOT produce the
  //    secret. If it does, the ON pass is not trustworthy (leakage/hardcoding).
  if (offHas(SECRET)) {
    failures.push(
      `ANTI-GAME VIOLATED: the no-delegation baseline produced the secret "${SECRET}" ` +
        `despite having no workers — the delegation-ON pass cannot be attributed to ` +
        `delegation. Baseline answer: ${JSON.stringify(offAnswer.slice(0, 400))}`,
    );
  }

  console.log(
    `delegation ON answer:  ${JSON.stringify(onAnswer.slice(0, 300))}\n` +
      `  secret "${SECRET}" present: ${onHas(SECRET)}\n` +
      `  fanned-out "${FANNED}" present: ${onHas(FANNED)}\n` +
      `  auditor worker executed (corroboration): ${ranAuditor}\n` +
      `delegation OFF answer:  ${JSON.stringify(offAnswer.slice(0, 300))}\n` +
      `  secret "${SECRET}" present: ${offHas(SECRET)} (must be false)`,
  );

  return failures;
}

const failures = await runGoalCheck();
if (failures.length === 0) {
  console.log(
    `\nPASS — a coordinator delegated to a declared worker (researcher), that worker ` +
      `fanned out follow-up work mid-drain to a second worker (auditor), and both results ` +
      `were synthesized into the coordinator's answer. The no-delegation baseline, given the ` +
      `identical prompt and request, could not produce the held-out secret — so the pass is ` +
      `attributable to delegation actually running.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
