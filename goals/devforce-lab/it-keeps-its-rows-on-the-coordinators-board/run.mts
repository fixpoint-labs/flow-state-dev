/**
 * Goal check — the org sees a workstream's entry; only its owner sees the rows.
 *
 * On the DevTeam lab, Alice (the lab's owner) opens Storefront's `feature`
 * workstream with the EM as its lead. The EM files one row in that workstream
 * session and drains it there, and the row ends completed. Then each person
 * reads what Shift Manager reads, over the lab's HTTP routes with their own
 * verified bearer: Alice reads the row on the workstream session's board;
 * Bob (a project member) and an outsider (in the organization, on no
 * project) read the workstream's entry, and are refused the rows.
 *
 * Model-free: the lab's scripted harness commits and finishes. What is graded
 * is where the row lives and who reads it, not how the work went.
 *
 * Legs:
 *
 *   0  the tree holds no mailbox file
 *   a  the workstream session's board holds exactly the filed row, completed,
 *      assignee eng.coder, read by its owner
 *   b  Bob and the outsider read the entry: owner Alice, lead eng.em, its
 *      session; a read with no verified organization is refused
 *   c  Bob and the outsider are refused the rows on Alice's workstream session
 *   d  the row is stored once, in Alice's storage under the workstream
 *      session's partition, naming its issue and phase, and no copy is in
 *      the organization's storage
 *
 * Control: `GOAL_CONTROL=em-session` files and drains on the EM's own
 * session's board instead of the workstream session's. The run still
 * completes; the check must FAIL on leg a, *the workstream session's board
 * holds no row*. `GOAL_CONTROL=list` prints it.
 *
 * Run: pnpm tsx goals/devforce-lab/it-keeps-its-rows-on-the-coordinators-board/run.mts
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodeUserSegment } from "@flow-state-dev/core/types";
import { inMemoryStores } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { runGoal, silentLogger } from "../../lib/index.mts";
import { labApi, labRoutes } from "../../lib/shift-manager.mts";
import { connect } from "../../../packages/shift-manager/src/lib/connection.ts";
import { readProject } from "../../../packages/shift-manager/src/lib/projects.ts";
import { createLabReader, PROJECT_READER_FLOW, readerSessionId } from "../../../packages/shift-manager/src/lib/reads.ts";
import { LAB_ORG_ID, LAB_TREE, LAB_USERS, openLab } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { harnessStub, type StubRun } from "../../../packages/shift-manager/teams/devteam/harness-stub.mts";
import { BASE_REF, commitAll, createScratchRepo } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { DRAIN_ENTRY, EM_FLOW, FILE_ENTRY } from "../../../packages/shift-manager/teams/devteam/workforce/flows/workers/em.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["em-session"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const CODER = "eng.coder";
const EM = "eng.em";
const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
const ISSUE = `greeting-${globalThis.crypto.randomUUID().slice(0, 8)}`;
const GOAL = "Add a greeting module to the repository.";
const LIST_TASKS = "listTasks_tasks";
const SETTLE_BUDGET_MS = 60_000;
const SETTLED = new Set(["completed", "errored", "cancelled"]);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const show = (value: unknown): string => JSON.stringify(value)?.slice(0, 400) ?? "undefined";

/** What the harness "did": write a file and commit it, so the run completes. */
const commitWork = (run: StubRun): void => {
  writeFileSync(join(run.cwd, "GREETING.md"), "A greeting, as the brief asked.\n");
  commitAll(run.cwd, "add greeting module");
};

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const note = (assertion: string, why: string): void => {
    failures.push(`${CONTROL === "" ? "" : `[control ${CONTROL}] `}${assertion} — ${why}`);
  };

  // ---- (0) the tree holds no mailbox file --------------------------------
  // Nothing loads a mailbox file any more, so the tree itself is read for one.
  const mailboxFiles = (readdirSync(LAB_TREE, { recursive: true }) as string[]).filter((rel) => rel.endsWith("MAILBOX.md"));
  if (mailboxFiles.length > 0) note("0:no-mailbox", `the tree holds ${show(mailboxFiles)}`);

  const dirs = createScratchRepo("workstream-board");
  const stub = harnessStub({ duringRun: commitWork });
  const lab = await openLab({
    stores: inMemoryStores(),
    harness: stub.slot,
    workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
    coderWorkerId: CODER,
    logger: silentLogger,
    // Model-free: the stub answers nothing a judge could pass.
    withoutJudge: true,
    inventory: true,
    projects: [{ id: STOREFRONT.id, title: "Storefront", members: [LAB_USERS.member.userId] }],
    workstreams: [{ as: "owner", input: { project: STOREFRONT, id: "feature", title: "Feature", lead: EM } }],
  });
  const handle = await serve(lab.state, { host: "127.0.0.1", port: 0, basePath: "/api/flows", handleSignals: false });
  await lab.state.ready();
  const origin = `http://127.0.0.1:${handle.port}`;

  try {
    const runtime = await lab.state.getRuntime();
    const [wsSession] = await runtime.stores.session.list({
      orgId: LAB_ORG_ID,
      parentage: "all",
      state: { workstreamId: `shared/${STOREFRONT.id}/feature` },
    });
    if (wsSession === undefined) throw new Error("opening Storefront's feature made no workstream session");
    const workstream = wsSession.id;
    const alice = labRoutes(origin, LAB_USERS.owner);

    // ---- the run -----------------------------------------------------------
    // The EM files and drains in its workstream session, through its own actions, as Alice.
    // Under the control, it files on its own session's board instead.
    if (CONTROL === "em-session") {
      const filed = await lab.file(EM, { issue: ISSUE, goal: GOAL, maxAttempts: 1 });
      if (filed.error !== undefined) throw new Error(`filing was refused — ${filed.error}`);
      for (const deadline = Date.now() + SETTLE_BUDGET_MS; Date.now() < deadline; await sleep(200)) {
        const row = await lab.featureRow(ISSUE);
        if (row !== undefined && SETTLED.has(row.status)) break;
        await lab.drain(EM);
      }
    } else {
      const filed = await alice.act(EM_FLOW, workstream, FILE_ENTRY, { issue: ISSUE, goal: GOAL, maxAttempts: 1 });
      if (filed.error !== undefined) throw new Error(`filing was refused — ${filed.error}`);
    }
    const rowsAt = async (): Promise<Task[]> => {
      const read = await alice.act(EM_FLOW, workstream, LIST_TASKS, {});
      if (read.error !== undefined) throw new Error(`Alice's read of her workstream's board failed — ${read.error}`);
      return ((read.output as { tasks?: Task[] } | undefined)?.tasks ?? []) as Task[];
    };
    let rows: Task[] = await rowsAt();
    for (const deadline = Date.now() + SETTLE_BUDGET_MS; Date.now() < deadline && CONTROL === ""; ) {
      if (rows.length > 0 && rows.every((r) => SETTLED.has(r.status))) break;
      if (rows.some((r) => r.status === "pending")) await alice.act(EM_FLOW, workstream, DRAIN_ENTRY, {});
      await sleep(200);
      rows = await rowsAt();
    }

    // ---- (a) the workstream session's board, read by its owner -------------
    const row = rows[0];
    if (rows.length === 0) {
      note("a:the-row", "the workstream session's board holds no row");
    } else if (rows.length !== 1) {
      note("a:the-row", `the workstream session's board holds ${rows.length} rows: ${show(rows.map((r) => r.id))}`);
    } else {
      if (row!.status !== "completed") note("a:completed", `the row is "${row!.status}"`);
      if (row!.assignee !== CODER) note("a:assignee", `the row is assigned "${row!.assignee}"`);
      if (stub.runs.length !== 1) note("a:ran-once", `the coder's harness ran ${stub.runs.length} times`);
    }
    if (failures.length === 0) {
      evidence.push(`a: Alice's workstream session's board holds one row ${row!.id}, completed by ${CODER}`);
    }

    // ---- (b) the org reads the entry ----------------------------------------
    const before = failures.length;
    for (const [label, user] of [["Bob", LAB_USERS.member], ["the outsider", LAB_USERS.outsider]] as const) {
      const client = connect({ userId: user.userId, baseUrl: origin, bearerToken: user.bearer });
      await createLabReader(client).read();
      const read = await readProject(client, readerSessionId(user.userId, PROJECT_READER_FLOW), STOREFRONT);
      const entry = read?.entries.find((e) => e.owner === LAB_USERS.owner.userId && e.id === "feature");
      if (entry === undefined) {
        note("b:reads-the-entry", `${label} reads Storefront's entries as ${show(read?.entries.map((e) => [e.owner, e.id]))}, without Alice's feature`);
      } else if (entry.lead !== EM || entry.sessionId !== workstream) {
        note("b:reads-the-entry", `${label} reads Alice's feature as led by ${entry.lead} in ${entry.sessionId}`);
      }
    }
    const orgless = await labApi(origin, undefined).call("GET", `/sessions?userId=${encodeURIComponent(LAB_USERS.owner.userId)}`);
    if (orgless.status < 400) note("b:org-less-refused", `a read with no verified organization answered ${orgless.status}`);
    if (failures.length === before) {
      evidence.push(`b: Bob and the outsider each read Alice's feature entry, led by ${EM} in ${workstream}; a read with no verified organization answered ${orgless.status}`);
    }

    // ---- (c) only the owner reads the rows ----------------------------------
    const beforeC = failures.length;
    for (const [label, user] of [["Bob", LAB_USERS.member], ["the outsider", LAB_USERS.outsider]] as const) {
      const read = await labRoutes(origin, user).act(EM_FLOW, workstream, LIST_TASKS, {});
      const seen = ((read.output as { tasks?: Task[] } | undefined)?.tasks ?? []).length;
      if (read.status === "completed" || seen > 0) {
        note("c:rows-refused", `${label}'s read of Alice's workstream board ended ${read.status} with ${seen} row(s)`);
      }
    }
    if (failures.length === beforeC) evidence.push("c: Bob's and the outsider's reads of Alice's workstream board were refused");

    // ---- (d) where the row is stored ----------------------------------------
    if (row !== undefined) {
      const beforeD = failures.length;
      const partition = `tasks/${encodeUserSegment(`${workstream}~`)}`;
      const stored = await lab.stored("user");
      const mine = Object.keys(stored).filter((key) => key.endsWith(`/${row.id}`));
      if (mine.length !== 1 || !mine[0]!.startsWith(partition)) {
        note("d:stored-once", `Alice's storage holds the row under ${show(mine)}, wanted one key under ${partition}`);
      } else if (show((stored[mine[0]!] as Task).input) !== show({ harnessFeature: { issue: ISSUE, phase: "implement" } })) {
        note("d:names-its-work", `the stored row's payload is ${show((stored[mine[0]!] as Task).input)}, wanted its issue and phase`);
      }
      const inOrg = Object.keys(await lab.stored("org")).filter((key) => key.endsWith(`/${row.id}`));
      if (inOrg.length > 0) note("d:no-org-copy", `the organization's storage holds the row under ${show(inOrg)}`);
      if (failures.length === beforeD) evidence.push(`d: the row is stored once, at ${mine[0]}, naming ${ISSUE} at implement, and nowhere in the organization's storage`);
    }

    return { failures, evidence: evidence.join("; ") };
  } finally {
    await handle.close();
    await lab.dispose();
  }
});
