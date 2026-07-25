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
import { readFileSync, readdirSync } from "node:fs";
import { join as pathJoin } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_MODEL,
  loadFixture,
  messageText,
  repoPath,
  runGoal,
  stripIntentOverrides,
} from "../../lib/index.mts";
import { defineFlow, generator } from "@flow-state-dev/core";
import {
  runAction,
  createInMemoryStores,
  createModelResolver,
} from "@flow-state-dev/engine";
import {
  createSkillsLibrary,
  inlineActivate,
  readSkillsDirectory,
} from "@flow-state-dev/orchestration";
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

// The PORTABLE model id (goals/lib/model.mts): this runner builds a bare
// `createModelResolver()`, which applies whatever gateway the env provides, so
// the id must not name one itself.
const MODEL = DEFAULT_MODEL;

const fx = loadFixture<{
  researcherSecret: string;
  auditToken: string;
  handoffCode: string;
}>(import.meta.url, "team.json");

/**
 * Required marker shape: `LETTERS-DIGITS` — at least four UPPERCASE letters, a
 * hyphen, at least four digits (e.g. `QORVIX-7788`).
 *
 * This is a VALIDATION rule, not grader logic. It fences off three ways a
 * fixture could make a correct implementation mis-grade, without adding any
 * matcher machinery:
 *
 *  (a) Response formatting. A punctuation-only or punctuation-edged marker
 *      collides with prose: with `researcherSecret = "-"`, a Markdown answer's
 *      list bullet reads as a bounded standalone `-`.
 *  (b) `$`-substitution. `$ARGUMENTS`, `$1`–`$9`, `${SKILL_DIR}` are rewritten
 *      by the skills runtime's `substitute()` before a worker prompt is invoked,
 *      erasing the marker from the prompt while the grader still expects the
 *      literal.
 *  (c) THE SURFACES NO GREP HERE CAN SEE. `assertNoMarkerInRenderedContext`
 *      reads the coordinator's captured `block_trace`, and that capture records
 *      only tool NAMES — `packages/core/src/blocks/generator.ts` stamps
 *      `tools: toolBlocks.map((t) => t.name)`. The tool DESCRIPTIONS and the
 *      JSON schemas serialized for the provider never enter the captured
 *      context, so no post-run check can grep them. Descriptions and schema
 *      FIELD names are covered by the source pre-flight below; the JSON-schema
 *      VOCABULARY the zod→provider conversion emits (`additionalProperties`,
 *      `properties`, `required`, `description`, …) is covered by nothing. This
 *      shape closes that hole by construction rather than by capture: an
 *      uppercase letter-run followed by `-` and a digit-run cannot be an
 *      English word, a JSON-schema keyword, or a code identifier (camelCase and
 *      snake_case have no hyphen; kebab-case identifiers like `task-change`
 *      have no digit run). Note `additionalProperties` satisfied the previous,
 *      looser format — and occurs verbatim in every generated tool schema.
 */
const MARKER_FORMAT = /^[A-Z]{4,}-[0-9]{4,}$/;

function assertValidMarker(field: string, value: string): void {
  if (typeof value !== "string" || !MARKER_FORMAT.test(value)) {
    throw new Error(
      `fixture invalid: ${field} ${JSON.stringify(value)} is not a valid marker. Markers must ` +
        `match ${MARKER_FORMAT} — at least four uppercase letters, a hyphen, then at least four ` +
        `digits (e.g. "QORVIX-7788"). That shape cannot collide with response formatting, with ` +
        `the skills runtime's $-substitution, or with the tool descriptions and generated JSON ` +
        `schemas that the coordinator receives but no post-run grep can read.`,
    );
  }
}

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

/** `[fieldName, value]` — the three fixture values every load guard walks. */
type Fixture = readonly [field: string, value: string];
const FIXTURES: readonly Fixture[] = [
  ["researcherSecret", SECRET],
  ["auditToken", AUDIT_TOKEN],
  ["handoffCode", HANDOFF],
];

/**
 * Every fixture value must match the sentinel shape. Extracted as a function
 * (rather than three inline calls) so the probe suite can exercise it with
 * deliberately bad values.
 */
function assertValidMarkers(fixtures: readonly Fixture[]): void {
  for (const [field, value] of fixtures) assertValidMarker(field, value);
}

/**
 * All fixture values must be mutually underivable. If one contained another, a
 * single worker's output could carry more than one graded marker and the check
 * would pass without both results being synthesized. Asserted at load so it
 * cannot silently regress.
 */
function assertMutuallyIndependent(fixtures: readonly Fixture[]): void {
  for (const [aName, aVal] of fixtures) {
    for (const [bName, bVal] of fixtures) {
      if (aName === bName) continue;
      const a = aVal.toLowerCase();
      const b = bVal.toLowerCase();
      if (a === b || a.includes(b)) {
        throw new Error(
          `fixture invalid: ${aName} ${JSON.stringify(aVal)} overlaps ${bName} ` +
            `${JSON.stringify(bVal)} — the fixture values must be mutually independent, or ` +
            `one worker's result would be derivable from another's.`,
        );
      }
    }
  }
}

assertValidMarkers(FIXTURES);
assertMutuallyIndependent(FIXTURES);

const USER_TURN = "Collect the codes from your team and report all of them.";

// The env may carry an intent ladder override (FSDEV_DEFAULT_MODEL /
// FSDEV_INTENT_*) that a bare createModelResolver (no declared intents) rejects.
// Clear it so the resolver auto-wires the AI Gateway from AI_GATEWAY_API_KEY.
stripIntentOverrides();

/**
 * `assertNoMarkerInRenderedContext` reads the coordinator's `block_trace`, and
 * that item only exists when trace capture is on: `createExecutionContext` wires
 * `onBlockTraceCapture` behind `isTraceObservabilityEnabled()`
 * (`packages/core/src/helpers/trace-observability.ts`), which defaults to OFF
 * under `NODE_ENV=production` and honors an explicit
 * `FSDEV_TRACE_OBSERVABILITY=false` everywhere. Both are supported
 * environments, and in either one the guard would report "no rendered context"
 * and fail every otherwise-correct delegation run.
 *
 * So the check turns capture on for itself rather than inheriting the ambient
 * default. This is also what makes the guard's failure branch meaningful: with
 * capture explicitly enabled, a missing `block_trace` means trace capture
 * really broke, which IS worth failing on.
 */
process.env.FSDEV_TRACE_OBSERVABILITY = "true";

// `messageText` (renders a message item's content, including structured
// content-part arrays) comes from goals/lib — it was the third copy in the corpus.

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
// The skill is authored the way a real user authors one: a `skills/code-team/`
// folder with a `SKILL.md` (frontmatter `agents:` using `prompt-ref`) and a
// prompt file per worker under `reference/` — the same layout as
// `examples/guides/research-team`. It is loaded through the REAL loader
// (`readSkillsDirectory`), so this goal exercises file discovery, frontmatter
// parsing, prompt-ref resolution and `substitute()` — all part of the delegation
// surface that an inline, TypeScript-constructed skill object bypasses entirely.
//
// The held-out fixture values are NOT hardcoded in the markdown. The prompts use
// the framework's own `$1`/`$2`/`$3` substitution, and the values arrive as the
// skill's activation arguments (see `ACTIVATION_ARGS`) — the same mechanism a
// real slash-command-style skill uses to parameterize itself. The sentinel
// format rule above guarantees the values are whitespace-free, so they map
// one-to-one onto `$1`/`$2`/`$3`.
const SKILL_NAME = "code-team";
const SKILLS_DIR = fileURLToPath(new URL("./skills", import.meta.url));

const { skills: initialSkills, errors: skillLoadErrors } =
  await readSkillsDirectory(SKILLS_DIR);
if (skillLoadErrors.length > 0) {
  throw new Error(
    `failed to load skill files from ${SKILLS_DIR}: ` +
      skillLoadErrors.map(({ name, error }) => `${name}: ${error.message}`).join("; "),
  );
}
if (!initialSkills.some((sk) => sk.name === SKILL_NAME)) {
  throw new Error(
    `skill "${SKILL_NAME}" not found under ${SKILLS_DIR} — expected ${SKILL_NAME}/SKILL.md`,
  );
}

/** `$1 $2 $3` — positional args the skill's prompts substitute. */
const ACTIVATION_ARGS = `${SECRET} ${AUDIT_TOKEN} ${HANDOFF}`;

/** Raw (unsubstituted) prompt bodies, straight from the authored files. */
function promptFile(rel: string): string {
  return readFileSync(new URL(`./skills/${SKILL_NAME}/${rel}`, import.meta.url), "utf8");
}
const RESEARCHER_PROMPT_RAW = promptFile("reference/researcher.md");
const AUDITOR_PROMPT_RAW = promptFile("reference/auditor.md");

const skills = createSkillsLibrary({
  catalog: {},
  initialSkills,
  workerModelId: MODEL,
  // Session scope keeps the fixture self-contained — no org identity/persistence.
  scope: "session",
});

/**
 * The skill is activated at RUNTIME with arguments (rather than bound `active`),
 * because only a runtime activation carries the `input` that `substitute()`
 * feeds to `$1`/`$2`/`$3`. Activations live in session state, written by the
 * framework's own `inlineActivate` block — the same path the real skill
 * activator uses.
 */
const skillsBinding = {
  activeState: { scope: "session", field: "activeSkills" },
} satisfies SkillsBindingConfig;

const inputSchema = z.object({ message: z.string() });

// Deliberately thin: the delegation plan lives in the authored SKILL.md, the way
// a real skill carries its own playbook. The coordinator just follows it.
const COORDINATOR_PROMPT = [
  "You are the coordinator of a team of agents, reachable through your task board.",
  "Follow your active skill's instructions exactly when it applies.",
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
 * `taskStatusSchema`) plus the full source text of the skills + tasks subsystem.
 * Scanning the source is what covers the tool DESCRIPTIONS and schema FIELD
 * names, which the post-run capture cannot see (it records tool NAMES only —
 * see `MARKER_FORMAT`). What neither this corpus nor the capture covers is the
 * JSON-schema vocabulary the provider serialization adds; the sentinel SHAPE
 * closes that by construction.
 *
 * Worker prompts are excluded from both corpora: they carry the markers by
 * construction.
 */
// Repo-anchored (goals/lib/paths.mts) rather than `../../../` relative, so this
// runtime scan does not depend on how deeply the goal folder is nested. The
// deep static IMPORTS above stay relative on purpose — an import cannot use a
// runtime helper, and goal.md wants a moved module to fail loudly at import.
const FRAMEWORK_SOURCE_DIRS = [
  repoPath("packages", "orchestration", "src", "skills"),
  repoPath("packages", "orchestration", "src", "tasks"),
];

/** Every `.ts` file under the delegation subsystem, so no module is missed by enumeration. */
function frameworkSourceText(): string {
  const out: string[] = [];
  for (const dir of FRAMEWORK_SOURCE_DIRS) {
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      out.push(readFileSync(pathJoin(entry.parentPath ?? dir, entry.name), "utf8"));
    }
  }
  return out.join("\n");
}

/** Throw if any fixture value occurs (case-folded) in any named corpus. */
function assertNoCorpusCollision(
  fixtures: readonly Fixture[],
  corpora: readonly (readonly [name: string, text: string])[],
): void {
  for (const [corpusName, corpus] of corpora) {
    const haystack = corpus.toLowerCase();
    for (const [field, value] of fixtures) {
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

{
  const taskTools = buildTaskToolsList() as { name?: string; description?: string }[];
  const frameworkContext = [
    // Real runtime values the coordinator's tool surface exposes.
    RUN_BOARD_TOOL_NAME,
    ...taskStatusSchema.options,
    ...taskTools.flatMap((t) => [t.name ?? "", t.description ?? ""]),
    // Full source text of the whole skills + tasks subsystem — covers the guidance
    // playbook, the runBoard description, schema field names, board-result literals
    // such as "drained"/"blocked", AND the skill reader's rendered preamble
    // ("The following skills are active..."). Scanning the directories rather than
    // naming files means a new module is covered without updating a list.
    frameworkSourceText(),
  ].join("\n");

  const runnerContext = [
    COORDINATOR_PROMPT,
    USER_TURN,
    SKILL_NAME,
    // The authored skill files, verbatim. They legitimately contain the `$1`/`$2`/`$3`
    // placeholders but never the fixture VALUES, so any value found here is hardcoded
    // markdown that would bypass the held-out contract.
    initialSkills.find((sk) => sk.name === SKILL_NAME)!.skillMd,
    RESEARCHER_PROMPT_RAW,
    AUDITOR_PROMPT_RAW,
    "researcher",
    "auditor",
  ].join("\n");

  assertNoCorpusCollision(FIXTURES, [
    ["the runner's fixed prompt/roster text", runnerContext],
    [
      "framework-injected coordinator context (delegation guidance / task tools / board results)",
      frameworkContext,
    ],
  ]);
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
    // Runtime skill activation WITH arguments — the framework's own block, the
    // same path a real activator uses. This is what carries `$1 $2 $3`.
    activate: { block: inlineActivate as never },
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
 * Activate the authored skill for this session, passing the held-out fixture
 * values as its arguments. `substitute()` maps them onto the `$1`/`$2`/`$3`
 * placeholders in the authored prompt files at worker-materialization time.
 */
async function activateTeam(sessionId: string) {
  return runAction({
    flow,
    actionName: "activate" as never,
    input: { skillName: SKILL_NAME, input: ACTIVATION_ARGS },
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

/**
 * Final snapshot of each board task, read from the `task-change` component
 * stream. The substrate publishes the WHOLE `Task` record on every transition
 * (`tasks/collection/change-event.ts` → `get-or-create.ts` emits `task: event.task`),
 * so the creation-side payload a worker chose when it called `addTask` is
 * already in hand — no extra capture needed to inspect it.
 */
interface BoardTask {
  id: string;
  assignee?: string;
  createdAt: number;
  startedAt?: number;
  // --- creation-side payload (whatever the task's CREATOR set) ---
  goal?: string;
  title?: string;
  context?: string;
  input?: unknown;
  feedback?: string;
  metadata?: Record<string, unknown>;
  deps?: string[];
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
 * The fields of a task that its CREATOR chose — i.e. everything a fanned-out
 * worker can be handed. `buildUserMessage` (`skills/worker-materializer.ts`)
 * renders `goal` and `input` verbatim into the assigned worker's user turn, so
 * these are the channel by which one worker's content reaches another's context.
 *
 * Deliberately EXCLUDES `output` and `error`: the worker itself writes those,
 * and the auditor's own output carries the graded `AUDIT_TOKEN` by design.
 * `deps` is checked separately — it holds task ids, and the substrate resolves
 * them to the upstream tasks' OUTPUTS before rendering them into the turn.
 */
function creationPayload(task: BoardTask): string {
  return JSON.stringify({
    goal: task.goal,
    title: task.title,
    context: task.context,
    input: task.input,
    feedback: task.feedback,
    metadata: task.metadata,
  });
}

/**
 * HANDOFF ISOLATION, asserted against the REAL created task rather than trusted
 * to the researcher's instructions.
 *
 * `researcher.md` tells the researcher to hand the auditor the ungraded
 * `HANDOFF` code and to "never send your secret code to anyone" — but that is an
 * INSTRUCTION to a real model, not a guarantee. If the researcher deviates and
 * puts its graded `SECRET` into the auditor task's `goal`/`input`, that value
 * enters the auditor's context through `buildUserMessage`; an auditor that then
 * echoes it alongside its own token would put BOTH graded markers in ONE
 * worker's output. Every other assertion here still passes — the markers are
 * present, the auditor task really was created mid-drain by the researcher — yet
 * the coordinator could have synthesized the auditor's result alone and never
 * read the researcher's. That is precisely the derivability class the
 * independent fixtures were introduced to kill; fixture independence stops the
 * markers being derivable BY CONSTRUCTION, but it cannot stop the researcher
 * re-coupling them AT RUNTIME.
 *
 * So: grade the real payload. A deviated run is a FAIL, not a pass.
 */
function assertAuditorTaskPayloadIsolated(
  items: readonly Record<string, unknown>[],
): string[] {
  const tasks = boardTasks(items);
  const auditor = tasks.find((t) => t.assignee === "auditor");
  // A missing auditor task is already reported by assertFannedOutMidDrain.
  if (!auditor) return [];

  const failures: string[] = [];
  const payload = creationPayload(auditor);
  const folded = payload.toLowerCase();

  // Positive half, LAYER 1 (localizer): the researcher populated the structured
  // `input` field at creation time. NOT the authoritative proof — the creation
  // record is not the worker boundary — but it separates "the researcher never
  // sent it" from "the substrate dropped it in transit", which layer 2 alone
  // cannot distinguish. Reads `input` ONLY: grepping the wide `creationPayload`
  // blob (which includes `goal`) passes when the researcher writes the code into
  // the goal and sets no `input`, reporting the structured channel as verified
  // when it was never exercised.
  //
  // Deliberately does NOT re-render the value the way `buildUserMessage` does.
  // Mirroring the framework's three lines of rendering here would be a copy that
  // silently rots; layer 2 reads the framework's REAL rendering instead.
  if (auditor.input === undefined || auditor.input === null) {
    failures.push(
      `the auditor task (${auditor.id}) was created with NO structured \`input\` — ` +
        `addTask({ input }) was never exercised, so the payload channel to a fanned-out worker ` +
        `is unproven even if the handoff code appears elsewhere on the task. ` +
        `Created payload: ${payload.slice(0, 400)}`,
    );
  } else if (!JSON.stringify(auditor.input).toLowerCase().includes(HANDOFF.toLowerCase())) {
    failures.push(
      `the auditor task (${auditor.id}) has a structured \`input\` that does not carry the ` +
        `handoff code "${HANDOFF}" — the researcher did not hand the auditor the value it was ` +
        `told to pass. Created input: ${JSON.stringify(auditor.input).slice(0, 400)}`,
    );
  }

  // Negative half: no GRADED marker may ride along, in ANY field the creator
  // chose. Case-folded on purpose — a leak guard should be broad, so even a
  // lowercased echo of the secret trips it. Note the net is deliberately WIDER
  // than what reaches the worker's turn: `metadata` and `context` never reach
  // `buildUserMessage`, but a graded marker sitting in them still means the
  // researcher leaked its secret downstream, which is what this guards.
  for (const { label, marker } of GRADED_MARKERS) {
    if (folded.includes(marker.toLowerCase())) {
      failures.push(
        `HANDOFF ISOLATION VIOLATED: the ${label} "${marker}" is in a creator-chosen field of ` +
          `the auditor task (${auditor.id}). Whatever the researcher writes onto the task can ` +
          `reach the auditor — goal/input render straight into its turn — so an auditor ` +
          `that echoed what it was handed could carry BOTH graded markers alone, and the run ` +
          `would pass with the researcher's own result never synthesized. ` +
          `Created payload: ${payload.slice(0, 400)}`,
      );
    }
  }

  // Same hole, third channel: a dep on the researcher's task makes the substrate
  // render the researcher's OUTPUT (the secret) into the auditor's turn as an
  // "Upstream outputs:" line, without the secret ever appearing in the payload above.
  const researcher = tasks.find((t) => t.assignee === "researcher");
  if (researcher && (auditor.deps ?? []).includes(researcher.id)) {
    failures.push(
      `HANDOFF ISOLATION VIOLATED: the auditor task declares a dependency on the researcher ` +
        `task (${researcher.id}), so the substrate renders the researcher's OUTPUT into the ` +
        `auditor's turn as an upstream output — the auditor's result could carry the ` +
        `researcher's secret without it ever appearing in the task payload`,
    );
  }

  return failures;
}

// ---------------------------------------------------------------------------
// ONE definition of "section boundary", shared by the parser and the guard.
//
// `buildUserMessage` (`skills/worker-materializer.ts`) builds the turn as parts
// joined by "\n" with "" between sections, so sections are "\n\n"-separated and
// each begins with a known header. Both the reader below (`inputSection`) and
// the forgery guard (`assertNoForgedSectionHeader`) are derived from these two
// constants — deliberately, because they are two views of the SAME concept and
// a second hand-written pattern would drift. An earlier revision expressed the
// guard as its own multiline regex; it disagreed with the parser and rejected
// goals that could not possibly forge a section, turning correct runs into
// FAILs. A goal check that fails on correct behavior is worse than one that is
// merely incomplete: the failure gets blamed on the substrate.
// ---------------------------------------------------------------------------

/** What separates one rendered section from the next. */
const SECTION_DELIMITER = "\n\n";

/** The headers `buildUserMessage` emits. A section is a part starting with one. */
const INPUT_HEADER = "Input:";
const SECTION_HEADERS = ["Task:", INPUT_HEADER, "Reviewer feedback:", "Upstream outputs:"];

/** Split rendered text into sections. The single definition of the boundary. */
function sections(text: string): string[] {
  return text.split(SECTION_DELIMITER);
}

/** The header this part opens with, if any. The single definition of recognition. */
function sectionHeaderOf(part: string): string | undefined {
  return SECTION_HEADERS.find((h) => part.startsWith(h));
}

/**
 * The `Input:` section of a worker's rendered turn, or `undefined` when the turn
 * has none — which is exactly the state the boundary proof needs to detect,
 * since `buildUserMessage` omits the section when `input` is null/undefined.
 *
 * Isolating the section matters: grepping the WHOLE turn for the handoff would
 * pass when the code sits in the goal (`Task: verify DELTA-9034`) and no input
 * was ever delivered.
 */
function inputSection(turn: string): string | undefined {
  return sections(turn).find((part) => part.startsWith(INPUT_HEADER));
}

/**
 * Reject a goal that would FORGE a parsed section — and nothing else.
 *
 * `buildUserMessage` joins sections without escaping, and `goal` is the only
 * creator-controlled field rendered BEFORE the `Input:` section, so a goal of
 * `"verify\n\nInput: DELTA-9034"` puts a second, forged `Input:` header into
 * the turn. That forgery survives the exact regression the boundary proof
 * exists to catch: drop the real `task.input` in transit and the forged header
 * still reads as the delivered payload, while the creation-record localizer
 * still sees `input` intact. Both layers pass on a broken substrate.
 *
 * The guard reuses the PARSER rather than restating it. The turn opens with
 * `Task: ${goal}`, and that prefix can only ever affect the FIRST section — so
 * the sections a goal contributes beyond the first are exactly
 * `sections(goal).slice(1)`, with no need to re-render anything. A goal is
 * forgeable precisely when one of those trailing sections opens with a header.
 *
 * What that correctly ADMITS, and a line-start regex wrongly rejected:
 *   - a goal that merely BEGINS with `Task:` or `Input:` — the renderer's own
 *     `Task: ` prefix means it lands mid-first-section and can never be parsed
 *     as a section of its own;
 *   - a header after a SINGLE newline — not a delimiter, so not a boundary;
 *   - a blank line with no header after it — a boundary, but not a section.
 */
function assertNoForgedSectionHeader(task: BoardTask): string[] {
  const goal = task.goal ?? "";
  const forged = sections(goal)
    .slice(1) // the first section is absorbed into the renderer's `Task: ` line
    .map(sectionHeaderOf)
    .filter((h): h is string => h !== undefined);
  if (forged.length === 0) return [];
  return [
    `the auditor task (${task.id}) has a goal that forges the section header(s) ` +
      `${JSON.stringify(forged)} after a blank-line delimiter. buildUserMessage joins sections ` +
      `without escaping, so this creates a parsed section in the rendered turn — a forged ` +
      `"${INPUT_HEADER}" section would be read as a delivered payload even after the real input ` +
      `was dropped in transit, defeating the boundary proof. ` +
      `Goal: ${JSON.stringify(goal.slice(0, 400))}`,
  ];
}

/**
 * AUTHORITATIVE proof that the handoff reached the auditor AT THE WORKER
 * BOUNDARY — the turn the auditor's generator actually received.
 *
 * The creation-record check above reads the `task-change` snapshot, which is
 * where the researcher WROTE the payload, not where the auditor READ it. If the
 * dispatch/materialization path drops `task.input` between creation and the
 * worker call, that check still reports a successful handoff. And the auditor's
 * own output cannot stand in as evidence: `reference/auditor.md` substitutes the
 * expected handoff into its SYSTEM PROMPT as `$3`, so it can emit its sign-off
 * token — satisfying every terminal and structural assertion — without ever
 * having received an `Input:` section at all.
 *
 * So read the boundary directly. The worker's `block_trace` carries
 * `generator.user`, the rendered turn as the model received it, which means this
 * asserts against the framework's REAL rendering rather than a local mirror of
 * it. Requires trace capture, which this runner enables explicitly.
 *
 * The auditor generator is found by name match rather than an exact constructed
 * name so a framework rename surfaces as a clear diagnostic (every
 * generator-bearing block is listed) instead of a silent miss.
 *
 * IDENTITY BINDING. This function and the payload/structural checks each select
 * "the auditor" independently — one a `task-change` record, the other a
 * `block_trace` — and two independent selections of the same thing must be
 * bound, or a correctly-delivered turn from one auditor execution can mask
 * input being dropped on the task actually graded.
 *
 * They CANNOT be bound by task id: a worker's own `block_trace` is not
 * scope-stamped. Verified against a real run — the auditor's trace carries
 * `provenance` / `blockInstanceId` (an execution path like
 * `.../forEach[3]/iter[1]/branch[skillWorker_code-team_auditor]`) and no
 * `taskId` at all, consistent with the note on the attribution check above that
 * a handler's own `block_trace` is not stamped.
 *
 * So bind by UNIQUENESS instead, which is the stronger property anyway: require
 * exactly one auditor task and exactly one auditor generator trace. Then the two
 * selections are provably the same execution, and a deviating researcher that
 * enqueues a second auditor task FAILs loudly rather than having one of its
 * tasks silently picked.
 */
function assertHandoffReachedAuditorTurn(
  items: readonly Record<string, unknown>[],
): string[] {
  const auditorTasks = boardTasks(items).filter((t) => t.assignee === "auditor");
  // A missing auditor task is already reported by assertFannedOutMidDrain.
  if (auditorTasks.length === 0) return [];
  if (auditorTasks.length > 1) {
    return [
      `${auditorTasks.length} tasks are assigned to the auditor ` +
        `(${JSON.stringify(auditorTasks.map((t) => t.id))}) — the run is expected to create ` +
        `exactly one, and with more than one this check and the payload/structural checks could ` +
        `select DIFFERENT executions, letting a correctly-delivered turn mask input being dropped ` +
        `on the task actually graded`,
    ];
  }
  const auditor = auditorTasks[0]!;

  // A forged section delimiter in the goal would make the turn parse below
  // meaningless, so fail on it before trusting that parse.
  const forged = assertNoForgedSectionHeader(auditor);
  if (forged.length > 0) return forged;

  const generatorTraces = items.filter(
    (i) => i.type === "block_trace" && (i as { generator?: unknown }).generator !== undefined,
  );
  const auditorTraces = generatorTraces.filter((i) =>
    String(i.blockName ?? "").toLowerCase().includes("auditor"),
  );
  if (auditorTraces.length === 0) {
    return [
      `no captured generator turn for the auditor worker — cannot verify the handoff reached ` +
        `the worker boundary. Generator-bearing blocks in this run: ` +
        `${JSON.stringify(generatorTraces.map((i) => i.blockName))}`,
    ];
  }
  if (auditorTraces.length > 1) {
    return [
      `${auditorTraces.length} auditor generator turns were captured ` +
        `(${JSON.stringify(auditorTraces.map((i) => i.blockName))}) — cannot tell which belongs ` +
        `to the graded auditor task (${auditor.id}), and picking one could mask a dropped input ` +
        `on the other`,
    ];
  }
  const auditorTrace = auditorTraces[0]!;

  const user = (auditorTrace.generator as { user?: unknown }).user;
  const turn = Array.isArray(user)
    ? user.map((m) => messageText(m as { content?: unknown })).join("\n")
    : messageText((user ?? {}) as { content?: unknown });

  const section = inputSection(turn);
  if (section === undefined) {
    return [
      `the auditor's rendered turn carries NO "Input:" section — the task's structured input ` +
        `did not survive dispatch to the worker, so addTask({ input }) did not actually deliver ` +
        `a payload. (The auditor can still emit its sign-off token from its system prompt, so ` +
        `its output does not evidence this.) Turn: ${JSON.stringify(turn.slice(0, 400))}`,
    ];
  }
  if (!section.toLowerCase().includes(HANDOFF.toLowerCase())) {
    return [
      `the auditor's rendered turn has an "Input:" section that does not carry the handoff ` +
        `code "${HANDOFF}" — what reached the worker is not what the researcher was told to ` +
        `pass. Input section: ${JSON.stringify(section.slice(0, 400))}`,
    ];
  }
  return [];
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
  // `blockName` and carries the tool's return value in `output`. (The `addTask`
  // handler's own `block_trace` is NOT scope-stamped, so it cannot be used here.)
  //
  // It is not enough that the researcher called addTask at all: same-step
  // coordinator tool calls run concurrently, so a coordinator can issue its own
  // auditor `addTask` alongside `runBoard`. If the researcher happened to create
  // some OTHER task, a "researcher called addTask" predicate would pass while the
  // graded auditor task was still coordinator-created. So bind the attribution to
  // the graded task: collect the task ids RETURNED by researcher-scoped addTask
  // calls and require the auditor's id among them.
  const researcherCreatedIds = items
    .filter((i) => i.blockName === "addTask" && i.taskId === researcher.id)
    .map((i) => (i.output as { taskId?: string } | undefined)?.taskId)
    .filter((id): id is string => typeof id === "string");

  if (!researcherCreatedIds.includes(auditor.id)) {
    failures.push(
      `the auditor task (${auditor.id}) was not created by the researcher: addTask calls ` +
        `inside the researcher's scope (taskId ${researcher.id}) returned ` +
        `${JSON.stringify(researcherCreatedIds)}. The coordinator most likely created the ` +
        `auditor task itself, so NO mid-drain fan-out occurred`,
    );
  }

  // 2. The auditor must be SETTLED in the FIRST drain. Without this, a regression
  //    in mid-drain pickup — the first runBoard returning while the newly created
  //    auditor task sits `pending` — would be invisible: the coordinator could
  //    simply call runBoard a second time, and the attribution and timing checks
  //    would all still pass while FIX-927 was broken.
  const drained = firstDrainTasks(items);
  if (!drained) {
    failures.push(`no runBoard result found — the board was never drained`);
  } else {
    const settled = drained.find((t) => t.id === auditor.id);
    if (!settled) {
      failures.push(
        `the auditor task (${auditor.id}) is ABSENT from the FIRST runBoard result ` +
          `(${JSON.stringify(drained.map((t) => ({ id: t.id, status: t.status })))}) — it was ` +
          `created but not picked up by the drain that was already in flight. A later drain ` +
          `could still settle it, which is exactly the mid-drain-pickup regression this goal ` +
          `exists to catch`,
      );
    } else if (settled.status !== "completed") {
      failures.push(
        `the auditor task is in the FIRST runBoard result but not settled ` +
          `(status="${settled.status}") — mid-drain pickup did not complete it`,
      );
    }
  }

  // 3. Timing: created at/after the researcher was claimed → inside the drain.
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

/**
 * Grep the coordinator's ACTUAL rendered context for a graded marker. If one
 * appears there, the coordinator could emit it with no worker output at all, and
 * the board-less OFF baseline could never catch it.
 *
 * SCOPE — exactly what the captured `block_trace.generator` holds, no more:
 *   - `prompt`   the assembled system message: the skill-reader preamble ("The
 *                following skills are active…"), the substituted SKILL.md body,
 *                the delegation guidance playbook, the live agent roster.
 *   - `user` / `history`  the message shapes as sent.
 *   - `tools`    the tool NAMES only. `packages/core/src/blocks/generator.ts`
 *                records `tools: toolBlocks.map((t) => t.name)`, so tool
 *                DESCRIPTIONS and the JSON schemas serialized for the provider
 *                are NOT here and cannot be checked after the fact.
 *
 * Those two uncovered surfaces are closed elsewhere, and deliberately not by
 * building capture machinery: descriptions and schema field names live in the
 * source text the load-time corpus check scans, and everything else (the
 * JSON-schema vocabulary the provider serialization emits — `additionalProperties`,
 * `properties`, `required`) is excluded by the sentinel SHAPE `MARKER_FORMAT`
 * enforces. Read that comment for why the shape is sufficient.
 *
 * Requires trace capture, which this runner enables explicitly (see the
 * `FSDEV_TRACE_OBSERVABILITY` assignment above) — otherwise this reports a
 * missing trace on every run under `NODE_ENV=production`.
 */
function assertNoMarkerInRenderedContext(
  items: readonly Record<string, unknown>[],
): string[] {
  const trace = items.find(
    (i) => i.type === "block_trace" && i.blockName === "coordinatorWithTeam",
  );
  const generator = trace?.generator as
    | { prompt?: unknown; tools?: unknown; user?: unknown; history?: unknown }
    | undefined;
  if (generator?.prompt === undefined) {
    return [
      `could not read the coordinator's rendered context (block_trace.generator.prompt) — ` +
        `cannot verify that no graded marker was injected`,
    ];
  }
  const rendered = [
    String(generator.prompt),
    JSON.stringify(generator.tools ?? ""),
    JSON.stringify(generator.user ?? ""),
    JSON.stringify(generator.history ?? ""),
  ]
    .join("\n")
    .toLowerCase();

  const failures: string[] = [];
  for (const { label, marker } of GRADED_MARKERS) {
    if (rendered.includes(marker.toLowerCase())) {
      failures.push(
        `the ${label} "${marker}" appears in the coordinator's RENDERED context before any ` +
          `worker produced it — it could be emitted from context alone, so a pass would not ` +
          `prove delegation`,
      );
    }
  }
  return failures;
}

/** The tasks returned by the FIRST `runBoard` call, in stream order. */
function firstDrainTasks(
  items: readonly Record<string, unknown>[],
): { id: string; status: string; assignee?: string }[] | undefined {
  const drain = items.find(
    (i) => i.type === "tool_output" && i.blockName === RUN_BOARD_TOOL_NAME,
  );
  return (drain?.output as { tasks?: { id: string; status: string; assignee?: string }[] })
    ?.tasks;
}

/** The roster lines the coordinator actually sees, via the real `agentPurpose`. */
function rosterLines(): { agent: string; line: string }[] {
  return [
    { agent: "researcher", line: agentPurpose({ prompt: RESEARCHER_PROMPT_RAW } as never) },
    { agent: "auditor", line: agentPurpose({ prompt: AUDITOR_PROMPT_RAW } as never) },
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

// ---------------------------------------------------------------------------
// DETERMINISTIC PROBE SUITE
//
// Every grader and load guard above, exercised against synthetic inputs BEFORE
// any model call. This exists because the graders here are the whole value of
// the check: a grader bug is indistinguishable from a substrate bug at the
// verdict line, and this goal has already produced one (round 6 read `item.name`
// where the real items carry `blockName`, reporting a false FAIL against a
// working substrate).
//
// It lives in this file, and runs unconditionally, on purpose. Earlier rounds
// wrote equivalent probes as throwaway scripts; the counts survive in the
// verdict log while the probes themselves are gone, so each round re-derived
// them. Running them inline costs milliseconds and makes them impossible to skip.
// ---------------------------------------------------------------------------

/** True when `fn` throws — the assertion shape every load guard uses. */
function throws(fn: () => void): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

const RESEARCHER_ID = "task_probe_researcher";
const AUDITOR_ID = "task_probe_auditor";

function taskChange(task: Record<string, unknown> & { id: string }): Record<string, unknown> {
  return { type: "component", component: "task-change", data: { task } };
}

/** The assignee of a synthetic item's task, or undefined for non-task items. */
function probeAssignee(item: Record<string, unknown>): string | undefined {
  return (item.data as { task?: BoardTask } | undefined)?.task?.assignee;
}

/** A synthetic, fully-correct delegation run's item stream. Probes perturb it. */
function goodItems(
  overrides: {
    researcher?: Partial<BoardTask>;
    auditor?: Partial<BoardTask>;
    addTaskScope?: string | undefined;
    drainTasks?: { id: string; status: string }[];
    generator?: Record<string, unknown> | null;
    /** The auditor worker's rendered turn. `null` omits its trace entirely. */
    auditorTurn?: string | null;
  } = {},
): Record<string, unknown>[] {
  const researcher: Record<string, unknown> & { id: string } = {
    id: RESEARCHER_ID,
    assignee: "researcher",
    goal: "report your code",
    createdAt: 1000,
    startedAt: 1100,
    ...overrides.researcher,
  };
  const auditor: Record<string, unknown> & { id: string } = {
    id: AUDITOR_ID,
    assignee: "auditor",
    goal: "verify the code",
    input: HANDOFF,
    createdAt: 1200,
    startedAt: 1300,
    ...overrides.auditor,
  };
  const items: Record<string, unknown>[] = [
    taskChange(researcher),
    taskChange(auditor),
    {
      type: "tool_output",
      blockName: "addTask",
      // The emit-time worker-scope stamp. `undefined` = the coordinator's own scope.
      ...("addTaskScope" in overrides
        ? overrides.addTaskScope !== undefined
          ? { taskId: overrides.addTaskScope }
          : {}
        : { taskId: RESEARCHER_ID }),
      output: { ok: true, taskId: AUDITOR_ID },
    },
    {
      type: "tool_output",
      blockName: RUN_BOARD_TOOL_NAME,
      output: {
        status: "drained",
        tasks: overrides.drainTasks ?? [
          { id: RESEARCHER_ID, status: "completed" },
          { id: AUDITOR_ID, status: "completed" },
        ],
      },
    },
  ];
  if (overrides.generator !== null) {
    items.push({
      type: "block_trace",
      blockName: "coordinatorWithTeam",
      generator: overrides.generator ?? {
        prompt: "You are the coordinator. Your agents:\n- researcher: …\n- auditor: …",
        tools: ["addTask", RUN_BOARD_TOOL_NAME],
        user: [USER_TURN],
        history: [],
      },
    });
  }
  // The auditor worker's own generator trace — the boundary layer 2 reads.
  if (overrides.auditorTurn !== null) {
    items.push({
      type: "block_trace",
      blockName: `skillWorker_${SKILL_NAME}_auditor`,
      generator: {
        prompt: `Verifies a code it is handed. Your sign-off token is ${AUDIT_TOKEN}.`,
        user: [
          {
            role: "user",
            content: overrides.auditorTurn ?? `Task: verify the code\n\nInput: ${HANDOFF}`,
          },
        ],
      },
    });
  }
  return items;
}

/** Each probe: a name and a predicate that must be true. */
const PROBES: readonly (readonly [string, () => boolean])[] = [
  // --- marker matching (ON side: bounded, exact, case-sensitive) ---
  ["hasMarker: standalone occurrence matches", () => hasMarker(`answer: ${SECRET}`, SECRET)],
  ["hasMarker: embedded occurrence does NOT match", () => !hasMarker(`x${SECRET}y`, SECRET)],
  ["hasMarker: lowercased echo does NOT match", () => !hasMarker(SECRET.toLowerCase(), SECRET)],
  ["hasMarker: surrounding punctuation still matches", () => hasMarker(`(${SECRET}).`, SECRET)],
  ["hasMarker: newline-delimited matches", () => hasMarker(`${SECRET}\n${AUDIT_TOKEN}`, SECRET)],
  ["hasMarker: absent marker does not match", () => !hasMarker("no codes here", SECRET)],
  ["hasMarker: hyphen-glued suffix does NOT match", () => !hasMarker(`${SECRET}-EXTRA`, SECRET)],
  [
    "hasMarker: checks EVERY offset (glued first, bounded second)",
    () => hasMarker(`x${SECRET}y and ${SECRET}`, SECRET),
  ],

  // --- sentinel format (MARKER_FORMAT) ---
  ["format: current fixtures are valid", () => !throws(() => assertValidMarkers(FIXTURES))],
  [
    "format: rejects `additionalProperties` (occurs verbatim in generated tool schemas)",
    () => throws(() => assertValidMarker("x", "additionalProperties")),
  ],
  ["format: rejects a framework literal (`drained`)", () => throws(() => assertValidMarker("x", "drained"))],
  ["format: rejects an issue-id shape (`FIX-930`)", () => throws(() => assertValidMarker("x", "FIX-930"))],
  ["format: rejects lowercase letters", () => throws(() => assertValidMarker("x", SECRET.toLowerCase()))],
  ["format: rejects a short digit run", () => throws(() => assertValidMarker("x", "QORVIX-778"))],
  ["format: rejects a $-substitution sequence", () => throws(() => assertValidMarker("x", "$ARGUMENTS"))],
  ["format: rejects an English word", () => throws(() => assertValidMarker("x", "REPORT"))],

  // --- fixture independence ---
  ["independence: current fixtures pass", () => !throws(() => assertMutuallyIndependent(FIXTURES))],
  [
    "independence: identical values throw",
    () => throws(() => assertMutuallyIndependent([["a", SECRET], ["b", SECRET]])),
  ],
  [
    "independence: containment throws (the old secret+suffix shape)",
    () => throws(() => assertMutuallyIndependent([["a", SECRET], ["b", `${SECRET}-CHECKED-4413`]])),
  ],

  // --- corpus collision ---
  [
    "corpus: a clean corpus passes",
    () => !throws(() => assertNoCorpusCollision(FIXTURES, [["probe", "nothing to see"]])),
  ],
  [
    "corpus: a colliding corpus throws, case-folded",
    () => throws(() => assertNoCorpusCollision(FIXTURES, [["probe", `text ${SECRET.toLowerCase()} text`]])),
  ],

  // --- structural mid-drain fan-out ---
  ["fan-out: a correct run reports no failures", () => assertFannedOutMidDrain(goodItems()).length === 0],
  [
    "fan-out: no researcher task fails",
    () => assertFannedOutMidDrain(goodItems().filter((i) => probeAssignee(i) !== "researcher")).length > 0,
  ],
  [
    "fan-out: no auditor task fails",
    () => assertFannedOutMidDrain(goodItems().filter((i) => probeAssignee(i) !== "auditor")).length > 0,
  ],
  [
    "fan-out: a coordinator-scoped addTask fails attribution",
    () => assertFannedOutMidDrain(goodItems({ addTaskScope: undefined })).length > 0,
  ],
  [
    "fan-out: a researcher-scoped addTask for some OTHER task fails attribution",
    () =>
      assertFannedOutMidDrain(
        goodItems().map((i) =>
          i.blockName === "addTask" ? { ...i, output: { ok: true, taskId: "task_unrelated" } } : i,
        ),
      ).length > 0,
  ],
  [
    "fan-out: auditor absent from the FIRST drain fails",
    () => assertFannedOutMidDrain(goodItems({ drainTasks: [{ id: RESEARCHER_ID, status: "completed" }] })).length > 0,
  ],
  [
    "fan-out: auditor still `pending` in the FIRST drain fails",
    () =>
      assertFannedOutMidDrain(
        goodItems({
          drainTasks: [
            { id: RESEARCHER_ID, status: "completed" },
            { id: AUDITOR_ID, status: "pending" },
          ],
        }),
      ).length > 0,
  ],
  [
    "fan-out: an auditor task predating the researcher's claim fails timing",
    () => assertFannedOutMidDrain(goodItems({ auditor: { createdAt: 1050 } })).length > 0,
  ],

  // --- handoff isolation (the auditor task's REAL created payload) ---
  ["handoff: a correct payload reports no failures", () => assertAuditorTaskPayloadIsolated(goodItems()).length === 0],
  [
    "handoff: the graded secret in the auditor task's GOAL fails",
    () => assertAuditorTaskPayloadIsolated(goodItems({ auditor: { goal: `verify ${SECRET}` } })).length > 0,
  ],
  [
    "handoff: the graded secret in the auditor task's INPUT fails",
    () => assertAuditorTaskPayloadIsolated(goodItems({ auditor: { input: { code: SECRET } } })).length > 0,
  ],
  [
    "handoff: a LOWERCASED secret in the payload still fails (broad leak guard)",
    () =>
      assertAuditorTaskPayloadIsolated(
        goodItems({ auditor: { input: `${HANDOFF} ${SECRET.toLowerCase()}` } }),
      ).length > 0,
  ],
  [
    "handoff: the graded secret in metadata fails",
    () => assertAuditorTaskPayloadIsolated(goodItems({ auditor: { metadata: { note: SECRET } } })).length > 0,
  ],
  [
    "handoff: a missing handoff code fails",
    () => assertAuditorTaskPayloadIsolated(goodItems({ auditor: { input: "just verify it" } })).length > 0,
  ],
  [
    "handoff: a dep on the researcher task fails (upstream outputs render its secret)",
    () => assertAuditorTaskPayloadIsolated(goodItems({ auditor: { deps: [RESEARCHER_ID] } })).length > 0,
  ],
  [
    "handoff: the auditor's own OUTPUT is not graded as payload",
    () =>
      assertAuditorTaskPayloadIsolated(
        goodItems().map((i) => {
          const task = (i.data as { task?: BoardTask } | undefined)?.task;
          return task?.assignee === "auditor"
            ? taskChange({ ...(task as unknown as Record<string, unknown>), id: task.id, output: AUDIT_TOKEN })
            : i;
        }),
      ).length === 0,
  ],
  [
    "handoff: the code in GOAL with NO input fails (structured channel never exercised)",
    () =>
      assertAuditorTaskPayloadIsolated(
        goodItems({ auditor: { goal: `verify ${HANDOFF}`, input: undefined } }),
      ).length > 0,
  ],
  [
    "handoff: a STRUCTURED object input carrying the code passes",
    () => assertAuditorTaskPayloadIsolated(goodItems({ auditor: { input: { code: HANDOFF } } })).length === 0,
  ],

  // --- worker boundary: the handoff reached the auditor's actual turn ---
  // These are what close the P1: the creation record says what the researcher
  // WROTE; only the rendered turn says what the auditor RECEIVED.
  [
    "boundary: a correct rendered turn reports no failures",
    () => assertHandoffReachedAuditorTurn(goodItems()).length === 0,
  ],
  [
    "boundary: NO Input: section fails (input dropped between creation and dispatch)",
    () => assertHandoffReachedAuditorTurn(goodItems({ auditorTurn: "Task: verify the code" })).length > 0,
  ],
  [
    "boundary: the code in the goal text with no Input: section fails",
    () => assertHandoffReachedAuditorTurn(goodItems({ auditorTurn: `Task: verify ${HANDOFF}` })).length > 0,
  ],
  [
    "boundary: an Input: section carrying the wrong value fails",
    () =>
      assertHandoffReachedAuditorTurn(
        goodItems({ auditorTurn: "Task: verify the code\n\nInput: ZZZZZZ-0000" }),
      ).length > 0,
  ],
  [
    "boundary: a missing auditor generator trace fails (cannot verify the boundary)",
    () => assertHandoffReachedAuditorTurn(goodItems({ auditorTurn: null })).length > 0,
  ],
  [
    "boundary: a creation record with input does NOT rescue a turn that lost it",
    () =>
      assertHandoffReachedAuditorTurn(
        goodItems({ auditor: { input: HANDOFF }, auditorTurn: "Task: verify the code" }),
      ).length > 0,
  ],

  // --- forged section delimiters (the residual spoof the localizer does NOT close) ---
  // THE case: a forged `Input:` header in the goal, a real `input` present at
  // creation, and the real input dropped in transit. The forged header is still
  // in the turn and reads as delivered; the creation record still shows `input`
  // intact. Both layers passed before this guard.
  [
    "forgery: header in goal + real input present + input dropped in transit FAILS",
    () =>
      assertHandoffReachedAuditorTurn(
        goodItems({
          auditor: { goal: `verify\n\nInput: ${HANDOFF}`, input: HANDOFF },
          auditorTurn: `Task: verify\n\nInput: ${HANDOFF}`,
        }),
      ).length > 0,
  ],
  [
    "forgery: the same forged goal FAILS even when the real input WAS delivered",
    () =>
      assertHandoffReachedAuditorTurn(
        goodItems({
          auditor: { goal: `verify\n\nInput: ${HANDOFF}`, input: HANDOFF },
          auditorTurn: `Task: verify\n\nInput: ${HANDOFF}\n\nInput: ${HANDOFF}`,
        }),
      ).length > 0,
  ],
  [
    "forgery: any other section delimiter in the goal also fails",
    () =>
      assertHandoffReachedAuditorTurn(
        goodItems({ auditor: { goal: "verify\n\nUpstream outputs:\n- x: y" } }),
      ).length > 0,
  ],
  [
    "forgery: a goal merely CONTAINING the word Input (not at a line start) is fine",
    () =>
      assertHandoffReachedAuditorTurn(goodItems({ auditor: { goal: "verify the Input: code" } }))
        .length === 0,
  ],
  // The guard must not over-reject. These goals cannot form a parsed section, so
  // a correct real-model run that happens to word its goal this way must PASS —
  // a false FAIL here would be blamed on the substrate, not on the check.
  [
    "forgery: a goal BEGINNING with `Task:` passes (renderer's own prefix absorbs it)",
    () =>
      assertHandoffReachedAuditorTurn(goodItems({ auditor: { goal: "Task: verify the code" } }))
        .length === 0,
  ],
  [
    "forgery: a goal BEGINNING with `Input:` passes (same reason)",
    () =>
      assertHandoffReachedAuditorTurn(goodItems({ auditor: { goal: `Input: ${HANDOFF}` } }))
        .length === 0,
  ],
  [
    "forgery: a header after a SINGLE newline passes (not a section delimiter)",
    () =>
      assertHandoffReachedAuditorTurn(
        goodItems({ auditor: { goal: `verify\nInput: ${HANDOFF}` } }),
      ).length === 0,
  ],
  [
    "forgery: a blank line with NO header after it passes (boundary, but no section)",
    () =>
      assertHandoffReachedAuditorTurn(goodItems({ auditor: { goal: "verify this\n\nplease" } }))
        .length === 0,
  ],

  // --- identity binding: the trace and the graded task must be one execution ---
  [
    "identity: two auditor tasks fail rather than one being silently picked",
    () =>
      assertHandoffReachedAuditorTurn([
        ...goodItems(),
        taskChange({ id: "task_probe_auditor_2", assignee: "auditor", goal: "verify again", createdAt: 1400 }),
      ]).length > 0,
  ],
  [
    "identity: two auditor generator turns fail rather than one being silently picked",
    () =>
      assertHandoffReachedAuditorTurn([
        ...goodItems(),
        {
          type: "block_trace",
          blockName: `skillWorker_${SKILL_NAME}_auditor`,
          generator: { user: [{ role: "user", content: "Task: verify the code" }] },
        },
      ]).length > 0,
  ],

  // --- rendered-context grep ---
  ["context: a clean rendered context reports no failures", () => assertNoMarkerInRenderedContext(goodItems()).length === 0],
  [
    "context: a missing block_trace fails (capture is explicitly enabled, so this means it broke)",
    () => assertNoMarkerInRenderedContext(goodItems({ generator: null })).length > 0,
  ],
  [
    "context: a marker in the rendered prompt fails",
    () => assertNoMarkerInRenderedContext(goodItems({ generator: { prompt: `roster ${SECRET}` } })).length > 0,
  ],
  [
    "context: a marker among the captured tool NAMES fails",
    () =>
      assertNoMarkerInRenderedContext(goodItems({ generator: { prompt: "clean", tools: [AUDIT_TOKEN] } }))
        .length > 0,
  ],

  // --- roster leak, against the REAL agentPurpose and the REAL authored prompts ---
  ["roster: the authored worker prompts leak no marker into the roster", () => assertNoRosterLeak().length === 0],
];

/** Run every probe. Returns the failing probe names (empty = all green). */
function runProbes(): string[] {
  const failed: string[] = [];
  for (const [name, predicate] of PROBES) {
    let ok = false;
    try {
      ok = predicate();
    } catch (e) {
      ok = false;
      failed.push(`${name} (threw: ${(e as Error).message})`);
      continue;
    }
    if (!ok) failed.push(name);
  }
  return failed;
}

async function runGoalCheck(): Promise<string[]> {
  const failures: string[] = [];

  // Probes first — always, before any model call. A grader bug must not be
  // reported as a substrate verdict.
  const probeFailures = runProbes();
  console.log(`probes: ${PROBES.length - probeFailures.length}/${PROBES.length}`);
  if (probeFailures.length > 0) {
    return probeFailures.map((name) => `PROBE FAILED (grader bug, not a substrate verdict): ${name}`);
  }

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
  const activated = await activateTeam("deleg-on");
  if (activated.error) return [`skill activation failed: ${activated.error.message}`];

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
  // ...and the fan-out must be a real HANDOFF, not the researcher smuggling its
  // own graded secret into the auditor's context.
  failures.push(...assertAuditorTaskPayloadIsolated(on.items as never));
  // ...and the handoff must have survived all the way to the worker boundary,
  // not merely been written onto the task record.
  failures.push(...assertHandoffReachedAuditorTurn(on.items as never));
  failures.push(...assertNoMarkerInRenderedContext(on.items as never));

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
      `\n    task ids created by researcher-scoped addTask calls: ${JSON.stringify(
        (on.items as never as Record<string, unknown>[])
          .filter((i) => i.blockName === "addTask" && i.taskId !== undefined)
          .map((i) => (i.output as { taskId?: string } | undefined)?.taskId)
          .filter(Boolean),
      )} (must include the auditor task id)\n` +
      (() => {
        const auditor = boardTasks(on.items as never).find((t) => t.assignee === "auditor");
        const trace = (on.items as never as Record<string, unknown>[]).find(
          (i) =>
            i.type === "block_trace" &&
            (i as { generator?: unknown }).generator !== undefined &&
            String(i.blockName ?? "").toLowerCase().includes("auditor"),
        );
        const user = trace ? (trace.generator as { user?: unknown }).user : undefined;
        const turn = Array.isArray(user)
          ? user.map((m) => messageText(m as { content?: unknown })).join("\n")
          : "";
        return (
          `    auditor task's created payload (leak net — NEITHER graded marker):\n` +
          `      ${auditor ? creationPayload(auditor).slice(0, 300) : "(no auditor task)"}\n` +
          `    auditor's RENDERED TURN at the worker boundary (authoritative handoff proof):\n` +
          `      ${JSON.stringify(turn.slice(0, 300))}\n` +
          `      Input: section must carry "${HANDOFF}" → ${JSON.stringify(inputSection(turn) ?? "(ABSENT)")}\n`
        );
      })() +
      `delegation OFF terminal output: ${JSON.stringify(offOutput.slice(0, 300))}\n` +
      GRADED_MARKERS.map(
        ({ label, marker }) =>
          `  ${label} "${marker}" present anywhere: ${offOutput.includes(marker)} (must be false)\n`,
      ).join(""),
  );

  return failures;
}

// `runGoal` owns the verdict format and the exit code (goals/lib/verdict.mts).
// `runGoalCheck` keeps returning a plain `string[]` so none of its graders or
// early returns change shape.
await runGoal(async () => ({
  failures: await runGoalCheck(),
  evidence:
    `the coordinator's terminal answer carried BOTH independent markers (the ` +
    `researcher's secret and the auditor's sign-off token; neither derivable from the other), ` +
    `AND the auditor's task was structurally proven to be created mid-drain by the researcher: ` +
    `an addTask was emitted from inside the researcher's task scope, and the auditor's task was ` +
    `created after the researcher was claimed — a window in which the coordinator is blocked. ` +
    `The handoff was verified AT THE WORKER BOUNDARY: the auditor's rendered turn carried an ` +
    `"Input:" section with the handoff code, so the payload survived dispatch rather than merely ` +
    `being written onto the task record. ` +
    `The no-delegation baseline, given the identical prompt and request, produced neither ` +
    `marker — so the pass is attributable to delegation and fan-out actually running.`,
}));
