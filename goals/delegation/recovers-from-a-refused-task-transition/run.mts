/**
 * Goal check — the refused-transition contract (FIX-950): when a real
 * coordinator asks the board for a status change the task cannot make, the
 * board REFUSES IT AS A RESULT the model can act on, and the model recovers
 * using one of the calls the refusal named.
 *
 * Real model, real path, out of CI. See goal.md for the contract.
 *
 * What makes this a goal check rather than a dressed-up unit test:
 *   - The refusal is provoked through the SHIPPED delegation surface. A bound
 *     agent-declaring skill installs the board; the model calls `addTask` and
 *     then `completeTask` itself; the rejection arrives as the tool result the
 *     model actually receives. Unit tests prove the message composes; only this
 *     proves a model reads it and acts on it.
 *   - The probe is a workflow, not a scripted call sequence. The skill says
 *     requests that need no work are closed out on the board and must never be
 *     left outstanding — it never names the calls that answer this rejection. A
 *     coordinator following it walks into `completeTask` on a task that was
 *     never started, which is exactly the case FIX-950 makes recoverable.
 *   - The recovery is read from a model step STRICTLY LATER than the rejecting
 *     one. A step's tool calls settle concurrently, so a sibling of the rejected
 *     call was chosen BEFORE the guidance existed; scoring one as the recovery
 *     would pass a coordinator that never read the message. See `assignSteps`
 *     for how the step boundary is established on a path where the framework
 *     does not record one.
 *   - The available calls are PARSED OUT OF THE REJECTION, never hardcoded, so
 *     the check stays true if the composer's list changes.
 *   - The recovery is BOUND TO THE REFUSED TASK by id, not inferred from the
 *     task leaving `pending` — a `runBoard` drain moves it out of `pending` on
 *     its own. See criterion (C) and the probe suite that falsifies it.
 *   - The salted worker turn is BOUND TO THE OPEN REQUEST by the task's goal,
 *     not accepted from any completed task — the fixture also holds requests
 *     that arrived answered, and running one of THOSE on a worker is the
 *     inversion of what the skill says. See criterion (E) and its probe.
 *   - The pre-fix shape is detected explicitly: a `completeTask` that FAILED
 *     with a raw `illegal status transition` throw is reported as its own
 *     failure, not silently rolled into "the case never came up".
 *
 * Run: pnpm tsx goals/delegation/recovers-from-a-refused-task-transition/run.mts
 */
import {
  DEFAULT_MODEL,
  fail,
  loadFixture,
  runGoal,
  stripIntentOverrides,
} from "../../lib/index.mts";
import { defineFlow, generator } from "@flow-state-dev/core";
import type { InitialSkill } from "@flow-state-dev/core";
import {
  runAction,
  createInMemoryStores,
  createModelResolver,
} from "@flow-state-dev/engine";
import { createSkillsLibrary } from "@flow-state-dev/orchestration";
// Deep source imports on purpose. The tool NAMES this check reasons about must
// be the real ones: which tools belong to `taskTools` decides what counts as a
// recovery attempt, and `runBoard`'s name decides what is scored as outside the
// message's contract. A local list would keep passing after a rename. If either
// path moves, this goal fails loudly at import, which is the intended failure.
import { buildTaskToolsList } from "../../../packages/orchestration/src/skills/task-tools-capability.ts";
import { RUN_BOARD_TOOL_NAME } from "../../../packages/orchestration/src/skills/delegation-surface.ts";
import { z } from "zod";

// The PORTABLE model id (goals/lib/model.mts): this runner builds a bare
// `createModelResolver()`, which applies whatever gateway the env provides.
const MODEL = DEFAULT_MODEL;

const fx = loadFixture<{
  workerSalt: string;
  openRequests: string[];
  settledRequests: { request: string; answer: string }[];
}>(import.meta.url);

// A bare `createModelResolver()` (no declared intents) rejects an ambient intent
// ladder; clear it so the resolver auto-wires the gateway from AI_GATEWAY_API_KEY.
stripIntentOverrides();

/** The eight `taskTools` names, from the real tool list. */
const TASK_TOOL_NAMES = new Set(
  (buildTaskToolsList() as { name: string }[]).map((t) => t.name),
);

/** The soft-error prefix the refused-transition result carries. */
const REFUSAL_CODE = "illegal_status_transition";

/**
 * The message the collection throws when a transition is refused. Before
 * FIX-950 this reached the model as a raw tool FAILURE carrying this text;
 * matching it is what lets the pre-fix arm be reported as "the refusal arrived
 * as a throw" rather than the much weaker "the case never came up".
 */
const RAW_THROW_TEXT = /illegal status transition/i;

const SKILL_NAME = "request-desk";

/**
 * The worker's salt sits on the SECOND line of the agent prompt, deliberately.
 * `agentPurpose` copies the FIRST nonempty line of each agent's prompt into the
 * roster the coordinator reads before any task runs; a salt there would let a
 * coordinator that never ran a worker still emit it. Agent specs live in
 * frontmatter, which `stripFrontmatter` removes from the rendered skill body, so
 * line two is genuinely out of the coordinator's reach.
 *
 * The body is a general intake workflow. It says what must be TRUE of the board
 * (nothing that needs no work is left outstanding on it; nothing that needs no
 * work is handed to a worker) and it points the model at the board's own
 * refusals. It never names `cancelTask` or `blockTask` — naming them would turn
 * this into a test of instruction-following instead of a test of whether the
 * refusal message carries the model.
 *
 * It DOES name `runner` as the assignee, and that is load-bearing rather than
 * decorative: an unassigned task lands on the delegation floor, whose synthetic
 * prompt has no salt, so a run that left the assignee unset completed its real
 * work on a worker that could not evidence itself. Naming the declared agent
 * keeps the salt assertion measuring the board and not the coordinator's choice
 * of worker. Observed as a real FAIL before this line existed.
 */
const skill: InitialSkill = {
  name: SKILL_NAME,
  skillMd: [
    "---",
    "description: Log every incoming request on the board and settle the ones that need no work.",
    "agents:",
    "  runner:",
    "    prompt: |",
    "      You carry out one logged request per task and report what you did.",
    `      End your reply with a space and the token ${fx.workerSalt}.`,
    "      Keep it to one short sentence.",
    "---",
    "",
    "Every request goes on the board. Before you do anything else, call addTask once per request,",
    "one task per request, with the request text as the goal and runner as the assignee.",
    "",
    "Then settle the board, before any of it runs:",
    "",
    "- A request that arrived with its answer already in hand needs no work from anyone. Close it",
    "  out on the board with that answer.",
    "- A request that still needs doing is left alone at this stage — the board will run it.",
    "",
    "The board is the authority on what it will accept. When it turns an action down it tells you",
    "the task's current status and which calls are available from there. Read that and act on it in",
    "your very next step.",
    "",
    "A request that needs no work must never be left sitting on the board as outstanding work, and",
    "it must never be handed to a worker just to get it moving. If you cannot close it out, take it",
    "off the board instead.",
    "",
    `Only once the board holds nothing but real work, call ${RUN_BOARD_TOOL_NAME}. Then report every`,
    "request and what happened to it.",
  ].join("\n"),
};

const COORDINATOR_PROMPT = [
  "You are a request desk with a private task board and a team reachable through it.",
  "Follow your active skill's instructions exactly when they apply.",
].join("\n");

const USER_TURN = [
  "Here is today's intake.",
  "",
  "These arrived with their answer already in hand:",
  ...fx.settledRequests.map((r) => `- ${r.request} — answer: ${r.answer}`),
  "",
  "These still need doing:",
  ...fx.openRequests.map((r) => `- ${r}`),
  "",
  "Handle the whole intake and report back on every request.",
].join("\n");

const inputSchema = z.object({ message: z.string() });

const skills = createSkillsLibrary({
  catalog: {},
  initialSkills: [skill],
  workerModelId: MODEL,
  // Session scope keeps the fixture self-contained — no org identity/persistence.
  scope: "session",
});

const flow = defineFlow({
  kind: "refused-transition-goal",
  requireUser: true,
  actions: {
    intake: {
      inputSchema,
      block: generator({
        name: "requestDesk",
        model: MODEL,
        prompt: COORDINATOR_PROMPT,
        inputSchema,
        user: (i: { message: string }) => i.message,
        outputSchema: z.string(),
        itemVisibility: { client: true, history: true },
        history: true,
        uses: [skills.with({ active: [SKILL_NAME] } as never)],
        maxIterations: 16,
      }),
      userMessage: (i: { message: string }) => i.message,
    },
  },
})({ id: "default" });

const stores = createInMemoryStores();
const runtimeConfig = { modelResolver: createModelResolver() } as never;

// ---------------------------------------------------------------------------
// The step boundary
//
// `tool_output.toolCall.stepNumber` is not populated on this path, so the step
// is reconstructed from dispatch time: `emitToolOutputAround` stamps `ts`
// BEFORE the tool runs, a step's calls are dispatched in one synchronous burst,
// and the next step's cannot start until a provider round trip completes.
// Measured same-burst spread 0–1ms vs between-step gaps 970–2174ms; SAME_STEP_MS
// sits between them and the real gap is printed every run. If `stepNumber` is
// ever present it wins automatically.
//
// Why it is absent, and why enabling it is not in this check's reach, is traced
// in goal.md → "The step boundary". That is the contract; this is the summary.
// ---------------------------------------------------------------------------

/** Dispatch-time spread within which two tool calls belong to the same step. */
const SAME_STEP_MS = 100;

interface StreamItem {
  type?: string;
  component?: string;
  blockName?: string;
  status?: string;
  taskId?: string;
  ts?: number;
  output?: unknown;
  error?: { message?: string };
  toolCall?: { stepNumber?: number; arguments?: string };
  // `goal` is read by criterion (E) to bind the salted completion to the request
  // that actually needed doing. The change stream carries the whole task, so
  // this narrowing is the runner's own — widen it, don't work around it.
  data?: { task?: { id: string; status: string; output?: unknown; goal?: string } };
}

/** One tool call the COORDINATOR made, as the stream recorded it. */
interface Call {
  name: string;
  /** Dispatch time — when the `tool_output` item was constructed. */
  ts: number;
  /** The model step this call belongs to. Assigned by `assignSteps`. */
  step: number;
  /** Parsed `toolCall.arguments`, or `{}` when unparseable. */
  args: Record<string, unknown>;
  /** The tool's return value, present when the call SETTLED. */
  output: { ok?: boolean; error?: string; taskId?: string } | undefined;
  /** The error message, present when the call THREW (the pre-fix shape). */
  threw: string | undefined;
}

/** How a run's step indices were established. Reported in the verdict log. */
type StepSource = "toolCall.stepNumber" | "dispatch burst";

/**
 * A task's final state, as the change stream left it. `goal` is what the
 * coordinator logged the task under — criterion (E) reads it to tell the
 * request that needed doing apart from the ones that arrived answered.
 */
interface TaskState {
  status: string;
  output?: unknown;
  goal?: string;
}

/** What one run produced, read entirely from the emitted item stream. */
interface Observed {
  /** Terminal answer the caller received. */
  answer: string;
  /** Coordinator-scope tool calls, in dispatch order, with steps assigned. */
  calls: Call[];
  /** Where the step indices came from. */
  stepSource: StepSource;
  /** Final status, output and goal per task. */
  tasks: Map<string, TaskState>;
  /** Set when the action itself errored, so the graders can say so. */
  runError: string | undefined;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Assign a step index to every call. Uses the framework's own `stepNumber` when
 * EVERY call carries one — a partially-stamped run is not trusted, since a
 * mixture of real indices and reconstructed ones cannot be ordered against each
 * other. Otherwise splits the dispatch-ordered calls wherever the gap exceeds
 * {@link SAME_STEP_MS}.
 */
function assignSteps(
  raw: Omit<Call, "step">[],
  recorded: (number | undefined)[],
): { calls: Call[]; stepSource: StepSource } {
  if (raw.length > 0 && recorded.every((n) => typeof n === "number")) {
    return {
      calls: raw.map((c, i) => ({ ...c, step: recorded[i] as number })),
      stepSource: "toolCall.stepNumber",
    };
  }
  const sorted = [...raw].sort((a, b) => a.ts - b.ts);
  let step = 0;
  const calls: Call[] = [];
  for (const [i, call] of sorted.entries()) {
    if (i > 0 && call.ts - sorted[i - 1]!.ts > SAME_STEP_MS) step += 1;
    calls.push({ ...call, step });
  }
  return { calls, stepSource: "dispatch burst" };
}

async function run(sessionId: string): Promise<Observed> {
  const res = await runAction({
    flow,
    actionName: "intake" as never,
    input: { message: USER_TURN },
    userId: "goal-user",
    sessionId,
    stores,
    runtimeConfig,
  });

  const items = res.items as unknown as StreamItem[];
  const tasks = new Map<string, TaskState>();
  const raw: Omit<Call, "step">[] = [];
  const recorded: (number | undefined)[] = [];

  for (const item of items) {
    if (item.type === "component" && item.component === "task-change" && item.data?.task) {
      const task = item.data.task;
      // Keyed items upsert — the last snapshot per id is the final state.
      tasks.set(task.id, { status: task.status, output: task.output, goal: task.goal });
      continue;
    }
    if (item.type !== "tool_output" || typeof item.blockName !== "string") continue;
    // A tool_output emitted inside a worker's task scope is stamped with that
    // task's id; the coordinator runs outside any task scope, so its own calls
    // carry none. Workers on this board reach `taskTools` too, so without this
    // filter a worker's call could be graded as the coordinator's recovery.
    if (item.taskId !== undefined) continue;
    raw.push({
      name: item.blockName,
      ts: typeof item.ts === "number" ? item.ts : 0,
      args: parseArgs(item.toolCall?.arguments),
      output: (item.output ?? undefined) as Call["output"],
      threw: item.status === "failed" ? (item.error?.message ?? "") : undefined,
    });
    recorded.push(item.toolCall?.stepNumber);
  }

  const { calls, stepSource } = assignSteps(raw, recorded);
  return {
    answer: typeof res.output === "string" ? res.output : "",
    calls,
    stepSource,
    tasks,
    runError: res.error?.message,
  };
}

// ---------------------------------------------------------------------------
// Reading the rejection
// ---------------------------------------------------------------------------

/** True when this call settled as a refused-transition result (post-fix shape). */
function isRefusal(call: Call): boolean {
  return call.output?.ok === false && (call.output.error ?? "").includes(REFUSAL_CODE);
}

/** True when this call THREW the raw transition error (the pre-fix shape). */
function threwRefusal(call: Call): boolean {
  return call.threw !== undefined && RAW_THROW_TEXT.test(call.threw);
}

/**
 * The calls the rejection advertised, parsed out of its "From here you can call
 * …" clause. DERIVED, never hardcoded: if the composer changes which tools it
 * offers, this check follows it instead of grading against a stale list.
 *
 * Returns `[]` for a terminal-source rejection, which names no calls at all —
 * a state the graders below report distinctly, because reaching it means the
 * probe never provoked the pending case it exists to provoke.
 */
function advertisedCalls(message: string): string[] {
  const clause = /From here you can call ([^.]+)\./.exec(message);
  if (!clause) return [];
  return clause[1]!
    .split(/,|\bor\b/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * Calls the coordinator made in a step STRICTLY LATER than `step`, in dispatch
 * order. This is the whole step-boundary rule: a step's tool calls settle
 * concurrently, so anything the model emitted alongside the rejected call was
 * chosen before the rejection existed. Grading a sibling as the recovery would
 * pass a coordinator that never read the message — and would fail a correct one
 * that recovered properly in the following step.
 */
function callsAfterStep(observed: Observed, step: number): Call[] {
  return observed.calls.filter((c) => c.step > step);
}

const describe = (c: Call) => `${c.name}@step${c.step}${c.threw !== undefined ? "(THREW)" : ""}`;

/**
 * The differences a coordinator's logged goal is allowed to have from the
 * request text: case, whitespace, and trailing punctuation. Everything else
 * has to match, so the comparison below can stay one-way.
 */
const normalizeRequest = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.,;:!?]+$/, "")
    .trim();

const OPEN_REQUESTS = fx.openRequests.map(normalizeRequest);

/**
 * True when `goal` is one of the requests that still needed doing.
 *
 * Read off the FIXTURE, never a literal — swap the intake and this follows it.
 *
 * Containment is ONE-WAY: the goal must contain the WHOLE open request. The
 * skill has the coordinator log each request's text as the goal, so the two
 * shapes worth tolerating are a goal that quotes the request and adds to it,
 * and one that drops its trailing period — `normalizeRequest` plus this
 * direction cover both. The reverse (`open.includes(goal)`) is deliberately
 * NOT accepted: it matches any fragment, so a task goal of "draft" would
 * satisfy (E) while the request it was supposed to serve sat cancelled. That
 * is the same false pass (E) was tightened to close, and putting it back
 * inside the new guard would make the guard decorative.
 */
function servesOpenRequest(goal: string | undefined): boolean {
  if (goal === undefined) return false;
  const g = normalizeRequest(goal);
  return OPEN_REQUESTS.some((open) => g.includes(open));
}

/**
 * Setup honesty — the fixture is a valid intake for this check at all.
 *
 * Runs at module load, which is BEFORE the probe constants below index the
 * fixture and before the probe suite runs. The ordering is deliberate: probes
 * still precede any model call, but a probe driven by a dishonest fixture
 * reports `PROBE FAILED (grader bug)` for what is really a bad intake, and an
 * empty array would throw on the index before reaching a boundary check that
 * lived further down. A setup error should say so, so it is asserted first.
 */
function assertFixtureIsHonest(): void {
  if (fx.settledRequests.length === 0) {
    fail(
      "setup invalid: the fixture supplies no already-answered request, so nothing would ever " +
        "ask the board to complete a task that was never started",
    );
  }
  if (fx.openRequests.length === 0) {
    fail(
      "setup invalid: the fixture supplies no request that needs doing, so the board has no " +
        "real work and 'the run still completed' would be vacuous",
    );
  }
  // A blank open request would make (E)'s containment vacuous — every goal
  // contains the empty string, so every completed task would look like the
  // real work.
  if (OPEN_REQUESTS.some((open) => open === "")) {
    fail(
      `setup invalid: an open request is blank once normalized ` +
        `(${JSON.stringify(fx.openRequests)}), so every task goal would read as serving it`,
    );
  }
  // (E) can only tell the real work from the work that needed none if the two
  // kinds of request are actually distinguishable by their text. Asserted here
  // rather than argued in prose: a later intake where an answered request reads
  // as an open one would silently hand (E) back its unbound behaviour, which is
  // the exact defect this criterion was tightened to close.
  const ambiguous = fx.settledRequests.filter((r) => servesOpenRequest(r.request));
  if (ambiguous.length > 0) {
    fail(
      `setup invalid: already-answered request(s) ` +
        `${JSON.stringify(ambiguous.map((r) => r.request))} also read as one of the open ` +
        `requests ${JSON.stringify(fx.openRequests)}, so criterion (E) could no longer tell a ` +
        `worker turn on the real work apart from one on work that needed none`,
    );
  }
  const desk = `${COORDINATOR_PROMPT}\n${USER_TURN}`.toLowerCase();
  if (desk.includes(fx.workerSalt.toLowerCase())) {
    fail("setup invalid: the worker salt leaked into the coordinator's own context");
  }
}

assertFixtureIsHonest();

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grade one observed run against criteria A–E.
 *
 * Pure — it reads nothing but the observation it is handed, which is what lets
 * the probe suite below drive it with synthetic runs and prove each criterion
 * FAILS when its property is violated. Returns the refusal and the advertised
 * list alongside the failures so the caller can build the verdict log.
 */
function grade(observed: Observed): {
  failures: string[];
  refusal: Call | undefined;
  advertised: string[];
} {
  const failures: string[] = [];
  const trail = observed.calls.map(describe).join(", ");

  // --- A) The anti-game control. Without a real, refused transition every
  //        assertion below is about a case that never happened. ---
  const refusal = observed.calls.find(isRefusal);
  if (refusal === undefined) {
    const thrown = observed.calls.filter(threwRefusal);
    if (thrown.length > 0) {
      failures.push(
        `the transition WAS refused, but as a THROW: ${thrown.length} call(s) failed with ` +
          `${JSON.stringify(thrown[0]!.threw)}. A thrown tool error reaches the model as a raw ` +
          `failure with no status, no reason, and no available calls — the exact shape FIX-950 ` +
          `replaced with a recoverable result. Calls: ${trail}`,
      );
    } else {
      failures.push(
        `ANTI-GAME VOID: no task tool ever returned a ${REFUSAL_CODE} result and none threw the ` +
          `raw transition error either, so the coordinator never asked for a transition the board ` +
          `refuses. Everything below would be true by accident rather than by recovery. ` +
          `Calls: ${trail}`,
      );
    }
    return { failures, refusal: undefined, advertised: [] };
  }

  const message = refusal.output!.error!;
  const rejectedTaskId = refusal.output!.taskId;
  const advertised = advertisedCalls(message);

  if (advertised.length === 0) {
    failures.push(
      `the rejection named no available calls: ${JSON.stringify(message)}. That is the TERMINAL ` +
        `branch of the message — the coordinator asked to transition a task that had already ` +
        `settled, so the probe never reached the pending case it exists to provoke and there is ` +
        `no advertised call to recover with. Calls: ${trail}`,
    );
    return { failures, refusal, advertised };
  }
  const unknown = advertised.filter((name) => !TASK_TOOL_NAMES.has(name));
  if (unknown.length > 0) {
    failures.push(
      `the rejection advertises ${JSON.stringify(unknown)}, which are not task tools ` +
        `(${JSON.stringify([...TASK_TOOL_NAMES])}) — the message points the model at calls it ` +
        `does not have. Message: ${JSON.stringify(message)}`,
    );
  }

  // --- B) Recovery, read from a strictly later step. ---
  const later = callsAfterStep(observed, refusal.step);
  // `runBoard` is NOT one of the eight task tools and the message never names
  // it, so it can neither satisfy nor violate a criterion about "the calls the
  // message named" — grading it either way would hold the model to a contract
  // the message does not make. It is skipped when looking for the recovery, and
  // counted in the log instead. It cannot pass silently: a coordinator whose
  // only answer to the rejection is to drain makes no advertised call at all,
  // and the branch below FAILs it.
  const laterTaskTools = later.filter((c) => TASK_TOOL_NAMES.has(c.name));
  const recovery = laterTaskTools[0];
  if (recovery === undefined) {
    failures.push(
      `the coordinator made NO task-tool call after the rejection (step ${refusal.step}). It was ` +
        `told what it could do and did none of it. Later calls: ` +
        `${JSON.stringify(later.map(describe))}. All calls: ${trail}`,
    );
  } else if (!advertised.includes(recovery.name)) {
    failures.push(
      `the first task-tool call after the rejection was ${describe(recovery)}, which the ` +
        `rejection did NOT name as available ${JSON.stringify(advertised)} — the coordinator ` +
        `did not act on the guidance it was given. Message: ${JSON.stringify(message)}`,
    );
  }

  // --- C) The rejected task was actually dealt with, BY the recovery.
  //        Recovering on some OTHER task would satisfy (B) while leaving the
  //        refused one untouched. That hazard is one question, but it takes TWO
  //        assertions, because either one alone is satisfiable without it:
  //
  //        C1 — was an advertised recovery AIMED at the refused task? Read from
  //        the call's own `taskId` argument. This has to be asserted directly:
  //        the obvious stand-in, "the task is no longer pending at the end", is
  //        a PROXY THE SUBSTRATE CAN SATISFY ON ITS OWN — `runBoard` claims and
  //        completes whatever is still pending, so a drain moves the refused
  //        task out of `pending` with no recovery call ever naming it. Every
  //        advertisable tool (blockTask/cancelTask/completeTask/failTask) takes
  //        `taskId`, so the binding is readable for any list the composer emits.
  //
  //        C2 — did it TAKE? An advertised call aimed at the right task can
  //        still not land (a second refusal, a CAS conflict). C1 reads intent
  //        from the arguments and cannot see that; the final state can.
  //
  //        Neither subsumes the other — C2 passes on a drain that C1 catches,
  //        and C1 passes on an aimed call that C2 catches. Both stay. The probe
  //        suite below holds that in place from both directions.
  //
  //        C1 scans ALL later task-tool calls, not just `recovery`
  //        (`laterTaskTools[0]`): a coordinator that cancels some other task
  //        first and then the refused one has still bound its recovery to it.
  if (rejectedTaskId === undefined) {
    failures.push(
      `the rejection carries no taskId, so the refused task cannot be identified. ` +
        `Message: ${JSON.stringify(message)}`,
    );
  } else {
    const bound = laterTaskTools.filter(
      (c) => advertised.includes(c.name) && c.args.taskId === rejectedTaskId,
    );
    if (bound.length === 0) {
      failures.push(
        `no advertised recovery call targeted the refused task ${rejectedTaskId} — the ` +
          `coordinator made advertised call(s) ` +
          `${JSON.stringify(laterTaskTools.filter((c) => advertised.includes(c.name)).map(describe))} ` +
          `after the rejection but aimed them at ` +
          `${JSON.stringify([
            ...new Set(
              laterTaskTools
                .filter((c) => advertised.includes(c.name))
                .map((c) => String(c.args.taskId ?? "(no taskId)")),
            ),
          ])}, not at the task it was refused on. The refusal guidance was never applied to the ` +
          `task that received it. Calls: ${trail}`,
      );
    }

    const finalState = observed.tasks.get(rejectedTaskId);
    if (finalState === undefined) {
      failures.push(
        `the refused task ${rejectedTaskId} never appears in the task-change stream — its final ` +
          `state cannot be read`,
      );
    } else if (finalState.status === "pending") {
      failures.push(
        `the refused task ${rejectedTaskId} is still "pending" at the end of the run — whatever ` +
          `the coordinator did next, it did not apply it to the task it was refused on`,
      );
    }

    // --- D) No retry of the call it was told is unavailable. A later
    //        `completeTask` that SUCCEEDED is not a retry: the task had
    //        legitimately been started by then, so it was no longer pending. ---
    const retries = later.filter(
      (c) =>
        c.name === "completeTask" && c.args.taskId === rejectedTaskId && c.output?.ok !== true,
    );
    if (retries.length > 0) {
      failures.push(
        `the coordinator re-issued completeTask on the refused task ${rejectedTaskId} ` +
          `${retries.length} time(s) in a later step, and was refused again ` +
          `(${JSON.stringify(retries.map(describe))}) — it read the rejection as noise and ` +
          `retried instead of taking one of the calls it was offered`,
      );
    }
  }

  // --- E) The run still finished coherently. Being refused is not the outcome;
  //        "refused, recovered, and still completed" is. ---
  if (observed.runError !== undefined) {
    failures.push(`the action itself errored: ${observed.runError}`);
  }
  if (observed.answer.trim() === "") {
    failures.push(
      `the coordinator produced an EMPTY terminal answer — recovering from the rejection but not ` +
        `completing the intake is a failure of this outcome, not a pass`,
    );
  }
  //        The salt has to sit ON THE OPEN REQUEST, not merely somewhere on the
  //        board. The salt alone proves only that SOME worker turn happened; it
  //        is silent about which request that turn served. The fixture supplies
  //        both kinds, and the skill says an already-answered one must never be
  //        handed to a worker — so a run that got the routing exactly backwards
  //        (worked a settled request, dropped the open one) still produces a
  //        salted completion. Binding it to `fx.openRequests` is what makes this
  //        an assertion about the real work getting done. See the probe suite.
  const salted = [...observed.tasks.values()].filter(
    (t) => t.status === "completed" && String(t.output ?? "").includes(fx.workerSalt),
  );
  if (salted.length === 0) {
    failures.push(
      `no completed task carries the held-out worker salt "${fx.workerSalt}" — the request that ` +
        `genuinely needed doing never ran, so the recovery came at the cost of the real work`,
    );
  } else if (!salted.some((t) => servesOpenRequest(t.goal))) {
    failures.push(
      `the held-out worker salt "${fx.workerSalt}" appears only on completed task(s) whose goal ` +
        `is not one of the requests that needed doing ${JSON.stringify(fx.openRequests)} — ` +
        `salted goals were ${JSON.stringify(salted.map((t) => t.goal ?? "(no goal)"))}. A worker ` +
        `ran, but on work that did not need doing, while the request that did went unserved`,
    );
  }

  return { failures, refusal, advertised };
}

/**
 * The measured dispatch gap between the last call of `step` and the first call
 * of the next one — the margin the reconstructed step boundary rests on. Printed
 * so a reader can see whether it was seconds (a real provider round trip) or
 * barely over the threshold.
 */
function stepGapMs(observed: Observed, step: number): number | undefined {
  const before = observed.calls.filter((c) => c.step === step);
  const after = observed.calls.filter((c) => c.step > step);
  if (before.length === 0 || after.length === 0) return undefined;
  return Math.min(...after.map((c) => c.ts)) - Math.max(...before.map((c) => c.ts));
}

function summarize(observed: Observed, refusal: Call | undefined, advertised: string[]): string {
  const drains = observed.calls.filter((c) => c.name === RUN_BOARD_TOOL_NAME);
  return [
    `${observed.calls.length} coordinator tool call(s); ${drains.length} ` +
      `${RUN_BOARD_TOOL_NAME} call(s); steps from ${observed.stepSource}`,
    `calls: ${observed.calls.map(describe).join(", ")}`,
    refusal === undefined
      ? `no refused transition observed`
      : `refused at step ${refusal.step}: ${JSON.stringify(refusal.output?.error)}`,
    `advertised: ${JSON.stringify(advertised)}`,
    refusal === undefined
      ? `after the rejection: n/a`
      : `after the rejection: ${JSON.stringify(
          callsAfterStep(observed, refusal.step).map(describe),
        )} (dispatch gap ${stepGapMs(observed, refusal.step) ?? "n/a"}ms vs a ` +
        `${SAME_STEP_MS}ms same-step threshold)`,
    `board: ${JSON.stringify([...observed.tasks].map(([id, t]) => `${id}=${t.status}`))}`,
    `answer: ${JSON.stringify(observed.answer.slice(0, 200))}`,
  ].join("\n  ");
}

// ---------------------------------------------------------------------------
// DETERMINISTIC PROBE SUITE
//
// `grade` exercised against synthetic runs BEFORE any model call, to prove each
// criterion FAILS when its property is violated. A criterion that has never
// been seen to fail is not evidence — it may be asserting something the
// substrate satisfies on its own.
//
// This suite exists because that is exactly what happened to (C). The hazard
// was identified correctly and the comment named it precisely ("Recovering on
// some OTHER task would satisfy (B) while leaving the refused one untouched"),
// then it was guarded with `finalState.status !== "pending"` — a condition a
// `runBoard` drain satisfies by claiming and completing the refused task, with
// no recovery call targeting it at all. The guard was verified against ONE path
// (the coordinator cancels the refused task, so it ends `cancelled`) and
// asserted OF THE PROPERTY (the refused task was dealt with by the recovery).
// `codexScenario` below is the run that passed the old guard, and it is now the
// probe that fails without the binding check.
//
// Runs inline and unconditionally: it costs milliseconds, needs no credential,
// and is therefore impossible to skip.
// ---------------------------------------------------------------------------

const REFUSED_ID = "task_probe_refused";
const OTHER_ID = "task_probe_other";
const REAL_ID = "task_probe_real";
/** A second already-answered request, used by the inverted-routing probe. */
const SETTLED_RAN_ID = "task_probe_settled_ran";

/** The goal a probe's task carries — read from the fixture, never a literal. */
const OPEN_GOAL = fx.openRequests[0]!;
const SETTLED_GOAL = fx.settledRequests[0]!.request;
const OTHER_SETTLED_GOAL = (fx.settledRequests[1] ?? fx.settledRequests[0]!).request;

/** The result a `completeTask` on a still-pending task really returns. */
const REFUSAL_MESSAGE =
  `illegal_status_transition: task "${REFUSED_ID}" is pending, so transitioning to completed is ` +
  `not available — a pending task has not been started yet. ` +
  `From here you can call blockTask or cancelTask.`;

function probeCall(over: Partial<Call> & { name: string; step: number }): Call {
  return { ts: 0, args: {}, output: undefined, threw: undefined, ...over };
}

/** The rejecting call itself — shared by every probe, since (A) must hold in all. */
const refusedCompleteTask = probeCall({
  name: "completeTask",
  step: 1,
  args: { taskId: REFUSED_ID },
  output: { ok: false, error: REFUSAL_MESSAGE, taskId: REFUSED_ID },
});

/**
 * A synthetic run. Defaults describe a fully-correct one: refused on
 * `REFUSED_ID` at step 1, that same task cancelled at step 2, the board's real
 * work completed carrying the held-out salt, intake answered. Probes perturb it.
 */
function observedRun(over: {
  calls?: Call[];
  tasks?: [string, TaskState][];
} = {}): Observed {
  return {
    answer: "Handled the intake.",
    calls: over.calls ?? [
      probeCall({ name: "addTask", step: 0, output: { ok: true, taskId: REFUSED_ID } }),
      refusedCompleteTask,
      probeCall({ name: "cancelTask", step: 2, args: { taskId: REFUSED_ID }, output: { ok: true } }),
      probeCall({ name: RUN_BOARD_TOOL_NAME, step: 3 }),
    ],
    stepSource: "dispatch burst",
    tasks: new Map(
      over.tasks ?? [
        [REFUSED_ID, { status: "cancelled", goal: SETTLED_GOAL }],
        [
          REAL_ID,
          {
            status: "completed",
            output: `Drafted the notice. ${fx.workerSalt}`,
            goal: OPEN_GOAL,
          },
        ],
      ],
    ),
    runError: undefined,
  };
}

/**
 * The false positive codex found: the coordinator is refused on `REFUSED_ID`,
 * makes an ADVERTISED recovery call in a strictly later step — but aims it at a
 * different pending task — and then drains. The drain claims and completes the
 * refused task, so it ends non-`pending` without the guidance ever reaching it.
 * Satisfies A, B, D and E, and satisfied the old C.
 */
const codexScenario = observedRun({
  calls: [
    probeCall({ name: "addTask", step: 0, output: { ok: true, taskId: REFUSED_ID } }),
    refusedCompleteTask,
    probeCall({ name: "cancelTask", step: 2, args: { taskId: OTHER_ID }, output: { ok: true } }),
    probeCall({ name: RUN_BOARD_TOOL_NAME, step: 3 }),
  ],
  tasks: [
    [
      REFUSED_ID,
      { status: "completed", output: `Ran it anyway. ${fx.workerSalt}`, goal: SETTLED_GOAL },
    ],
    [OTHER_ID, { status: "cancelled", goal: OTHER_SETTLED_GOAL }],
    // The real work still got done here — this probe isolates C1, so it must
    // trip C1 and nothing else. Without it the drained settled task would be
    // the only salted completion and (E) would fire too.
    [
      REAL_ID,
      { status: "completed", output: `Drafted the notice. ${fx.workerSalt}`, goal: OPEN_GOAL },
    ],
  ],
});

/**
 * The inversion criterion (E) exists to catch: the coordinator recovers from
 * the refusal correctly (A–D all clean), but the work it actually ran was an
 * already-answered request — handed to a worker, which the skill says must
 * never happen — while the one request that genuinely needed doing was
 * cancelled. A salted `completed` task exists, so an (E) that only looks for
 * the salt PASSES this run.
 */
const invertedRoutingScenario = observedRun({
  tasks: [
    [REFUSED_ID, { status: "cancelled", goal: SETTLED_GOAL }],
    [
      SETTLED_RAN_ID,
      { status: "completed", output: `Confirmed it. ${fx.workerSalt}`, goal: OTHER_SETTLED_GOAL },
    ],
    [REAL_ID, { status: "cancelled", goal: OPEN_GOAL }],
  ],
});

/**
 * The same inversion, dressed to defeat a matcher that accepts a FRAGMENT of
 * the open request. The salted completion's goal is one word of that request —
 * enough for `open.includes(goal)`, nowhere near enough to be the work — while
 * the request itself sits cancelled.
 *
 * This is the shape the first cut of `servesOpenRequest` let through: its
 * containment ran both ways, which put the very false pass (E) was tightened
 * to close back inside the new guard. One-way containment is what closes it,
 * and this probe is what keeps it closed.
 */
const fragmentGoalScenario = observedRun({
  tasks: [
    [REFUSED_ID, { status: "cancelled", goal: SETTLED_GOAL }],
    [
      SETTLED_RAN_ID,
      {
        status: "completed",
        output: `Confirmed it. ${fx.workerSalt}`,
        goal: OPEN_GOAL.split(" ")[0]!,
      },
    ],
    [REAL_ID, { status: "cancelled", goal: OPEN_GOAL }],
  ],
});

/** True when some failure mentions the recovery not being bound to the refused task. */
const saysUnbound = (failures: string[]) =>
  failures.some((f) => f.includes("no advertised recovery call targeted the refused task"));

/** True when some failure mentions the refused task still being pending. */
const saysStillPending = (failures: string[]) =>
  failures.some((f) => f.includes(`is still "pending" at the end of the run`));

/** True when some failure mentions the salt not sitting on an open request. */
const saysUnserved = (failures: string[]) =>
  failures.some((f) => f.includes("not one of the requests that needed doing"));

const PROBES: readonly (readonly [string, () => boolean])[] = [
  // Positive control. Without this, a C1 that rejects everything would look
  // like a working guard — the adversarial probes below would all still pass.
  ["a correct run grades clean", () => grade(observedRun()).failures.length === 0],

  // The finding, as a run. This is the falsification: it PASSED before C1.
  [
    "C1: recovery aimed at another task + refused task drained to completed FAILS",
    () => saysUnbound(grade(codexScenario).failures),
  ],

  // C2 is not made redundant by C1: an advertised call aimed at the RIGHT task
  // that did not land leaves the task pending, which only the final state sees.
  [
    "C2: recovery aimed at the refused task but refused again still FAILS",
    () =>
      saysStillPending(
        grade(
          observedRun({
            calls: [
              probeCall({ name: "addTask", step: 0, output: { ok: true, taskId: REFUSED_ID } }),
              refusedCompleteTask,
              probeCall({
                name: "cancelTask",
                step: 2,
                args: { taskId: REFUSED_ID },
                output: { ok: false, error: "task_not_found", taskId: REFUSED_ID },
              }),
            ],
            // Goals set for the same reason `codexScenario` carries them: this
            // probe isolates C2, so the run must trip C2 and nothing else.
            tasks: [
              [REFUSED_ID, { status: "pending", goal: SETTLED_GOAL }],
              [
                REAL_ID,
                { status: "completed", output: `Drafted it. ${fx.workerSalt}`, goal: OPEN_GOAL },
              ],
            ],
          }),
        ).failures,
      ),
  ],

  // C1 scans every later task-tool call, not just the first: recovering on
  // another task and THEN on the refused one is a real recovery, not a miss.
  [
    "C1: a later advertised call on the refused task counts even if not the first",
    () =>
      !saysUnbound(
        grade(
          observedRun({
            calls: [
              probeCall({ name: "addTask", step: 0, output: { ok: true, taskId: REFUSED_ID } }),
              refusedCompleteTask,
              probeCall({
                name: "cancelTask",
                step: 2,
                args: { taskId: OTHER_ID },
                output: { ok: true },
              }),
              probeCall({
                name: "cancelTask",
                step: 3,
                args: { taskId: REFUSED_ID },
                output: { ok: true },
              }),
            ],
          }),
        ).failures,
      ),
  ],

  // (E)'s salt assertion, falsified. The salt alone only proves SOME worker
  // ran; this run has one, on an already-answered request, with the real one
  // cancelled. EXACTLY ONE failure is the load-bearing number: it means the
  // unbound grader returned zero and would have PASSED the inversion.
  [
    "E: salt on an already-answered request with the open one cancelled FAILS",
    () => {
      const { failures } = grade(invertedRoutingScenario);
      return failures.length === 1 && saysUnserved(failures);
    },
  ],

  // The same inversion with the salted goal reduced to a fragment of the open
  // request. Guards the matcher's direction: a bidirectional `servesOpenRequest`
  // PASSES this run, which is how the fragment path got in the first time.
  [
    "E: salt on a goal that is only a fragment of the open request FAILS",
    () => {
      const { failures } = grade(fragmentGoalScenario);
      return failures.length === 1 && saysUnserved(failures);
    },
  ],
];

function runProbes(): string[] {
  const failed: string[] = [];
  for (const [name, predicate] of PROBES) {
    let ok: boolean;
    try {
      ok = predicate();
    } catch (e) {
      failed.push(`${name} (threw: ${(e as Error).message})`);
      continue;
    }
    if (!ok) failed.push(name);
  }
  return failed;
}

// ---------------------------------------------------------------------------
// The goal
// ---------------------------------------------------------------------------

async function runGoalCheck(): Promise<{ failures: string[]; log: string }> {
  // Probes first — always, before any model call. A grader bug must not be
  // reported as a substrate verdict.
  const probeFailures = runProbes();
  console.log(`  probes: ${PROBES.length - probeFailures.length}/${PROBES.length}`);
  if (probeFailures.length > 0) {
    return {
      failures: probeFailures.map(
        (name) => `PROBE FAILED (grader bug, not a substrate verdict): ${name}`,
      ),
      log: "",
    };
  }

  // Setup honesty already ran at module load — see `assertFixtureIsHonest`,
  // which has to precede the probe constants that index the fixture.
  const observed = await run("refused-transition");
  const { failures, refusal, advertised } = grade(observed);
  return { failures, log: summarize(observed, refusal, advertised) };
}

await runGoal(async () => {
  const { failures, log } = await runGoalCheck();
  if (log !== "") console.log(`  ${log}`);
  return {
    failures,
    evidence:
      `a real coordinator, following a skill that never names the recovery, asked the board to ` +
      `complete a task that had never been started. The board refused it AS A RESULT ` +
      `(${REFUSAL_CODE}) naming the task's status and the calls available from it; in a strictly ` +
      `later model step the coordinator's first task-tool call was one of those advertised calls, ` +
      `it never re-issued the refused completeTask, the refused task did not stay "pending", and ` +
      `the intake still finished with a real worker turn behind it.`,
  };
});
