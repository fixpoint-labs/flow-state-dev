/**
 * Goal check: a coordinator hires a worker, sets up a mailbox with it, files a
 * task there, and moves workers on a file's mailbox, all while the app runs;
 * the hire is woken by every post on both mailboxes, the member taken off is
 * not, and all of it holds after a restart on the same store.
 *
 * Real path, scripted model, out of CI. See goal.md for the contract.
 *
 * One host (`host.mts`) over one SQLite file. The coordinator's tools are
 * called by its own `run` turns; posts go through the mailbox's public `post`.
 * Everything graded is read back from the store: each worker's conversations
 * through the host's own routes, the lists through the mailbox's `readBoard`,
 * and `discover` over the inventory rows. Legs:
 *
 *   woken     the hire heard each of the four posts on its two mailboxes once,
 *             before and after the restart.
 *   removed   the file member heard the post before it was taken off, and
 *             none after, before or after the restart.
 *   task      after the restart, the new mailbox's `tasks` list holds the
 *             task, for the hire, filed by the coordinator.
 *   works     after the restart, a task for the hire lands on the file
 *             mailbox's board, and one for the member taken off is refused.
 *   discover  `discover` lists the new mailbox, with the hire on it.
 *   project   `setWorkstreams` makes the new mailbox a project's workstream.
 *   tree      no file under the tree changed, and neither the hire nor the
 *             new mailbox is named in any file.
 *
 * Run:      pnpm --dir goals exec tsx mailbox-setup/it-wakes-a-worker-hired-and-subscribed-at-run-time/run.mts
 * Control:  GOAL_CONTROL=boot-wake  (the wake reads the start-up list: must FAIL at woken, and nothing else)
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAction } from "@flow-state-dev/engine";
import type { ManifestEntry } from "@flow-state-dev/core";
import { workforceManifestSources } from "@flow-state-dev/workforce";
import { goalTmpDir, REPO_ROOT, runGoal } from "../../lib/index.mts";
import { OWNER, ORG_ID, startHost, type MailboxSetupHost } from "./host.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const TREE = join(HERE, "fixtures", "workforce");
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // The wake reads the workers declared at start: a hire is never in it.
  "boot-wake": ["woken"]
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}
const wake = CONTROL === "boot-wake" ? (boot: readonly unknown[]) => boot as never : undefined;

/** Every file under `dir`, with a hash of its bytes. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (at: string) => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.set(path, createHash("sha256").update(readFileSync(path)).digest("hex"));
    }
  };
  walk(dir);
  return out;
}

/** What git sees as changed or new anywhere in the repository. */
function workingTree(): string[] {
  return execFileSync("git", ["status", "--porcelain", "--untracked-files=all"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((line) => line.length > 0);
}

type Message = { role: string; text: string };

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, line: string) => failures.push(`[${leg}] ${line}`);

  // ---- the tree: the coordinator, and the file mailbox's one member -------
  const before = snapshot(HERE);
  const treeBefore = new Set(workingTree());
  const run = randomUUID().replace(/-/g, "").slice(0, 8);
  const file = join(goalTmpDir("mailbox-setup"), `app-${run}.db`);
  let app: MailboxSetupHost = await startHost(TREE, file, wake);
  const floor = app.mailboxes[0]!;
  const fileMembers = floor.declared.members as string[];
  const board = (floor.declared.boards as string[])[0]!;
  const coordinator = app.declared.find((w) => ((w.config as { tools?: string[] }).tools ?? []).includes("setUpMailbox"))!.id;
  const member = fileMembers[0]!;
  const team = floor.id.split(".")[0]!;
  // Held out: names no file holds, fresh every run.
  const hire = `${team}.hire${run}`;
  const mailboxId = `${team}.launch${run}`;

  const call = async (tool: string, args: Record<string, unknown>) => app.say(coordinator, `call ${tool} ${JSON.stringify(args)}`);
  const must = async (tool: string, args: Record<string, unknown>) => {
    const error = await call(tool, args);
    if (error !== undefined) throw new Error(`${tool} refused: ${error}`);
  };

  const http = async (method: "GET", segments: string[], query = "") => {
    const res = await app.router[method](
      new Request(`http://mailbox-setup.local/api/flows/${segments.map(encodeURIComponent).join("/")}${query}`, { method }),
      { params: { path: segments } }
    );
    return await res.text();
  };
  /** Every message a worker's conversations hold, read through the routes a page reads. */
  const heardBy = async (address: string): Promise<Message[]> => {
    const listed = await http("GET", ["sessions"], `?flowId=${encodeURIComponent(address)}&userId=${OWNER}&include=dispatch-runs&limit=100`);
    const rows = (JSON.parse(listed) as { sessions?: Array<{ id: string }> }).sessions ?? [];
    const out: Message[] = [];
    for (const row of rows) {
      const state = await http("GET", ["sessions", row.id, "state"], "?include_items=true&item_types=message&limit=1000");
      const items = (JSON.parse(state) as { items?: Array<{ role?: string; transient?: boolean; content?: Array<{ text?: string }> }> }).items ?? [];
      for (const item of items) {
        if (item.transient === true) continue;
        out.push({ role: item.role ?? "", text: (item.content ?? []).map((c) => c.text ?? "").join("") });
      }
    }
    return out;
  };
  const turnsWith = async (address: string, token: string) =>
    (await heardBy(address)).filter((m) => m.role === "user" && m.text.includes(token)).length;

  /** Post through the mailbox's public action, and let every run it woke settle. */
  const post = async (on: string, token: string) => {
    const runtime = await app.state.getRuntime();
    const posted = await runAction({
      orgId: ORG_ID,
      flow: app.mailbox,
      actionName: "post",
      input: { body: `${token} is anyone on this?` },
      userId: OWNER,
      sessionId: on,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never);
    if ((posted as { error?: unknown }).error !== undefined) throw new Error(`post on ${on} refused: ${String((posted as { error: unknown }).error)}`);
    for (let i = 0; i < 600; i += 1) {
      const requests = await runtime.stores.request.list({});
      if (requests.every((r: { status: string }) => r.status !== "in_progress")) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    // Give a wrongly woken worker time to run, so its absence is not a race.
    await new Promise((r) => setTimeout(r, 500));
  };
  const tasksOn = async (on: string, list: string) => {
    const runtime = await app.state.getRuntime();
    const read = (await runAction({
      orgId: ORG_ID,
      flow: app.mailbox,
      actionName: "readBoard",
      input: { board: list },
      userId: OWNER,
      sessionId: on,
      stores: runtime.stores,
      runtimeConfig: { ...runtime.runtimeConfig }
    } as never)) as { output?: { tasks: Array<Record<string, any>> }; error?: unknown };
    if (read.error !== undefined) throw new Error(`readBoard ${on}/${list}: ${String(read.error)}`);
    return read.output!.tasks;
  };

  const tokens = {
    memberBefore: `before-${run}`,
    newBefore: `launch-a-${run}`,
    floorBefore: `floor-a-${run}`,
    newAfter: `launch-b-${run}`,
    floorAfter: `floor-b-${run}`
  };
  const taskGoal = `ship-${run}: build the launch page`;
  try {
    // ---- 1–3: hire, set up a mailbox with it, file a task ------------------
    await post(floor.id, tokens.memberBefore);
    await must("hire", { seatId: hire, flow: "agent", instructions: "You build launch pages." });
    await must("setUpMailbox", {
      team,
      name: `launch${run}`,
      description: "The launch.",
      charter: "Get the launch out.",
      members: [hire],
      worksTaskList: true
    });
    await must("fileTask", { mailboxId, title: "Launch page", goal: taskGoal, assignee: hire });
    // ---- 4: post on the new mailbox ----------------------------------------
    await post(mailboxId, tokens.newBefore);
    // ---- 5–6: the hire onto the file mailbox, its member off, post there ----
    await must("subscribeWorkers", { mailboxId: floor.id, workers: [hire], worksTaskList: true });
    await must("unsubscribeWorkers", { mailboxId: floor.id, workers: [member] });
    await post(floor.id, tokens.floorBefore);

    // ---- 7–8: restart on the same store, post again on both ----------------
    await app.state.dispose();
    app = await startHost(TREE, file, wake);
    await post(mailboxId, tokens.newAfter);
    await post(floor.id, tokens.floorAfter);

    // The hire's address, as the registry holds it after the restart: the
    // reload put it back there, under the name the coordinator gave it.
    const registered = (await app.state.getRuntime()).registry.list();
    const hireAddress = registered.find((w) => (w.config as { seatId?: string } | undefined)?.seatId === hire)?.id;
    if (hireAddress === undefined) throw new Error(`the hire ${hire} is not registered after the restart`);

    // ---- woken --------------------------------------------------------------
    const heardCounts: string[] = [];
    for (const [name, token] of Object.entries({
      newBefore: tokens.newBefore,
      floorBefore: tokens.floorBefore,
      newAfter: tokens.newAfter,
      floorAfter: tokens.floorAfter
    })) {
      const n = await turnsWith(hireAddress, token);
      heardCounts.push(`${name}=${n}`);
      if (n !== 1) fail("woken", `the hire ${hire} heard the ${name} post (${token}) in ${n} turns (want 1)`);
    }
    if (!failures.some((f) => f.startsWith("[woken]"))) {
      evidence.push(`hire ${hire} heard each post once (${heardCounts.join(", ")}) on ${mailboxId} and ${floor.id}, before and after the restart`);
    }

    // ---- removed ------------------------------------------------------------
    const memberBefore = await turnsWith(member, tokens.memberBefore);
    const memberAfter = [tokens.floorBefore, tokens.floorAfter, tokens.newBefore, tokens.newAfter];
    const wrongly: string[] = [];
    for (const token of memberAfter) if ((await turnsWith(member, token)) > 0) wrongly.push(token);
    if (memberBefore !== 1) fail("removed", `${member} heard the post before it was taken off in ${memberBefore} turns (want 1), so its silence after proves nothing`);
    if (wrongly.length > 0) fail("removed", `${member} was woken after it was taken off, by ${wrongly.join(", ")}`);
    if (memberBefore === 1 && wrongly.length === 0) evidence.push(`${member} heard the post before its removal and none of the ${memberAfter.length} after`);

    // ---- task ---------------------------------------------------------------
    const filed = (await tasksOn(mailboxId, "tasks")).filter((t) => t.goal === taskGoal);
    if (filed.length !== 1) fail("task", `${mailboxId}'s tasks list holds ${filed.length} tasks with the goal (want 1)`);
    else if (filed[0]!.assignee !== hire || filed[0]!.metadata?.filingWorker !== coordinator) {
      fail("task", `the task is for ${filed[0]!.assignee}, filed by ${filed[0]!.metadata?.filingWorker} (want ${hire}, ${coordinator})`);
    } else evidence.push(`after the restart ${mailboxId}'s tasks list holds the task, for ${hire}, filingWorker ${coordinator}`);

    // ---- works: the hire works the file mailbox's board; the member does not
    const worksGoal = `queue-${run}`;
    const forHire = await call("fileTask", { mailboxId: floor.id, list: board, goal: worksGoal, assignee: hire });
    const forMember = await call("fileTask", { mailboxId: floor.id, list: board, goal: `${worksGoal}-member`, assignee: member });
    const queue = await tasksOn(floor.id, board);
    const hireRows = queue.filter((t) => t.goal === worksGoal && t.assignee === hire).length;
    const memberRows = queue.filter((t) => t.assignee === member).length;
    if (forHire !== undefined || hireRows !== 1) fail("works", `a task for ${hire} on ${floor.id}'s ${board}: ${forHire ?? "accepted"}, ${hireRows} rows (want 1)`);
    if (forMember === undefined || memberRows !== 0) fail("works", `a task for ${member} on ${floor.id}'s ${board} was not refused (${memberRows} rows)`);
    if (!failures.some((f) => f.startsWith("[works]"))) {
      evidence.push(`after the restart ${hire} works ${floor.id}'s ${board}; a task for ${member} was refused ("${forMember}")`);
    }

    // ---- discover -----------------------------------------------------------
    const runtime = await app.state.getRuntime();
    const stored = await runtime.stores.resourceState.getByPrefix("org", ORG_ID, "inventory/mailboxes/");
    const rows = Object.values(stored).map((record) => ({ state: (record as { state: unknown }).state }));
    const [source] = workforceManifestSources({ roster: { workers: [], mailboxes: app.mailboxes }, inventory: { mailboxes: "rows" } });
    const entries: ManifestEntry[] = await source!.entries({
      resources: { rows: { pattern: "inventory/mailboxes/*", create: async () => undefined, list: async () => rows } },
      org: { identity: { orgId: ORG_ID, id: ORG_ID } }
    } as never);
    const listed = entries.find((entry) => entry.id === mailboxId);
    if (listed === undefined) fail("discover", `discover lists ${entries.map((e) => e.id).join(", ")}, not ${mailboxId}`);
    else if (!String(listed.contract ?? "").includes(hire)) fail("discover", `discover lists ${mailboxId} without ${hire}: ${listed.contract}`);
    else evidence.push(`discover lists ${mailboxId} ("${listed.contract}")`);

    // ---- project: the new mailbox can be a project's workstream -------------
    const projectId = `launch-${run}`;
    try {
      await app.project("createProject", { id: projectId, title: "Launch" });
      const set = (await app.project("setWorkstreams", { projectId, workstreams: [mailboxId] })) as {
        project?: { workstreams?: string[] };
      };
      const workstreams = set.project?.workstreams ?? [];
      if (!workstreams.includes(mailboxId)) fail("project", `setWorkstreams on ${projectId} returned workstreams ${workstreams.join(", ")}, not ${mailboxId}`);
      else evidence.push(`setWorkstreams made ${mailboxId} a workstream of ${projectId}`);
    } catch (error) {
      fail("project", `setWorkstreams refused ${mailboxId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  } finally {
    await app.state.dispose();
  }

  // ---- tree: nothing written, and the new names in no file -----------------
  const after = snapshot(HERE);
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((path) => before.get(path) !== after.get(path));
  if (changed.length > 0) fail("tree", `files changed under the goal's tree: ${changed.join(", ")}`);
  const written = workingTree().filter((line) => !treeBefore.has(line));
  if (written.length > 0) fail("tree", `the run wrote to the repository: ${written.join(", ")}`);
  const naming = [...after.keys()].filter((path) => {
    const text = readFileSync(path, "utf8");
    return text.includes(hire) || text.includes(mailboxId);
  });
  if (naming.length > 0) fail("tree", `a file names the hire or the new mailbox: ${naming.join(", ")}`);
  if (!failures.some((f) => f.startsWith("[tree]"))) evidence.push(`git status is as it was before the run, no file under the goal changed, and none names ${hire} or ${mailboxId}`);

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
