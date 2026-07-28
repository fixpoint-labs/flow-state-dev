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
 *   - The pre-fix shape is detected explicitly: a `completeTask` that FAILED
 *     with a raw `illegal status transition` throw is reported as its own
 *     failure, not silently rolled into "the case never came up".
 *
 * Run: pnpm tsx goals/delegation/recovers-from-a-refused-task-transition/run.mts
 */
import {
  DEFAULT_MODEL,
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
// `tool_output.toolCall.stepNumber` is the field that answers "which model step
// chose this call", and it is the field this check wants. It is populated ONLY
// by the framework-owned per-step loop, which the generator takes when the
// resolved model exposes `streamStep`/`generateStep`. A model served through a
// LAZILY LOADED gateway package — which is what a bare `createModelResolver()`
// plus `AI_GATEWAY_API_KEY` produces — is wrapped by `createLazyGeneratorModel`,
// and that wrapper exposes only `generate`/`stream`. So the generator takes the
// legacy SDK-owned multi-step path, and no step index is ever recorded.
// Confirmed empirically on this path: every `toolCall` carried `callId`, `name`,
// `alias`, `arguments`, `generatorBlock` — and no `stepNumber`.
//
// Rather than assume one tool call per step, the step is RECONSTRUCTED from
// when each `tool_output` item was CREATED. `emitToolOutputAround` stamps
// `ts: Date.now()` when it builds the item, BEFORE the tool runs — so the
// timestamp records when the call was DISPATCHED, not how long it took. A
// step's calls are dispatched together in one synchronous burst; the next
// step's calls cannot be dispatched until a provider round trip has completed.
// The two are separated by orders of magnitude, which is what makes the split
// safe rather than merely plausible: observed same-burst spreads are 0–1ms and
// observed between-step gaps are 1.3–1.7s. `SAME_STEP_MS` sits between them
// with three orders of magnitude of headroom on each side, and the real
// measured gap is printed in the verdict log so the margin stays visible.
//
// When `stepNumber` IS present (a step-capable model), it wins — the check
// tightens automatically rather than staying on the reconstruction.
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
  data?: { task?: { id: string; status: string; output?: unknown } };
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

/** What one run produced, read entirely from the emitted item stream. */
interface Observed {
  /** Terminal answer the caller received. */
  answer: string;
  /** Coordinator-scope tool calls, in dispatch order, with steps assigned. */
  calls: Call[];
  /** Where the step indices came from. */
  stepSource: StepSource;
  /** Final status + output per task. */
  tasks: Map<string, { status: string; output?: unknown }>;
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
  const tasks = new Map<string, { status: string; output?: unknown }>();
  const raw: Omit<Call, "step">[] = [];
  const recorded: (number | undefined)[] = [];

  for (const item of items) {
    if (item.type === "component" && item.component === "task-change" && item.data?.task) {
      const task = item.data.task;
      // Keyed items upsert — the last snapshot per id is the final state.
      tasks.set(task.id, { status: task.status, output: task.output });
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

// ---------------------------------------------------------------------------
// The goal
// ---------------------------------------------------------------------------

async function runGoalCheck(): Promise<{ failures: string[]; log: string }> {
  // Setup honesty, asserted before any model call.
  if (fx.settledRequests.length === 0) {
    return {
      failures: [
        "setup invalid: the fixture supplies no already-answered request, so nothing would ever " +
          "ask the board to complete a task that was never started",
      ],
      log: "",
    };
  }
  if (fx.openRequests.length === 0) {
    return {
      failures: [
        "setup invalid: the fixture supplies no request that needs doing, so the board has no " +
          "real work and 'the run still completed' would be vacuous",
      ],
      log: "",
    };
  }
  const desk = `${COORDINATOR_PROMPT}\n${USER_TURN}`.toLowerCase();
  if (desk.includes(fx.workerSalt.toLowerCase())) {
    return {
      failures: ["setup invalid: the worker salt leaked into the coordinator's own context"],
      log: "",
    };
  }

  const observed = await run("refused-transition");
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
    return { failures, log: summarize(observed, undefined, []) };
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
    return { failures, log: summarize(observed, refusal, advertised) };
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

  // --- C) The rejected task was actually dealt with. Recovering on some OTHER
  //        task would satisfy (B) while leaving the refused one untouched. ---
  if (rejectedTaskId === undefined) {
    failures.push(
      `the rejection carries no taskId, so the refused task cannot be identified. ` +
        `Message: ${JSON.stringify(message)}`,
    );
  } else {
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
  const salted = [...observed.tasks.values()].filter(
    (t) => t.status === "completed" && String(t.output ?? "").includes(fx.workerSalt),
  );
  if (salted.length === 0) {
    failures.push(
      `no completed task carries the held-out worker salt "${fx.workerSalt}" — the request that ` +
        `genuinely needed doing never ran, so the recovery came at the cost of the real work`,
    );
  }

  return { failures, log: summarize(observed, refusal, advertised) };
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
