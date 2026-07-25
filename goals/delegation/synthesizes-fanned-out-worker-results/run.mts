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
import {
  agentPurpose,
  RUN_BOARD_TOOL_NAME,
} from "../../../packages/orchestration/src/skills/delegation-surface.ts";
import { buildTaskToolsList } from "../../../packages/orchestration/src/skills/task-tools-capability.ts";
import { taskStatusSchema } from "../../../packages/orchestration/src/tasks/schema/task-status.ts";
import { z } from "zod";

const MODEL = "openai/gpt-5.4-mini";

const fx = JSON.parse(
  readFileSync(new URL("./fixtures/team.json", import.meta.url), "utf8"),
) as { researcherSecret: string; auditToken: string; handoffCode: string };

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
assertValidMarker("handoffCode", fx.handoffCode);

const SECRET = fx.researcherSecret; // the researcher's result (GRADED)
const AUDIT_TOKEN = fx.auditToken; // the auditor's OWN result (GRADED) — not derived from SECRET
/**
 * The value the researcher hands the auditor. Deliberately UNGRADED and
 * independent of both graded markers: `buildUserMessage` renders a task's input
 * verbatim into the worker's turn, so whatever the researcher passes lands in
 * the auditor's context. If that were the graded SECRET, an auditor that simply
 * echoed its input would put both graded markers in one worker's output — and
 * the check would pass with the researcher's own result dropped.
 */
const HANDOFF = fx.handoffCode;

/**
 * All three fixture values must be mutually underivable. If one contained
 * another, a single worker's output could carry more than one graded marker and
 * the check would pass without both results being synthesized. Asserted at load
 * so it cannot silently regress.
 */
for (const [aName, aVal] of [
  ["researcherSecret", SECRET],
  ["auditToken", AUDIT_TOKEN],
  ["handoffCode", HANDOFF],
] as const) {
  for (const [bName, bVal] of [
    ["researcherSecret", SECRET],
    ["auditToken", AUDIT_TOKEN],
    ["handoffCode", HANDOFF],
  ] as const) {
    if (aName === bName) continue;
    const a = aVal.toLowerCase();
    const b = bVal.toLowerCase();
    if (a === b || a.includes(b)) {
      throw new Error(
        `fixture invalid: ${aName} ${JSON.stringify(aVal)} overlaps ${bName} ` +
          `${JSON.stringify(bVal)} — the three fixture values must be mutually independent, or ` +
          `one worker's result would be derivable from another's.`,
      );
    }
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
// The researcher hands the auditor the UNGRADED handoff code — never its own
// graded secret, which therefore never enters the auditor's context at all.
const RESEARCHER_PROMPT = [
  "Researches the requested topic and reports its finding.", // roster line — generic
  `Your secret code is ${SECRET}.`,
  `The verification code you pass to the auditor is ${HANDOFF}.`,
  "When you receive a task, do BOTH of these, in order:",
  '1. Call addTask to create ONE follow-up task with assignee "auditor",',
  '   a short goal like "verify the code", and its input set to the',
  `   verification code ${HANDOFF}. Never send your secret code to anyone.`,
  `2. Then reply with exactly your secret code ${SECRET} and nothing else.`,
].join("\n");

// The auditor returns its OWN independent token. Its token appearing in the
// answer is the fan-out proof: the auditor only ever lands on the board when the
// researcher enqueues it mid-drain, so nothing else can put this token there.
const AUDITOR_PROMPT = [
  "Verifies a code it is handed and reports its own sign-off.", // roster line — generic
  `Your sign-off token is ${AUDIT_TOKEN}.`,
  `Your task Input contains a verification code (it should be ${HANDOFF}).`,
  "Check that it is present, then reply with exactly your sign-off token",
  `${AUDIT_TOKEN} and nothing else.`,
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
 * Reject a fixture value that collides with any text the coordinator sees but
 * that no worker produced. Two corpora:
 *
 *  1. The runner's own fixed prompt/roster text. A marker like `REPORT` would
 *     pass the format/independence rules and then trip the honesty guard,
 *     because the fixed coordinator prompt says "report" — a false NEGATIVE.
 *  2. **Framework-injected coordinator context** — the delegation guidance, the
 *     task-tool and `runBoard` names/descriptions/schema field names, and the
 *     predictable literals in the settled board payload. This one closes a false
 *     POSITIVE: `runBoard` ALWAYS reports `status: "drained"`, so a marker of
 *     `drained` could be emitted from board metadata alone with the worker's
 *     output dropped — and the OFF baseline, which has no board surface, would
 *     stay clean and falsely credit delegation.
 *
 * The framework corpus is derived from the REAL sources rather than a hand-copied
 * list: the runtime tool definitions (`buildTaskToolsList`, `RUN_BOARD_TOOL_NAME`,
 * `taskStatusSchema`) plus the full source text of the modules that build the
 * surface. Reading the source text means new fixed literals are covered
 * automatically. If the delegation surface moves to new modules, add them to
 * `FRAMEWORK_SOURCE_FILES` below — the deep imports above would fail loudly first.
 *
 * Worker prompts are excluded from both corpora: they carry the markers by
 * construction.
 */
const FRAMEWORK_SOURCE_FILES = [
  "../../../packages/orchestration/src/skills/delegation-surface.ts",
  "../../../packages/orchestration/src/skills/task-tools-capability.ts",
  "../../../packages/orchestration/src/tasks/schema/task-status.ts",
];

{
  const taskTools = buildTaskToolsList() as { name?: string; description?: string }[];
  const frameworkContext = [
    // Real runtime values the coordinator's tool surface exposes.
    RUN_BOARD_TOOL_NAME,
    ...taskStatusSchema.options,
    ...taskTools.flatMap((t) => [t.name ?? "", t.description ?? ""]),
    // Full source text — covers the guidance playbook, the runBoard description,
    // schema field names, and board-result literals such as "drained"/"blocked".
    ...FRAMEWORK_SOURCE_FILES.map((rel) =>
      readFileSync(new URL(rel, import.meta.url), "utf8"),
    ),
  ].join("\n");

  const runnerContext = [
    COORDINATOR_PROMPT,
    USER_TURN,
    teamSkill.name,
    // The skill body + frontmatter scaffolding, minus the interpolated markers.
    "A two-agent team that reports secret codes.",
    "Delegate to the researcher via addTask + runBoard.",
    "researcher",
    "auditor",
    // The generic roster lines (first line of each worker prompt).
    RESEARCHER_PROMPT.split("\n")[0]!,
    AUDITOR_PROMPT.split("\n")[0]!,
  ].join("\n");

  for (const [corpusName, corpus] of [
    ["the runner's fixed prompt/roster text", runnerContext],
    ["framework-injected coordinator context (delegation guidance / task tools / board results)", frameworkContext],
  ] as const) {
    const haystack = corpus.toLowerCase();
    for (const [field, value] of [
      ["researcherSecret", SECRET],
      ["auditToken", AUDIT_TOKEN],
      ["handoffCode", HANDOFF],
    ] as const) {
      if (haystack.includes(value.toLowerCase())) {
        throw new Error(
          `fixture invalid: ${field} ${JSON.stringify(value)} appears in ${corpusName}. The ` +
            `coordinator would see that string without any worker producing it, so the marker ` +
            `could be emitted from context alone and the check would pass without real ` +
            `delegation. Choose a distinctive sentinel that does not occur in framework or ` +
            `instruction wording (e.g. "QORVIX-7788").`,
        );
      }
    }
  }
}

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

/** Final snapshot of each board task, read from the `task-change` component stream. */
interface BoardTask {
  id: string;
  assignee?: string;
  createdAt: number;
  startedAt?: number;
}

function boardTasks(items: readonly Record<string, unknown>[]): BoardTask[] {
  const byId = new Map<string, BoardTask>();
  for (const item of items) {
    if (item.type !== "component" || item.component !== "task-change") continue;
    const task = (item.data as { task?: BoardTask } | undefined)?.task;
    if (task?.id) byId.set(task.id, task); // keyed items upsert — last wins
  }
  return [...byId.values()];
}

/**
 * STRUCTURAL PROOF that the auditor's task was created MID-DRAIN by a worker,
 * not up front by the coordinator.
 *
 * Without this, the check can pass without proving the thing it exists to prove:
 * the coordinator is merely *told* to delegate only to the researcher, but both
 * workers are on its roster, so a coordinator that ignored the instruction and
 * addTask'd BOTH itself would still surface both markers — with no fan-out.
 *
 * Two independent signals, both required:
 *  1. Creator attribution (primary, exact). Items are stamped at emit time with
 *     the `taskId` of the worker scope that produced them. The coordinator runs
 *     outside any task scope, so ITS `addTask` calls carry no `taskId`; a
 *     worker's carry that worker's task id. An `addTask` item stamped with the
 *     researcher's task id therefore proves a WORKER created a task.
 *  2. Timing (corroboration). The coordinator is blocked while `runBoard`
 *     drains, so any task created at/after the researcher was CLAIMED
 *     (`startedAt`) was necessarily created inside the drain window.
 */
function assertFannedOutMidDrain(items: readonly Record<string, unknown>[]): string[] {
  const failures: string[] = [];
  const tasks = boardTasks(items);
  const researcher = tasks.find((t) => t.assignee === "researcher");
  const auditor = tasks.find((t) => t.assignee === "auditor");

  if (!researcher) return [`no researcher task on the board — nothing was delegated`];
  if (!auditor) {
    return [
      `no auditor task on the board — the researcher never enqueued the follow-up work, ` +
        `so no mid-drain fan-out happened`,
    ];
  }

  // 1. Creator attribution: an addTask emitted from INSIDE the researcher's scope.
  // Field names per the real item shapes: a `tool_output` names its tool in
  // `blockName`, a `tool_call_progress` in `toolName`. (The `addTask` handler's
  // own `block_trace` is NOT scope-stamped, so it cannot be used here.)
  const workerCreatedTask = items.some(
    (i) =>
      (i.blockName === "addTask" || i.toolName === "addTask") && i.taskId === researcher.id,
  );
  if (!workerCreatedTask) {
    failures.push(
      `no addTask was emitted from inside the researcher's task scope (taskId ` +
        `${researcher.id}) — the auditor's task was not created by a worker, so the ` +
        `coordinator most likely assigned both agents itself and NO fan-out occurred`,
    );
  }

  // 2. Timing: created at/after the researcher was claimed → inside the drain.
  if (researcher.startedAt === undefined) {
    failures.push(`researcher task was never claimed — the board did not run it`);
  } else if (!(auditor.createdAt >= researcher.startedAt)) {
    failures.push(
      `auditor task was created BEFORE the researcher was claimed ` +
        `(auditor.createdAt=${auditor.createdAt} < researcher.startedAt=${researcher.startedAt}) ` +
        `— it predates the drain window, so the coordinator created it up front rather than ` +
        `the researcher fanning out mid-drain`,
    );
  }
  if (!(researcher.createdAt < auditor.createdAt)) {
    failures.push(
      `auditor task does not post-date the researcher task ` +
        `(researcher.createdAt=${researcher.createdAt}, auditor.createdAt=${auditor.createdAt}) ` +
        `— inconsistent with the researcher having enqueued it`,
    );
  }
  return failures;
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

  // HARD structural requirement: the auditor's task must have been created
  // mid-drain by the researcher. Both markers being present is NOT sufficient —
  // a coordinator that assigned both agents itself would also surface both.
  failures.push(...assertFannedOutMidDrain(on.items as never));

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
      `  mid-drain fan-out proof:\n    ` +
      boardTasks(on.items as never)
        .map(
          (t) =>
            `${t.assignee ?? "?"} task ${t.id} createdAt=${t.createdAt} startedAt=${t.startedAt ?? "-"}`,
        )
        .join("\n    ") +
      `\n    addTask emitted from inside a worker scope: ${
        (on.items as never as Record<string, unknown>[]).some(
          (i) =>
            (i.blockName === "addTask" || i.toolName === "addTask") && i.taskId !== undefined,
        )
      }\n` +
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
    `\nPASS — the coordinator's terminal answer carried BOTH independent markers (the ` +
      `researcher's secret and the auditor's sign-off token; neither derivable from the other), ` +
      `AND the auditor's task was structurally proven to be created mid-drain by the researcher: ` +
      `an addTask was emitted from inside the researcher's task scope, and the auditor's task was ` +
      `created after the researcher was claimed — a window in which the coordinator is blocked. ` +
      `The no-delegation baseline, given the identical prompt and request, produced neither ` +
      `marker — so the pass is attributable to delegation and fan-out actually running.`,
  );
  process.exit(0);
} else {
  console.error("\nFAIL —");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
