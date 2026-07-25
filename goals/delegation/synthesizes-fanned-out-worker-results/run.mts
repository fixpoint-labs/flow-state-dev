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
// Deep source import on purpose: `agentPurpose` is what builds the coordinator's
// live delegation roster, and it is not on the package's public export surface.
// The leak guard below must run the REAL function — a local re-implementation
// would keep passing if the roster rule changed. If this path ever moves, the
// goal fails loudly at import, which is the intended failure mode.
import { agentPurpose } from "../../../packages/orchestration/src/skills/delegation-surface.ts";
import { z } from "zod";

const MODEL = "openai/gpt-5.4-mini";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/team.json", import.meta.url), "utf8"),
) as { researcherSecret: string; auditToken: string };

/**
 * Required marker format: an unambiguous sentinel — at least 6 chars, starts
 * with a letter, alphanumeric-plus-hyphen, no leading/trailing punctuation.
 *
 * This is a VALIDATION rule, not grader logic. It fences off two ways a fixture
 * could make a correct implementation mis-grade, without adding any matcher
 * machinery: (a) punctuation-only or punctuation-edged markers collide with
 * response formatting — with `researcherSecret = "-"`, a Markdown answer's list
 * bullet reads as a bounded standalone `-`; (b) `$`-substitution sequences
 * (`$ARGUMENTS`, `$1`–`$9`, `${SKILL_DIR}`) are rewritten by the skills
 * runtime's `substitute()` before a worker prompt is invoked, erasing the marker
 * from the prompt while the grader still expects the literal. The format below
 * excludes both by construction.
 */
const MARKER_FORMAT = /^[A-Za-z][A-Za-z0-9-]*[A-Za-z0-9]$/;
const MARKER_MIN_LENGTH = 6;

function assertValidMarker(field: string, value: string): void {
  if (typeof value !== "string" || value.length < MARKER_MIN_LENGTH || !MARKER_FORMAT.test(value)) {
    throw new Error(
      `fixture invalid: ${field} ${JSON.stringify(value)} is not a valid marker. Markers must be ` +
        `at least ${MARKER_MIN_LENGTH} characters, start with a letter, contain only letters, ` +
        `digits and hyphens, and not start or end with punctuation (e.g. "QORVIX-7788"). This ` +
        `keeps a marker from colliding with response formatting or with the skills runtime's ` +
        `$-substitution.`,
    );
  }
}

assertValidMarker("researcherSecret", fx.researcherSecret);
assertValidMarker("auditToken", fx.auditToken);

const SECRET = fx.researcherSecret; // the researcher's result
const AUDIT_TOKEN = fx.auditToken; // the auditor's OWN result — NOT derived from SECRET

/**
 * The two markers must be mutually underivable, or the whole point collapses: if
 * one contained the other, a coordinator handed only the auditor's result could
 * print the researcher's marker too and pass both checks with the researcher's
 * own output dropped. Asserted at load so it cannot silently regress.
 */
{
  const a = SECRET.toLowerCase();
  const b = AUDIT_TOKEN.toLowerCase();
  if (a === b || a.includes(b) || b.includes(a)) {
    throw new Error(
      `fixture invalid: researcherSecret ${JSON.stringify(SECRET)} and auditToken ` +
        `${JSON.stringify(AUDIT_TOKEN)} overlap — neither may contain the other. They must be ` +
        `independent, or one worker's result would be derivable from the other's and the check ` +
        `would pass without both results being synthesized.`,
    );
  }
}

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

// ---------------------------------------------------------------------------
// Marker matching — EXACT and case-sensitive, so the fixture marker must survive
// verbatim (a lowercased echo is not the fixture's marker). Plain substring +
// boundary, never tokenization.
//
// There is no nesting/derivation logic here, and deliberately so: the two
// markers are asserted INDEPENDENT at load (neither contains the other), which
// is a strictly stronger guarantee than any exclusion rule the grader could
// apply after the fact. Independence is what makes each marker's presence prove
// its own worker's result was synthesized.
// ---------------------------------------------------------------------------

/** A char that would make an adjacent match part of a longer run. */
const WORDISH = /[\p{L}\p{N}_-]/u;

/** Every start index of `marker` in `text` (exact, case-sensitive). */
function occurrences(text: string, marker: string): number[] {
  const out: number[] = [];
  for (let i = text.indexOf(marker); i !== -1; i = text.indexOf(marker, i + 1)) out.push(i);
  return out;
}

/** True when the match at `at` is not glued to a longer surrounding run. */
function isBounded(text: string, at: number, marker: string): boolean {
  const before = at > 0 ? text[at - 1]! : "";
  const after = at + marker.length < text.length ? text[at + marker.length]! : "";
  return (!before || !WORDISH.test(before)) && (!after || !WORDISH.test(after));
}

/** Does `text` carry `marker` as a standalone (bounded) occurrence? */
function hasMarker(text: string, marker: string): boolean {
  return occurrences(text, marker).some((i) => isBounded(text, i, marker));
}

/**
 * The graded markers, in ONE list so the two sides of the A/B cannot drift
 * apart: the delegation-ON answer must carry EVERY marker here, and the
 * no-delegation baseline must carry NONE of them.
 *
 * The two are INDEPENDENT fixture values, not one derived from the other, so
 * each proves its own worker's result reached the answer:
 *   - SECRET       — only the researcher holds it → the researcher's result was synthesized.
 *   - AUDIT_TOKEN  — only the auditor holds it, and the auditor only ever lands
 *                    on the board when the researcher enqueues it MID-DRAIN →
 *                    the fan-out happened. The auditor running IS the fan-out proof.
 */
const GRADED_MARKERS = [
  {
    label: "researcher's secret",
    marker: SECRET,
    why: "the researcher's own result was not synthesized",
  },
  {
    label: "auditor's sign-off token (fan-out proof)",
    marker: AUDIT_TOKEN,
    why: "the auditor never ran, so the mid-drain fan-out did not happen",
  },
] as const;

// ---------------------------------------------------------------------------
// The team skill: two inline-prompt workers. The `researcher` declares
// `tools: [taskTools]`, the shorthand that hands an inline worker the
// board-scoped task tools (FIX-927) so it can enqueue follow-up work mid-drain.
//
// IMPORTANT — the FIRST NONEMPTY LINE of each prompt is copied verbatim into the
// coordinator's delegation roster by `agentPurpose()`, so the coordinator reads
// it BEFORE any task runs. Every marker must therefore live on a LATER line: a
// secret on line 1 would let a coordinator that never synthesized the worker's
// result still emit the marker straight from the roster. `assertNoRosterLeak`
// enforces this against the real `agentPurpose`.
// ---------------------------------------------------------------------------
const RESEARCHER_PROMPT = [
  "Researches the requested topic and reports its finding.", // roster line — generic
  `Your secret code is ${SECRET}.`,
  "When you receive a task, do BOTH of these, in order:",
  '1. Call addTask to create ONE follow-up task with assignee "auditor",',
  '   a short goal like "verify the code", and its input set to your',
  `   secret code ${SECRET}.`,
  `2. Then reply with exactly your secret code ${SECRET} and nothing else.`,
].join("\n");

// The auditor returns its OWN independent token — never a transform of, and
// never echoing, the researcher's secret. Its token appearing in the answer is
// the fan-out proof: the auditor only ever lands on the board when the
// researcher enqueues it mid-drain, so nothing else can put this token there.
const AUDITOR_PROMPT = [
  "Verifies a code it is handed and reports its own sign-off.", // roster line — generic
  `Your sign-off token is ${AUDIT_TOKEN}.`,
  "Your task Input contains a code to verify. Check that it is present,",
  `then reply with exactly your sign-off token ${AUDIT_TOKEN} and nothing else.`,
  "Never repeat or quote the code you were given — reply only with your own token.",
].join("\n");

/** Indent a prompt body so it nests under a YAML `prompt: |` block scalar. */
function yamlBlock(body: string, indent: string): string {
  return body
    .split("\n")
    .map((l) => `${indent}${l}`)
    .join("\n");
}

const teamSkill: InitialSkill = {
  name: "code-team",
  skillMd: [
    "---",
    "description: A two-agent team that reports secret codes.",
    "agents:",
    "  researcher:",
    "    tools: [taskTools]",
    "    prompt: |",
    yamlBlock(RESEARCHER_PROMPT, "      "),
    "  auditor:",
    "    prompt: |",
    yamlBlock(AUDITOR_PROMPT, "      "),
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
 * The coordinator's TERMINAL answer — `res.output` and nothing else.
 *
 * Deliberately has no message fallback. Inline workers default to client-visible
 * messages, so their secret-bearing outputs land in `res.items`; and the
 * coordinator's own intermediate turns (e.g. text emitted alongside a tool call)
 * land there too. Aggregating any of those would let a run where the terminal
 * output is EMPTY — nothing actually synthesized — grade as a success off an
 * earlier turn. `z.string()` permits "", so that is a reachable state, and it is
 * a genuine failure: the caller received no answer.
 */
function coordinatorOutput(res: { output?: unknown }): string {
  return typeof res.output === "string" ? res.output : "";
}

/** The roster lines the coordinator actually sees, via the real `agentPurpose`. */
function rosterLines(): { agent: string; line: string }[] {
  return [
    { agent: "researcher", line: agentPurpose({ prompt: RESEARCHER_PROMPT } as never) },
    { agent: "auditor", line: agentPurpose({ prompt: AUDITOR_PROMPT } as never) },
  ];
}

/**
 * Fail loudly if a graded marker reached the pre-task delegation roster. This is
 * what keeps the roster leak from silently regressing when a prompt is edited.
 */
function assertNoRosterLeak(): string[] {
  const failures: string[] = [];
  for (const { agent, line } of rosterLines()) {
    const lower = line.toLowerCase();
    for (const [label, marker] of [
      ["researcher secret", SECRET],
      ["auditor sign-off token", AUDIT_TOKEN],
    ] as const) {
      if (lower.includes(marker.toLowerCase())) {
        failures.push(
          `setup invalid: the ${label} "${marker}" leaked into the "${agent}" delegation ` +
            `roster line the coordinator sees BEFORE any task runs — it could emit the marker ` +
            `without ever synthesizing the worker's result. Move it off the prompt's first ` +
            `nonempty line. Roster line: ${JSON.stringify(line)}`,
        );
      }
    }
  }
  return failures;
}

async function runGoalCheck(): Promise<string[]> {
  const failures: string[] = [];

  // Honesty guard part 1: neither marker may appear in the
  // coordinator's own prompt or the user turn. Case-folded ON PURPOSE — unlike
  // grading (which demands the fixture code verbatim), a leak guard should be
  // broad, so a lowercased echo of a marker still trips it.
  const coordinatorContext = `${COORDINATOR_PROMPT}\n${USER_TURN}`.toLowerCase();
  if (
    coordinatorContext.includes(SECRET.toLowerCase()) ||
    coordinatorContext.includes(AUDIT_TOKEN.toLowerCase())
  ) {
    return ["setup invalid: a graded marker leaked into the coordinator's own context"];
  }

  // Honesty guard part 2 — the ROSTER leak. `agentPurpose()` copies each
  // worker's first nonempty prompt line into the delegation roster the
  // coordinator reads BEFORE any task runs. If a marker appears there, a
  // coordinator that never synthesized the worker's result could still emit it
  // from the roster and satisfy both graded checks. The A/B baseline cannot
  // catch this (no team binding → no roster), so this guard is the only thing
  // standing between that leak and a silent false pass. Runs the REAL
  // agentPurpose, so a change to the roster rule fails here loudly.
  const rosterLeak = assertNoRosterLeak();
  if (rosterLeak.length > 0) return rosterLeak;

  // --- Delegation ON ---
  const on = await run("withTeam", "deleg-on");
  if (on.error) return [`delegation-ON run failed: ${on.error.message}`];
  const onOutput = coordinatorOutput(on);

  // An empty terminal output is a real failure, not a grading technicality: the
  // caller got no answer, so nothing was synthesized — regardless of what the
  // coordinator may have said in an earlier turn or what the workers emitted.
  if (onOutput.trim() === "") {
    return [
      `coordinator's TERMINAL output is empty — nothing was synthesized for the caller. ` +
        `(Worker messages and the coordinator's intermediate turns are deliberately not ` +
        `graded, so an earlier turn carrying the codes cannot rescue this.)`,
    ];
  }

  // The delegation-ON answer must carry EVERY graded marker. The two are
  // independent, so neither can be derived from the other: the secret proves the
  // researcher's result was synthesized, and the auditor's token proves the
  // auditor ran — which it only does when the researcher enqueues it mid-drain.
  for (const { label, marker, why } of GRADED_MARKERS) {
    if (!hasMarker(onOutput, marker)) {
      failures.push(
        `coordinator's terminal answer has no ${label} "${marker}" — ${why}. ` +
          `Output: ${JSON.stringify(onOutput.slice(0, 400))}`,
      );
    }
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

  // The baseline — identical prompt + user turn, NO team — must produce NONE of
  // the graded markers. Same GRADED_MARKERS list the ON side accepts, so the two
  // can't drift.
  //
  // Deliberately a PLAIN SUBSTRING check, not `hasMarker`: boundaries and
  // nesting must NOT matter here. Any appearance at all is disqualifying,
  // because it means the marker was reachable WITHOUT delegation — an embedded
  // `prefixQORVIX-7788suffix` in a no-team answer proves the secret was
  // available to the bare model just as surely as a clean one, and the
  // bounded/standalone logic would wrongly wave it through as "clean".
  for (const { marker } of GRADED_MARKERS) {
    if (offOutput.includes(marker)) {
      failures.push(
        `ANTI-GAME VIOLATED: the no-delegation baseline produced the graded marker ` +
          `"${marker}" despite having no workers — the delegation-ON pass cannot be ` +
          `attributed to delegation. Baseline output: ${JSON.stringify(offOutput.slice(0, 400))}`,
      );
    }
  }

  console.log(
    `pre-task roster the coordinator sees (must carry NO marker):\n    ` +
      rosterLines()
        .map(({ agent, line }) => `- ${agent}: ${line}`)
        .join("\n    ") +
      `\n` +
      `delegation ON terminal output:  ${JSON.stringify(onOutput.slice(0, 300))}\n` +
      GRADED_MARKERS.map(
        ({ label, marker }) =>
          `  ${label} "${marker}" present: ${hasMarker(onOutput, marker)} (must be true)\n`,
      ).join("") +
      `  worker stream outputs (corroboration):\n    ${workerOutputs.join("\n    ") || "(none)"}\n` +
      `  auditor worker executed: ${ranAuditor}\n` +
      `delegation OFF terminal output: ${JSON.stringify(offOutput.slice(0, 300))}\n` +
      GRADED_MARKERS.map(
        ({ label, marker }) =>
          `  ${label} "${marker}" present anywhere: ${offOutput.includes(marker)} (must be false)\n`,
      ).join(""),
  );

  return failures;
}

const failures = await runGoalCheck();
if (failures.length === 0) {
  console.log(
    `\nPASS — the coordinator's terminal answer carried BOTH independent markers: the ` +
      `researcher's secret (its delegated result was synthesized) and the auditor's sign-off ` +
      `token (the auditor ran, which only happens when the researcher enqueues it mid-drain — ` +
      `so the fan-out happened). Neither marker is derivable from the other. The no-delegation ` +
      `baseline, given the identical prompt and request, produced neither — so the pass is ` +
      `attributable to delegation actually running.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
