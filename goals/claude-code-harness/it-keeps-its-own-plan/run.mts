/**
 * claude-code-harness › it keeps its own plan. The contract is `goal.md`; this
 * is its runnable form.
 *
 * A host runs Claude Code from a flow with `recordWork` on and no prompt of its
 * own, on a multi-step job that names no tool and says nothing about planning.
 * The agent must keep its own to-do list, and the list must be readable back
 * from the run's state, through the app's resource route, as a person's app
 * reads it.
 *
 * Every attempt gets a fresh session, a fresh checkout seeded from the
 * fixture, and its own request id, and the plan rows are read under that
 * request's prefix only, so one attempt's rows can never count for another.
 *
 * The stream is tapped for ONE thing, the run's `system/init` message, and only
 * for the evidence line: which model ran and whether the plan tools were
 * offered to it. Nothing is graded from the stream.
 *
 * Run:      pnpm tsx goals/claude-code-harness/it-keeps-its-own-plan/run.mts
 * Control:  GOAL_CONTROL=empty-prompt (the run is given `systemPrompt: ""`,
 *           the blank start every run had before the default changed)
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
import { httpActions, loadFixture, runGoal, silentLogger } from "../../lib/index.mts";

type Job = { name: string; files: Record<string, string>; prompt: string };

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["empty-prompt"];
if (CONTROL !== "" && !CONTROLS.includes(CONTROL)) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
}

/** 3 of 3 for the PASS; 2 of 2 under the control, which only has to show the record stays short. */
const RUNS = Number(process.env.GOAL_RUNS ?? (CONTROL === "" ? 3 : 2));
const KIND = "it-keeps-its-own-plan";
const USER_ID = "u_plan_goal";
const ORG_ID = "org_plan_goal";
const PLAN_TOOLS = ["TaskCreate", "TaskUpdate"];
const RUN_TIMEOUT_MS = 15 * 60_000;

const jobs = loadFixture<Job[]>(import.meta.url, "jobs.json");

// The anti-game rule, enforced on the fixture rather than trusted: a job that
// names a plan tool or asks for planning proves the instruction, not the default.
for (const job of jobs) {
  const banned = /\b(plan|planning|to-?do|todos?|tasks?|checklist)\b|TaskCreate|TaskUpdate|TodoWrite/i;
  if (banned.test(job.prompt)) {
    throw new Error(`fixture job "${job.name}" mentions planning or a plan tool; it must not`);
  }
}

/** What one attempt's `system/init` said, for the evidence line only. */
type InitSeen = { model: string | null; planToolsOffered: boolean | null; toolCalls: Record<string, number> };

/** The default resolver, with the init message noted on the way past. */
function tappedResolver(seen: InitSeen): ResolveClaudeAgent {
  return async (ctx) => {
    const resolved = await defaultResolveClaudeAgent(ctx);
    return {
      query: (args) => {
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
            // Tallied for the evidence line only: which tools the run called.
            // Never graded; the grade is the stored record.
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

function buildFlow(checkout: string, seen: InitSeen) {
  const agent = claudeCodeAgent({
    resolveClaudeAgent: tappedResolver(seen),
    recordWork: true,
    cwd: () => checkout,
    // Edits go through without a person to approve them; nothing else is
    // loosened. No settings files are loaded, so nothing on the host that
    // runs this (a user CLAUDE.md that mentions planning) can steer the run.
    permissionMode: "acceptEdits",
    settingSources: [],
    // THE variable under test. Absent is the shipped default; the control
    // passes the blank start explicitly.
    ...(CONTROL === "empty-prompt" ? { systemPrompt: "" } : {}),
  });
  return defineFlow({
    kind: KIND,
    actions: { work: { inputSchema: z.object({ prompt: z.string() }), block: agent } },
  } as never);
}

type PlanRow = { topic: string; clientData?: { title?: string | null; status?: string | null } };

/** One attempt: a fresh app, session and checkout; the plan rows its request wrote, read through the route. */
async function attempt(job: Job) {
  const checkout = seedCheckout(job);
  const seen: InitSeen = { model: null, planToolsOffered: null, toolCalls: {} };
  const state = createFlowState({
    flows: { [KIND]: buildFlow(checkout, seen) },
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
    const { call, open } = httpActions((await state.getRouter()) as never, USER_ID);
    const sessionId = await open(KIND, {});
    const sent = await call("POST", [KIND, sessionId, "actions", "work"], { userId: USER_ID, input: { prompt: job.prompt } });
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
    let cursor: string | undefined;
    do {
      const query = `?topicPrefix=${encodeURIComponent(`observed-plan/${requestId}/`)}&limit=100${
        cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
      }`;
      const page = await call("GET", ["sessions", sessionId, "resources", "observed-plan"], undefined, query);
      if (page.status !== 200) throw new Error(`the plan record answered ${page.status}: ${page.text}`);
      const body = JSON.parse(page.text) as { items: PlanRow[]; nextCursor?: string };
      rows.push(...body.items);
      cursor = body.nextCursor;
    } while (cursor !== undefined);

    return { job: job.name, rows, handle, runError, seen };
  } finally {
    await state.dispose().catch(() => undefined);
    rmSync(checkout, { recursive: true, force: true });
  }
}

await runGoal(async (failures) => {
  const lines: string[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    // Alternate the jobs, so the PASS covers both held-out inputs, not one input three times.
    const job = jobs[i % jobs.length]!;
    const run = await attempt(job);
    const statuses = run.rows.map((row) => row.clientData?.status ?? "null");
    const completed = statuses.filter((status) => status === "completed").length;
    const offered =
      run.seen.planToolsOffered === null ? "unknown" : run.seen.planToolsOffered ? "yes" : "NO";
    const line = `run ${i + 1} (${run.job}, model ${run.seen.model ?? "unknown"}, plan tools offered: ${offered}): ${run.rows.length} plan rows [${statuses.join(", ")}]; tools called ${JSON.stringify(run.seen.toolCalls)}`;
    lines.push(line);
    console.log(line);

    if (run.runError !== undefined || run.handle?.outcome !== "finished") {
      failures.push(
        `run ${i + 1}: run:finished — the run did not finish (${run.runError !== undefined ? JSON.stringify(run.runError).slice(0, 300) : `outcome ${run.handle?.outcome ?? "none"}`})`,
      );
    }
    if (run.rows.length < 2) {
      failures.push(
        `run ${i + 1}: plan:rows — ${run.rows.length} plan rows, need at least 2${run.seen.planToolsOffered === false ? " (the run was not offered TaskCreate/TaskUpdate)" : ""}`,
      );
    }
    if (completed < 1) {
      failures.push(`run ${i + 1}: plan:completed — no plan row reached completed`);
    }
  }
  return {
    failures,
    evidence: `${RUNS} of ${RUNS} runs kept their own plan${CONTROL ? ` (control ${CONTROL})` : ""}:\n  ${lines.join("\n  ")}`,
  };
});
