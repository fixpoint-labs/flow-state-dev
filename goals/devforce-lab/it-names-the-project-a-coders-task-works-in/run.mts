/**
 * Goal check — asked to have the coder look at "our repo", the Shift
 * Coordinator (the Shift Coordinator) reads the projects the person is a member
 * of and names the one a coder's task works in, rather than asking which
 * project; with two candidates it asks, naming them.
 *
 * The DevTeam lab, opened as its profile is served, driven over its HTTP door
 * as the lab's owner: a conversation is opened on the coordinator's flow, the
 * ask is sent as one turn, and the turn's tool outputs, its reply and the
 * tasks the conversation filed are read back. A real model plays the Shift
 * Coordinator. The coder's harness is the lab's stub; what a filed task does after
 * the filing is not graded here.
 *
 * Legs:
 *
 *   one  the person is a member of storefront (a repository), platform and
 *        sandbox (none); a stranger's project with a repository exists in the
 *        organization. The turn reads the projects (its `listProjects` output
 *        names storefront and not the stranger's) and files a task for
 *        eng.coder naming storefront, on that one turn.
 *   two  the person's second project with a repository is added. The turn
 *        files nothing, and its reply names both projects and not the
 *        stranger's.
 *
 * Controls:
 *
 *   no-project-list  the Shift Coordinator without `listProjects`. Must FAIL leg
 *                    one on read-the-projects and files-naming-storefront.
 *
 * `GOAL_CONTROL=list` prints them. `GOAL_LEGS=one` runs only that leg.
 *
 * Run: pnpm tsx goals/devforce-lab/it-names-the-project-a-coders-task-works-in/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelResolver } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { listProjectsOutputSchema } from "@flow-state-dev/workforce";
import { DEFAULT_MODEL, gatewayModel, keysServing, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { LAB_USERS, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["no-project-list"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}
const LEGS = new Set((process.env.GOAL_LEGS ?? "one,two").split(",").map((leg) => leg.trim()));

interface Fixture {
  ask: string;
  secondProject: { id: string; title: string };
  strangersProject: { id: string; title: string };
}
const fixture = loadFixture<Fixture>(import.meta.url);

const CODER = "eng.coder";
const SHIFT_COORDINATOR = "shift-coordinator";
const COORDINATOR_FLOW = "coordinator";
const LIST_TASKS = "listTasks_tasks";
const LIST_PROJECTS = "listProjects";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown, n = 300): string => (JSON.stringify(value) ?? "undefined").slice(0, n);

/** A real model for every turn, and the gateway's evaluation model for the Shift Coordinator's routing. */
function liveResolver(): ModelResolver {
  // A container's FSDEV_DEFAULT_MODEL / FSDEV_INTENT_* would swap the model under the resolver.
  stripIntentOverrides();
  const base = createModelResolver();
  return Object.assign((_id: string, block?: string, options?: never) => base(gatewayModel(DEFAULT_MODEL), block, options), {
    resolveId: () => gatewayModel(DEFAULT_MODEL),
    resolveEvaluationModel: (id: string, block?: string) => base.resolveEvaluationModel!(id, block),
  }) as unknown as ModelResolver;
}

// ---- reading and writing through the lab's door ----------------------------

function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map((part: { text?: string }) => part.text ?? "").join("");
  return "";
}

function door(lab: Lab) {
  /** Run `action` on a session and wait for it to end: its request id, output and error. */
  const act = async (flow: string, sessionId: string, action: string, input: unknown, as: keyof typeof LAB_USERS = "owner") => {
    const sent = await lab.door("POST", `${flow}/${encodeURIComponent(sessionId)}/actions/${action}`, {
      as,
      body: { userId: LAB_USERS[as].userId, input },
    });
    if (sent.status !== 202) return { requestId: undefined, output: undefined as any, error: `${sent.status} ${show(sent.body)}` };
    const requestId = sent.body.request.id as string;
    for (let i = 0; i < 12_000; i += 1) {
      const status = await lab.door("GET", `${flow}/requests/${requestId}/status`, { as });
      if (status.body?.status !== "in_progress") break;
      await sleep(10);
    }
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_result_output=true&limit=100`, { as });
    const found = (listed.body?.requests ?? []).find((r: { id: string }) => r.id === requestId);
    return { requestId: requestId as string | undefined, output: found?.result?.output as any, error: found?.result?.error === undefined ? undefined : show(found.result.error) };
  };
  const open = async (flow: string, state: Record<string, unknown>, as: keyof typeof LAB_USERS = "owner") => {
    const sessionId = `s-${flow}-${globalThis.crypto.randomUUID()}`;
    const created = await lab.door("POST", `${flow}/sessions`, { as, body: { userId: LAB_USERS[as].userId, sessionId, state } });
    if (created.status !== 201) throw new Error(`opening a ${flow} session answered ${created.status}: ${show(created.body)}`);
    return sessionId;
  };
  /** One request's items: its tool outputs and its last assistant message. */
  const turnOf = async (sessionId: string, requestId: string) => {
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_items=true&limit=200`);
    const request = ((listed.body?.requests ?? []) as Array<{ id: string; items?: any[] }>).find((r) => r.id === requestId);
    const items = request?.items ?? [];
    return {
      tools: items
        .filter((item) => item.type === "tool_output")
        .map((item) => ({ name: String(item.toolCall?.name ?? ""), output: item.output ?? item.error ?? null })),
      reply: textOf(items.filter((item) => item.type === "message" && item.role === "assistant").at(-1) ?? {}),
    };
  };
  return { act, open, turnOf };
}

/** Wait until nothing in the lab is running. */
async function quiet(lab: Lab): Promise<void> {
  const runtime = await lab.state.getRuntime();
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(50)) {
    const busy = (await runtime.stores.request.list({})).some((r: { status: string }) => ["pending", "queued", "in_progress"].includes(r.status));
    if (!busy) return;
  }
}

/** One turn of the ask in a new conversation with the Shift Coordinator, read back. */
interface Asked {
  tools: Array<{ name: string; output: unknown }>;
  reply: string;
  /** The tasks the conversation filed in that turn, as the board stores them. */
  tasks: Array<Record<string, any>>;
  error?: string;
}

async function ask(lab: Lab): Promise<Asked> {
  const http = door(lab);
  const sessionId = await http.open(COORDINATOR_FLOW, { workerId: SHIFT_COORDINATOR });
  const turn = await http.act(COORDINATOR_FLOW, sessionId, "respond", { message: fixture.ask });
  const read = turn.requestId === undefined ? { tools: [], reply: "" } : await http.turnOf(sessionId, turn.requestId);
  const listed = ((await http.act(COORDINATOR_FLOW, sessionId, LIST_TASKS, {})).output?.tasks ?? []) as Array<{ id: string }>;
  // The rows as the board stores them, which carry the task's input.
  const rows = await lab.stored("user", "tasks/");
  const tasks = listed.map(({ id }) => (Object.entries(rows).find(([key]) => key.endsWith(`/${id}`))?.[1] ?? { id }) as Record<string, any>);
  return { ...read, tasks, ...(turn.error === undefined ? {} : { error: turn.error }) };
}

/** The project ids a turn's `listProjects` outputs named, or undefined when it never read them. */
function listedIds(asked: Asked): string[] | undefined {
  const reads = asked.tools.filter((tool) => tool.name === LIST_PROJECTS);
  if (reads.length === 0) return undefined;
  return reads.flatMap((tool) => {
    const parsed = listProjectsOutputSchema.safeParse(tool.output);
    return parsed.success ? parsed.data.projects.map((project) => project.id) : [];
  });
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string): void => {
    failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  };
  const blocked = [DEFAULT_MODEL].filter((model) => !keysServing(model).some((key) => (process.env[key] ?? "") !== ""));
  if (blocked.length > 0) {
    note("blocked", `no key here serves ${blocked.join(", ")}; the check did not run`);
    return { failures, evidence: "" };
  }

  const members = [LAB_USERS.member.userId];
  const storefront = createBareRemote("names-the-project-storefront", { seed: { "README.md": "Storefront.\n" } });
  const second = createBareRemote(`names-the-project-${fixture.secondProject.id}`, { seed: { "README.md": `${fixture.secondProject.title}.\n` } });
  const strangers = createBareRemote(`names-the-project-${fixture.strangersProject.id}`, { seed: { "README.md": `${fixture.strangersProject.title}.\n` } });
  const stub = harnessStub({ finalMessage: () => "I looked at the code." });
  const lab = await openLab({
    modelResolver: liveResolver(),
    stores: inMemoryStores(),
    harness: stub.slot,
    runTimeoutMs: 30_000,
    workspace: { root: mkdtempSync(join(tmpdir(), "names-the-project-")), remotes: { allow: ["file"] } },
    coderWorkerId: CODER,
    logger: silentLogger,
    inventory: true,
    // The standard install's projects: storefront is the only one with a repository.
    projects: [
      { id: "storefront", title: "Storefront", members, repository: storefront.url },
      { id: "platform", title: "Platform", members },
      { id: "sandbox", title: "Sandbox", members },
    ],
    // What a filed task does next is not graded here, so no judge is asked.
    withoutJudge: true,
    ...(CONTROL === "no-project-list" ? { withoutProjectList: true } : {}),
  });
  const http = door(lab);
  try {
    // A project with a repository the person isn't a member of: a stranger's own.
    const outsider = await http.open("projects", {}, "outsider");
    const made = await http.act(
      "projects",
      outsider,
      "createProject",
      { id: fixture.strangersProject.id, title: fixture.strangersProject.title, repository: strangers.url },
      "outsider",
    );
    if (made.error !== undefined) throw new Error(`the stranger's createProject was refused — ${made.error}`);

    // ---- (one) one project with a repository: filed on the turn ------------
    if (LEGS.has("one")) {
      const before = failures.length;
      const last = await ask(lab);
      const filed = last.tasks.find((t) => t.assignee === CODER && t.input?.project?.visibility === "shared" && t.input.project.id === "storefront");
      const listed = listedIds(last);
      if (listed === undefined) note("one:read-the-projects", `the turn never called ${LIST_PROJECTS}; it called ${show(last.tools.map((t) => t.name))}`);
      else if (!listed.includes("storefront") || listed.includes(fixture.strangersProject.id)) {
        note("one:read-the-projects", `${LIST_PROJECTS} answered ${show(listed)}: wanted storefront, and never ${fixture.strangersProject.id}`);
      }
      if (filed === undefined) {
        note(
          "one:files-naming-storefront",
          `the turn filed ${show(last.tasks.map((t) => ({ assignee: t.assignee, input: t.input })))}, not a task for ${CODER} naming storefront; it said ${show(last.reply, 300)}`,
        );
      }
      if (failures.length === before) {
        evidence.push(`one: "${fixture.ask}" read ${show(listed)} and filed a task for ${CODER} naming storefront on the turn: ${show(filed?.input)}`);
      }
    }

    // ---- (two) two projects with a repository: asked, naming both ----------
    if (LEGS.has("two")) {
      const before = failures.length;
      const added = await lab.projectAct!("createProject", {
        id: fixture.secondProject.id,
        title: fixture.secondProject.title,
        members,
        repository: second.url,
      });
      if (added.error !== undefined) throw new Error(`createProject ${fixture.secondProject.id} was refused — ${added.error}`);
      const names = (reply: string, project: { id: string; title: string }) =>
        reply.toLowerCase().includes(project.id.toLowerCase()) || reply.toLowerCase().includes(project.title.toLowerCase());
      const last = await ask(lab);
      if (last.tasks.length > 0) note("two:files-nothing", `the turn filed ${show(last.tasks.map((t) => ({ assignee: t.assignee, input: t.input })))}`);
      if (!names(last.reply, { id: "storefront", title: "Storefront" }) || !names(last.reply, fixture.secondProject)) {
        note("two:asks-naming-both", `the reply doesn't name storefront and ${fixture.secondProject.id}: ${show(last.reply, 400)}; the turn called ${show(last.tools.map((t) => t.name))}`);
      }
      if (names(last.reply, fixture.strangersProject)) note("two:no-strangers-project", `the reply names ${fixture.strangersProject.id}: ${show(last.reply, 400)}`);
      const listed = listedIds(last);
      if (listed?.includes(fixture.strangersProject.id)) note("two:no-strangers-project", `${LIST_PROJECTS} answered ${show(listed)}`);
      if (failures.length === before) evidence.push(`two: the turn filed nothing and asked: ${show(last.reply, 300)}`);
    }
    await quiet(lab);
  } finally {
    await lab.dispose();
  }
  return { failures, evidence: evidence.join("; ") };
});
