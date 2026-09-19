/**
 * Contract gate — model-free. The team, its board, the door the board arrives
 * through, and the queue as a read.
 *
 * **Model-free on purpose.** Nothing here is a judgment call: a roster hires or
 * refuses, a kind holds a tool or does not, a column groups a row or does not,
 * a ledger is byte-identical across a read or is not. A model in the loop would
 * add a way to fail that has nothing to do with the claim. The one thing that
 * genuinely needs judgment — a coordinator deciding who gets what — is the
 * sibling goal's, and it is the only place a model appears in this lab.
 *
 * Legs:
 *   0  the tree declares a board by NAME and the minted id appears in no file
 *   a  the tree alone produces four seats, one channel and one ledger (BR-1)
 *   b  a seat folder that declares the board refuses the whole roster (BR-3)
 *   c  the eight arrive by composition, and the fence never touches them (BR-2)
 *   d  the channel's author check, both arms (BR-8)
 *   e  the queue is a read, and every row lands in exactly one column (BR-10–12)
 *   f  an unclaimed settle is allowed, and a lapsed one is not (BR-9, BR-11)
 *   g  the task status set has exactly the members it had (BR-13)
 *   h  this issue's diff stays inside `goals/manager-queue-lab/` (BR-14, BR-15)
 *   i  the drain-width switch RUNS WORK at either value (BR-17)
 *
 * Run: pnpm tsx goals/manager-queue-lab/it-stands-the-team-and-its-board-up-from-files/run.mts
 * Controls: GOAL_CONTROL=catalog-door · GOAL_CONTROL=repointed-map
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryStores } from "@flow-state-dev/engine";
import { taskStatusSchema } from "@flow-state-dev/orchestration/tasks";
import { goalTmpDir, runGoal } from "../../lib/index.mts";
import { diffReport, FROZEN_SUBTREE, LAB_ROOT } from "../lab/diff-check.mts";
import { openLab, LAB_TREE, messageOf, type Lab } from "../lab/host.mts";
import { QUEUE_COLUMNS, queueView } from "../lab/queue.mts";

/** The lab's own root, so leg 0 can read every file the lab ships. */
const LAB_DIR = fileURLToPath(new URL("../lab", import.meta.url));

/** Where the refusal trees live. Found by walking, never named file by file. */
const REFUSAL_TREES = join(LAB_DIR, "refusal-trees");

/**
 * The task status set as FIX-443 §2 fixed it, written out.
 *
 * Asserted on the enum itself rather than on a reading of it: BR-13's claim is
 * that this issue adds no member, and a check that derived the expected set
 * from the enum would agree with whatever the enum said.
 */
const STATUS_SET = [
  "pending",
  "in_progress",
  "blocked",
  "parked",
  "completed",
  "errored",
  "cancelled",
];

/**
 * Controls perturb the WIRING, never the tree — leg 0 reads the tree, so a tree
 * edit would die there and prove only that leg 0 works.
 *
 *   catalog-door  the eight tools are registered in the lab's own catalog and
 *                 reached by name, instead of arriving as capability controls.
 *                 Everything still compiles and the roster still hires; only
 *                 the door moves. Must fail at leg (c), which is what makes
 *                 that leg a test of the door rather than of tool count.
 *
 *   repointed-map two builders' desks are SWAPPED in the host's map. The tree
 *                 is untouched, every id is well-formed, the roster hires and
 *                 rows run — a recovered row just runs on a seat whose own file
 *                 answers for another desk. Must fail at leg (f), which is the
 *                 only leg here that grades routing identity. A swap and not a
 *                 one-sided re-point, so exactly one seat stays eligible per
 *                 desk and which seat takes a row is not a CAS race.
 *
 * Each control also grades ITSELF at the end: a run that goes red somewhere
 * other than the leg it names has demonstrated a different check, and says so.
 */
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** Silence the engine's own logging; a gate's output is its verdict. */
const silent = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Every file under a directory, so a leg can search all of them. */
function treeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? treeFiles(path) : [path];
  });
}

/** The tool names a built generator resolves, sorted. Instances are per-resolver, so compare names. */
async function toolNames(
  block: unknown,
  flowConfig: Record<string, unknown>,
): Promise<string[]> {
  const resolver = (block as { config?: { tools?: unknown } }).config?.tools;
  if (resolver === undefined) return [];
  const ctx = { flow: { config: flowConfig }, resources: {} } as never;
  const list =
    typeof resolver === "function"
      ? await (resolver as (input: unknown, ctx: unknown) => Promise<unknown[]>)(undefined, ctx)
      : (resolver as unknown[]);
  return list.map((tool) => String((tool as { name?: unknown }).name)).sort();
}

/** A fresh outbox per width, so one width's lines cannot be read as another's. */
function widthOutbox(scratch: string, width: number): string {
  const path = join(scratch, `width-${width}.ndjson`);
  writeFileSync(path, "", "utf8");
  return path;
}

/** Open a lab, run a body, and always dispose. */
async function withLab<T>(
  options: Parameters<typeof openLab>[0],
  body: (lab: Lab) => Promise<T>,
): Promise<T> {
  const lab = await openLab(options);
  try {
    return await body(lab);
  } finally {
    await lab.dispose();
  }
}

await runGoal(async () => {
  const failures: string[] = [];
  const note = (line: string): void => {
    failures.push(line);
  };
  const scratch = goalTmpDir("manager-queue-contract");
  const outbox = join(scratch, "work.ndjson");
  writeFileSync(outbox, "", "utf8");

  const base = {
    stores: inMemoryStores(),
    outbox,
    logger: silent,
    ...(CONTROL === "catalog-door" ? { door: "catalog" as const } : {}),
  };

  // `repointed-map` needs the hired map before it can perturb it, and the map
  // is fixed when the kinds are built — so the perturbed run gets its own lab.
  // Same swap as the sibling check's: exactly one seat eligible per desk, so
  // which seat takes a row is not a race.
  let assignees: Record<string, string> | undefined;
  if (CONTROL === "repointed-map") {
    const probe = await openLab(base);
    const [first, second] = probe.builderIds;
    assignees = {
      ...probe.assignees,
      [first]: String(probe.assignees[second]),
      [second]: String(probe.assignees[first]),
    };
    await probe.dispose();
  }

  const lab = await openLab(
    assignees === undefined ? base : { ...base, stores: inMemoryStores(), assignees },
  );
  let evidence = "";

  try {
    // ---- a. the tree alone produces the roster, the channel and the ledger --
    const seatIds = Object.keys(lab.seats).sort();
    if (seatIds.length !== 4) {
      note(`the tree hired ${seatIds.length} seats, not 4: ${seatIds.join(", ")}`);
    }
    if (lab.builderIds.length !== 3) {
      note(`expected 3 builder seats, found ${lab.builderIds.length}`);
    }
    // `openLab` now refuses a tree with no coordinator outright, so the empty
    // case cannot reach here. What is still worth asserting is that the two
    // kinds PARTITION the roster: a seat counted as both would make the four
    // above add up while leaving a desk unanswered.
    if (lab.builderIds.includes(lab.coordinatorId)) {
      note(`${lab.coordinatorId} was hired onto both kinds; the roster does not partition`);
    }
    if (lab.roster.channels.length !== 1) {
      note(`the tree declared ${lab.roster.channels.length} channels, not 1`);
    }
    // The ledger's identity is MINTED, and org-scoped by construction.
    if (lab.boardId !== `${lab.channelId}.${lab.boardName}`) {
      note(`the ledger id "${lab.boardId}" is not minted from the channel and the board's name`);
    }

    // ---- 0. the tree names a board and never an id -------------------------
    // Run over the whole lab, not just the tree: a minted id written into the
    // lab's own code would make legs (d)-(f) pass for a seat that agreed with a
    // string somebody typed.
    for (const path of treeFiles(LAB_DIR)) {
      if (readFileSync(path, "utf8").includes(lab.boardId)) {
        note(`${path} writes the minted ledger id "${lab.boardId}"; a file declares a NAME`);
      }
    }

    // ---- c. the eight arrive by composition (BR-2) -------------------------
    // Three arms, read off BUILT kinds rather than off a run: the real
    // coordinator with the `tools:` ITS OWN FILE declares, the same kind with a
    // catalog tool named, and a twin that composes nothing.
    //
    // WHAT THIS LEG DOES NOT GRADE, stated here and in the evidence line rather
    // than left for a reader to discover: the block is the one `openLab` built,
    // so the composition is the shipped one — but the tools RESOLVER is invoked
    // directly, with a context this check assembles. It is not a live
    // generation, so it says nothing about how the tools reach a model mid-run.
    // The narrow claim is the one worth having: a seat's `tools:` can neither
    // grant nor fence a capability control.
    const coordinatorDeclared = lab.roster.workers.find(
      (worker) => worker.id === lab.coordinatorId,
    )?.declared;
    const declaredTools = (coordinatorDeclared?.tools as string[] | undefined) ?? undefined;
    if (declaredTools === undefined || declaredTools.length !== 0) {
      note(
        `the coordinator's file was expected to declare \`tools: []\` — the arm this leg grades ` +
          `— and declares ${JSON.stringify(declaredTools)}`,
      );
    }
    // Fed the value read OFF THE TREE, not a literal typed here: otherwise the
    // arm grades a string this check chose and the file's own line never enters.
    const withNothing = await toolNames(lab.intake, { tools: declaredTools ?? [] });
    const withNote = await toolNames(lab.intake, { tools: ["note"] });
    const eight = withNothing.filter((name) => name !== "note");

    if (eight.length !== 8) {
      note(
        `the coordinator whose file says \`tools: []\` holds ${eight.length} board tools, not 8: ` +
          `${withNothing.join(", ") || "(none)"}`,
      );
    }
    if (withNothing.includes("note")) {
      note(`\`tools: []\` did not take the catalog tool away; the fence is not biting`);
    }
    if (!withNote.includes("note")) {
      note(`\`tools: ["note"]\` did not reach the catalog tool at all`);
    }
    if (withNote.filter((name) => name !== "note").join(",") !== eight.join(",")) {
      note(
        `the eight board tools changed when the seat's \`tools:\` changed. They are capability ` +
          `controls; no \`tools:\` list may add or remove one`,
      );
    }

    const twin = await withLab({ ...base, composeBoard: false }, async (other) =>
      toolNames(other.intake, { tools: [] }),
    );
    if (twin.length !== 0) {
      note(`the twin kind composes nothing and still holds ${twin.join(", ")}`);
    }

    // ---- b. a seat folder that declares the board refuses the roster (BR-3) --
    const refusalTrees = readdirSync(REFUSAL_TREES).sort();
    const offending = refusalTrees.find((name) => !name.endsWith("-corrected"));
    const corrected = refusalTrees.find((name) => name.endsWith("-corrected"));
    if (offending === undefined || corrected === undefined) {
      note(`expected one refusal tree and its corrected pair, found: ${refusalTrees.join(", ")}`);
    } else {
      let refusal = "";
      try {
        await withLab({ ...base, root: join(REFUSAL_TREES, offending) }, async () => undefined);
      } catch (error) {
        refusal = messageOf(error);
      }
      // Asserted on the BLOCK NAMED, never on the message's wording: the
      // refusal's words are the framework's to change, the block's name is the
      // tree's own fact.
      if (!refusal.includes("desk-board")) {
        note(
          refusal === ""
            ? `the tree at "${offending}" hired cleanly; a seat folder declaring the board must ` +
              `refuse the whole roster`
            : `the refusal did not name the block "desk-board": ${refusal}`,
        );
      }
      try {
        await withLab({ ...base, root: join(REFUSAL_TREES, corrected) }, async () => undefined);
      } catch (error) {
        note(`the corrected tree "${corrected}" did not hire cleanly: ${messageOf(error)}`);
      }
    }

    // ---- d. the channel's author check, both arms (BR-8) -------------------
    // Both arms, or the rule reads as a gate the code does not have: `author`
    // is optional, caller-supplied and stored `authorVerified: false`, so a
    // filing that names NO label is not checked at all.
    const refusedAuthor = await lab.fileThroughChannel({
      board: lab.boardName,
      goal: "filed by somebody the roster never heard of",
      assignee: lab.desks[0],
      author: "eng.nobody",
    });
    if (refusedAuthor.error === undefined) {
      note(`a filing naming a non-member landed; it must be refused at the channel`);
    } else if (!refusedAuthor.error.includes("is not a member of channel")) {
      note(`the refusal was not the channel's own author-not-a-member wording: ${refusedAuthor.error}`);
    }

    const noAuthor = await lab.fileThroughChannel({
      board: lab.boardName,
      goal: "filed with no author at all",
      assignee: lab.desks[0],
    });
    if (noAuthor.error !== undefined) {
      note(
        `a filing that names no author was refused: ${noAuthor.error}. Filing is not ` +
          `members-only, and the roster check runs only on a label that is there`,
      );
    }

    // ---- a (control). an unregistered kind refuses the WHOLE roster (V1) ----
    // Nothing is returned partially, so a refusal cannot leave a short roster
    // running — which is the failure a lab that boots three seats out of four
    // would prove nothing about.
    let kindRefusal = "";
    try {
      await withLab(
        { ...base, kindOverrides: { [lab.builderIds[0]]: "not-a-registered-kind" } },
        async () => undefined,
      );
    } catch (error) {
      kindRefusal = messageOf(error);
    }
    if (!kindRefusal.includes(lab.builderIds[0])) {
      note(
        kindRefusal === ""
          ? `a seat naming an unregistered kind hired anyway`
          : `the refusal did not name the seat "${lab.builderIds[0]}": ${kindRefusal}`,
      );
    }

    // ---- e. the queue is a READ (BR-10, BR-11, BR-12) ----------------------
    // Stage the three states a column exists for, on the real path.
    const blockedRow = await lab.fileThroughChannel({
      board: lab.boardName,
      goal: "needs a decision from a person",
      assignee: lab.desks[1],
    });
    const blockedId = (blockedRow.output as { taskId?: string } | undefined)?.taskId ?? "";
    // A second row for the same desk, so the unclaimed-settle leg below has a
    // live claim to settle after the one above has been blocked out of reach.
    await lab.fileThroughChannel({
      board: lab.boardName,
      goal: "a second piece for the same desk",
      assignee: lab.desks[1],
    });
    const blockedReason = "waiting on the customer to confirm the date";
    const blocked = await lab.blockRow(blockedId, blockedReason);
    if (!blocked.blocked) note(`could not block a row: ${blocked.refusal ?? "(no reason)"}`);

    // A real claim on the minimum lease, left unrenewed. Not a staged row: a
    // row written into the store would prove the view agrees with what this
    // check wrote.
    const held = await lab.hold(lab.builderIds[0]);
    if (held.taskId === null) note(`no row was available for ${lab.builderIds[0]} to hold`);

    // While the lease is live: the row runs, and the seat is busy.
    const busyRows = await lab.rows();
    const busyView = queueView(busyRows, lab.hiredSeats(), Date.now());
    if (!busyView.running.some((row) => row.id === held.taskId)) {
      note(`a row under a live claim did not read as running`);
    }
    if (busyView.seats.find((seat) => seat.seat === lab.builderIds[0])?.idle !== false) {
      note(`the seat holding a live claim read as idle`);
    }

    // BR-10: a READ writes nothing. Compare the ledger either side of one.
    const before = JSON.stringify(await lab.rows());
    await lab.queue();
    const after = JSON.stringify(await lab.rows());
    if (before !== after) note(`reading the queue changed the ledger; a column is a view`);

    // Every row in exactly one column, and the waiting column carrying the
    // reason the row already had.
    const view = await lab.queue();
    if (view.uncolumned.length > 0) {
      note(
        `${view.uncolumned.length} row(s) landed in no column: ` +
          view.uncolumned.map((row) => `${row.id} (${row.status})`).join(", "),
      );
    }
    const counted = QUEUE_COLUMNS.flatMap((column) => view[column].map((row) => row.id));
    const duplicated = counted.filter((id, index) => counted.indexOf(id) !== index);
    if (duplicated.length > 0) note(`row(s) in more than one column: ${duplicated.join(", ")}`);
    const rowCount = (await lab.rows()).length;
    if (counted.length !== rowCount) {
      note(`the columns hold ${counted.length} rows, the ledger holds ${rowCount}`);
    }
    const waiting = view.waitingOnYou.find((row) => row.id === blockedId);
    if (waiting === undefined) note(`the blocked row is not under "waiting on you"`);
    else if (waiting.reason !== blockedReason) {
      note(`the waiting row's reason is ${JSON.stringify(waiting.reason)}, not the row's own`);
    }

    // BR-11 and BR-10's lapsed-lease arm. The lease is the substrate's minimum,
    // so the wait is short and real rather than a sleep standing in for one.
    await new Promise((resolve) => setTimeout(resolve, held.leaseMs + 250));
    const lapsedRows = await lab.rows();
    const lapsedView = queueView(lapsedRows, lab.hiredSeats(), Date.now());
    if (held.taskId !== null && !lapsedView.queued.some((row) => row.id === held.taskId)) {
      note(`a row whose lease lapsed did not read as queued; nobody is on it`);
    }
    if (lapsedView.running.some((row) => row.id === held.taskId)) {
      note(`a row whose lease lapsed still read as running`);
    }
    if (lapsedView.seats.find((seat) => seat.seat === lab.builderIds[0])?.idle !== true) {
      note(`the seat whose claim lapsed did not read as idle`);
    }

    // ---- f. the lapsed row really is back in the queue (BR-11) -------------
    // The strong form of the claim, and the one the column asserts: not that
    // the old holder is stopped, but that the NEXT DRAIN takes the row and runs
    // it. Reading it as queued is a column; running it is the fact behind the
    // column.
    //
    // (The spec's BR-11 cites `StaleTaskClaimError` as refusing an adoption
    // here. It does not — `adoptLapsedLease` in
    // `packages/orchestration/src/task-board/task-entry.ts` renews the lease so
    // a successor CAN take the row back, and `StaleTaskClaimError` fires only
    // when a reclaim genuinely won or the committed span cannot be read. The
    // lab grades the recovery, which is what actually happens and is the
    // stronger claim.)
    // The desk the row was FILED for, read off the ledger before the drain.
    // This is the independent side of the comparison below and the reason the
    // leg can fail at all: it is what the filer wrote, not what the host's map
    // says. Comparing the seat's own file against `lab.assignees[seat]` would
    // put the tree on BOTH sides — the map is derived from `answersFor` — and
    // the leg would be green however badly the row was routed. That is exactly
    // the failure mode this lab's own README names, and it was in here.
    const heldAssignee = (await lab.rows()).find((row) => row.id === held.taskId)?.assignee;

    const beforeRecovery = lab.workLines().length;
    await lab.drainAll();
    const recovered = lab
      .workLines()
      .slice(beforeRecovery)
      .find((line) => line.taskId === held.taskId);
    if (recovered === undefined) {
      note(`the row whose lease lapsed was never taken back by a drain; it is not really queued`);
    } else if (heldAssignee === undefined) {
      note(`the row that lapsed names no desk, so where it ran cannot be graded`);
    } else if (recovered.declaredAssignee !== heldAssignee) {
      note(
        `the recovered row was filed for "${heldAssignee}" and ran on ${recovered.seat}, ` +
          `whose own file answers for "${recovered.declaredAssignee}"`,
      );
    }

    // The coordinator settling a row it never claimed IS allowed. Recorded as
    // observed behaviour, not defended as a design.
    //
    // A row is filed for this leg rather than reused from above: the recovery
    // drain settles everything it can reach, and a leg that quietly found
    // nothing to settle would report nothing while reading as green.
    await lab.fileThroughChannel({
      board: lab.boardName,
      goal: "a row for somebody else to hold",
      assignee: lab.desks[2],
    });
    const freshHold = await lab.hold(lab.builderIds[2]);
    let unclaimedSettle: string;
    if (freshHold.taskId === null) {
      unclaimedSettle = "(not graded)";
      note(`no row was left for ${lab.builderIds[2]} to hold, so the unclaimed settle graded nothing`);
    } else {
      const settled = await lab.coordinatorSettle(freshHold.taskId);
      unclaimedSettle = settled.settled ? "allowed" : `refused: ${settled.refusal}`;
      if (!settled.settled) {
        note(
          `the coordinator could not settle a row it never claimed (${settled.refusal}). The ` +
            `task tools leave that unguarded today; this rule records the behaviour rather ` +
            `than asserting a guard`,
        );
      }
    }

    // ---- g. the task status set (BR-13) ------------------------------------
    const statuses = [...taskStatusSchema.options];
    if (JSON.stringify(statuses) !== JSON.stringify(STATUS_SET)) {
      note(
        `the task status set is ${JSON.stringify(statuses)}, not ${JSON.stringify(STATUS_SET)}. ` +
          `A queue column groups rows that already exist; it adds no status`,
      );
    }

    // ---- h. the diff stays inside the lab (BR-14, BR-15) -------------------
    let diff = "(not run)";
    try {
      const report = diffReport();
      diff = `${report.changed.length} path(s) against ${report.base.slice(0, 9)}`;
      if (report.outside.length > 0) {
        note(`this issue's diff reaches outside ${LAB_ROOT}: ${report.outside.join(", ")}`);
      }
      if (report.frozen.length > 0) {
        note(`this issue's diff touches ${FROZEN_SUBTREE}: ${report.frozen.join(", ")}`);
      }
      if (report.changed.length === 0) {
        note(`the diff gate found no changed paths at all; it graded nothing`);
      }
    } catch (error) {
      note(`the diff gate could not run: ${messageOf(error)}`);
    }

    // ---- i. the drain-width switch (BR-17) ---------------------------------
    // The epic ruled width 1. The knob stays so the other case remains
    // REACHABLE, and that is the claim this leg has to earn: not that a lab
    // boots at 2, but that it runs work at 2.
    //
    // The leg used to open a lab at each width and read `drainWidth` back off
    // it — the same number it had just handed in. Concurrency wiring that was
    // ignored outright would have left that green. So each width now files two
    // rows for one desk, drains, and requires both to run and settle.
    const widths: string[] = [];
    for (const width of [1, 2]) {
      try {
        const ran = await withLab(
          { ...base, stores: inMemoryStores(), outbox: widthOutbox(scratch, width), drainWidth: width },
          async (other) => {
            if (other.drainWidth !== width) {
              note(`the lab booted at drain width ${other.drainWidth}, not ${width}`);
            }
            for (const goal of [`first piece at width ${width}`, `second piece at width ${width}`]) {
              await other.fileThroughChannel({
                board: other.boardName,
                goal,
                assignee: other.desks[0],
              });
            }
            await other.drainAll();
            const rows = await other.rows();
            return {
              lines: other.workLines().length,
              settled: rows.filter((row) => row.status === "completed").length,
              total: rows.length,
            };
          },
        );
        widths.push(`${width} (${ran.lines} rows ran)`);
        if (ran.lines !== 2 || ran.settled !== ran.total) {
          note(
            `at drain width ${width}, ${ran.lines} of 2 rows ran and ${ran.settled} of ` +
              `${ran.total} settled; the switch is not operable at that width`,
          );
        }
      } catch (error) {
        note(`the lab did not run work at drain width ${width}: ${messageOf(error)}`);
      }
    }

    // ---- the controls grade THEMSELVES -------------------------------------
    // A control certifies "this check fails when this thing breaks", so it has
    // to go red at the leg it names and at no other. Exiting non-zero from
    // somewhere else demonstrates a different check.
    if (CONTROL !== "") {
      const expected: Record<string, { leg: string; mark: string }> = {
        "catalog-door": { leg: "(c)", mark: "board tools, not 8" },
        "repointed-map": { leg: "(f)", mark: "whose own file answers for" },
      };
      const want = expected[CONTROL];
      if (want === undefined) {
        note(`unknown control ${JSON.stringify(CONTROL)}`);
      } else if (failures.length === 0) {
        note(
          `the ${CONTROL} control did not go red at all; leg ${want.leg} does not grade what it ` +
            `claims to`,
        );
      } else {
        const offLeg = failures.filter((line) => !line.includes(want.mark));
        if (offLeg.length > 0) {
          note(
            `the ${CONTROL} control went red away from leg ${want.leg}, so it certifies a ` +
              `different check than the one it names: ${offLeg.join(" | ")}`,
          );
        }
      }
    }

    evidence =
      `one tree at ${LAB_TREE}: four seats (${seatIds.join(", ")}) on the two kinds their own ` +
      `files name, one channel "${lab.channelId}" declaring board "${lab.boardName}", and the ` +
      `framework minted "${lab.boardId}" — a string that appears in no file under the lab. The ` +
      `coordinator's file says \`tools: []\` and it holds all eight board tools anyway ` +
      `(${eight.join(", ")}); with \`tools: ["note"]\` it holds those eight plus the catalog ` +
      `tool, and a twin kind composing nothing holds none — read off the kinds \`openLab\` ` +
      `built, by invoking the tools resolver DIRECTLY with a context this check assembles and ` +
      `the seat's own declared \`tools:\`, so the composition is the shipped one and the ` +
      `resolution is not a live generation. A seat folder declaring the board ` +
      `refuses the whole roster by naming "desk-board", and the corrected tree hires. The ` +
      `channel refused a filing naming a non-member and accepted the same call with no author. ` +
      `Reading the queue left the ledger byte-identical; a blocked row carried its own reason ` +
      `into "waiting on you"; a real claim on the ${held.leaseMs}ms minimum lease read running ` +
      `with its seat busy, and once it lapsed read queued with its seat idle and was then taken ` +
      `back and run by the next drain — on the seat whose own file answers for the desk the ` +
      `row was FILED for, which is a fact of the ledger and not of the host's map. An ` +
      `unclaimed settle by ` +
      `the coordinator: ${unclaimedSettle}. The status set is ` +
      `unchanged at ${statuses.length} members. The diff gate ran over ${diff}, all inside ` +
      `${LAB_ROOT}. The drain-width switch RAN WORK at ${widths.join(" and ")}; the epic ` +
      `ruled width 1, and the knob keeps the other case reachable.`;
  } finally {
    await lab.dispose();
  }

  return { failures, evidence };
});
