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

// ---------------------------------------------------------------------------
// Marker matching — EXACT and case-sensitive, so the fixture code must survive
// verbatim (a lowercased echo is not the fixture's code). Matching is plain
// substring + boundary, never tokenization, so the goal.md contract "swap them
// for any other two distinct strings" genuinely holds: a fixture containing
// underscores, spaces, punctuation, or non-ASCII grades the same way.
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

/**
 * Does `text` carry `marker` on its own — as a bounded occurrence that is not
 * merely part of one of the `longer` graded markers that contain it? Passing
 * `longer` is what makes "standalone SECRET" distinct from "SECRET inside
 * FANNED", for any fixture strings (not just hyphenated ASCII ones).
 */
function hasMarker(text: string, marker: string, longer: readonly string[] = []): boolean {
  return occurrences(text, marker).some(
    (i) =>
      isBounded(text, i, marker) &&
      !longer.some((l) => {
        const offset = l.indexOf(marker);
        return offset !== -1 && text.startsWith(l, i - offset);
      }),
  );
}

/**
 * The graded markers, in ONE list so the two sides of the A/B cannot drift
 * apart: the delegation-ON answer must carry EVERY marker here, and the
 * no-delegation baseline must carry NONE of them. (A baseline that emits the
 * fanned code is just as disqualifying as one that emits the bare secret —
 * either means the marker was reachable without delegation.)
 */
const GRADED_MARKERS = [
  {
    label: "researcher's standalone secret",
    marker: SECRET,
    // SECRET is a prefix of FANNED, so an occurrence inside FANNED does not
    // count as the researcher's own distinct result.
    notPartOf: [FANNED] as const,
    why: "the researcher's own result was not synthesized",
  },
  {
    label: "fanned-out auditor code",
    marker: FANNED,
    notPartOf: [] as const,
    why: "the mid-drain fan-out did not reach the answer",
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

const AUDITOR_PROMPT = [
  "Verifies a code it is handed and returns the verified form.", // roster line — generic
  "Your task Input contains a code.",
  `Reply with that exact code immediately followed by the suffix ${SUFFIX},`,
  "and nothing else. For example, if the Input code is ABC then you reply",
  `ABC${SUFFIX}.`,
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
      ["audit suffix", SUFFIX],
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

  // Fixture sanity: the two held-out strings must be non-empty and distinct, or
  // the standalone-vs-fanned distinction collapses. Any other pair is fair game
  // (the matcher is exact + boundary-based, not tokenized).
  if (!SECRET || !SUFFIX || SECRET === SUFFIX) {
    return [
      `fixture invalid: researcherSecret and auditSuffix must be non-empty and distinct ` +
        `(got ${JSON.stringify(SECRET)} / ${JSON.stringify(SUFFIX)})`,
    ];
  }

  // Honesty guard part 1: neither secret nor suffix may appear in the
  // coordinator's own prompt or the user turn. Case-folded ON PURPOSE — unlike
  // grading (which demands the fixture code verbatim), a leak guard should be
  // broad, so a lowercased echo of a marker still trips it.
  const coordinatorContext = `${COORDINATOR_PROMPT}\n${USER_TURN}`.toLowerCase();
  if (
    coordinatorContext.includes(SECRET.toLowerCase()) ||
    coordinatorContext.includes(SUFFIX.toLowerCase())
  ) {
    return ["setup invalid: a secret/suffix leaked into the coordinator's own context"];
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

  // The delegation-ON answer must carry EVERY graded marker: the researcher's
  // standalone secret (proving its own result was synthesized, not just echoed
  // inside the auditor's longer code) and the auditor's fanned-out code
  // (reachable only if the researcher enqueued it mid-drain and handed it the
  // secret — the coordinator never learns the suffix).
  for (const { label, marker, notPartOf, why } of GRADED_MARKERS) {
    if (!hasMarker(onOutput, marker, notPartOf)) {
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
  // the graded markers. Checked over the same GRADED_MARKERS list the ON side
  // accepts, so the two can't drift: a baseline that emits the FANNED code is
  // just as disqualifying as one that emits the bare secret, since either means
  // the marker was reachable without delegation. Note the baseline check does
  // NOT apply `notPartOf` — here ANY appearance is disqualifying, including one
  // nested inside a longer marker.
  for (const { marker } of GRADED_MARKERS) {
    if (hasMarker(offOutput, marker)) {
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
        ({ label, marker, notPartOf }) =>
          `  ${label} "${marker}" present: ${hasMarker(onOutput, marker, notPartOf)} (must be true)\n`,
      ).join("") +
      `  worker stream outputs (corroboration):\n    ${workerOutputs.join("\n    ") || "(none)"}\n` +
      `  auditor worker executed: ${ranAuditor}\n` +
      `delegation OFF terminal output: ${JSON.stringify(offOutput.slice(0, 300))}\n` +
      GRADED_MARKERS.map(
        ({ label, marker }) =>
          `  ${label} "${marker}" present: ${hasMarker(offOutput, marker)} (must be false)\n`,
      ).join(""),
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
