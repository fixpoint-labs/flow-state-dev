/**
 * Goal check — the DevForce feature channel carries the board its rows sit on.
 *
 * A line posted on the feature channel ends as one completed row, and that row
 * is read back where Shift Manager reads a workstream: through the channel's own
 * `read` and `readBoard`, through the HTTP door a browser uses, and from the
 * organization's storage under the id the framework minted. Nothing here reads
 * the drain's report, the run record or the EM's output — all three are green
 * while the row sits on a ledger the channel does not hold.
 *
 * Model-free: the lab's scripted harness commits and finishes, as in the
 * contract gate. What is graded is where the row lives, not how the work went.
 *
 * Legs:
 *
 *   0  BR-1        — the channel's file names the board; no file writes its minted id
 *   a  BR-2        — the channel lists exactly the boards its file declares
 *   b  BR-3 BR-4   — its board holds exactly the filed row, completed, assignee coder
 *   c  BR-7 BR-8   — the browser's door returns that row under the lab's bearer, only
 *                    client fields; with no verified organization it is refused
 *   d  BR-4 BR-9   — org storage holds it under the minted id, and no other copy exists
 *   e  BR-11       — hiring named no board as unattended
 *
 * Control: `GOAL_CONTROL=kind-ledger` builds the two kinds on a user-scoped
 * ledger of their own, as they were before the board moved onto the channel.
 * The run still completes; the check must FAIL naming the channel's board
 * returning no rows. `GOAL_CONTROL=list` prints it.
 *
 * Run: pnpm tsx goals/devforce-lab/it-keeps-its-rows-on-the-channels-board/run.mts
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryStores } from "@flow-state-dev/engine";
import { harnessTaskInputSchema } from "@flow-state-dev/harness-manager";
import { harnessTaskId, joinIdentity, tenantSegment } from "@flow-state-dev/harness-manager/checkout";
import { defineTaskCollection, type Task } from "@flow-state-dev/orchestration/tasks";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { runGoal, silentLogger } from "../../lib/index.mts";
import { LAB_TREE, openLab, type Lab, type OpenLabOptions } from "../lab/host.mts";
import { harnessStub, type StubRun } from "../lab/harness-stub.mts";
import { createNotifyLog } from "../lab/notify.mts";
import { BASE_REF, commitAll, createScratchRepo } from "../lab/scratch-repo.mts";
import { PHASE } from "../lab/phase.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["kind-ledger"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}

/** The seat the board's `coder` assignee is addressed to — the app's address map. */
const ASSIGNED_SEAT = "eng.coder";
/** The seat a channel post is delivered to. */
const COORDINATOR_SEAT = "eng.em";

const ISSUE = "greeting-module";
const POST_LINE = `${ISSUE}: Add a greeting module to the repository.`;
/** The row id the EM's filing returns: the issue-and-phase, as the manager derives it. */
const TASK_ID = harnessTaskId(ISSUE, PHASE);
const SETTLE_BUDGET_MS = 120_000;
/**
 * A pattern that matches `id` only where a file pins it as a value: a quoted
 * string that is exactly the id, or the id standing alone after `:`, `=`, `[`
 * or `,`. Word characters, dots and dashes on either side mean a longer name,
 * not this one.
 */
function pinsOf(id: string): RegExp {
  const lit = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(["'\`])${lit}\\1|[:=\\[,]\\s*${lit}(?![\\w.-])`);
}

/** Fields a browser's read of a board may never carry. */
const PRIVATE_ROW_FIELDS = ["input", "output", "metadata", "context", "claimedBy", "leaseUntil", "writeLog"];

const LAB_ROOT = fileURLToPath(new URL("../lab", import.meta.url));
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Every file under a directory, recursively, as [relative path, contents]. */
function filesUnder(root: string, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel));
    else out.push([rel, readFileSync(full, "utf8")]);
  }
  return out;
}

/** What the harness "did": write a file and commit it, so the run completes. */
const commitWork = (run: StubRun): void => {
  writeFileSync(join(run.cwd, "GREETING.md"), "A greeting, as the brief asked.\n");
  commitAll(run.cwd, "add greeting module");
};

/**
 * The control's ledger: user-scoped, under the id the kinds used before the
 * board moved onto the channel. Built here, never in the lab.
 */
function kindLedger(): NonNullable<OpenLabOptions["ledger"]> {
  const id = joinIdentity("devforce-tasks", tenantSegment(undefined), "feature");
  return {
    id,
    collection: defineTaskCollection({ id, scope: "user" as const, stateSchema: harnessTaskInputSchema }),
  };
}

/** Post, then run the EM's board until the row is completed or errored. */
async function postAndSettle(lab: Lab): Promise<Task | undefined> {
  const posted = await lab.post!(POST_LINE);
  if (posted.error !== undefined) throw new Error(`the post was refused — ${posted.error}`);
  const deadline = Date.now() + SETTLE_BUDGET_MS;
  let row: Task | undefined;
  while (Date.now() < deadline) {
    row = await lab.row(TASK_ID);
    if (row?.status === "completed" || row?.status === "errored") return row;
    if (row === undefined || row.status === "pending") await lab.drain(COORDINATOR_SEAT);
    await sleep(500);
  }
  return row;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const note = (why: string): void => {
    failures.push(CONTROL === "" ? why : `[control ${CONTROL}] ${why}`);
  };

  // ---- (0) BR-1, read off the tree before anything is built ---------------
  const roster = await readDeclaredRoster(LAB_TREE);
  const channel = roster.channels.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  const declared = (channel?.declared.boards as string[] | undefined) ?? [];
  if (channel === undefined) {
    return { failures: ["no channel in the tree holds a board"], evidence: "" };
  }

  const dirs = createScratchRepo("channel-board");
  const stub = harnessStub({ duringRun: commitWork });
  const warnings: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  let lab: Lab;
  try {
    lab = await openLab({
      stores: inMemoryStores(),
      harness: stub.slot,
      workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
      coderSeatId: ASSIGNED_SEAT,
      logger: silentLogger,
      channels: {
        addresses: { [COORDINATOR_SEAT]: COORDINATOR_SEAT },
        log: createNotifyLog(),
      },
      ...(CONTROL === "kind-ledger" ? { ledger: kindLedger() } : {}),
    });
  } finally {
    console.warn = warn;
  }

  try {
    const board = lab.board;
    if (declared.length === 0) {
      note(`the channel lists no board: "${channel.id}"'s file declares none`);
      return { failures, evidence: "" };
    }
    if (declared.length !== 1 || declared[0] !== board.name) {
      note(`the channel's file declares [${declared.join(", ")}]; the lab resolved "${board.name}"`);
    }
    // The minted id is the channel's id, a dot, and the local name — and no
    // file in the tree or the lab's code pins it. Pinning is a value: a quoted
    // string that is exactly the id, or the id standing alone after `:`, `=`,
    // `[` or `,` (a YAML key, an assignment, a list entry). Prose and comments
    // that name the id in passing are not a second declaration of it.
    const pins = pinsOf(board.id);
    const writers = [
      ...filesUnder(LAB_TREE).map(([path, text]) => [`workforce/${path}`, text] as const),
      ...filesUnder(LAB_ROOT)
        .filter(([path]) => path.endsWith(".mts"))
        .map(([path, text]) => [`lab/${path}`, text] as const),
    ]
      .filter(([, text]) => pins.test(text))
      .map(([path]) => path);
    if (writers.length > 0) note(`the board's minted id "${board.id}" is written in ${writers.join(", ")}`);
    evidence.push(
      `"${channel.id}"'s file declares boards [${declared.join(", ")}], minted "${board.id}", which no ` +
        `file in the tree or the lab's code writes`,
    );

    // ---- the run ---------------------------------------------------------
    const settled = await postAndSettle(lab);
    if (settled?.status !== "completed") {
      note(`the run did not complete the row (last status: ${settled?.status ?? "never filed"})`);
      return { failures, evidence: "" };
    }

    // ---- (a) BR-2: the channel lists exactly its declared boards ---------
    const read = await lab.channelAct!("read", {});
    const listed = (read.output as { boards?: string[] } | undefined)?.boards ?? [];
    if (read.error !== undefined || listed.join(",") !== declared.join(",")) {
      note(
        `the channel lists [${listed.join(", ")}]${read.error === undefined ? "" : ` (${read.error})`}; ` +
          `its file declares [${declared.join(", ")}]`,
      );
    }

    // ---- (b) BR-3, BR-4: the channel's board holds the filed row ---------
    const readBoard = await lab.channelAct!("readBoard", { board: board.name });
    const tasks = (readBoard.output as { tasks?: Task[] } | undefined)?.tasks ?? [];
    if (readBoard.error !== undefined) {
      note(`reading the channel's board was refused — ${readBoard.error}`);
    } else if (tasks.length === 0) {
      note(`the channel's board returned no rows`);
    } else if (tasks.length !== 1 || tasks[0]!.id !== TASK_ID) {
      note(`the channel's board returned [${tasks.map((t) => t.id).join(", ")}]; wanted exactly ${TASK_ID}`);
    } else {
      const row = tasks[0]!;
      if (row.status !== "completed") note(`the channel's board shows the row "${row.status}"; the run completed it`);
      if (row.assignee !== "coder") note(`the channel's board shows the row assigned "${row.assignee}"`);
    }

    // ---- (c) BR-7, BR-8: the browser's door ------------------------------
    const door = await lab.readBoardAtDoor!("bearer");
    const doorRows = door.rows ?? [];
    if (door.status !== 200) {
      note(`the browser's door answered ${door.status} under the lab's bearer — ${door.error}`);
    } else if (doorRows.length !== 1 || doorRows[0]!.id !== TASK_ID || doorRows[0]!.status !== "completed") {
      note(
        `the browser's door returned ${JSON.stringify(doorRows.map((r) => [r.id, r.status]))}; ` +
          `wanted exactly [${TASK_ID}, completed]`,
      );
    } else {
      // What a board card never carries: the row's payloads, and the
      // substrate's execution coordinates. Present on the stored row (the run
      // wrote `output`, the manager wrote `metadata`), so their absence here
      // is the door's doing.
      const leaked = PRIVATE_ROW_FIELDS.filter((key) => Object.hasOwn(doorRows[0]!, key));
      if (leaked.length > 0) note(`the browser's door published [${leaked.join(", ")}], which a browser may not see`);
    }
    const orgless = await lab.readBoardAtDoor!("org-less");
    if (orgless.status < 400) {
      note(`the browser's door answered ${orgless.status} with no verified organization`);
    }

    // ---- (d) BR-4, BR-9: org storage, and no second copy ------------------
    const key = `${board.id}/${TASK_ID}`;
    const org = await lab.stored("org");
    const stored = org[key] as Task | undefined;
    if (stored?.status !== "completed") {
      note(`org storage holds "${key}" as ${stored === undefined ? "nothing" : `"${stored.status}"`}`);
    }
    const copies = [
      ...Object.keys(org).map((k) => `org:${k}`),
      ...Object.keys(await lab.stored("user")).map((k) => `user:${k}`),
    ].filter((k) => k.endsWith(`/${TASK_ID}`));
    if (copies.length !== 1 || copies[0] !== `org:${key}`) {
      note(`the row is stored under [${copies.join(", ")}]; wanted only org:${key}`);
    }

    // ---- (e) BR-11 --------------------------------------------------------
    const unattended = warnings.filter((line) => line.includes(board.id));
    if (unattended.length > 0) note(`hiring warned about the channel's board: ${unattended.join(" | ")}`);

    if (failures.length === 0) {
      evidence.push(
        `a post on "${channel.id}" ended as one completed row ${TASK_ID}; the channel lists ` +
          `[${listed.join(", ")}] and its "${board.name}" board returns exactly that row, assignee coder; ` +
          `the browser's door returns it under the lab's bearer with only client fields ` +
          `(${Object.keys(doorRows[0]!).sort().join(", ")}) and answers ${orgless.status} with no ` +
          `verified organization; org storage holds it under "${key}" and nowhere else; hiring ` +
          `named no board as unattended`,
      );
    }
    return { failures, evidence: evidence.join("; ") };
  } finally {
    await lab.dispose();
  }
});
