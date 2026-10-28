/**
 * Goal check — a coding run on a project that names Linear reads the Linear
 * issue it was given, through FSD's own connection, with the filer's key; and
 * the key never reaches the run.
 *
 * The `fsd` profile's Lab, opened in-process the way the profile opens it: its
 * tree, its two projects (both naming `linear`), its MCP servers, and Claude
 * Code through its Agent SDK as the coder. Two things differ, each said here:
 * the runs' checkout is a scratch repository mapped as the profile maps this
 * one (a check must not add worktrees to the checkout it runs in), and the
 * Shift Coordinator's model is scripted to file one task (its judgment is not
 * under test; what the run is handed and does is).
 *
 * 1. A held-out Linear issue is picked at run time from Linear's own API: one
 *    whose identifier and title this repository never mentions
 *    (`git grep` on HEAD) and the run's base never mentions either.
 * 2. `LINEAR_MCP_API_KEY` is unset in this process, so no seed stands in: the
 *    filer (the Lab's user) sets their key through the Lab's key route, as
 *    Settings does, from `LINEAR_API_KEY`.
 * 3. The Shift Coordinator files a task for the coder on FSD naming the issue by
 *    its identifier only. Its prompt carries no title.
 * 4. While the run works, every process whose working directory is the run's
 *    is read from `/proc`: its command line and environment. The Lab's own
 *    processes there are listed and not graded.
 *
 * PASS when all hold: the task's answer carries the title Linear's API gives;
 * the run's items hold at least one `mcp__linear__` tool call; at least one
 * Claude Code process was read while it ran, and the key is in none of their
 * command lines or environments, in no item, no request record, no session
 * and not in the task's row.
 *
 * Controls (`GOAL_CONTROL=list` prints them):
 *   no-linear   FSD's servers cleared on the project (`setMcpServers []`) before filing; FAILS on the title
 *   no-key      the filer's key cleared on the key route before filing; FAILS on the title
 *   key-in-run  the key handed to the run's environment (on `NO_PROXY`, a name the
 *               run is passed); FAILS on the key in a Claude Code process's environment
 *
 * Needs: LINEAR_API_KEY, AI_GATEWAY_API_KEY (the coder's judge, Jev), a
 * Claude Code Agent SDK that can run (signed in, or ANTHROPIC_API_KEY), git.
 * Spends Claude Code's model and Jev's; the Shift Coordinator's is scripted.
 *
 * Run: pnpm tsx goals/shift-manager/a-projects-coding-run-reads-its-linear/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createModelResolver } from "@flow-state-dev/core";
import { inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowInstance, GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { fail, goalTmpDir, REPO_ROOT, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { claudeCodeHarness, CLAUDE_CODE_RUN_TIMEOUT_MS } from "../../../packages/shift-manager/teams/devteam/harness.mts";
import { CHECKOUTS } from "../../../packages/shift-manager/teams/devteam/fsd-checkouts.mts";
import { FSD_MCP_SERVERS, FSD_PROJECTS } from "../../../packages/shift-manager/teams/devteam/fsd-projects.mts";
import { LAB_ORG_ID, LAB_USER_ID, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createScratchRepo } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { LIST_TASKS_ACTION } from "../../../packages/shift-manager/src/lib/conversation-tasks.ts";

const SLUG = "a-projects-coding-run-reads-its-linear";
const CONTROLS = ["no-linear", "no-key", "key-in-run"] as const;
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const KEY = process.env.LINEAR_API_KEY ?? "";
if (KEY === "") fail("LINEAR_API_KEY is not set: the check reads the held-out issue from Linear's API and sets it as the filer's key.");
// No seed: the stored key is the one that must pass.
delete process.env.LINEAR_MCP_API_KEY;
if (CONTROL === "key-in-run") {
  // A host name nothing resolves, so the run's proxying is unchanged; read when the Lab builds the harness.
  process.env.NO_PROXY = [process.env.NO_PROXY, KEY].filter((part) => part !== undefined && part !== "").join(",");
}

const CODER = "eng.coder";
const FSD = { visibility: "shared", id: "fsd" } as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const normal = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

/** Linear's GraphQL API, with the key as a bare Authorization header. */
async function linear<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json()) as { data?: T; errors?: unknown };
  if (!response.ok || body.data === undefined) throw new Error(`Linear answered ${response.status}: ${JSON.stringify(body.errors ?? null).slice(0, 300)}`);
  return body.data;
}

/** Whether `text` appears anywhere in `repo`'s HEAD, as a fixed string, any case. */
function mentioned(repo: string, text: string): boolean {
  try {
    execFileSync("git", ["grep", "-q", "-i", "-F", "-e", text, "HEAD", "--"], { cwd: repo, stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** A held-out issue: one neither this repository nor the run's base mentions, by identifier or title. */
async function heldOutIssue(base: string): Promise<{ identifier: string; title: string }> {
  const { issues } = await linear<{ issues: { nodes: Array<{ identifier: string; title: string }> } }>(
    "query { issues(first: 100, orderBy: updatedAt) { nodes { identifier title } } }",
  );
  const candidates = issues.nodes.filter((issue) => issue.title.trim().length >= 12);
  // Shuffled, so a run doesn't always pick the same issue.
  for (const issue of candidates.sort(() => Math.random() - 0.5)) {
    if ([REPO_ROOT, base].some((repo) => mentioned(repo, issue.identifier) || mentioned(repo, issue.title))) continue;
    return issue;
  }
  throw new Error(`none of Linear's ${issues.nodes.length} most recently updated issues is held out from this repository`);
}

/** A model that has the Shift Coordinator make `call` once, then stop. */
function scriptedShiftCoordinator(call: { toolName: string; args: Record<string, unknown> }): ModelResolver {
  // A container's FSDEV_DEFAULT_MODEL / FSDEV_INTENT_* would swap the model under the resolver.
  stripIntentOverrides();
  const base = createModelResolver();
  let made = false;
  const model: GeneratorModel = {
    modelId: "goal/scripted-shift-coordinator",
    async generate() {
      throw new Error("the owned tool loop calls generateStep");
    },
    async generateStep() {
      if (made) return { text: "Filed.", finishReason: "stop" };
      made = true;
      return { toolCalls: [{ toolCallId: "t1", ...call }], finishReason: "tool-calls" };
    },
  };
  return Object.assign(
    (_id: string, block?: string) => {
      if (block === "coordinator-route-ask") throw new Error("no route model in this check");
      return model;
    },
    {
      resolveId: (id: string) => id,
      resolveEvaluationModel: (id: string, block?: string) => base.resolveEvaluationModel!(id, block),
    },
  ) as unknown as ModelResolver;
}

interface ReadProcess {
  ppid: number;
  cmdline: string;
  environ: string;
}

/** The Agent SDK's `claude` binary. */
const isClaudeCode = (proc: ReadProcess): boolean => /\/claude(\s|$)/.test(proc.cmdline.split(" --")[0] ?? "");

/** A direct child of this process that is not Claude Code is the Lab's own. */
const isTheRuns = (proc: ReadProcess): boolean => proc.ppid !== process.pid || isClaudeCode(proc);

/** The processes whose working directory is under `root`: each one's parent, command line and environment, read now. */
function processesUnder(root: string): Map<number, ReadProcess> {
  const found = new Map<number, ReadProcess>();
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const cwd = readlinkSync(`/proc/${entry}/cwd`);
      if (!cwd.startsWith(root)) continue;
      const status = readFileSync(`/proc/${entry}/status`, "utf8");
      found.set(Number(entry), {
        ppid: Number(/^PPid:\s+(\d+)/m.exec(status)?.[1]),
        cmdline: readFileSync(`/proc/${entry}/cmdline`, "utf8").replace(/\0/g, " "),
        environ: readFileSync(`/proc/${entry}/environ`, "utf8").replace(/\0/g, "\n"),
      });
    } catch {
      // Gone, or not ours to read.
    }
  }
  return found;
}

await runGoal(async (failures) => {
  const scratch = goalTmpDir(SLUG);
  const { sourceRepo } = createScratchRepo(SLUG);
  const checkout = realpathSync(sourceRepo);
  const runsRoot = join(realpathSync(scratch), "runs");
  let lab: Lab | undefined;
  try {
    const issue = await heldOutIssue(checkout);
    console.log(`held-out issue: ${issue.identifier}${CONTROL === "" ? "" : ` (control ${CONTROL})`}`);
    const goal = `Read Linear issue ${issue.identifier} and answer with its title, exactly as Linear has it.`;

    lab = await openLab({
      stores: inMemoryStores(),
      harness: claudeCodeHarness,
      runTimeoutMs: CLAUDE_CODE_RUN_TIMEOUT_MS,
      workspace: { root: runsRoot, remotes: { allow: [] }, checkouts: CHECKOUTS.map((entry) => ({ ...entry, checkout })) },
      coderWorkerId: CODER,
      inventory: true,
      projects: FSD_PROJECTS,
      mcpServers: FSD_MCP_SERVERS,
      modelResolver: scriptedShiftCoordinator({ toolName: "createTask", args: { goal, assignee: CODER, input: { project: FSD } } }),
      logger: silentLogger,
      log: (line) => console.log(line),
    });

    // The filer's key, through the route Settings writes through.
    const set = await lab.door("POST", "mcp-credentials/linear", { body: { value: KEY } });
    if (set.status !== 200) throw new Error(`setting the key answered ${set.status}: ${JSON.stringify(set.body)}`);
    if (CONTROL === "no-key") {
      const cleared = await lab.door("DELETE", "mcp-credentials/linear");
      if (cleared.status !== 200) throw new Error(`clearing the key answered ${cleared.status}`);
    }
    if (CONTROL === "no-linear") {
      const off = await lab.projectAct!("setMcpServers", { project: FSD, mcpServers: [] });
      if (off.error !== undefined) throw new Error(`clearing FSD's servers failed: ${off.error}`);
    }

    // File through the Shift Coordinator, as a person's conversation does.
    const runtime = await lab.state.getRuntime();
    const sessionId = `s-shift-coordinator-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", "coordinator/sessions", { body: { userId: LAB_USER_ID, sessionId, state: { workerId: "shift-coordinator" } } });
    if (created.status !== 201) throw new Error(`opening the Shift Coordinator's session answered ${created.status}`);
    const act = async (actionName: string, input: unknown) =>
      (await runAction({
        orgId: LAB_ORG_ID,
        flow: runtime.registry.get("coordinator") as FlowInstance,
        actionName,
        input,
        userId: LAB_USER_ID,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never)) as { output?: any; error?: unknown };
    const said = await act("respond", { message: `On FSD: ${goal}` });
    if (said.error !== undefined) throw new Error(`the Shift Coordinator's turn failed: ${JSON.stringify(said.error)}`);

    // While the run works, read every process working in the runs' places.
    const seen = new Map<number, ReadProcess>();
    let task: Record<string, any> | undefined;
    for (const deadline = Date.now() + CLAUDE_CODE_RUN_TIMEOUT_MS + 60_000; Date.now() < deadline; await sleep(250)) {
      for (const [pid, proc] of processesUnder(runsRoot)) if (!seen.has(pid)) seen.set(pid, proc);
      task = ((await act(LIST_TASKS_ACTION, {})).output as { tasks?: Array<Record<string, any>> } | undefined)?.tasks?.[0];
      if (["completed", "errored", "cancelled", "failed"].includes(task?.status)) break;
    }
    console.log(`task ${task?.status ?? "never filed"}; ${seen.size} process(es) read in the run's places`);
    for (const [pid, proc] of seen) {
      console.log(`  ${pid} (${isTheRuns(proc) ? "the run's" : "the Lab's own, not graded"}): ${proc.cmdline.split(KEY).join("<KEY>").slice(0, 160)}`);
    }
    const runs = [...seen].filter(([, proc]) => isTheRuns(proc));

    // Grade.
    const requests = await runtime.stores.request.list({ withItems: true } as never);
    const items = requests.flatMap((r) => ((r as unknown as { items?: any[] }).items ?? []));
    const linearCalls = items.filter((item) => item.type === "tool_output" && String(item.toolCall?.name ?? "").startsWith("mcp__linear__"));
    // The answer is the run's final message, as the coding run's manager reports it on the task's request.
    const runRequest = task?.run?.requestId === undefined ? undefined : await runtime.stores.request.get(task.run.requestId);
    const answer = String((runRequest as { result?: { output?: { answer?: unknown } } } | undefined)?.result?.output?.answer ?? "");
    console.log(`answer: ${answer.slice(0, 400)}`);
    console.log(`mcp__linear__ calls: ${linearCalls.map((item) => item.toolCall.name).join(", ") || "none"}`);

    if (!normal(answer).includes(normal(issue.title))) {
      failures.push(`the title: the task's answer does not carry ${issue.identifier}'s title as Linear's API gives it`);
    }
    if (linearCalls.length === 0) failures.push("the run's items hold no mcp__linear__ tool call");
    if (!runs.some(([, proc]) => isClaudeCode(proc))) {
      failures.push("no Claude Code process was read in the run's places while it ran, so the key's absence from it is unchecked");
    }
    for (const [pid, proc] of runs) {
      if (proc.cmdline.includes(KEY)) failures.push(`the key is in process ${pid}'s command line`);
      if (proc.environ.includes(KEY)) failures.push(`the key is in process ${pid}'s environment`);
    }
    const sessions = await runtime.stores.session.list({ parentage: "all" } as never);
    for (const [name, value] of Object.entries({ items, requests, sessions, task, "run record": runRequest })) {
      if (JSON.stringify(value ?? null).includes(KEY)) failures.push(`the key is in the ${name}`);
    }
    return {
      failures,
      evidence:
        `${issue.identifier}'s title is in the run's answer after ${linearCalls.length} mcp__linear__ call(s); ` +
        `the key is in none of the run's ${runs.length} process(es)' command line or environment, nor the items, requests, sessions or task`,
    };
  } finally {
    await lab?.dispose();
    rmSync(scratch, { recursive: true, force: true });
    rmSync(checkout, { recursive: true, force: true });
  }
});
