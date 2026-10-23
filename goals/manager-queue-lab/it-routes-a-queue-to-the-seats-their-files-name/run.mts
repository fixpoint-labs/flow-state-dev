/**
 * Goal check — a manager declared in Markdown takes in more work than its
 * team has workers, files one task per piece on its own conversation's board
 * naming the builder each is for, and every task runs on the worker it names,
 * in a session of its own, carrying that worker's own file.
 *
 * **One model surface, and only one.** The manager deciding who gets what is
 * the judgment call; everything else is mechanism. Builder turns are stubs
 * that write a line a check reads back.
 *
 * **The oracle and the implementation are two different sources**, and that
 * is the whole of leg (c). The stored row says which worker it was filed for;
 * the running work reports, from inside its task session, which worker it runs
 * as and what that worker's own file says in `answersFor:`. The tree, read at
 * run time, says which file declares which worker. The `repointed-map` control
 * moves the host's id -> file records and leaves the tree alone, so what a
 * worker runs with and what the tree says come apart, and leg (c) is the leg
 * that fails.
 *
 * Legs:
 *   a  the manager files one row per piece, on its own conversation's board
 *   b  every piece reaches the board in its own words, one row per piece, each
 *      naming one of the manager's delegates, one delegate given two
 *   c  every row runs on the worker it names, carrying that worker's own file
 *   d  each row runs in its own session, a child of the manager's
 *      conversation, carrying none of its transcript
 *   e  two rows for one worker each run once on it: not re-routed, not dropped
 *   f  a row for a worker the manager can't hand a task to is refused by name,
 *      and a row for nobody waits, unassigned, and runs nowhere
 *
 * ## The filer is a slot, and only one of its two values is the gate
 *
 * `GOAL_FILER` decides who files:
 *
 * - **`model` (default) — THE GATE.** The manager's judgment turn decides
 *   which builder each piece is for and files with its `createTask` tool, which
 *   it holds because its delegates take tasks. Needs a model credential.
 * - **`scripted` — NOT the gate.** The four rows are filed through the
 *   conversation's `createTask_tasks` action, spread across the manager's
 *   delegates, and every other leg runs unchanged. The manager's turn, woken by
 *   each task's notice, runs on a quiet stub that files nothing. It proves the
 *   routing half and nothing about a model choosing; its evidence line says so.
 *
 * Run: cd goals && pnpm exec tsx manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name/run.mts
 * Controls: GOAL_CONTROL=repointed-map · GOAL_CONTROL=duplicate-filing (both force the scripted filer)
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inMemoryStores } from "@flow-state-dev/engine";
import { gatewayModel, goalTmpDir, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { openLab, partitionOf, LAB_TREE, LAB_USER_ID, type Lab } from "../lab/host.mts";

/**
 * The work that comes in — four pieces for three builders. Held out: nothing
 * about these strings is known to the lab.
 */
const WORK = [
  "renumber the invoice export so the columns line up",
  "the weekly digest is sending twice on Mondays",
  "add a per-team filter to the usage report",
  "the CSV upload rejects a trailing newline",
];

/**
 * Controls perturb the WIRING, never the tree — the tree is the oracle, so an
 * edit there would move the answer along with the implementation.
 *
 *   repointed-map  the host hands the installation two builders' files SWAPPED
 *                  under their ids. Every id is still well-formed, the roster
 *                  still hires, every row still names a delegate, runs on it
 *                  and completes. What changes is the file each of the two runs
 *                  with, while the tree still says which file declares which
 *                  worker. Must fail at leg (c) once for every row filed for
 *                  either of the two, and nowhere else.
 *
 *   duplicate-filing  the filer combines two pieces into one row and files a
 *                  third twice. Four rows still land, every row names a
 *                  delegate, one delegate still gets two, and every row runs
 *                  where it names. Must fail at leg (b), and nowhere else.
 *
 * Both force the scripted filer: the first so which rows the swap moves is
 * known from the filing, the second because what it perturbs is what gets
 * filed, and a model cannot be made to file badly on demand.
 */
const CONTROL = process.env.GOAL_CONTROL ?? "";
const FILER = CONTROL !== "" || process.env.GOAL_FILER === "scripted" ? "scripted" : "model";

/** The words a leg's own failure carries, so a control can prove it went red THERE. */
const LEG_C_IDENTITY = "whose own file";
const LEG_B_MARKS = ["carry the same piece", "combines", "carries none of the work"];

stripIntentOverrides();

await runGoal(async (failures) => {
  const note = (line: string): void => {
    failures.push(line);
  };
  const scratch = goalTmpDir("manager-queue-goal");
  const outbox = join(scratch, "work.ndjson");
  writeFileSync(outbox, "", "utf8");
  const model = gatewayModel();

  const lab: Lab = await openLab({
    stores: inMemoryStores(),
    outbox,
    logger: silentLogger,
    ...(FILER === "model" ? { model } : {}),
    ...(CONTROL === "repointed-map" ? { swapBuilders: true } : {}),
  });
  let evidence = "";

  try {
    const manager = lab.roster.workers.find((worker) => worker.id === lab.managerId);
    const delegates = ((manager?.declared.delegates as string[] | undefined) ?? []).slice();
    const ownFile = Object.fromEntries(
      lab.roster.workers
        .filter((worker) => worker.declared.answersFor !== undefined)
        .map((worker) => [worker.id, String(worker.declared.answersFor)]),
    );
    const swapped =
      CONTROL === "repointed-map" ? ([lab.builderIds[0]!, lab.builderIds[1]!] as const) : undefined;

    if (delegates.length !== 3 || delegates.some((id) => ownFile[id] === undefined)) {
      return {
        failures: [`the manager's file names ${JSON.stringify(delegates)} as delegates, not three builders with files`],
        evidence: "",
      };
    }

    const filing = await lab.filingSessionId();

    // ---- a. the rows are filed, on the manager's own board -----------------
    if (FILER === "model") {
      const said = await lab.say(
        `Here is the work that came in. File one task per line, in this order:\n\n` +
          WORK.map((piece, index) => `${index + 1}. ${piece}`).join("\n"),
      );
      if (said.error !== undefined) note(`the manager could not be asked: ${said.error}`);
    } else {
      const [one, two, three] = delegates as [string, string, string];
      const filings =
        CONTROL === "duplicate-filing"
          ? [
              { goal: `${WORK[0]} ${WORK[1]}`, assignee: one },
              { goal: WORK[2], assignee: one },
              { goal: WORK[2], assignee: two },
              { goal: WORK[3], assignee: three },
            ]
          : [
              { goal: WORK[0], assignee: one },
              { goal: WORK[1], assignee: one },
              { goal: WORK[2], assignee: two },
              { goal: WORK[3], assignee: three },
            ];
      for (const filed of filings) {
        const result = await lab.act("createTask_tasks", filed);
        if (result.error !== undefined || result.output?.ok !== true) {
          note(`could not file ${JSON.stringify(filed.goal)}: ${result.error ?? result.output?.error}`);
        }
      }
    }
    await lab.settled();

    const rowsAfter = await lab.rows();
    if (rowsAfter.length !== WORK.length) {
      note(
        `the manager filed ${rowsAfter.length} rows for ${WORK.length} pieces of work: ` +
          rowsAfter.map((row) => JSON.stringify(row.goal)).join(", "),
      );
    }
    const elsewhere = rowsAfter.filter((row) => row.partition !== partitionOf(filing));
    if (elsewhere.length > 0) {
      note(`${elsewhere.length} row(s) are stored outside the manager's conversation's board`);
    }
    if (FILER === "model") {
      // Filed by the turn's own tool: the check sent no `createTask_tasks`, and
      // the turn was handed the tool.
      const actions = (await lab.requestsOf(lab.conversation)).map((request) => String(request.actionName));
      if (actions.includes("createTask_tasks")) note(`something filed through the action, not the manager's turn`);
      if (!lab.judgmentCalls.some((call) => call.tools.includes("createTask"))) {
        note(`the manager's turn was never handed createTask`);
      }
    }

    // ---- b. every piece reached the board, in its own words -----------------
    // One distinct row per piece, both directions: "each piece appears
    // somewhere" is satisfied by a filer that combines two and files a third
    // twice, and nothing downstream grades the text.
    for (const piece of WORK) {
      const carriers = rowsAfter.filter((row) => row.goal.includes(piece));
      if (carriers.length === 0) note(`no row carries the work ${JSON.stringify(piece)}`);
      else if (carriers.length > 1) {
        note(
          `${carriers.length} rows carry the same piece ${JSON.stringify(piece)} ` +
            `(${carriers.map((row) => row.id).join(", ")}); one piece is one row`,
        );
      }
    }
    for (const row of rowsAfter) {
      const carried = WORK.filter((piece) => row.goal.includes(piece));
      if (carried.length === 0) note(`row ${row.id} carries none of the work that came in: ${JSON.stringify(row.goal)}`);
      else if (carried.length > 1) {
        note(`row ${row.id} combines ${carried.length} pieces into one row: ${carried.map((p) => JSON.stringify(p)).join(", ")}`);
      }
    }
    const misfiled = rowsAfter.filter((row) => row.assignee === undefined || !delegates.includes(row.assignee));
    if (misfiled.length > 0) {
      note(
        `${misfiled.length} row(s) name none of the manager's delegates: ` +
          misfiled.map((row) => `${row.id} -> ${row.assignee ?? "(none)"}`).join(", "),
      );
    }
    const perWorker = new Map<string, number>();
    for (const row of rowsAfter) perWorker.set(String(row.assignee), (perWorker.get(String(row.assignee)) ?? 0) + 1);
    const doubled = [...perWorker.entries()].filter(([, count]) => count > 1);
    if (doubled.length === 0) {
      note(`no builder was given two pieces, so leg (e) has nothing to grade`);
    }

    // ---- c, d. each row ran on the worker it names, in a session of its own --
    // Proof of execution is a FILE, not the board's report.
    const lines = lab.workLines();
    const finalRows = await lab.rows();
    const rowById = new Map(finalRows.map((row) => [row.id, row]));
    if (lines.length !== rowsAfter.length) note(`${lines.length} of ${rowsAfter.length} rows actually ran`);

    for (const line of lines) {
      const row = rowById.get(line.taskId);
      if (row === undefined) {
        note(`a task ran that is not on the board: ${line.taskId}`);
        continue;
      }
      // THE LEG. The row says who it was filed for; the work says who it runs
      // as and what that worker's own file says; the tree says which file
      // declares the row's worker.
      if (line.worker !== row.assignee) {
        note(`row ${row.id} was filed for ${row.assignee} and ran as ${line.worker}`);
      }
      const oracle = ownFile[String(row.assignee)];
      if (line.answersFor !== oracle) {
        note(
          `row ${row.id} was filed for ${row.assignee}, whose own file says answersFor "${oracle}", ` +
            `and ran carrying "${line.answersFor}"`,
        );
      }

      // ---- d. its own session, a child of the conversation, no transcript ---
      const session = await lab.session(line.session);
      if (session === undefined) {
        note(`row ${row.id} left no session record for ${line.session}`);
        continue;
      }
      if (session.parentSessionId !== lab.conversation) {
        note(`row ${row.id} ran in a session parented to ${String(session.parentSessionId)}, not the manager's conversation`);
      }
      if (session.userId !== LAB_USER_ID) note(`row ${row.id} ran as ${String(session.userId)}, not the conversation's user`);
      if (line.filingSessionId !== filing) {
        note(`row ${row.id}'s session names ${line.filingSessionId} as its filer, not the manager's board`);
      }
      // What the task session holds as messages: the task as filed, and none
      // of the conversation's own lines.
      const texts = (await lab.requestsOf(line.session))
        .flatMap((request) => (request.items ?? []) as Array<Record<string, any>>)
        .filter((item) => item.type === "message")
        .map((item) => JSON.stringify(item.content ?? item.text ?? ""));
      const foreign = WORK.filter((piece) => piece !== row.goal && !row.goal.includes(piece) && texts.some((t) => t.includes(piece)));
      if (foreign.length > 0) note(`row ${row.id}'s session carries other pieces of the conversation: ${foreign.join(" | ")}`);
    }
    const sessions = new Set(lines.map((line) => line.session));
    if (sessions.size !== lines.length) note(`${lines.length} rows ran in ${sessions.size} sessions; each runs in its own`);

    // ---- e. two rows for one worker: each ran once, on it --------------------
    for (const [worker, count] of doubled) {
      const ran = lines.filter((line) => rowById.get(line.taskId)?.assignee === worker);
      const ranOn = new Set(ran.map((line) => line.worker));
      if (ran.length !== count) note(`${ran.length} of ${count} rows for ${worker} ran; a second row must not be dropped`);
      if (ranOn.size > 1) note(`rows for ${worker} ran as ${[...ranOn].join(" and ")}; a second row was re-routed`);
    }
    const unsettled = finalRows.filter((row) => row.status !== "completed");
    if (unsettled.length > 0) {
      note(`${unsettled.length} row(s) did not complete: ${unsettled.map((row) => `${row.id} (${row.status})`).join(", ")}`);
    }

    // ---- f. a row for nobody on the team, and a row for nobody --------------
    const stranger = "eng.nobody";
    const refused = await lab.act("createTask_tasks", { goal: "a piece for a stranger", assignee: stranger });
    const refusal = String(refused.output?.error ?? refused.error ?? "");
    if (refused.output?.ok !== false || !refusal.startsWith("unknown_assignee") || !refusal.includes(stranger)) {
      note(`a filing for ${stranger} was not refused unknown_assignee by name: ${JSON.stringify(refused)}`);
    }
    const unassigned = await lab.act("createTask_tasks", { held: true, goal: "a piece of work for nobody in particular" });
    const unassignedId = String(unassigned.output?.taskId ?? "");
    await lab.settled();
    const afterF = await lab.rows();
    if (afterF.some((row) => row.goal === "a piece for a stranger")) note(`the refused filing was stored anyway`);
    const waiting = afterF.find((row) => row.id === unassignedId);
    if (waiting === undefined) note(`the unassigned row was not stored: ${JSON.stringify(unassigned)}`);
    else if (waiting.status !== "held" || waiting.assignee !== undefined) {
      note(`the unassigned row is ${waiting.status} for ${waiting.assignee ?? "nobody"}; with three delegates it waits, unassigned`);
    }
    const ranAfterF = lab.workLines().slice(lines.length);
    if (ranAfterF.length > 0) note(`${ranAfterF.length} task(s) ran after leg (f) filed; neither of its rows may run`);

    // ---- the controls grade THEMSELVES --------------------------------------
    if (CONTROL !== "") {
      const expected =
        CONTROL === "repointed-map"
          ? { leg: "(c)", marks: [LEG_C_IDENTITY] }
          : CONTROL === "duplicate-filing"
            ? { leg: "(b)", marks: LEG_B_MARKS }
            : undefined;
      if (expected === undefined) note(`unknown control ${JSON.stringify(CONTROL)}`);
      else if (failures.length === 0) note(`the ${CONTROL} control did not go red at all; leg ${expected.leg} does not grade what it claims to`);
      else {
        const offLeg = failures.filter((line) => !expected.marks.some((mark) => line.includes(mark)));
        if (offLeg.length > 0) {
          note(`the ${CONTROL} control went red away from leg ${expected.leg}: ${offLeg.join(" | ")}`);
        } else if (CONTROL === "repointed-map" && swapped !== undefined) {
          // Exactly the rows filed for either swapped worker, one note apiece.
          const mustFail = finalRows.filter((row) => swapped.includes(String(row.assignee))).map((row) => row.id);
          const unnamed = mustFail.filter((id) => !failures.some((line) => line.includes(id)));
          if (unnamed.length > 0 || failures.length !== mustFail.length) {
            note(
              `the repointed-map control went red ${failures.length} time(s), but the swap moved ` +
                `${mustFail.length} row(s) (${mustFail.join(", ")}); leg (c) must fail once for each`,
            );
          }
        }
      }
    }

    const placement = lines
      .map((line) => `${rowById.get(line.taskId)?.assignee} -> ${line.worker} (${line.answersFor})`)
      .sort()
      .join(", ");
    const filedBy =
      FILER === "model"
        ? `The manager, whose own file says \`tools: []\`, decided who got what and filed ${rowsAfter.length} rows ` +
          `for ${WORK.length} pieces with its own createTask tool, which it holds because its delegates take tasks.`
        : `**NOT THE GATE — GOAL_FILER=scripted.** No model chose: the ${rowsAfter.length} rows were filed ` +
          `through the conversation's createTask_tasks action, spread across the manager's delegates. What follows ` +
          `is the routing half, and says nothing about a manager choosing.`;
    evidence =
      `one tree at ${LAB_TREE}${FILER === "model" ? `, on ${model}` : ""}: ${filedBy} Every row is stored on ` +
      `the manager's own conversation's board (partition ${partitionOf(filing)}). ` +
      `${doubled.map(([worker, n]) => `${worker} got ${n}`).join(", ")}. Every row ran on the worker it names, ` +
      `carrying that worker's own file (${placement}), proved by ${outbox}, each in its own task session, a ` +
      `child of the manager's conversation, holding none of its other pieces. The second row for one worker ` +
      `was neither re-routed nor dropped. A filing for ${stranger} answered "${refusal.split(":")[0]}" and stored ` +
      `nothing; a filing for nobody waits, held and unassigned, and ran nowhere.`;
  } finally {
    await lab.dispose();
  }

  return { failures, evidence };
});
