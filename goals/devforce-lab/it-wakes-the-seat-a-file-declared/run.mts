/**
 * Goal check — a filed board row wakes the seat a Markdown file declared, into
 * a supervised coding run.
 *
 * **The contract gate.** Two halves of DevForce's central claim have each been
 * proved and have never met: the pentest lab shows that a post reaches seats
 * declared in Markdown, and `labs/conductor` shows that a board row becomes a
 * supervised coding run — but the thing that row reaches there is hand-written
 * TypeScript, not a seat that came out of a folder. This runs the join: one
 * tree of Markdown, pointed at once, ends with a row filed by one declared seat
 * having woken a *different* declared seat, in its own flow instance, into a run
 * whose prompt carries tokens that live only in that seat's own files — with a
 * third declared seat, on the same kind, never dispatched to.
 *
 * Model-free on purpose. A model improvising around a missing document still
 * produces a plausible commit, so a single model-backed run reports PASS on a
 * seat that read none of its own files. The gate therefore puts a scripted stub
 * in the harness slot and grades what the plumbing carried; the model-backed
 * sibling, `it-commits-from-the-seats-own-file`, drives the same tree, the same
 * hire and the same wiring with a real coding harness in that one slot.
 *
 * Legs, and the rules each one closes:
 *
 *   0  the tree's held-out tokens live where the fixture says, and nowhere else
 *   a  BR-1 BR-2      — the tree alone produces the roster; a bad tree refuses whole
 *   b  BR-3 BR-4      — each seat's own view of itself; the EM kind has no task entry
 *   c  BR-5 BR-6 BR-8 BR-9 — one row, claimed once, to the seat the board named
 *   d  BR-10 BR-11 BR-13   — the prompt, the checkout, and the settled row
 *   e  BR-7           — a hand-off to an instance nobody minted
 *   f  BR-12 BR-14    — the done-condition is the authority, and the budget is spent
 *   g  BR-16 BR-17    — an unwalked folder loads as nothing; an org-less read is refused
 *
 * Every control is env-gated on the same command (`GOAL_CONTROL=…`) and listed
 * by `GOAL_CONTROL=list`. See goal.md for the contract and the anti-game.
 *
 * Run: pnpm tsx goals/devforce-lab/it-wakes-the-seat-a-file-declared/run.mts
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { inMemoryStores } from "@flow-state-dev/engine";
import { checkoutPathFor } from "@flow-state-dev/harness-manager/checkout";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import {
  LAB_ORG_ID,
  LAB_TREE,
  LAB_USER_ID,
  openLab,
  readLabTree,
  type Lab,
  type OpenLabOptions,
  type SeatSkill,
} from "../lab/host.mts";
import { harnessStub, type HarnessStubOptions, type StubRun } from "../lab/harness-stub.mts";
import { BASE_REF, commitAll, createScratchRepo } from "../lab/scratch-repo.mts";
import { LEDGER_ID } from "../lab/board.mts";
import { PHASE } from "../lab/phase.mts";

stripIntentOverrides();

interface SeatFixture {
  kind: string;
  document: string;
  skills: string[];
  instructionsToken: string;
}

interface Fixture {
  row: { issue: string; phase: string; taskId: string; goal: string };
  assignedSeat: string;
  silentSeat: string;
  coordinatorSeat: string;
  unknownSeat: string;
  seats: Record<string, SeatFixture>;
  documents: string[];
  channels: string[];
  promptTokens: string[];
  tokenHomes: Record<string, string>;
  wait: { timeoutMs: number; pollMs: number };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const { wait } = fixture;

/** Which perturbation this run is exercising. Empty means the real gate. */
const CONTROL = process.env.GOAL_CONTROL ?? "";

const CONTROLS = [
  "address-the-reviewer",
  "no-commit",
  "swap-documents",
  "drop-own-skill",
  "stopped-at-limit",
] as const;

if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}

const LAB_ROOT = fileURLToPath(new URL("../lab", import.meta.url));

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sameSet = (seen: readonly string[], wanted: readonly string[]): boolean =>
  seen.length === wanted.length && [...seen].sort().join(",") === [...wanted].sort().join(",");

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

/**
 * A copy of the real tree with one file perturbed.
 *
 * **Derived from the real tree rather than committed as a twin pair.** A
 * committed twin has to be kept identical to the tree it stands against by
 * hand, and the failure mode when it drifts is a control that is green for the
 * wrong reason. Copying and editing one line makes the perturbation the only
 * difference by construction, and the line is visible right here.
 */
function perturbedTree(label: string, edit: (root: string) => void): string {
  const root = mkdtempSync(join(tmpdir(), `devforce-tree-${label}-`));
  cpSync(LAB_TREE, root, { recursive: true });
  edit(root);
  return root;
}

/** What the harness "did" in its checkout: write the brief's file and commit it. */
const commitWork: HarnessStubOptions["duringRun"] = (run: StubRun) => {
  writeFileSync(join(run.cwd, "GREETING.md"), "A greeting, as the brief asked.\n");
  commitAll(run.cwd, "add greeting module");
};

/** The stub options this run's control asks for. The real gate commits and finishes cleanly. */
function stubOptions(): HarnessStubOptions {
  switch (CONTROL) {
    // The run produced nothing. The done-condition is the authority on
    // completion, so the row must NOT settle — which is exactly leg (d)'s
    // claim, inverted.
    case "no-commit":
      return {};
    // A clean finish that reports it stopped at its limit, and still commits.
    // See goal.md → Findings: this control's red is a framework observation,
    // not a perturbation the lab detects.
    case "stopped-at-limit":
      return { duringRun: commitWork, outcome: "stopped-at-limit" };
    default:
      return { duringRun: commitWork };
  }
}

/** The host options this run's control asks for. Empty for the real gate. */
function controlOptions(): Partial<OpenLabOptions> {
  switch (CONTROL) {
    // The board's `coder` assignee addressed at the seat that is declared and
    // must never be reached. The row still runs; it runs on the wrong seat.
    case "address-the-reviewer":
      return { coderSeatId: fixture.silentSeat };
    // The working seat repointed at the coordinator's document. Its own brief's
    // token can then reach the prompt by no route at all.
    case "swap-documents":
      return {
        documentOverrides: {
          [fixture.assignedSeat]: fixture.seats[fixture.coordinatorSeat]!.document,
        },
      };
    // The working seat's OWN-folder skill removed, leaving the team's. Set
    // equality catches it; a check that only excluded siblings would not.
    case "drop-own-skill":
      return {
        mutateSkills: (seatId: string, skills: SeatSkill[]) =>
          seatId === fixture.assignedSeat
            ? skills.filter((skill) => skill.name !== "branch-naming")
            : skills,
      };
    default:
      return {};
  }
}

interface OpenedLab {
  lab: Lab;
  runs: StubRun[];
  workspace: { root: string; sourceRepo: string; baseRef: string };
}

/** Open a lab over throwaway stores and a throwaway git repository. */
async function open(label: string, over: Partial<OpenLabOptions> = {}): Promise<OpenedLab> {
  const dirs = createScratchRepo(label);
  const stub = harnessStub(stubOptions());
  const workspace = { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF };
  const lab = await openLab({
    stores: inMemoryStores(),
    harness: stub.slot,
    workspace,
    coderSeatId: fixture.assignedSeat,
    logger: silentLogger,
    ...controlOptions(),
    ...over,
  });
  return { lab, runs: stub.runs, workspace };
}

/** The row this check files, everywhere. */
const filing = { issue: fixture.row.issue, goal: fixture.row.goal, maxAttempts: 2 };

class UnsettledError extends Error {
  constructor(status: string | undefined, timeoutMs: number) {
    super(
      `the row never left \`in_progress\` inside ${timeoutMs}ms (last status: ${status ?? "absent"}). ` +
        `A timeout is a failure, not a result.`,
    );
    this.name = "UnsettledError";
  }
}

/**
 * Wait until the row stops being worked, and hand back what it settled as.
 *
 * `pending` counts as settled here, deliberately: a re-pended row is the state
 * BR-14 claims, and treating it as "still running" would spin until the bound
 * and then report a timeout for a result the check wanted.
 *
 * **It throws on the bound rather than returning what it last saw.** Returning
 * the last row would let a run whose child is still in flight be reported as a
 * settled one — the same defect this lab exists to prove against.
 */
async function settled(lab: Lab, timeoutMs = wait.timeoutMs): Promise<Task> {
  return await until(lab, (row) => row.status !== "in_progress", timeoutMs);
}

/**
 * Wait until the row reaches a state no further drain can move it out of.
 *
 * Separate from {@link settled} because a re-pended row is a legitimate result
 * for one leg and an unfinished one for another, and a single helper that
 * guessed which would make one of the two legs assert on a moment.
 */
async function terminal(lab: Lab, timeoutMs = wait.timeoutMs): Promise<Task> {
  return await until(
    lab,
    (row) => row.status === "completed" || row.status === "errored",
    timeoutMs,
  );
}

async function until(
  lab: Lab,
  reached: (row: Task) => boolean,
  timeoutMs: number,
): Promise<Task> {
  const deadline = Date.now() + timeoutMs;
  let row: Task | undefined;
  while (Date.now() < deadline) {
    row = await lab.row(fixture.row.taskId);
    if (row !== undefined && reached(row)) return row;
    await sleep(wait.pollMs);
  }
  throw new UnsettledError(row?.status, timeoutMs);
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const note = (why: string): void => {
    failures.push(CONTROL === "" ? why : `[control ${CONTROL}] ${why}`);
  };

  // ---- (0) the held-out tokens live where the fixture says, and only there --
  //
  // Runs before anything is built, because it is what makes every later
  // assertion mean something: a token this lab's own code could have produced
  // proves nothing was read out of a file.
  {
    const treeFiles = filesUnder(LAB_TREE);
    const codeFiles = filesUnder(LAB_ROOT).filter(([path]) => path.endsWith(".mts"));
    for (const [token, home] of Object.entries(fixture.tokenHomes)) {
      const carriers = treeFiles.filter(([, text]) => text.includes(token)).map(([path]) => path);
      if (!sameSet(carriers, [home])) {
        note(
          `token ${token} should live in exactly one convention file (${home}) — ` +
            `found in ${carriers.length === 0 ? "none" : carriers.join(", ")}`,
        );
      }
      const inCode = codeFiles.filter(([, text]) => text.includes(token)).map(([path]) => path);
      if (inCode.length > 0) {
        note(`token ${token} appears in the lab's own code (${inCode.join(", ")})`);
      }
      if (fixture.row.goal.includes(token)) note(`token ${token} appears in the filed row's goal`);
    }
    evidence.push(
      `each of the ${Object.keys(fixture.tokenHomes).length} held-out tokens lives in exactly one ` +
        `convention file, in none of the lab's ${codeFiles.length} code files, and in no part of ` +
        `the row the EM seat files`,
    );
  }

  const opened = await open("gate");
  const { lab, runs, workspace } = opened;

  try {
    // ---- (a) BR-1, BR-2 — the tree alone produced all of it ---------------
    {
      const seatIds = Object.keys(lab.seats).sort();
      if (!sameSet(seatIds, Object.keys(fixture.seats))) {
        note(
          `hired ${JSON.stringify(seatIds)}, wanted ${JSON.stringify(Object.keys(fixture.seats))}`,
        );
      }
      for (const [seatId, expected] of Object.entries(fixture.seats)) {
        const seat = lab.seats[seatId] as { kind?: string; requiresOrg?: boolean } | undefined;
        if (seat === undefined) continue;
        if (seat.kind !== expected.kind) {
          note(`${seatId} was hired into kind "${String(seat.kind)}", not "${expected.kind}"`);
        }
        if (seat.requiresOrg !== true) {
          note(`${seatId} does not require an org, so BR-17's refusal could never fire`);
        }
      }

      const docRefs = lab.roster.documents.map((doc) => doc.ref);
      if (!sameSet(docRefs, fixture.documents)) {
        note(`documents ${JSON.stringify(docRefs)}, wanted ${JSON.stringify(fixture.documents)}`);
      }
      // The COMPLETE set, not its first element — a loader that started
      // returning a second channel would otherwise leave this green.
      const channelIds = lab.roster.channels.map((channel) => channel.id);
      if (!sameSet(channelIds, fixture.channels)) {
        note(`channels ${JSON.stringify(channelIds)}, wanted ${JSON.stringify(fixture.channels)}`);
      }

      // BR-2, both halves. One line of one `WORKER.md` is the only difference
      // between the two trees, and the corrected twin IS the real tree.
      const badRoot = perturbedTree("unknown-kind", (root) => {
        const worker = join(root, fixture.tokenHomes[fixture.seats[fixture.assignedSeat]!.instructionsToken]!);
        writeFileSync(
          worker,
          readFileSync(worker, "utf8").replace(
            `flow: ${fixture.seats[fixture.assignedSeat]!.kind}`,
            "flow: codr",
          ),
        );
      });
      let refusal = "";
      let hiredAnyway = -1;
      try {
        const bad = await open("badtree", { root: badRoot });
        hiredAnyway = Object.keys(bad.lab.seats).length;
        await bad.lab.dispose();
      } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
      }
      if (hiredAnyway >= 0) {
        note(`a tree naming an unregistered kind hired ${hiredAnyway} seats instead of refusing`);
      } else if (!refusal.includes("nothing was hired") || !refusal.includes("codr")) {
        note(`the refusal did not name the unregistered kind and the empty roster: ${refusal}`);
      }

      evidence.push(
        `one root produced ${seatIds.length} seats on ${
          new Set(Object.values(fixture.seats).map((s) => s.kind)).size
        } kinds, ${docRefs.length} documents and ${channelIds.length} channel; a tree naming an ` +
          `unregistered kind refused the whole roster and its corrected twin hired cleanly`,
      );
    }

    // ---- (b) BR-3, BR-4 — each seat's own view; the EM kind has no entry ---
    {
      for (const [seatId, expected] of Object.entries(fixture.seats)) {
        const read = await lab.inspect(seatId);
        if (read.error !== undefined) {
          note(`${seatId}: its own read was refused — ${read.error}`);
          continue;
        }
        const facts = read.facts as {
          documentRef?: string;
          document?: string;
          instructions?: string;
          skillNames?: string[];
        };

        if (facts.documentRef !== expected.document) {
          note(`${seatId}: reads document "${facts.documentRef}", wanted "${expected.document}"`);
        }
        // Exact expected union, not presence and not sibling-exclusion: the
        // three seats share their team folder by design, so exclusion would
        // fail a correct run — and presence would pass a seat handed every
        // skill in the tree.
        if (!sameSet(facts.skillNames ?? [], expected.skills)) {
          note(
            `${seatId}: holds skills ${JSON.stringify(facts.skillNames)}, wanted exactly ` +
              `${JSON.stringify(expected.skills)}`,
          );
        }
        if (!(facts.instructions ?? "").includes(expected.instructionsToken)) {
          note(`${seatId}: its instructions do not carry ${expected.instructionsToken}`);
        }
      }

      // BR-4, on the KIND rather than on behaviour. "It did not run a harness"
      // is a fact about one run; "it declares no task entry" is a fact about
      // what the seat can ever do.
      const entriesOf = (seatId: string): string[] =>
        Object.keys((lab.seats[seatId] as { task?: { actions?: object } } | undefined)?.task?.actions ?? {});
      const emEntries = entriesOf(fixture.coordinatorSeat);
      if (emEntries.length > 0) {
        note(
          `${fixture.coordinatorSeat} declares task entries ${JSON.stringify(emEntries)} — the ` +
            `coordinator seat must have no route to a harness at all`,
        );
      }
      if (entriesOf(fixture.assignedSeat).length === 0) {
        note(`${fixture.assignedSeat} declares no task entry, so nothing could be handed to it`);
      }
      // And in the source, so the claim survives a refactor that moves the
      // slot somewhere the flow shape does not show.
      const emSource = readFileSync(join(LAB_ROOT, "workforce/flows/workers/em.mts"), "utf8");
      if (emSource.includes("harnessManager")) {
        note(`the em kind's own file names harnessManager`);
      }

      evidence.push(
        `each of the ${Object.keys(fixture.seats).length} seats reported its own instructions, ` +
          `document ref and exact skill union from inside a running block; the coordinator kind ` +
          `declares no task entry and its file never names the manager`,
      );
    }

    // ---- (c) BR-5, BR-6, BR-8, BR-9 — one row, to the seat it named -------
    {
      const filed = await lab.file(fixture.coordinatorSeat, filing);
      if (filed.error !== undefined) note(`filing the row was refused — ${filed.error}`);
      const filedTaskId = (filed.output as { taskId?: string } | undefined)?.taskId;
      if (filedTaskId !== fixture.row.taskId) {
        note(`the EM seat filed row "${filedTaskId}", wanted "${fixture.row.taskId}"`);
      }

      const drained = await lab.drain(fixture.coordinatorSeat);
      if (drained.error !== undefined) note(`the drain was refused — ${drained.error}`);
      const row = await settled(lab);

      // The DISPATCH RECORD, and by `flowId` rather than `flowKind`: two of the
      // three seats are hired into the same kind, so a record read by kind
      // cannot tell the seat that was named from the seat that must never be
      // reached. That distinction is the whole of BR-8.
      const dispatched = await lab.dispatched(fixture.coordinatorSeat);
      const reached = dispatched.map((child) => child.flowId ?? "<none>");
      if (!sameSet(reached, [fixture.assignedSeat])) {
        note(
          `the drain dispatched to ${JSON.stringify(reached)}, wanted exactly ` +
            `${JSON.stringify([fixture.assignedSeat])}`,
        );
      }
      if (reached.includes(fixture.silentSeat)) {
        note(`${fixture.silentSeat} is declared and was dispatched to`);
      }

      // **BR-9, and only over a row that settled done.** A re-pended row SHOULD
      // be reclaimed — that is BR-14, and asserting "one row, one run" over one
      // would be asserting that a retry is a defect. The claim is about a row
      // the board has finished with.
      if (row.status === "completed") {
        if (runs.length !== 1) {
          note(`the harness was reached ${runs.length} time(s) for one settled row, wanted 1`);
        }
        const before = runs.length;
        await lab.drain(fixture.coordinatorSeat);
        await sleep(500);
        if (runs.length !== before) {
          note(`a second drain over a settled row started ${runs.length - before} further run(s)`);
        }
      }

      evidence.push(
        `one row (${row.id}) was claimed once and handed to ${reached.join(", ")} — the seat the ` +
          `board's "${row.assignee}" assignee names — with ${fixture.silentSeat} declared on the ` +
          `same kind and absent from the dispatch record; a second drain claimed nothing`,
      );
    }

    // ---- (d) BR-10, BR-11, BR-13 — the prompt, the checkout, the row ------
    {
      const row = await lab.row(fixture.row.taskId);
      // The FIRST run, deliberately: BR-10 and BR-11 are claims about what the
      // manager hands a run, and they are equally true of a retry. How many
      // runs one row gets is BR-9's claim, and it is graded there.
      const run = runs[0];
      if (run === undefined) {
        note(`the harness was never reached, so nothing about the run can be graded`);
      } else {
        // BR-10. Graded in the prompt the manager BUILT, never in what the run
        // produced: a model writes a plausible commit without reading anything.
        for (const token of fixture.promptTokens) {
          if (!run.prompt.includes(token)) {
            note(
              `the prompt does not carry ${token}, which lives only in ` +
                `${fixture.tokenHomes[token]} — the seat did not read its own file`,
            );
          }
        }

        // BR-11. Compared against the framework's own derivation rather than
        // against a path this check spelled, so a change to that derivation
        // moves both sides together and the claim stays about the run's cwd
        // being THE derived checkout.
        const expected = checkoutPathFor(workspace, {
          principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID } as never,
          epic: LEDGER_ID,
          issue: fixture.row.issue,
          phase: PHASE,
        });
        if (run.cwd !== expected) {
          note(`the run's cwd was ${run.cwd}, wanted the derived checkout ${expected}`);
        }
        if (run.cwd === workspace.root || run.cwd === workspace.sourceRepo) {
          note(`the run was given the host's own directory rather than a checkout of its own`);
        }
        // Injective over its components — a redistribution of characters
        // between the issue and the phase must not land in the same tree.
        const shifted = checkoutPathFor(workspace, {
          principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID } as never,
          epic: LEDGER_ID,
          issue: fixture.row.issue.slice(0, -1),
          phase: `${fixture.row.issue.slice(-1)}-${PHASE}`,
        });
        if (shifted === expected) {
          note(`two different (issue, phase) pairs derive one checkout: ${expected}`);
        }
        if (run.resume !== null) {
          note(`the first attempt was offered session "${run.resume}" to resume`);
        }
      }

      // **BR-12, and the `stopped-at-limit` control's one clause.**
      //
      // The rule as this spec words it says a bad outcome inside a normal
      // finish must not settle the row. The framework reads `status` for
      // success and then asks the phase's done-condition; the `outcome` word is
      // recorded and never consulted. So a run that stopped at its limit and
      // still left a commit settles done — see goal.md → Findings. This clause
      // is what makes that reproducible rather than an assertion in a document.
      if (CONTROL === "stopped-at-limit" && row?.status === "completed") {
        note(
          `the run reported outcome "stopped-at-limit" and the row settled done anyway — ` +
            `\`status\` alone decides success and the done-condition decides completion, so a ` +
            `run that stopped at its budget with a partial commit settles its row`,
        );
      }

      // BR-13.
      if (CONTROL !== "stopped-at-limit" && row?.status !== "completed") {
        note(
          `the row settled "${row?.status}" after a run that finished cleanly; wanted ` +
            `"completed"${row?.feedback === undefined ? "" : ` — ${row.feedback}`}`,
        );
      }

      evidence.push(
        `the run was handed a prompt carrying all ${fixture.promptTokens.length} held-out tokens ` +
          `from the seat's own instructions, brief and skills, and the checkout the framework ` +
          `derives for (${fixture.row.issue}, ${PHASE}); the row settled ${row?.status}`,
      );
    }
  } finally {
    await lab.dispose();
  }

  // ---- (e) BR-7 — a hand-off to an instance nobody minted -----------------
  {
    const missing = await open("noseat", { coderSeatId: fixture.unknownSeat });
    try {
      await missing.lab.file(fixture.coordinatorSeat, filing);
      await missing.lab.drain(fixture.coordinatorSeat);
      const row = await terminal(missing.lab);
      if (row.status !== "errored") {
        note(`a hand-off to an unminted instance settled "${row.status}", wanted "errored"`);
      }
      const reason = `${row.error ?? ""} ${row.feedback ?? ""}`;
      if (!reason.includes("flow-not-found") || !reason.includes(fixture.unknownSeat)) {
        note(`the refusal names neither flow-not-found nor the id it could not find: ${reason}`);
      }
      if (missing.runs.length !== 0) {
        note(`a checkout was provisioned for a hand-off that could not be delivered`);
      }
      evidence.push(
        `a hand-off naming an instance no seat minted errors the row by name (flow-not-found) ` +
          `and provisions nothing`,
      );
    } finally {
      await missing.lab.dispose();
    }
  }

  // ---- (f) BR-12, BR-14 — the done-condition is the authority -------------
  {
    // **Opened with its own stub, whatever the control asked for.** The state
    // this leg grades IS "the run produced nothing", so a control that made the
    // main run produce nothing would leave this leg testing the control rather
    // than the rule.
    const dirs = createScratchRepo("nowork");
    const stub = harnessStub({ finalMessage: "I ran out of room." });
    const lab = await openLab({
      stores: inMemoryStores(),
      harness: stub.slot,
      workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
      coderSeatId: fixture.assignedSeat,
      logger: silentLogger,
    });
    try {
      await lab.file(fixture.coordinatorSeat, filing);
      await lab.drain(fixture.coordinatorSeat);
      const first = await settled(lab);
      if (first.status !== "pending") {
        note(
          `a run that finished cleanly and left no commit settled "${first.status}" — the ` +
            `done-condition is meant to be the authority on completion`,
        );
      }
      if (!(first.feedback ?? "").includes("not done")) {
        note(`the re-pended row carries no reason the next attempt can read: ${first.feedback}`);
      }

      await lab.drain(fixture.coordinatorSeat);
      const second = await settled(lab);
      if (second.status !== "errored") {
        note(`the row settled "${second.status}" with its retry budget spent, wanted "errored"`);
      }
      if (second.attempts !== 2) {
        note(`the row recorded ${second.attempts} attempts against a budget of 2`);
      }
      if (stub.runs[1] !== undefined && !stub.runs[1].prompt.includes("last attempt")) {
        note(`the retry's prompt does not carry why the last attempt stopped`);
      }
      evidence.push(
        `a clean finish that produced no commit re-pends the row with its reason attached, and ` +
          `errors it once the retry budget is spent`,
      );
    } finally {
      await lab.dispose();
    }
  }

  // ---- (g) BR-16, BR-17 — the silent folder, and the door ------------------
  {
    // BR-16. A folder no loader walks, added to a copy of the real tree: the
    // record set must be identical, which is what makes "a board declared as a
    // file would be read by nobody" a measurement rather than a belief.
    const decoyed = perturbedTree("boards", (root) => {
      mkdirSync(join(root, "teams/eng/boards/feature"), { recursive: true });
      writeFileSync(
        join(root, "teams/eng/boards/feature/BOARD.md"),
        "---\nassignees: [eng.reviewer]\n---\n\nA board declared as a file. Nothing walks this.\n",
      );
    });
    const real = await readLabTree(LAB_TREE);
    const withDecoy = await readLabTree(decoyed);
    const shape = (tree: typeof real): string =>
      JSON.stringify([
        tree.workers.map((w) => w.id).sort(),
        tree.documents.map((d) => d.ref).sort(),
        tree.channels.map((c) => c.id).sort(),
      ]);
    if (shape(real) !== shape(withDecoy)) {
      note(`a boards/ folder changed what the tree produced: ${shape(withDecoy)}`);
    }
    // And the positive half, without which "it changed nothing" is equally
    // true of a loader that reads nothing at all: the channels/ folder beside
    // it DOES load.
    if (withDecoy.channels.length === 0) {
      note(`the tree produced no channels, so "an unwalked folder loads as nothing" says nothing`);
    }

    // BR-17, at the door the rule names.
    const org = await open("org");
    try {
      const refused = await org.lab.inspect(fixture.coordinatorSeat, { omitOrg: true });
      if (refused.error === undefined) {
        note(`an org-less read of ${fixture.coordinatorSeat} was answered rather than refused`);
      } else if (!refused.error.includes("org")) {
        note(`the org-less refusal does not say what was missing: ${refused.error}`);
      }
      const landed = await org.lab.inspect(fixture.coordinatorSeat);
      if (landed.error !== undefined) {
        note(`the same read WITH an org was refused too — ${landed.error}`);
      }
      evidence.push(
        `a boards/ folder loads as nothing while the channels/ folder beside it loads, and an ` +
          `org-less read is refused at the transport door while the same read with an org lands`,
      );
    } finally {
      await org.lab.dispose();
    }
  }

  return { failures, evidence: evidence.join("; ") };
});
