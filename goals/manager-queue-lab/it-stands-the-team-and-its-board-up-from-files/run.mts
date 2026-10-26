/**
 * Contract gate — model-free. The team from files, the board from the
 * manager's own conversation, the task tools from its delegates, the board's
 * filing check, and the queue as a read.
 *
 * **Model-free on purpose.** Nothing here is a judgment call: a roster hires or
 * refuses, a turn is handed a tool or is not, a filing is refused or stored, a
 * column groups a row or does not. Every model call the manager's turn makes is
 * answered by a quiet stub that files nothing; what the leg reads is the tool
 * set the turn was handed. The one thing that needs judgment, the manager
 * deciding who gets what, is the sibling goal's.
 *
 * Legs:
 *   0  no file declares a board or grants the task tools
 *   a  the tree alone hires four workers on the flows their files name
 *   c  the manager's turn holds the task tools because its delegates take
 *      tasks; its `tools:` neither grants nor fences them
 *   d  the board's filing check, both arms
 *   e  the queue is a read, and every row lands in exactly one column
 *   f  the manager settling a task its worker is running is allowed
 *   g  the task status set has exactly the members it had
 *
 * Retired, each with its reason in goal.md: (b) a worker folder declaring the
 * board, (h) FIX-1430's diff fence, (i) the drain-width switch, and the
 * `catalog-door` and `repointed-map` controls.
 *
 * Run: cd goals && pnpm exec tsx manager-queue-lab/it-stands-the-team-and-its-board-up-from-files/run.mts
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { inMemoryStores } from "@flow-state-dev/engine";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { goalTmpDir, runGoal, silentLogger } from "../../lib/index.mts";
import { openLab, LAB_TREE, NOTE_TOOL, messageOf, type Lab, type OpenLabOptions } from "../lab/host.mts";
import { QUEUE_COLUMNS, queueView } from "../lab/queue.mts";

/**
 * The task status set as FIX-443 §2 fixed it, written out — asserted on the
 * enum against this list, not against a reading of itself.
 */
const STATUS_SET = ["pending", "in_progress", "held", "completed", "errored", "cancelled"];

/**
 * Orchestration's task tools, written out: what the manager's turn must hold,
 * each once: the filer's four since FIX-2081 (`answerTask` left with FIX-2131).
 */
const TASK_TOOLS = ["createTask", "getTask", "listTasks", "updateTask"];

/** Frontmatter keys that would declare a board or grant the task tools. None may appear. */
const BOARD_KEYS = /^(boards|boardActions|filing|mailboxes|members)\s*:/m;

/** Every file under a directory. */
function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

/** Open a lab, run a body, and always dispose. */
async function withLab<T>(options: OpenLabOptions, body: (lab: Lab) => Promise<T>): Promise<T> {
  const lab = await openLab(options);
  try {
    return await body(lab);
  } finally {
    await lab.dispose();
  }
}

/** What the twin's turn files with `createTask` for a builder that takes no task. */
const PROBE_GOAL = "probe";

/** One manager turn on a fresh lab: the tools it was handed, and what the filings answered. */
async function turnTools(
  options: OpenLabOptions,
): Promise<{ tools: string[]; turnFiling: unknown; filing: unknown; stored: boolean }> {
  return withLab(options, async (lab) => {
    const said = await lab.say("Anything new?");
    if (said.error !== undefined) throw new Error(said.error);
    await lab.settled();
    const turnFiling = lab.judgmentCalls.find((call) => "probed" in call)?.probed;
    const filing = await lab.act("createTask_tasks", { goal: PROBE_GOAL, assignee: lab.builderIds[0] });
    await lab.settled();
    const stored = (await lab.rows()).some((row) => row.goal === PROBE_GOAL);
    return { tools: lab.judgmentCalls[0]?.tools ?? [], turnFiling, filing: filing.output ?? filing.error, stored };
  });
}

await runGoal(async (failures) => {
  const note = (line: string): void => {
    failures.push(line);
  };
  const scratch = goalTmpDir("manager-queue-contract");
  const fresh = (name: string): string => {
    const path = join(scratch, `${name}.ndjson`);
    writeFileSync(path, "", "utf8");
    return path;
  };
  const base = (name: string): OpenLabOptions => ({ stores: inMemoryStores(), outbox: fresh(name), logger: silentLogger });

  const lab = await openLab(base("work"));
  let evidence = "";

  try {
    // ---- 0. no file declares a board or grants the task tools ---------------
    const files = treeFiles(LAB_TREE);
    for (const path of files) {
      if (basename(path) === "MAILBOX.md") note(`${path} is a mailbox file; no file declares a board`);
      if (path.endsWith(".md") && BOARD_KEYS.test(readFileSync(path, "utf8").split(/^---$/m)[1] ?? "")) {
        note(`${path} declares a board or grants the task tools in its frontmatter`);
      }
    }

    // ---- a. the tree alone hires four workers --------------------------------
    const ids = Object.keys(lab.hired).sort();
    if (ids.length !== 4) note(`the tree hired ${ids.length} workers, not 4: ${ids.join(", ")}`);
    if (lab.builderIds.length !== 3) note(`expected 3 builders, found ${lab.builderIds.length}`);
    for (const worker of lab.roster.workers) {
      if (lab.hired[worker.id] !== worker.declared.flow) {
        note(`${worker.id} was hired on ${lab.hired[worker.id]}, but its file names ${String(worker.declared.flow)}`);
      }
    }
    let kindRefusal = "";
    try {
      await withLab({ ...base("refused"), kindOverrides: { [lab.builderIds[0]!]: "not-a-registered-flow" } }, async () => undefined);
    } catch (error) {
      kindRefusal = messageOf(error);
    }
    if (!kindRefusal.includes(lab.builderIds[0]!)) {
      note(kindRefusal === "" ? `a worker naming an unregistered flow hired anyway` : `the refusal did not name the worker: ${kindRefusal}`);
    }

    // ---- c. the task tools come from the delegates ---------------------------
    // Read off live turns: what the manager's model call was handed, with the
    // `tools:` its own file declares, with that line rewritten to name the
    // catalog tool, and with builders that take no task.
    const managerFile = lab.roster.workers.find((worker) => worker.id === lab.managerId)?.declared;
    const declaredTools = managerFile?.tools as string[] | undefined;
    if (declaredTools === undefined || declaredTools.length !== 0) {
      note(`the manager's file was expected to say \`tools: []\` and says ${JSON.stringify(declaredTools)}`);
    }
    const own = await turnTools(base("own"));
    const withNote = await turnTools({ ...base("note"), managerTools: [NOTE_TOOL] });
    const twin = await turnTools({
      ...base("twin"),
      builderTakesTasks: false,
      probe: { tool: "createTask", input: (builders) => ({ goal: PROBE_GOAL, assignee: builders[0] }) },
    });
    const taskTools = (names: string[]) => names.filter((name) => TASK_TOOLS.includes(name));
    for (const tool of TASK_TOOLS) {
      const count = own.tools.filter((name) => name === tool).length;
      if (count !== 1) note(`the manager's turn, its file saying \`tools: []\`, holds ${tool} ${count} time(s), not once`);
    }
    if (own.tools.includes(NOTE_TOOL)) note(`\`tools: []\` did not take the catalog tool away; the fence is not biting`);
    if (!withNote.tools.includes(NOTE_TOOL)) note(`\`tools: ["${NOTE_TOOL}"]\` did not reach the catalog tool`);
    if (taskTools(withNote.tools).sort().join() !== taskTools(own.tools).sort().join()) {
      note(`the task tools changed when the manager's \`tools:\` changed; no \`tools:\` line may add or remove one`);
    }
    // FIX-2076 D1: a turn that works steps for itself holds the task tools
    // whoever its delegates are, so the twin holds the same ones. No post form
    // is left (FIX-2083). What a builder that takes no task changes is the
    // filing: the turn's createTask for one is refused, naming why.
    if (taskTools(twin.tools).sort().join() !== taskTools(own.tools).sort().join()) {
      note(`with builders that take no task the manager's task tools changed: ${taskTools(twin.tools).join(", ")}`);
    }
    const twinTurnError = String((twin.turnFiling as { error?: unknown } | undefined)?.error ?? "");
    if (!twinTurnError.startsWith("unknown_assignee") || !twinTurnError.includes("takes no task")) {
      note(
        `with builders that take no task, the turn's createTask for one was not refused as taking no task: it answered ` +
          `${JSON.stringify(twin.turnFiling)}`,
      );
    }
    if ((twin.filing as { error?: string } | undefined)?.error !== "no_delegation_board") {
      note(`with builders that take no task, a filing answered ${JSON.stringify(twin.filing)}, not no_delegation_board`);
    }
    if (twin.stored) note(`with builders that take no task, a filing was stored`);

    // ---- d. the board's filing check, both arms ------------------------------
    const stranger = "eng.nobody";
    const refused = await lab.act("createTask_tasks", { goal: "filed for a stranger", assignee: stranger });
    const refusal = String(refused.output?.error ?? refused.error ?? "");
    if (refused.output?.ok !== false || !refusal.startsWith("unknown_assignee") || !refusal.includes(stranger)) {
      note(`a filing for ${stranger} was not refused unknown_assignee naming it: ${JSON.stringify(refused)}`);
    }
    const noOne = await lab.act("createTask_tasks", { held: true, goal: "filed for no one in particular" });
    const noOneId = String(noOne.output?.taskId ?? "");
    await lab.settled();
    const afterD = await lab.rows();
    if (afterD.some((row) => row.goal === "filed for a stranger")) note(`the refused filing was stored`);
    const noOneRow = afterD.find((row) => row.id === noOneId);
    if (noOneRow?.status !== "held" || noOneRow.assignee !== undefined) {
      note(`a filing with no assignee is ${noOneRow?.status ?? "missing"}; with three delegates it waits, held and unassigned`);
    }
    if (lab.workLines().length !== 0) note(`${lab.workLines().length} task(s) ran; neither arm's row may run`);

    // ---- e. the queue is a READ ---------------------------------------------
    // Stage each column on the real path: a held task running, the held row
    // above (filed, and waiting on a person to release it), and a finished task.
    await lab.act("createTask_tasks", { goal: "a piece that finishes", assignee: lab.builderIds[2] });
    await lab.settled();
    lab.hold();
    const running = await lab.act("createTask_tasks", { goal: "a piece still running", assignee: lab.builderIds[0] });
    const runningId = String(running.output?.taskId ?? "");
    for (let i = 0; i < 250 && lab.heldTurns() < 1; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));

    const before = JSON.stringify(await lab.rows());
    const listed = await lab.act("listTasks_tasks", {});
    const after = JSON.stringify(await lab.rows());
    if (listed.output?.ok !== true) note(`the manager's listTasks failed: ${JSON.stringify(listed)}`);
    if (before !== after) note(`reading the queue changed the stored rows; a column is a view`);

    const rows = await lab.rows();
    const view = queueView(rows, Date.now());
    if (view.uncolumned.length > 0) {
      note(`${view.uncolumned.length} row(s) landed in no column: ${view.uncolumned.map((row) => `${row.id} (${row.status})`).join(", ")}`);
    }
    const counted = QUEUE_COLUMNS.flatMap((column) => view[column].map((row) => row.id));
    const duplicated = counted.filter((id, index) => counted.indexOf(id) !== index);
    if (duplicated.length > 0) note(`row(s) in more than one column: ${duplicated.join(", ")}`);
    if (counted.length !== rows.length) note(`the columns hold ${counted.length} rows, the store holds ${rows.length}`);
    if (!view.running.some((row) => row.id === runningId)) note(`a task its worker is running did not read as running`);
    if (view.queued.some((row) => row.id === noOneId)) note(`the unassigned held row read as queued; nothing starts it but a release`);
    if (view.done.length !== 1) note(`${view.done.length} row(s) read as done, not the one that finished`);
    if (!view.waitingOnYou.some((row) => row.id === noOneId)) note(`the held row is not under "waiting on you"`);

    // ---- f. the manager cancels a task its worker is still running -----------
    // No action settles a task (FIX-2081): the filer may cancel a row a worker
    // holds, and the worker's late result is then declined.
    const settled = await lab.act("updateTask_tasks", { id: runningId, status: "cancelled" });
    lab.release();
    await lab.settled();
    const settledRow = (await lab.rows()).find((row) => row.id === runningId);
    const ran = lab.workLines().some((line) => line.taskId === runningId);
    const unclaimedSettle = settled.output?.ok === true ? "allowed" : `refused: ${JSON.stringify(settled)}`;
    if (settled.output?.ok !== true) note(`the manager could not cancel a task its worker was running: ${unclaimedSettle}`);
    else if (settledRow?.status !== "cancelled" || settledRow.output !== undefined) {
      note(`after the manager's cancel the row reads ${settledRow?.status} with ${JSON.stringify(settledRow?.output)}`);
    }

    // ---- g. the task status set ----------------------------------------------
    const statuses = [...taskStatusSchema.options];
    if (JSON.stringify(statuses) !== JSON.stringify(STATUS_SET)) {
      note(`the task status set is ${JSON.stringify(statuses)}, not ${JSON.stringify(STATUS_SET)}`);
    }

    evidence =
      `one tree at ${LAB_TREE}: ${files.length} files, none a MAILBOX.md and none declaring a board or a ` +
      `filing grant; four workers (${ids.join(", ")}) hired on the flows their files name, and one renamed to an ` +
      `unregistered flow refused the whole roster naming it. The manager's file says \`tools: []\`, and its live ` +
      `turn was handed ${taskTools(own.tools).length} task tools, each once (${taskTools(own.tools).join(", ")}), ` +
      `and no catalog tool; with \`tools: ["${NOTE_TOOL}"]\` the same task tools plus ${NOTE_TOOL}; with builders ` +
      `whose work entry takes no conversation's task, the same task tools (it works steps for itself), and the ` +
      `turn's own createTask for a builder answered ${JSON.stringify(twinTurnError.split(":")[0])}, naming it as taking no task, ` +
      `and the public filing answered no_delegation_board, storing nothing. A filing ` +
      `for ${stranger} answered "${refusal.split(":")[0]}" and stored nothing; one for nobody waits, held and ` +
      `unassigned. The manager's listTasks left the stored rows byte-identical; each of ${rows.length} rows ` +
      `landed in one column (queued, running, waiting on you, done). The manager settling a ` +
      `task its worker was running: ${unclaimedSettle}; the worker's turn ${ran ? "still ran and its result was declined" : "did not run"}. ` +
      `The status set is unchanged at ${statuses.length} members.`;
  } finally {
    await lab.dispose();
  }

  return { failures, evidence };
});
