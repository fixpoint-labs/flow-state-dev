/**
 * Goal check — the DevTeam's EM, leading a workstream in Storefront, is told
 * its workstream's project, so the coder's task it files names Storefront or
 * no project at all, never one it guessed.
 *
 * The DevTeam lab, opened as its profile is served, with two projects the
 * owner is on, each with a repository: Storefront and another. The owner's
 * workstream in Storefront is led by the EM. The owner asks Storefront's
 * project coordinator over the lab's HTTP door, and it hands the ask to that
 * workstream; the EM's task tool calls are read back from the workstream
 * session's items. A real model plays the project coordinator and the EM. The
 * coder's harness is the lab's stub; what a filed task does next is not
 * graded.
 *
 * Assertions:
 *
 *   files-for-coder        the turn filed at least one task for eng.coder.
 *   names-no-other-project every task call the model made names Storefront
 *                          in `input.project`, or no project.
 *
 * Controls:
 *
 *   no-project-context  the EM's model is handed its prompt with the line
 *                       naming its conversation's project cut out. Must FAIL
 *                       `names-no-other-project`, and `control-took` proves
 *                       the line was there to cut.
 *
 * `GOAL_CONTROL=list` prints them.
 *
 * Run: pnpm tsx goals/devforce-lab/it-tells-a-workstream-lead-its-project/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelResolver } from "@flow-state-dev/core";
import type { GeneratorModel, ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { DEFAULT_MODEL, gatewayModel, keysServing, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { harnessStub } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { deriveWorkerSessionId } from "@flow-state-dev/workforce/browser";
import { LAB_ORG_ID, LAB_USERS, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { EM_TURN } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["no-project-context"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

interface Fixture {
  ask: string;
  workstream: { id: string; title: string };
  otherProject: { id: string; title: string };
}
const fixture = loadFixture<Fixture>(import.meta.url);

const CODER = "eng.coder";
const EM = "eng.em";
const PROJECT_COORDINATOR = "project-coordinator";
const COORDINATOR_FLOW = "coordinator";
const STOREFRONT = { visibility: "shared" as const, id: "storefront" };
const TASK_TOOLS = new Set(["createTask", "createTask"]);
/** The line the board's task tools add naming the conversation's project; the control cuts it. */
const PROJECT_LINE = /This conversation works in the \w+ project \\?"[^"\\]+\\?"\.[^.]*\./g;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown, n = 300): string => (JSON.stringify(value) ?? "undefined").slice(0, n);

/** How many times the control cut the line from the EM's prompt. */
let cut = 0;

/** Every call's messages with the project line cut out, for the control. */
function withoutProjectLine(model: GeneratorModel): GeneratorModel {
  return new Proxy(model, {
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      if (typeof value !== "function") return value;
      return (options: { messages?: unknown[] } | undefined, ...rest: unknown[]) => {
        if (options === undefined || !Array.isArray(options.messages)) return value.call(target, options, ...rest);
        const text = JSON.stringify(options.messages);
        const kept = text.replace(PROJECT_LINE, () => {
          cut += 1;
          return "";
        });
        return value.call(target, { ...options, messages: JSON.parse(kept) }, ...rest);
      };
    },
  });
}

/** A real model for every turn; under the control, the EM's turn without its project line. */
function liveResolver(): ModelResolver {
  stripIntentOverrides();
  const base = createModelResolver();
  return Object.assign(
    (_id: string, block?: string, options?: never) => {
      const model = base(gatewayModel(DEFAULT_MODEL), block, options) as GeneratorModel;
      return CONTROL === "no-project-context" && block === EM_TURN ? withoutProjectLine(model) : model;
    },
    {
      resolveId: () => gatewayModel(DEFAULT_MODEL),
      resolveEvaluationModel: (id: string, block?: string) => base.resolveEvaluationModel!(id, block),
    },
  ) as unknown as ModelResolver;
}

/** The arguments of a tool call as the item stores them. */
function argsOf(item: { toolCall?: { arguments?: unknown } }): Record<string, any> {
  const raw = item.toolCall?.arguments;
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as Record<string, any>;
    } catch {
      return {};
    }
  }
  return (raw ?? {}) as Record<string, any>;
}

/** Send `message` to `action` on a session as the lab's owner, and wait for that request to end. */
async function send(lab: Lab, flow: string, session: string, action: string, message: string): Promise<void> {
  const sent = await lab.door("POST", `${flow}/${encodeURIComponent(session)}/actions/${action}`, {
    as: "owner",
    body: { userId: LAB_USERS.owner.userId, input: { message } },
  });
  if (sent.status !== 202) throw new Error(`${flow} ${action} was refused: ${sent.status} ${show(sent.body)}`);
  const requestId = sent.body.request.id as string;
  for (let i = 0; i < 12_000; i += 1) {
    const status = await lab.door("GET", `${flow}/requests/${requestId}/status`);
    if (status.body?.status !== "in_progress") return;
    await sleep(10);
  }
}

/** Wait until nothing in the lab is running: the hand-off, the EM's turn and the coder's runs. */
async function quiet(lab: Lab): Promise<void> {
  const runtime = await lab.state.getRuntime();
  for (const deadline = Date.now() + 180_000; Date.now() < deadline; await sleep(200)) {
    const busy = (await runtime.stores.request.list({})).some((r: { status: string }) => ["pending", "queued", "in_progress"].includes(r.status));
    if (!busy) return;
  }
}

await runGoal(async (failures) => {
  const note = (assertion: string, why: string): void => {
    failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  };
  if (!keysServing(DEFAULT_MODEL).some((key) => (process.env[key] ?? "") !== "")) {
    note("blocked", `no key here serves ${DEFAULT_MODEL}; the check did not run`);
    return { failures, evidence: "" };
  }

  const members = [LAB_USERS.member.userId];
  const storefront = createBareRemote("tells-the-lead-storefront", { seed: { "README.md": "Storefront.\n" } });
  const other = createBareRemote(`tells-the-lead-${fixture.otherProject.id}`, { seed: { "README.md": `${fixture.otherProject.title}.\n` } });
  const stub = harnessStub({ finalMessage: () => "Done." });
  const lab = await openLab({
    modelResolver: liveResolver(),
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "tells-the-lead-")), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    logger: silentLogger,
    inventory: true,
    projects: [
      { id: STOREFRONT.id, title: "Storefront", members, repository: storefront.url },
      { id: fixture.otherProject.id, title: fixture.otherProject.title, members, repository: other.url },
    ],
    workstreams: [{ as: "owner", input: { project: STOREFRONT, id: fixture.workstream.id, title: fixture.workstream.title, lead: EM } }],
    withoutJudge: true,
  });
  try {
    const session = lab.workstreams?.[0]?.workstream.sessionId;
    if (typeof session !== "string") throw new Error(`the workstream opened with no session: ${show(lab.workstreams)}`);

    // The owner asks Storefront's project coordinator, which hands the ask to the workstream.
    const pc = await deriveWorkerSessionId({
      userId: LAB_USERS.owner.userId,
      orgId: LAB_ORG_ID,
      flow: COORDINATOR_FLOW,
      criteria: { worker: PROJECT_COORDINATOR, projectId: STOREFRONT },
    });
    const created = await lab.door("POST", `${COORDINATOR_FLOW}/sessions`, {
      as: "owner",
      body: { userId: LAB_USERS.owner.userId, sessionId: pc, state: { workerId: PROJECT_COORDINATOR, projectId: `${STOREFRONT.visibility}/${STOREFRONT.id}` } },
    });
    if (created.status !== 201) throw new Error(`opening the project coordinator answered ${created.status}: ${show(created.body)}`);
    await send(lab, COORDINATOR_FLOW, pc, "run", fixture.ask);
    await quiet(lab);

    const listed = await lab.door("GET", `sessions/${encodeURIComponent(session)}/requests?include_items=true&limit=200`);
    const calls = ((listed.body?.requests ?? []) as Array<{ items?: any[] }>)
      .flatMap((request) => request.items ?? [])
      .filter((item) => item.type === "tool_output" && TASK_TOOLS.has(String(item.toolCall?.name ?? "")))
      .map((item) => ({ name: String(item.toolCall.name), args: argsOf(item) }));

    if (CONTROL === "no-project-context" && cut === 0) note("control-took", "the EM's prompt carried no project line to cut");

    const forCoder = calls.filter((call) => call.args.assignee === CODER && call.args.post !== true);
    if (forCoder.length === 0) note("files-for-coder", `the EM made no task call for ${CODER} in its workstream: ${show(calls, 600)}`);
    const named = forCoder.map((call) => call.args.input?.project).filter((project) => project != null);
    const wrong = named.filter((project) => project?.visibility !== STOREFRONT.visibility || project?.id !== STOREFRONT.id);
    if (wrong.length > 0) note("names-no-other-project", `the model named ${show(wrong)} for a task in a Storefront workstream`);

    return {
      failures,
      evidence: `the EM in Storefront's "${fixture.workstream.id}" filed ${forCoder.length} task(s) for ${CODER}, naming ${named.length === 0 ? "no project" : show(named)}: ${show(forCoder.map((call) => call.args.input), 400)}`,
    };
  } finally {
    await lab.dispose();
  }
});
