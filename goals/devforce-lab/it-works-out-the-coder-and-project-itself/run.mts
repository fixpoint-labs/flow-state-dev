/**
 * Goal check — asked "have cursor review the super app", the Shift
 * Coordinator works out the coder and the project itself: Cursor is the
 * coding agent the coder runs on, not a worker to look for, and "the super
 * app" is a part of the code the coder finds, not a project to ask about.
 *
 * The DevTeam lab, opened as its profile is served, with the `fsd` profile's
 * two projects (FSD and Shift Manager) on one repository that holds
 * `apps/super-app`, as Jake's Lab had them. Driven over its HTTP door as the
 * lab's owner: a conversation on the coordinator's flow, the ask as one turn,
 * and the turn's reply and the tasks it filed read back. A real model plays the
 * Shift Coordinator, on the model its file declares. The coder's harness is the
 * lab's stub: what a filed task does next is not graded, only where it went.
 *
 * Legs:
 *
 *   cursor, codex, claude  the coder runs on the agent the ask names. The turn
 *        files one task for eng.coder naming the FSD project, and its reply
 *        names the agent (the assumption, stated). No question.
 *   missing  the coder runs on another agent than the one the ask names. The
 *        turn files nothing and its reply names both agents: what was asked
 *        for, and what the coder runs on.
 *   two-repos  Shift Manager gets a repository of its own. The projects no
 *        longer reach the same code, so the turn files nothing and asks one
 *        question naming both.
 *
 * Controls:
 *
 *   no-harness-label  the lab opened without telling the coordinator what
 *                     the coder runs on. Must FAIL the cursor leg.
 *
 * `GOAL_CONTROL=list` prints them. `GOAL_LEGS=cursor,missing` runs those legs.
 *
 * Run: pnpm tsx goals/devforce-lab/it-works-out-the-coder-and-project-itself/run.mts
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createModelResolver } from "@flow-state-dev/core";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessStub } from "@flow-state-dev/harness-manager";
import { gatewayModel, keysServing, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { FSD_PROJECTS } from "../../../packages/shift-manager/teams/devteam/fsd-projects.mts";
import { LAB_USERS, openLab, type Lab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["no-harness-label"] as const;
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
  harnesses: Array<{ word: string; label: string }>;
  otherHarness: string;
}
const fixture = loadFixture<Fixture>(import.meta.url);
const LEGS = new Set(
  (process.env.GOAL_LEGS ?? [...fixture.harnesses.map((h) => h.word), "missing", "two-repos"].join(",")).split(",").map((leg) => leg.trim()),
);

/** The model the Shift Coordinator's file declares: the one Jake's Lab ran. */
const COORDINATOR_MODEL = "anthropic/claude-haiku-5-5";
const CODER = "eng.coder";
const SHIFT_COORDINATOR = "shift-coordinator";
const COORDINATOR_FLOW = "coordinator";
const LIST_TASKS = "listTasks_tasks";
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown, n = 300): string => (JSON.stringify(value) ?? "undefined").slice(0, n);
const askFor = (word: string): string => fixture.ask.replace("{harness}", word);

/** Every model a block names, through the AI Gateway, as the Lab's own resolver would serve it. */
function liveResolver(): ModelResolver {
  // A container's FSDEV_DEFAULT_MODEL / FSDEV_INTENT_* would swap the model under the resolver.
  stripIntentOverrides();
  const base = createModelResolver();
  return Object.assign((id: string, block?: string, options?: never) => base(gatewayModel(id), block, options), {
    resolveId: (id: string) => gatewayModel(id),
    resolveEvaluationModel: (id: string, block?: string) => base.resolveEvaluationModel!(id, block),
  }) as unknown as ModelResolver;
}

function textOf(item: { content?: unknown; text?: unknown }): string {
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (Array.isArray(item.content)) return item.content.map((part: { text?: string }) => part.text ?? "").join("");
  return "";
}

/** One turn of `message` in a new conversation with the Shift Coordinator: its reply and the tasks it filed. */
async function ask(lab: Lab, message: string): Promise<{ reply: string; tools: string[]; tasks: Array<Record<string, any>>; error?: string }> {
  const as = "owner" as const;
  const sessionId = `s-${COORDINATOR_FLOW}-${globalThis.crypto.randomUUID()}`;
  const created = await lab.door("POST", `${COORDINATOR_FLOW}/sessions`, {
    as,
    body: { userId: LAB_USERS[as].userId, sessionId, state: { workerId: SHIFT_COORDINATOR } },
  });
  if (created.status !== 201) throw new Error(`opening a conversation answered ${created.status}: ${show(created.body)}`);
  const act = async (action: string, input: unknown) => {
    const sent = await lab.door("POST", `${COORDINATOR_FLOW}/${encodeURIComponent(sessionId)}/actions/${action}`, {
      as,
      body: { userId: LAB_USERS[as].userId, input },
    });
    if (sent.status !== 202) return { requestId: undefined, output: undefined as any, error: `${sent.status} ${show(sent.body)}` };
    const requestId = sent.body.request.id as string;
    for (let i = 0; i < 12_000; i += 1) {
      const status = await lab.door("GET", `${COORDINATOR_FLOW}/requests/${requestId}/status`, { as });
      if (status.body?.status !== "in_progress") break;
      await sleep(10);
    }
    const listed = await lab.door("GET", `sessions/${encodeURIComponent(sessionId)}/requests?include_result_output=true&include_items=true&limit=100`, { as });
    const found = (listed.body?.requests ?? []).find((r: { id: string }) => r.id === requestId);
    return {
      requestId,
      output: found?.result?.output as any,
      items: (found?.items ?? []) as any[],
      error: found?.result?.error === undefined ? undefined : show(found.result.error),
    };
  };
  const turn = await act("respond", { message });
  const items = (turn as { items?: any[] }).items ?? [];
  const reply = textOf(items.filter((item) => item.type === "message" && item.role === "assistant").at(-1) ?? {});
  const tools = items.filter((item) => item.type === "tool_output").map((item) => String(item.toolCall?.name ?? ""));
  const listed = ((await act(LIST_TASKS, {})).output?.tasks ?? []) as Array<{ id: string }>;
  // The rows as the board stores them, which carry the task's input.
  const rows = await lab.stored("user", "tasks/");
  const tasks = listed.map(({ id }) => (Object.entries(rows).find(([key]) => key.endsWith(`/${id}`))?.[1] ?? { id }) as Record<string, any>);
  return { reply, tools, tasks, ...(turn.error === undefined ? {} : { error: turn.error }) };
}

/** Wait until nothing in the lab is running. */
async function quiet(lab: Lab): Promise<void> {
  const runtime = await lab.state.getRuntime();
  for (const deadline = Date.now() + 60_000; Date.now() < deadline; await sleep(50)) {
    const busy = (await runtime.stores.request.list({})).some((r: { status: string }) => ["pending", "queued", "in_progress"].includes(r.status));
    if (!busy) return;
  }
}

/** The FSD repository as the ask meets it: the super app under apps/, Shift Manager under packages/. */
const FSD_SEED = {
  "README.md": "# flow-state-dev\n\nThe framework's packages, its apps and its labs.\n",
  "apps/super-app/package.json": `${JSON.stringify({ name: "@flow-state-dev/super-app", private: true, description: "Hosts Kitchen Sink, Shift Manager, Teammates and Claude Code Style behind one port, one sub-route each." }, null, 2)}\n`,
  "packages/shift-manager/README.md": "# Shift Manager\n",
};

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string): void => {
    failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  };
  const blocked = [COORDINATOR_MODEL].filter((model) => !keysServing(model).some((key) => (process.env[key] ?? "") !== ""));
  if (blocked.length > 0) {
    note("blocked", `no key here serves ${blocked.join(", ")}; the check did not run`);
    return { failures, evidence: "" };
  }

  const fsd = createBareRemote("works-it-out-fsd", { seed: FSD_SEED });
  const members = [LAB_USERS.member.userId];
  const names = (reply: string, word: string) => reply.toLowerCase().includes(word.toLowerCase());

  /** A lab whose coder runs on `harness`, with Jake's two projects; Shift Manager on `shiftManagerRepo`. */
  const open = (harness: string, shiftManagerRepo = fsd.url) =>
    openLab({
      modelResolver: liveResolver(),
      stores: inMemoryStores(),
      harness: harnessStub({ finalMessage: () => "I looked at the code." }).slot,
      runTimeoutMs: 30_000,
      workspace: { root: mkdtempSync(join(tmpdir(), "works-it-out-")), remotes: { allow: ["file"] } },
      coderWorkerId: CODER,
      logger: silentLogger,
      inventory: true,
      projects: FSD_PROJECTS.map((project) => ({
        ...project,
        members,
        mcpServers: undefined,
        repository: project.id === "shift-manager" ? shiftManagerRepo : fsd.url,
      })),
      withoutJudge: true,
      ...(CONTROL === "no-harness-label" ? {} : { coderHarness: harness }),
    });

  // ---- (cursor, codex, claude) the coder runs on the named agent: filed, no question
  for (const harness of fixture.harnesses) {
    if (!LEGS.has(harness.word)) continue;
    const lab = await open(harness.label);
    try {
      const before = failures.length;
      const turn = await ask(lab, askFor(harness.word));
      const filed = turn.tasks.find((t) => t.assignee === CODER && t.input?.project?.id === "fsd");
      if (filed === undefined || turn.tasks.length !== 1) {
        note(
          `${harness.word}:files-for-the-coder-in-fsd`,
          `the turn filed ${show(turn.tasks.map((t) => ({ assignee: t.assignee, input: t.input })))}; it called ${show(turn.tools)} and said ${show(turn.reply, 400)}`,
        );
      }
      if (!names(turn.reply, harness.label) && !names(turn.reply, harness.word)) {
        note(`${harness.word}:states-the-agent`, `the reply doesn't name ${harness.label}: ${show(turn.reply, 400)}`);
      }
      if (failures.length === before) evidence.push(`${harness.word}: filed ${show(filed?.goal ?? filed?.title, 120)} for ${CODER} in fsd and said ${show(turn.reply, 200)}`);
      await quiet(lab);
    } finally {
      await lab.dispose();
    }
  }

  // ---- (missing) the coder runs on another agent: nothing filed, both named
  const cursor = fixture.harnesses.find((h) => h.word === "cursor")!;
  if (LEGS.has("missing")) {
    const lab = await open(fixture.otherHarness);
    try {
      const before = failures.length;
      const turn = await ask(lab, askFor(cursor.word));
      if (turn.tasks.length > 0) note("missing:files-nothing", `the turn filed ${show(turn.tasks.map((t) => ({ assignee: t.assignee, input: t.input })))}: a swap the user didn't ask for`);
      if (!names(turn.reply, cursor.label) || !names(turn.reply, fixture.otherHarness)) {
        note("missing:names-both-agents", `the reply doesn't name ${cursor.label} and ${fixture.otherHarness}: ${show(turn.reply, 400)}`);
      }
      if (failures.length === before) evidence.push(`missing: filed nothing and said ${show(turn.reply, 200)}`);
      await quiet(lab);
    } finally {
      await lab.dispose();
    }
  }

  // ---- (two-repos) the projects reach different code: one question naming both
  if (LEGS.has("two-repos")) {
    const own = createBareRemote("works-it-out-shift-manager", { seed: { "README.md": "# Shift Manager\n" } });
    const lab = await open(cursor.label, own.url);
    try {
      const before = failures.length;
      const turn = await ask(lab, askFor(cursor.word));
      if (turn.tasks.length > 0) note("two-repos:files-nothing", `the turn filed ${show(turn.tasks.map((t) => ({ assignee: t.assignee, input: t.input })))}`);
      if (!names(turn.reply, "FSD") || !names(turn.reply, "Shift Manager")) {
        note("two-repos:asks-naming-both", `the reply doesn't name FSD and Shift Manager: ${show(turn.reply, 400)}`);
      }
      if (failures.length === before) evidence.push(`two-repos: filed nothing and asked ${show(turn.reply, 200)}`);
      await quiet(lab);
    } finally {
      await lab.dispose();
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
