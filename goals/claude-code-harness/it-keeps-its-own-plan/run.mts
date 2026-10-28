/**
 * claude-code-harness › it keeps its own plan. The contract is `goal.md`; this
 * is its runnable form.
 *
 * Two claims, each on a real Claude Code run started from a flow with
 * `recordWork` on, and each on a fresh session and seeded checkout:
 *
 * 1. **Default arm.** A host that gives no `systemPrompt` starts the run from
 *    Claude Code's own prompt, the way the `claude` CLI starts it, not from
 *    the SDK's empty one. Checked on what the real SDK `query()` was handed.
 *    Whether the agent then keeps a to-do list is reported, never graded: on
 *    newer models it usually doesn't, and the record honestly stays empty.
 * 2. **Planning arm.** When the agent does keep a to-do list, the list lands
 *    in the plan record. The run is offered the to-do tools and the job asks
 *    for them, so the agent plans; the rows are then read back from stored
 *    state, through the app's resource route, under that request's prefix.
 *
 * The stream is tapped only for the evidence line (the model, whether the
 * to-do tools were offered, which tools were called). Nothing is graded from
 * the stream.
 *
 * Run:      pnpm tsx goals/claude-code-harness/it-keeps-its-own-plan/run.mts
 * Controls: GOAL_CONTROL=empty-prompt (the default arm passes `systemPrompt: ""`)
 *           GOAL_CONTROL=no-record   (the planning arm runs with `recordWork` off)
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { defineFlow } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";
import {
  claudeCodeAgent,
  defaultResolveClaudeAgent,
  type ResolveClaudeAgent,
  type SdkAgentHandle,
} from "@flow-state-dev/claude-code/sdk";
import { actingAs, loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

type Job = { name: string; files: Record<string, string>; prompt: string };

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["empty-prompt", "no-record"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
}

const KIND = "it-keeps-its-own-plan";
const USER_ID = "u_plan_goal";
const ORG_ID = "org_plan_goal";
const PLAN_TOOLS = ["TaskCreate", "TaskUpdate"];
const RUN_TIMEOUT_MS = 15 * 60_000;

/**
 * Added to the job in the planning arm only. That arm proves the recorder, not
 * that the agent plans unasked, so it asks.
 */
const PLAN_ASK =
  " Use TaskCreate to record each step before you start, and TaskUpdate to mark each one completed as you finish it.";

/** What Claude Code's own prompt looks like on the wire to the SDK. */
const CLAUDE_CODE_PROMPT = JSON.stringify({ type: "preset", preset: "claude_code" });

const jobs = loadFixture<Job[]>(import.meta.url, "jobs.json");

// The default arm reports whether the agent plans unasked, so a job that asks
// for planning would make that report meaningless. Enforced, not trusted.
for (const job of jobs) {
  const banned = /\b(plan|planning|to-?do|todos?|tasks?|checklist)\b|TaskCreate|TaskUpdate|TodoWrite/i;
  if (banned.test(job.prompt)) {
    throw new Error(`fixture job "${job.name}" mentions planning or a plan tool; it must not`);
  }
}

/** What the run was handed and what it did, for the prompt leg and the evidence line. */
type Seen = {
  systemPromptSent: string | null;
  model: string | null;
  planToolsOffered: boolean | null;
  toolCalls: Record<string, number>;
};

/** The default resolver, with the call's options and the stream noted on the way past. */
function tappedResolver(seen: Seen): ResolveClaudeAgent {
  return async (ctx) => {
    const resolved = await defaultResolveClaudeAgent(ctx);
    return {
      query: (args) => {
        // What the real SDK is handed: the surface the default is decided on.
        seen.systemPromptSent = JSON.stringify(args.options?.systemPrompt ?? null);
        const stream = resolved.query(args);
        return (async function* () {
          for await (const message of stream) {
            const m = message as { type?: string; subtype?: string; model?: string; tools?: string[] };
            if (m.type === "system" && m.subtype === "init") {
              seen.model = m.model ?? null;
              seen.planToolsOffered = Array.isArray(m.tools)
                ? PLAN_TOOLS.every((tool) => m.tools!.includes(tool))
                : null;
            }
            if (m.type === "assistant") {
              const content = (message as { message?: { content?: Array<{ type?: string; name?: string }> } }).message?.content ?? [];
              for (const block of content) {
                if (block.type === "tool_use" && block.name) seen.toolCalls[block.name] = (seen.toolCalls[block.name] ?? 0) + 1;
              }
            }
            yield message;
          }
        })();
      },
    };
  };
}

/** A throwaway checkout holding the job's files. */
function seedCheckout(job: Job): string {
  const dir = mkdtempSync(join(tmpdir(), `fsd-goal-plan-${job.name}-`));
  for (const [path, content] of Object.entries(job.files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

type Arm = "default" | "planning";

function buildFlow(arm: Arm, checkout: string, seen: Seen) {
  const agent = claudeCodeAgent({
    resolveClaudeAgent: tappedResolver(seen),
    recordWork: !(arm === "planning" && CONTROL === "no-record"),
    cwd: () => checkout,
    // Edits go through without a person to approve them. No settings files
    // are loaded, so nothing on the host that runs this (a user CLAUDE.md
    // that mentions planning) can steer the run.
    permissionMode: "acceptEdits",
    settingSources: [],
    // Newer models only offer the to-do tools when they are named here.
    ...(arm === "planning" ? { allowedTools: PLAN_TOOLS } : {}),
    // The default arm passes no prompt: that IS the default under test. The
    // control passes the blank start explicitly.
    ...(arm === "default" && CONTROL === "empty-prompt" ? { systemPrompt: "" } : {}),
  });
  return defineFlow({
    kind: KIND,
    actions: { work: { inputSchema: z.object({ prompt: z.string() }), block: agent } },
  } as never);
}

type PlanRow = { topic: string; clientData?: { title?: string | null; status?: string | null } };

/** One run: a fresh app, session and checkout; the plan rows its request wrote, read through the route. */
async function attempt(arm: Arm, job: Job) {
  const checkout = seedCheckout(job);
  const seen: Seen = { systemPromptSent: null, model: null, planToolsOffered: null, toolCalls: {} };
  const state = createFlowState({
    flows: { [KIND]: buildFlow(arm, checkout, seen) },
    stores: { default: { primary: inMemoryStores() } },
    logger: silentLogger,
    resolvePrincipal: (context: any) => {
      const user = context.request?.headers.get("x-user");
      return typeof user === "string" ? { userId: user, orgId: ORG_ID } : null;
    },
  } as never);
  try {
    const runtime = await state.getRuntime();
    // The runtime's own narration, off, so the runs and the verdict are what prints.
    runtime.runtimeConfig.logger = silentLogger as never;
    const { call, open } = actingAs((await state.getRouter()) as never, USER_ID);
    const sessionId = await open(KIND, {});
    const prompt = arm === "planning" ? job.prompt + PLAN_ASK : job.prompt;
    const sent = await call("POST", [KIND, sessionId, "actions", "work"], { userId: USER_ID, input: { prompt } });
    if (sent.status !== 202) throw new Error(`the action was refused (${sent.status}): ${sent.text}`);
    const requestId = JSON.parse(sent.text).request.id as string;
    // A real coding run takes minutes, longer than the library's idle wait
    // allows, so this waits on the request's own status.
    const deadline = Date.now() + RUN_TIMEOUT_MS;
    for (;;) {
      const status = JSON.parse((await call("GET", [KIND, "requests", requestId, "status"])).text).status;
      if (status !== "in_progress") break;
      if (Date.now() > deadline) throw new Error(`run on ${job.name} did not end within ${RUN_TIMEOUT_MS / 60_000} minutes`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const listed = await call("GET", ["sessions", sessionId, "requests"], undefined, "?include_result_output=true&limit=10");
    const request = (JSON.parse(listed.text).requests ?? []).find((r: { id: string }) => r.id === requestId);
    const handle = request?.result?.output as SdkAgentHandle | undefined;
    const runError = request?.result?.error;

    // The recorder escapes the request id into one key segment. Ids the
    // engine mints need no escaping; refuse one that would, rather than read
    // the wrong prefix and grade an empty page.
    if (!/^[A-Za-z0-9_.-]+$/.test(requestId) || requestId === "." || requestId === "..") {
      throw new Error(`request id ${JSON.stringify(requestId)} needs escaping; this goal reads it raw`);
    }
    const rows: PlanRow[] = [];
    let recorded = true;
    let cursor: string | undefined;
    do {
      const query = `?topicPrefix=${encodeURIComponent(`observed-plan/${requestId}/`)}&limit=100${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const page = await call("GET", ["sessions", sessionId, "resources", "observed-plan"], undefined, query);
      // With recording off the flow declares no plan record at all.
      if (page.status === 404) {
        recorded = false;
        break;
      }
      if (page.status !== 200) throw new Error(`the plan record answered ${page.status}: ${page.text}`);
      const body = JSON.parse(page.text) as { items: PlanRow[]; nextCursor?: string };
      rows.push(...body.items);
      cursor = body.nextCursor;
    } while (cursor !== undefined);

    return { job: job.name, rows, recorded, handle, runError, seen };
  } finally {
    await state.dispose().catch(() => undefined);
    rmSync(checkout, { recursive: true, force: true });
  }
}

type Run = Awaited<ReturnType<typeof attempt>>;

function describeRun(label: string, run: Run): string {
  const statuses = run.rows.map((row) => row.clientData?.status ?? "null");
  const offered = run.seen.planToolsOffered === null ? "unknown" : run.seen.planToolsOffered ? "yes" : "no";
  return `${label} (${run.job}, model ${run.seen.model ?? "unknown"}, prompt ${run.seen.systemPromptSent}, to-do tools offered: ${offered}): ${
    run.recorded ? `${run.rows.length} plan rows [${statuses.join(", ")}]` : "no plan record declared"
  }; tools called ${JSON.stringify(run.seen.toolCalls)}`;
}

function finished(label: string, run: Run, failures: string[]): void {
  if (run.runError !== undefined || run.handle?.outcome !== "finished") {
    failures.push(
      `${label}: run:finished — the run did not finish (${run.runError !== undefined ? JSON.stringify(run.runError).slice(0, 300) : `outcome ${run.handle?.outcome ?? "none"}`})`,
    );
  }
}

await runGoal(async (failures) => {
  const lines: string[] = [];
  // One run of each arm per job, so both held-out inputs are covered.
  for (const job of jobs) {
    const label = `default/${job.name}`;
    const run = await attempt("default", job);
    lines.push(describeRun(label, run));
    console.log(lines.at(-1));
    finished(label, run, failures);
    if (run.seen.systemPromptSent !== CLAUDE_CODE_PROMPT) {
      failures.push(`${label}: prompt:preset — the SDK was handed ${run.seen.systemPromptSent}, not Claude Code's own prompt`);
    }
  }
  for (const job of jobs) {
    const label = `planning/${job.name}`;
    const run = await attempt("planning", job);
    lines.push(describeRun(label, run));
    console.log(lines.at(-1));
    finished(label, run, failures);
    if (run.rows.length < 2) {
      failures.push(
        `${label}: plan:rows — ${run.recorded ? `${run.rows.length} plan rows` : "no plan record"}, need at least 2${run.seen.planToolsOffered === false ? " (the run was not offered TaskCreate/TaskUpdate)" : ""}`,
      );
    }
    if (!run.rows.some((row) => row.clientData?.status === "completed")) {
      failures.push(`${label}: plan:completed — no plan row reached completed`);
    }
  }
  return {
    failures,
    evidence: `default runs started from Claude Code's own prompt, and planning runs left their plans in the record${CONTROL ? ` (control ${CONTROL})` : ""}:\n  ${lines.join("\n  ")}`,
  };
});
