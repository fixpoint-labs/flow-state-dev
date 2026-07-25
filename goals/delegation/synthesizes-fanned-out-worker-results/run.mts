/**
 * Goal check — the shipped delegation substrate (FIX-918/920/927/928) end-to-end
 * on a real model: a coordinator delegates to a declared worker via addTask +
 * runBoard, that worker fans out follow-up work mid-drain to a second worker,
 * and both results are synthesized into the coordinator's terminal answer.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
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
const FANNED = SECRET + SUFFIX; // the auditor's output — reachable ONLY via fan-out

const USER_TURN = "Collect the codes from your team and report all of them.";

// The env may carry an intent ladder override (FSDEV_DEFAULT_MODEL /
// FSDEV_INTENT_*) that a bare createModelResolver (no declared intents) rejects.
// Clear it so the resolver auto-wires the AI Gateway from AI_GATEWAY_API_KEY.
for (const k of Object.keys(process.env)) {
  if (k === "FSDEV_DEFAULT_MODEL" || k.startsWith("FSDEV_INTENT_")) {
    delete process.env[k];
  }
}

/** Render a message item's content to text (handles structured content-part arrays). */
function messageText(item: { content?: unknown; text?: unknown }): string {
  const c = item?.content ?? item?.text ?? "";
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (typeof p === "string" ? p : ((p as { text?: string })?.text ?? "")))
      .join(" ");
  }
  return String(c);
}

/** All hyphen-joined code-like tokens in a text, as EXACT (case-normalized) tokens. */
function extractCodes(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? []);
}

// ---------------------------------------------------------------------------
// The team skill: two inline-prompt workers. The `researcher` declares
// `tools: [taskTools]`, the shorthand that hands an inline worker the
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
  "   that lists every distinct code you found, each on its own line, verbatim.",
].join("\n");

/**
 * Both coordinators are identical apart from the team binding — the A/B contract
 * REQUIRES the baseline differ ONLY by `uses`, so a single factory removes drift.
 */
function makeCoordinator(name: string, withTeam: boolean) {
  return generator({
    name,
    model: MODEL,
    prompt: COORDINATOR_PROMPT,
    inputSchema,
    user: (i: { message: string }) => i.message,
    outputSchema: z.string(),
    itemVisibility: { client: true, history: true },
    history: true,
    ...(withTeam ? { uses: [skills.with(skillsBinding as never)] } : {}),
    maxIterations: 10,
  });
}

const flow = defineFlow({
  kind: "delegation-e2e-goal",
  requireUser: true,
  actions: {
    withTeam: {
      inputSchema,
      block: makeCoordinator("coordinatorWithTeam", true),
      userMessage: (i: { message: string }) => i.message,
    },
    solo: {
      inputSchema,
      block: makeCoordinator("coordinatorSolo", false),
      userMessage: (i: { message: string }) => i.message,
    },
  },
})({ id: "default" });

const stores = createInMemoryStores();
const runtimeConfig = { modelResolver: createModelResolver() } as never;

async function run(actionName: "withTeam" | "solo", sessionId: string) {
  return runAction({
    flow,
    actionName: actionName as never,
    input: { message: USER_TURN },
    userId: "goal-user",
    sessionId,
    stores,
    runtimeConfig,
  });
}

/**
 * The coordinator's OWN terminal answer — never a worker's message. Inline
 * workers default to client-visible messages, so their secret-bearing outputs
 * land in `res.items`; grading the coordinator's terminal output alone is what
 * makes "the COORDINATOR synthesized it" checkable (not "a worker emitted it").
 */
function coordinatorOutput(res: {
  output?: unknown;
  items: { type: string; role?: string; agentName?: string; content?: unknown; text?: unknown }[];
}): string {
  if (typeof res.output === "string" && res.output.length > 0) return res.output;
  // Fallback only if the terminal output is empty: the coordinator's own final
  // assistant message (worker messages carry an agentName prefixed "skill-").
  return res.items
    .filter(
      (i) =>
        i.type === "message" &&
        i.role === "assistant" &&
        !String(i.agentName ?? "").startsWith("skill-"),
    )
    .map(messageText)
    .join("\n");
}

async function runGoalCheck(): Promise<string[]> {
  const failures: string[] = [];

  // Honesty guard: neither secret nor suffix may appear in the coordinator's own
  // prompt or the user turn, or "the answer carried them" would prove nothing.
  const coordinatorContext = `${COORDINATOR_PROMPT}\n${USER_TURN}`.toLowerCase();
  if (
    coordinatorContext.includes(SECRET.toLowerCase()) ||
    coordinatorContext.includes(SUFFIX.toLowerCase())
  ) {
    return ["setup invalid: a secret/suffix leaked into the coordinator's own context"];
  }

  // --- Delegation ON ---
  const on = await run("withTeam", "deleg-on");
  if (on.error) return [`delegation-ON run failed: ${on.error.message}`];
  const onOutput = coordinatorOutput(on);
  const onCodes = extractCodes(onOutput);

  // 1. Delegation happened: the researcher's STANDALONE secret was synthesized
  //    into the coordinator's answer. It must be a distinct token — not merely a
  //    substring of FANNED — or a coordinator that dropped the researcher's own
  //    output and reported only the auditor's would falsely pass.
  if (!onCodes.has(SECRET.toLowerCase())) {
    failures.push(
      `coordinator's terminal answer has no STANDALONE researcher code "${SECRET}" — the ` +
        `researcher's own result was not synthesized. Output: ${JSON.stringify(onOutput.slice(0, 400))}`,
    );
  }

  // 2. Fan-out happened: the auditor's transformed code (secret+suffix). Only
  //    reachable if the researcher enqueued the auditor mid-drain AND handed it
  //    the secret — the coordinator never learns the suffix.
  if (!onCodes.has(FANNED.toLowerCase())) {
    failures.push(
      `coordinator's terminal answer has no fanned-out auditor code "${FANNED}" — the ` +
        `mid-drain fan-out did not reach the answer. Output: ${JSON.stringify(onOutput.slice(0, 400))}`,
    );
  }

  // Corroboration (printed, not graded): the worker generators actually executed,
  // and their distinct outputs are visible in the stream (rendered via messageText).
  const workerOutputs = on.items
    .filter(
      (i: { type: string; role?: string; agentName?: string }) =>
        i.type === "message" &&
        i.role === "assistant" &&
        String(i.agentName ?? "").startsWith("skill-code-team"),
    )
    .map(
      (i) =>
        `${(i as { agentName?: string }).agentName}: ${messageText(i as { content?: unknown }).slice(0, 80)}`,
    );
  const ranAuditor = on.items.some((i: { agentName?: string }) =>
    String(i.agentName ?? "").includes("auditor"),
  );

  // --- Delegation OFF (baseline / anti-game) ---
  const off = await run("solo", "deleg-off");
  if (off.error) return [`baseline (solo) run failed: ${off.error.message}`];
  const offOutput = coordinatorOutput(off);
  const offCodes = extractCodes(offOutput);

  // 3. The baseline — identical prompt + user turn, NO team — CANNOT produce the
  //    secret. If it does, the ON pass is not trustworthy (leakage/hardcoding).
  if (offCodes.has(SECRET.toLowerCase())) {
    failures.push(
      `ANTI-GAME VIOLATED: the no-delegation baseline produced the secret "${SECRET}" ` +
        `despite having no workers — the delegation-ON pass cannot be attributed to ` +
        `delegation. Baseline output: ${JSON.stringify(offOutput.slice(0, 400))}`,
    );
  }

  console.log(
    `delegation ON terminal output:  ${JSON.stringify(onOutput.slice(0, 300))}\n` +
      `  standalone secret "${SECRET}" present: ${onCodes.has(SECRET.toLowerCase())}\n` +
      `  fanned-out "${FANNED}" present:        ${onCodes.has(FANNED.toLowerCase())}\n` +
      `  worker stream outputs (corroboration):\n    ${workerOutputs.join("\n    ") || "(none)"}\n` +
      `  auditor worker executed: ${ranAuditor}\n` +
      `delegation OFF terminal output: ${JSON.stringify(offOutput.slice(0, 300))}\n` +
      `  secret "${SECRET}" present: ${offCodes.has(SECRET.toLowerCase())} (must be false)`,
  );

  return failures;
}

const failures = await runGoalCheck();
if (failures.length === 0) {
  console.log(
    `\nPASS — the coordinator's terminal answer carried BOTH the researcher's standalone secret ` +
      `and the auditor's fanned-out code, so it synthesized a delegated result and a mid-drain ` +
      `fan-out. The no-delegation baseline, given the identical prompt and request, could not ` +
      `produce the held-out secret — so the pass is attributable to delegation actually running.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
