/**
 * Goal check — the epic's exit gate. A coordinator declared in Markdown takes
 * in more work than its team has seats, files a row per piece naming the desk
 * it is for, and every row runs on the seat whose own file answers for that
 * desk — the extra one waiting for a seat to free rather than being re-routed.
 *
 * **One model surface, and only one.** The coordinator deciding who gets what
 * is the judgment call; everything else is mechanism. Worker bodies are stubs
 * that write a line a check reads back. A gate that goes red for reasons
 * unrelated to routing has stopped being a gate.
 *
 * ## What the tree contributes and the code does not
 *
 * The channel's id, the board's local name, the desk keys, which seat answers
 * for which desk, and which seat runs which kind all come off files at run
 * time. The ledger id is never written anywhere — the framework mints it from
 * where the channel folder sits, which is why leg 0 greps the whole lab for it.
 *
 * **The oracle and the implementation are two different sources**, and that is
 * the whole of leg (c). The host holds a seat -> desk map, which is what routes;
 * each builder's own `WORKER.md` says which desk it answers for, which is what
 * the check grades against. The control moves the map and leaves the tree
 * alone, so implementation and oracle come apart and the leg that grades
 * identity is the one that fails.
 *
 * Legs:
 *   0  the tree declares a board by NAME and the minted id appears in no file
 *   a  the coordinator files one row per piece, through the capability's door
 *   b  every piece of work reaches the board, in the words it arrived in
 *   c  every row runs on the seat whose own file answers for its desk
 *   d  each row runs in its own session, parented, carrying no transcript
 *   e  the extra row is not re-routed and not dropped — it waits, then runs
 *   f  a row filed for nobody is refused by name where it would have run
 *
 * ## The filer is a slot, and only one of its two values is the exit gate
 *
 * `GOAL_FILER` decides who files:
 *
 * - **`model` (default) — THE EXIT GATE.** The coordinator seat's generator
 *   decides which desk each piece is for and files through the eight task tools
 *   its kind composes. This is the whole of ER-20: a coordinator *assigning*
 *   across named seats, through the door FIX-1385 ships for models. It needs a
 *   real model credential.
 * - **`scripted` — NOT the exit gate.** The four rows are filed through the
 *   channel's own `fileTask` action, spread across the desks the tree declares,
 *   and every other leg runs unchanged. It proves the *routing and queue* half
 *   — more rows than seats, each reaching the seat its own file answers for,
 *   the extra one waiting rather than being re-routed — and proves **nothing**
 *   about a model choosing or about the capability door. A scripted run says so
 *   in its own evidence line, so a green one cannot be mistaken for the gate.
 *
 * The split exists because the two halves fail for different reasons and one of
 * them needs a credential. Keeping the second runnable everywhere is what makes
 * the routing claim a regression check rather than something only CI-with-keys
 * can ever see.
 *
 * Run: pnpm tsx goals/manager-queue-lab/it-routes-a-queue-to-the-seats-their-files-name/run.mts
 * Controls: GOAL_CONTROL=repointed-map · GOAL_FILER=scripted
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createModelResolver } from "@flow-state-dev/core";
import { inMemoryStores } from "@flow-state-dev/engine";
import { gatewayModel, goalTmpDir, runGoal, stripIntentOverrides } from "../../lib/index.mts";
import { openLab, LAB_TREE, type Lab } from "../lab/host.mts";

/** The lab's own root, so leg 0 can read every file the lab ships. */
const LAB_DIR = fileURLToPath(new URL("../lab", import.meta.url));

/**
 * The work that comes in — four pieces for three desks, which is the whole
 * point. Held out: nothing about these strings is known to the lab, and a
 * different four would pass a correct implementation just as well.
 */
const WORK = [
  "renumber the invoice export so the columns line up",
  "the weekly digest is sending twice on Mondays",
  "add a per-team filter to the usage report",
  "the CSV upload rejects a trailing newline",
];

/**
 * Controls perturb the WIRING, never the tree — the tree is the oracle, so an
 * edit there would move the answer along with the implementation and the
 * control would stay green.
 *
 *   repointed-map  one seat's entry in the host's seat -> desk map is pointed at
 *                  a DIFFERENT declared seat. Everything still compiles, every
 *                  id is still well-formed, the roster still hires and rows
 *                  still run. What changes is which seat a desk's rows reach,
 *                  and the tree still says where they should have gone — so the
 *                  run is observed on a seat whose own file claims another
 *                  desk. Must fail at leg (c).
 */
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** Who files the rows. See the module header — only `model` is the exit gate. */
const FILER = process.env.GOAL_FILER === "scripted" ? "scripted" : "model";

/** Silence the engine's own logging; a goal's output is its verdict. */
const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Every file under a directory, so leg 0 can search all of them. */
function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

/**
 * The map the control perturbs.
 *
 * It re-points one builder at another builder's declared desk. Both are
 * declared seats and both desks are declared desks, so nothing is malformed —
 * only the association is wrong, which is the one thing under test.
 */
function repoint(lab: Lab): Record<string, string> {
  const map = { ...lab.assignees };
  const [first, second] = lab.builderIds;
  map[first] = String(map[second]);
  return map;
}

stripIntentOverrides();

await runGoal(async () => {
  const failures: string[] = [];
  const note = (line: string): void => {
    failures.push(line);
  };
  const scratch = goalTmpDir("manager-queue-goal");
  const outbox = join(scratch, "work.ndjson");
  writeFileSync(outbox, "", "utf8");

  const model = gatewayModel();
  const base = {
    stores: inMemoryStores(),
    outbox,
    logger: silent,
    // Resolved only on the model path. A scripted run builds no resolver at
    // all, which is why it needs no credential and why it cannot accidentally
    // reach a model and report itself as the gate.
    ...(FILER === "model"
      ? { defaultModel: model, modelResolver: createModelResolver() }
      : {}),
  };

  // Opened twice under the control and once otherwise: the map is fixed when
  // the kinds are built, so the perturbed run needs its own lab. The tree, the
  // hire and every check below are identical across both.
  const probe = await openLab(base);
  const assignees = CONTROL === "repointed-map" ? repoint(probe) : probe.assignees;
  await probe.dispose();

  const lab = await openLab({ ...base, stores: inMemoryStores(), assignees });
  let evidence = "";

  try {
    // ---- 0. the tree names a board and never an id -------------------------
    for (const path of treeFiles(LAB_DIR)) {
      if (readFileSync(path, "utf8").includes(lab.boardId)) {
        note(`${path} writes the minted ledger id "${lab.boardId}"; a file declares a NAME`);
      }
    }

    // The oracle, read out of the tree at run time: what each seat's OWN FILE
    // says it answers for. Never the host's map, which is under test.
    const declaredDesk = Object.fromEntries(
      lab.roster.workers
        .filter((worker) => worker.declared.answersFor !== undefined)
        .map((worker) => [worker.id, String(worker.declared.answersFor)]),
    );
    if (Object.keys(declaredDesk).length !== 3) {
      return {
        failures: [`the tree names ${Object.keys(declaredDesk).length} desks, not 3`],
        evidence: "",
      };
    }
    const declaredDesks = new Set(Object.values(declaredDesk));

    // ---- a. the rows are filed -------------------------------------------
    // On the gate's path the coordinator decides and files through the eight
    // tools its kind composes. On the scripted path the same four pieces are
    // filed through the channel's own door, spread 2/1/1 across the desks the
    // TREE declares — so the queue below still has more rows than seats, and
    // every later leg grades exactly what it grades on the gate's path.
    if (FILER === "model") {
      const filed = await lab.intakeWork(WORK);
      if (filed.error !== undefined) note(`the coordinator could not file: ${filed.error}`);
    } else {
      const desks = [...declaredDesks];
      const spread = [desks[0], desks[0], desks[1], desks[2]];
      for (const [index, piece] of WORK.entries()) {
        const result = await lab.fileThroughChannel({
          board: lab.boardName,
          goal: piece,
          assignee: spread[index],
        });
        if (result.error !== undefined) note(`could not file ${JSON.stringify(piece)}: ${result.error}`);
      }
    }

    const rowsAfterFiling = await lab.rows();
    if (rowsAfterFiling.length !== WORK.length) {
      note(
        `the coordinator filed ${rowsAfterFiling.length} rows for ${WORK.length} pieces of work: ` +
          rowsAfterFiling.map((row) => JSON.stringify(row.goal)).join(", "),
      );
    }

    // ---- b. every piece reached the board, in its own words ----------------
    // Graded against the INPUT, so a run that filed four rows about something
    // else fails here rather than passing on a count.
    for (const piece of WORK) {
      if (!rowsAfterFiling.some((row) => row.goal.includes(piece))) {
        note(`no row carries the work ${JSON.stringify(piece)}`);
      }
    }

    // Every row must name a desk the tree declared. A row for a desk nobody
    // answers for is a filing mistake, not a routing one, and saying so here
    // keeps leg (c) about routing.
    const misfiled = rowsAfterFiling.filter(
      (row) => row.assignee === undefined || !declaredDesks.has(row.assignee),
    );
    if (misfiled.length > 0) {
      note(
        `${misfiled.length} row(s) name no declared desk: ` +
          misfiled.map((row) => `${row.id} -> ${row.assignee ?? "(none)"}`).join(", "),
      );
    }
    // More rows than desks is the case the queue exists for. If the model
    // spread four pieces over four desks there would be no waiting row, and
    // leg (e) would grade nothing.
    const perDesk = new Map<string, number>();
    for (const row of rowsAfterFiling) {
      perDesk.set(String(row.assignee), (perDesk.get(String(row.assignee)) ?? 0) + 1);
    }
    const doubled = [...perDesk.entries()].filter(([, count]) => count > 1);
    if (doubled.length === 0) {
      note(
        `no desk was given two pieces, so nothing ever waited for a seat. The queue's whole ` +
          `claim is about the row that could not start immediately`,
      );
    }

    // ---- c, d, e. the rows run where the tree says, each in its own session --
    const drained = await lab.drainAll();
    for (const result of drained) {
      if (result.error !== undefined) note(`${result.seat} could not drain: ${result.error}`);
    }

    // Proof of execution is a FILE, not the board's own report — the board
    // would say "completed" on the same path being tested.
    const lines = lab.workLines();
    const finalRows = await lab.rows();
    const rowById = new Map(finalRows.map((row) => [row.id, row]));

    if (lines.length !== rowsAfterFiling.length) {
      note(`${lines.length} of ${rowsAfterFiling.length} rows actually ran`);
    }

    for (const line of lines) {
      const row = rowById.get(line.taskId);
      if (row === undefined) {
        note(`a row ran that is not on the ledger: ${line.taskId}`);
        continue;
      }
      // THE LEG. The row says which desk it was for; the seat that ran it says
      // which desk its own file answers for. Two sources, and they must agree.
      const oracle = declaredDesk[line.seat];
      if (row.assignee !== oracle) {
        note(
          `row ${row.id} was filed for "${row.assignee}" and ran on ${line.seat}, whose own ` +
            `file answers for "${oracle}"`,
        );
      }
      if (line.declaredAssignee !== oracle) {
        note(
          `${line.seat} reported answering for "${line.declaredAssignee}" from inside its run, ` +
            `but its file says "${oracle}"`,
        );
      }

      // ---- d. its own session, parented, carrying no transcript ------------
      const session = await lab.session(line.session);
      if (session === undefined) {
        note(`row ${row.id} left no session record for ${line.session}`);
        continue;
      }
      const parent = session.parentSessionId;
      if (parent === undefined) {
        note(`row ${row.id} ran in a session with no parent; a dispatch always binds one`);
      } else if (parent !== lab.drainSession(line.seat)) {
        note(
          `row ${row.id} ran in a session parented to ${String(parent)}, not to the session ` +
            `that dispatched it (${lab.drainSession(line.seat)})`,
        );
      }
      // Nothing of the coordinator's travels with the row. The brief IS the
      // row; there is no ambient dump.
      const carried = JSON.stringify(session.state ?? {});
      if (carried.includes("desk-") || carried.length > 2) {
        note(`row ${row.id}'s child session carries state it was not handed: ${carried}`);
      }
    }

    // ---- e. the extra row waited, and was not re-routed --------------------
    // Every row that shares a desk ran on the SAME seat: nothing was handed to
    // a free seat to make it finish sooner.
    for (const [desk, count] of doubled) {
      const ran = lines.filter((line) => rowById.get(line.taskId)?.assignee === desk);
      const seatsUsed = new Set(ran.map((line) => line.seat));
      if (ran.length !== count) {
        note(`${ran.length} of ${count} rows for "${desk}" ran; a waiting row must not be dropped`);
      }
      if (seatsUsed.size > 1) {
        note(`rows for "${desk}" ran on ${[...seatsUsed].join(" and ")}; a waiting row was re-routed`);
      }
    }

    // Every row settled, and none of them errored.
    const unsettled = finalRows.filter((row) => row.status !== "completed");
    if (unsettled.length > 0) {
      note(
        `${unsettled.length} row(s) did not complete: ` +
          unsettled.map((row) => `${row.id} (${row.status})`).join(", "),
      );
    }

    // ---- f. a row for nobody is refused by name ----------------------------
    // Filed with no assignee and no retry budget: the lab declares no default
    // worker, so this is admitted at a drain, missed by the router, and refused
    // naming the row. Loud rather than quiet — a row nobody can claim would
    // simply sit there.
    const orphan = await lab.fileThroughChannel({
      board: lab.boardName,
      goal: "a piece of work for nobody in particular",
      maxAttempts: 1,
    });
    const orphanId = (orphan.output as { taskId?: string } | undefined)?.taskId ?? "";
    await lab.drainAll();
    const settledOrphan = (await lab.rows()).find((row) => row.id === orphanId);
    if (settledOrphan === undefined) {
      note(`the unassigned row vanished from the ledger`);
    } else if (settledOrphan.status !== "errored") {
      note(
        `the unassigned row is "${settledOrphan.status}", not errored. With no default worker a ` +
          `row for nobody must be refused where it would have run, not left waiting`,
      );
    } else if (!String(settledOrphan.error ?? "").includes(orphanId)) {
      note(
        `the refusal did not name the row: ${JSON.stringify(settledOrphan.error)}`,
      );
    }
    if (lab.workLines().some((line) => line.taskId === orphanId)) {
      note(`the unassigned row ran anyway; no seat should have a body for it`);
    }

    const placement = lines
      .map((line) => `${rowById.get(line.taskId)?.assignee} -> ${line.seat}`)
      .sort()
      .join(", ");

    const filedBy =
      FILER === "model"
        ? `The coordinator seat — whose own file says \`tools: []\` — decided who got what and ` +
          `filed ${rowsAfterFiling.length} rows for ${WORK.length} pieces of work through the ` +
          `eight task tools its kind composes, naming a desk on each.`
        : `**NOT THE EXIT GATE — GOAL_FILER=scripted.** No model ran and no task tool was ` +
          `called: the ${rowsAfterFiling.length} rows were filed through the channel's own ` +
          `\`fileTask\` door, spread across the desks the tree declares. What follows is the ` +
          `ROUTING half of ER-20 and says nothing about a coordinator choosing, or about the ` +
          `capability door FIX-1385 ships for models.`;

    evidence =
      `one tree at ${LAB_TREE}${FILER === "model" ? `, on ${model}` : ""}: the channel ` +
      `"${lab.channelId}" declares board "${lab.boardName}" and the framework minted ` +
      `"${lab.boardId}", which appears in no file. ${filedBy} ` +
      `${doubled.map(([desk, n]) => `"${desk}" got ${n}`).join(", ")}, so ` +
      `one row could not start until a seat freed. Every row ran on the seat whose OWN FILE ` +
      `answers for its desk (${placement}) — proved by ${outbox}, a real side effect the board ` +
      `could not have produced by reporting — each in its own child session bound to the session ` +
      `that dispatched it and carrying none of the coordinator's transcript. The waiting row was ` +
      `neither re-routed nor dropped. A row filed for nobody settled errored, named, and ran ` +
      `nowhere. The seat -> desk map is the host's and the expected association is the tree's, so ` +
      `the two can disagree — which is what GOAL_CONTROL=repointed-map makes them do.`;
  } finally {
    await lab.dispose();
  }

  return { failures, evidence };
});
