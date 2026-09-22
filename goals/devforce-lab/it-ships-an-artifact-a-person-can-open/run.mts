/**
 * Goal check — a post on a channel becomes work a person can open and judge.
 *
 * **The third sibling.** `it-wakes-the-seat-a-file-declared` grades what the
 * plumbing carried, model-free. `it-commits-from-the-seats-own-file` grades that
 * a real coding agent, handed the prompt the manager built, leaves a commit.
 * Neither can reach the two ends of the path, and those ends are what
 * ER-DevForce is actually about: **a post is what starts the work**, and **the
 * work survives the run and is judged against a condition its requester stated
 * first.** Neither existing check is edited; both keep their claims.
 *
 * ## What it grades
 *
 * 1. **The channel is driven.** An operator posts one line. The line lands in
 *    the transcript, reaches the EM seat and nobody else, and exactly one row
 *    appears on the feature board. Before the post there is no row (BR-6, BR-7,
 *    BR-8, BR-9).
 * 2. **The artifact outlives the run.** The work is published to a bare
 *    repository at a declared path; the store is closed, the temporary
 *    repository and every checkout are deleted, and the artifact still resolves
 *    (BR-1).
 * 3. **The lab did not author it.** The produced source appears nowhere the
 *    seat could have read it — not in the lab's code, not in the workforce
 *    tree, not in this runner, not in the prompt (BR-2).
 * 4. **It satisfies the condition the brief stated first.** The requester's
 *    acceptance check passes against the produced tree **and fails against the
 *    base ref**. One half is not evidence (BR-3).
 * 5. **The prompt still carries the seat's own files** — the four held-out
 *    tokens, unchanged from the sibling (BR-12).
 * 6. **The store was on disk and a fresh process reads it back** (BR-11).
 *
 * ## What it does not grade, deliberately
 *
 * **The artifact's content is never read for tokens.** A model emits a token it
 * was told to emit, so a file's contents are no evidence a brief was read. The
 * prompt is evidence of that; the acceptance check is evidence the *work* is
 * what was asked for. Grading the file by eye is the failure the sibling check
 * exists to refuse, and it is not reintroduced here (D2).
 *
 * **One leg, and the verdict names it.** CI runs the local leg: a bare
 * repository at a declared path, no `gh`, no token, no network. The
 * pull-request release run is the same path pointed at a real remote and is a
 * human release step, never inferred from whether `gh` happens to be installed
 * (BR-14, BR-15).
 *
 * **There is no stub fallback.** A model-backed check that silently degrades to
 * a scripted run is exactly the failure its model-free sibling exists to
 * detect. The two controls below install their own inert harnesses explicitly,
 * at their own call sites; nothing reaches one by falling back (BR-13).
 *
 * ## Provenance is provenance
 *
 * The one parentage read in this lab — `lab.dispatched()` — is used to say
 * which seat the board handed work to. It is never a work control plane:
 * nothing here schedules, claims or settles anything through a session tree
 * (ER-13).
 *
 * Run: pnpm tsx goals/devforce-lab/it-ships-an-artifact-a-person-can-open/run.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  handler,
  harnessRunHandleSchema,
  harnessRunInputSchema,
  sequencer,
} from "@flow-state-dev/core";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { harnessTaskId } from "@flow-state-dev/harness-manager/checkout";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { RUN_STAMP, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { LAB_TREE, LAB_USER_ID, openLab, type Lab } from "../lab/host.mts";
import { LEDGER_ID } from "../lab/board.mts";
import { PHASE } from "../lab/phase.mts";
import { createNotifyLog, type NotifyLog } from "../lab/notify.mts";
import { ACCEPTANCE_MODULE, runAcceptance } from "../lab/acceptance.mts";
import {
  ARTIFACTS_ROOT,
  BASE_REF,
  branchesUnder,
  cloneRef,
  createScratchRepo,
  publishArtifact,
} from "../lab/scratch-repo.mts";

stripIntentOverrides();

// ---------------------------------------------------------------------------
// What this check is about
// ---------------------------------------------------------------------------

/** The seat the board's `coder` assignee is addressed to. */
const ASSIGNED_SEAT = "eng.coder";
/** The seat the channel post is delivered to. */
const COORDINATOR_SEAT = "eng.em";
/** Declared on the channel, hired into the same kind as the coder, and never given work. */
const REVIEWER_SEAT = "eng.reviewer";
/** Every member `CHANNEL.md` declares, in the order the fan-out walks them. */
const DECLARED_MEMBERS = [COORDINATOR_SEAT, ASSIGNED_SEAT, REVIEWER_SEAT];

/** The feature, and the line an operator posts to ask for it. */
const ISSUE = "greeting-module";
const POST_LINE = `${ISSUE}: Add a greeting module to the repository.`;

/** The row the EM files in answer, derived exactly as the manager derives it. */
const TASK_ID = harnessTaskId(ISSUE, PHASE);
const ROW_KEY = `${LEDGER_ID}/${TASK_ID}`;


/** The branch prefix the manager cuts work on. */
const BRANCH_PREFIX = "conductor/";

/**
 * The tokens the prompt must carry, and the file each one lives in.
 *
 * Read off the tree at run time rather than restated here: the claim is that
 * the prompt carried what the seat's own files say, and a list this check typed
 * out would be a list this check could get right while the tree changed.
 */
const PROMPT_TOKEN_HOMES = {
  "CODER-INSTRUCTIONS-B42D9": "teams/eng/workers/coder/WORKER.md",
  "FEATURE-BRIEF-E61B8": "teams/eng/resources/feature-brief.md",
  "COMMIT-STYLE-F70C4": "teams/eng/skills/commit-style/SKILL.md",
  "BRANCH-NAMING-1B9E7": "teams/eng/workers/coder/skills/branch-naming/SKILL.md",
} as const;

const THIS_FILE = fileURLToPath(import.meta.url);
const LAB_ROOT = fileURLToPath(new URL("../lab", import.meta.url));
const DEVFORCE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REREAD = fileURLToPath(new URL("./reread/run.mts", import.meta.url));

/** Where this run's artifact and store live — the declared address (D1). */
const RUN_DIR = join(ARTIFACTS_ROOT, RUN_STAMP);
const ARTIFACT_REPO = join(RUN_DIR, "feature.git");
const STORE_FILE = join(RUN_DIR, "lab.db");

const RUN_TIMEOUT_MS = 10 * 60_000;
const SETTLE_TIMEOUT_MS = 12 * 60_000;
/** How long the fan-out has to turn a post into a row. It is one dispatch. */
const FILED_TIMEOUT_MS = 30_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Reading trees
// ---------------------------------------------------------------------------

/**
 * Directories the scans below never walk.
 *
 * `.artifacts/` is **generated output** — every previous run's bare repository
 * and its SQLite database. Walking it would make the totality claim depend on
 * what else has been run on this machine, and would read several megabytes
 * of git objects and SQLite pages as UTF-8 for no reason. It grows without
 * bound, so this is not a size that stays small.
 */
const NOT_SOURCE = new Set([".artifacts", "node_modules"]);

/** Every source file under a directory, recursively, as [relative path, contents]. */
function filesUnder(root: string, prefix = ""): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const entry of readdirSync(root)) {
    if (NOT_SOURCE.has(entry)) continue;
    const full = join(root, entry);
    const rel = prefix === "" ? entry : `${prefix}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, rel));
    else out.push([rel, readFileSync(full, "utf8")]);
  }
  return out;
}

/** Collapse whitespace, so a reformatted copy of a string still counts as the same one. */
const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// The controls' harnesses — installed explicitly, never fallen back to
// ---------------------------------------------------------------------------

/**
 * A harness that finishes cleanly having done nothing.
 *
 * Used by `work-reaches-the-reviewer`, whose claim is about **which seat the
 * board dispatched to** — a fact settled before any harness does anything, and
 * independent of what one does. Paying for inference to observe a routing
 * decision would make the control cost as much as the thing it guards.
 */
const inertHarness = () =>
  handler({
    name: "devforce-control-inert-harness",
    inputSchema: harnessRunInputSchema,
    outputSchema: harnessRunHandleSchema,
    execute: () => ({
      source: "devforce-lab/control",
      status: "completed" as const,
      sessionId: `sess_control_${Date.now()}`,
      url: null,
      dispatchedAt: Date.now(),
      outcome: "finished" as const,
      finalMessage: null,
      usage: null,
      cost: null,
    }),
  }) as unknown as HarnessBlock;

/**
 * A harness that is not there — the red state of BR-13.
 *
 * It throws the way an unauthenticated SDK throws. What the control grades is
 * that the check goes red and publishes nothing, rather than quietly running
 * something else.
 */
const unavailableHarness = () =>
  handler({
    name: "devforce-control-unavailable-harness",
    inputSchema: harnessRunInputSchema,
    outputSchema: harnessRunHandleSchema,
    execute: () => {
      throw new Error("no coding harness is available or authenticated");
    },
  }) as unknown as HarnessBlock;

// ---------------------------------------------------------------------------
// Driving one lab
// ---------------------------------------------------------------------------

/**
 * Wait for the post's row to appear, or give up.
 *
 * The fan-out is deliberately **not** inside the post's own request — the
 * channel hands it off so delivery latency cannot eat the next poster's queue
 * budget — so the row lands a moment after `post()` returns. Reading it
 * immediately is a race that passes on a fast machine and fails on a slow one.
 */
async function waitForRow(lab: Lab, budgetMs: number): Promise<Task | undefined> {
  const deadline = Date.now() + budgetMs;
  for (;;) {
    const row = await lab.row(TASK_ID);
    if (row !== undefined) return row;
    if (Date.now() >= deadline) return undefined;
    await sleep(250);
  }
}

/** Wait for a row to stop moving, or give up. */
async function settle(lab: Lab, budgetMs: number): Promise<Task | undefined> {
  const deadline = Date.now() + budgetMs;
  let row: Task | undefined;
  while (Date.now() < deadline) {
    row = await lab.row(TASK_ID);
    if (row !== undefined && row.status !== "in_progress" && row.status !== "pending") return row;
    await sleep(1_000);
  }
  return row;
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  /** One line per control, each naming what went red and on which clause. */
  const controls: string[] = [];

  // =========================================================================
  // Leg 0 — totality and the held-out discipline, before anything runs
  // =========================================================================
  //
  // First and separately. A token the lab's own code could have produced
  // proves nothing about a file being read, and a scan that missed a file
  // proves nothing at all — which is why totality comes before the scan rather
  // than beside it. Inherited from this spec's `poc/gap-check/`, whose
  // snapshot claims expired on merge but whose totality discipline did not.

  /** Every `.mts` file under the lab, and the category it belongs to. */
  const classified = new Map<string, string>();
  const unclassified: string[] = [];
  for (const [path] of filesUnder(DEVFORCE_ROOT)) {
    if (!path.endsWith(".mts")) continue;
    const category =
      /^lab\/workforce\/flows\/workers\/[^/]+\.mts$/.test(path) ? "worker kind"
      : /^lab\/[^/]+\.mts$/.test(path) ? "lab root"
      : /^[^/]+\/run\.mts$/.test(path) ? "goal runner"
      : /^[^/]+\/reread\/run\.mts$/.test(path) ? "goal runner" : undefined;
    if (category === undefined) unclassified.push(path);
    else classified.set(path, category);
  }
  if (unclassified.length > 0) {
    failures.push(
      `${unclassified.length} TypeScript file(s) under the lab fall into no known category, so ` +
        `the scans below are not total: ${unclassified.join(", ")}`,
    );
  }
  if (failures.length > 0) return { failures, evidence: "" };

  /** The authored workforce tree — the files a seat's own configuration comes from. */
  const tree = filesUnder(LAB_TREE);
  /** Everything under `lab/`, which already contains the tree. Walked once. */
  const labFiles = filesUnder(LAB_ROOT);

  /**
   * The lab's own code — what BUILDS the prompt.
   *
   * This runner is deliberately **not** in it. The held-out claim is that the
   * prompt carried tokens the lab's code could not have supplied, and a check
   * that grades those tokens has to name them; including itself would make the
   * scan fail on the act of checking.
   */
  const labCode = labFiles.filter(
    ([path]) => path.endsWith(".mts") || path.endsWith(".mjs"),
  );

  /**
   * Everything the artifact's content must not appear in.
   *
   * Wider than `labCode`, and this one **does** include the runner: nothing
   * here has to name the produced source in order to grade it, so there is no
   * reason to leave a file out, and a hole in this scan is exactly what BR-2 is
   * about.
   */
  const artifactScan: Array<[string, string]> = [
    ...labFiles.map(([path, text]) => [`lab/${path}`, text] as [string, string]),
    [relative(DEVFORCE_ROOT, THIS_FILE), readFileSync(THIS_FILE, "utf8")],
  ];

  for (const [token, home] of Object.entries(PROMPT_TOKEN_HOMES)) {
    const carriers = tree.filter(([, text]) => text.includes(token)).map(([path]) => path);
    if (carriers.length !== 1 || carriers[0] !== home) {
      failures.push(`token ${token} should live only in ${home}; found in ${carriers.join(", ")}`);
    }
    if (labCode.some(([, text]) => text.includes(token))) {
      failures.push(`token ${token} appears in the lab's own code`);
    }
  }

  // BR-2, the half that can be asserted before the run: the lab states the
  // contract and never the implementation. `greet` is named all over the brief
  // and the acceptance check — that is the contract, and naming it is the
  // point. What must not exist anywhere the seat could read is a DEFINITION.
  const definesGreet = /(?:function\s+greet\b|\bgreet\s*[:=]\s*(?:function\b|\([^)]*\)\s*=>))/;
  for (const [path, text] of labFiles) {
    if (definesGreet.test(text)) {
      failures.push(`${path} defines \`greet\`, so the lab carries the answer it is asking for`);
    }
  }
  if (failures.length > 0) return { failures, evidence: "" };
  evidence.push(
    `${classified.size} lab TypeScript file(s) classified with none left over; ` +
      `4 held-out tokens each in exactly one convention file; no lab file defines the export`,
  );

  // =========================================================================
  // Leg A — the acceptance check is strong enough to carry D2 (V5, BR-3a)
  // =========================================================================
  //
  // Three trees a weaker condition would have accepted, built directly rather
  // than hoped for from a model: a control that only fires when a run happens
  // to misbehave is a control that usually cannot fire at all. Each must be
  // REJECTED, and the one that matters most is `vacuous-test` — the module
  // exists, a test beside it passes, and the work is still wrong.

  const synthetic: Array<{ name: string; files: Record<string, string> }> = [
    {
      name: "ignores-the-brief",
      files: { "NOTES.md": "Did something else entirely.\n" },
    },
    {
      name: "unrelated-passing-test",
      files: {
        "src/other.js": "export const answer = 42;\n",
        "test/other.test.js": "import { answer } from '../src/other.js';\nif (answer !== 42) throw new Error('no');\n",
      },
    },
    {
      name: "vacuous-test",
      files: {
        // Deliberately the WRONG behaviour. Not the artifact's content, which
        // is why writing it here does not falsify BR-2.
        "src/greeting.js": "export function greet() {\n  return 'hi';\n}\n",
        "test/greeting.test.js": "import { greet } from '../src/greeting.js';\nif (typeof greet !== 'function') throw new Error('no');\n",
      },
    },
  ];

  for (const control of synthetic) {
    const dir = mkdtempSync(join(tmpdir(), `devforce-control-${control.name}-`));
    writeFileSync(
      join(dir, "package.json"),
      `${JSON.stringify({ name: "control", private: true, type: "module" }, null, 2)}\n`,
    );
    for (const [path, contents] of Object.entries(control.files)) {
      mkdirSync(join(dir, path, ".."), { recursive: true });
      writeFileSync(join(dir, path), contents);
    }
    const verdict = runAcceptance(dir);
    if (verdict.accepted) {
      failures.push(
        `control ${control.name}: the acceptance check ACCEPTED a tree that does not satisfy ` +
          `the brief, so it is too weak to carry D2`,
      );
    } else {
      controls.push(`${control.name} red — ${verdict.reason}`);
    }
    rmSync(dir, { recursive: true, force: true });
  }
  if (failures.length > 0) return { failures, evidence: "" };

  // =========================================================================
  // Leg B — no harness means a loud failure, never a quiet substitute (V8, BR-13)
  // =========================================================================

  {
    const log = createNotifyLog();
    const dirs = createScratchRepo("no-harness");
    const stores = sqliteStores({ filename: ":memory:" });
    const lab = await openLab({
      stores,
      workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
      coderSeatId: ASSIGNED_SEAT,
      logger: silentLogger,
      channels: { addresses: { [COORDINATOR_SEAT]: COORDINATOR_SEAT }, log },
      harness: () => unavailableHarness(),
    });
    try {
      await lab.post?.(POST_LINE);
      // **The row has to exist before its fate means anything.** Without this
      // the control passes when the post files nothing at all — "no completed
      // row and no branch" is equally true of a lab that never started, and a
      // control that green-lights on its own setup failing is worse than none.
      // Found the hard way: it passed vacuously exactly once, on a run where a
      // misdeclared dispatch entry meant no row was ever filed.
      const filed = await waitForRow(lab, FILED_TIMEOUT_MS);
      if (filed === undefined) {
        failures.push(
          `control no-harness: the post filed no row, so "the row did not settle completed" ` +
            `says nothing about the harness`,
        );
        return { failures, evidence: "" };
      }
      await lab.drain(COORDINATOR_SEAT);
      // The drain has returned idle, so the attempt is over and the row is at
      // rest. Waiting on a timeout here would add minutes and no information.
      const row = await lab.row(TASK_ID);
      const branches = branchesUnder(dirs.sourceRepo, BRANCH_PREFIX);
      if (row?.status === "completed") {
        failures.push(
          `control no-harness: the row settled "completed" with no harness available, which ` +
            `means something stood in for one`,
        );
      } else if (branches.length > 0) {
        failures.push(
          `control no-harness: no harness ran but ${branches.length} branch(es) appeared, so ` +
            `work came from somewhere else`,
        );
      } else {
        controls.push(
          `no-harness red — the row settled "${row?.status ?? "never"}" and no branch was cut`,
        );
      }
    } finally {
      await lab.dispose();
      rmSync(dirs.sourceRepo, { recursive: true, force: true });
      rmSync(dirs.root, { recursive: true, force: true });
    }
  }
  if (failures.length > 0) return { failures, evidence: "" };

  // =========================================================================
  // Leg C — work never reaches the reviewer seat (V2, BR-8)
  // =========================================================================
  //
  // **Graded on the board dispatch record, by `flowId`.** Two seats on this
  // tree are hired into the same kind, so a record read by kind alone cannot
  // tell the coder from the reviewer — and that is the whole of the claim.
  //
  // The perturbation is one thing: the board's `coder` assignee is addressed to
  // the reviewer seat. A channel *notification* to a declared member is a
  // different dispatch kind and is expected; what BR-8 forbids is work, and
  // this is what work reaching the reviewer looks like.

  {
    const log = createNotifyLog();
    const dirs = createScratchRepo("reviewer");
    const stores = sqliteStores({ filename: ":memory:" });
    const lab = await openLab({
      stores,
      workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
      coderSeatId: REVIEWER_SEAT,
      logger: silentLogger,
      channels: { addresses: { [COORDINATOR_SEAT]: COORDINATOR_SEAT }, log },
      harness: () => inertHarness(),
    });
    try {
      await lab.post?.(POST_LINE);
      // Same reason as the control above: with no row there is nothing for the
      // board to hand anywhere, and "no dispatch named the reviewer" would be
      // true of a lab that never started.
      if ((await waitForRow(lab, FILED_TIMEOUT_MS)) === undefined) {
        failures.push("control work-reaches-the-reviewer: the post filed no row to hand over");
        return { failures, evidence: "" };
      }
      await lab.drain(COORDINATOR_SEAT);

      const reached = (await lab.dispatched(COORDINATOR_SEAT)).filter(
        (child) => child.flowId === REVIEWER_SEAT,
      );
      if (reached.length === 0) {
        failures.push(
          `control work-reaches-the-reviewer: the board was pointed at ${REVIEWER_SEAT} and no ` +
            `dispatch record names it, so the assertion this control guards cannot go red`,
        );
      } else {
        controls.push(
          `work-reaches-the-reviewer red — ${reached.length} board dispatch(es) with ` +
            `flowId ${REVIEWER_SEAT}`,
        );
      }
    } finally {
      await lab.dispose();
      rmSync(dirs.sourceRepo, { recursive: true, force: true });
      rmSync(dirs.root, { recursive: true, force: true });
    }
  }
  if (failures.length > 0) return { failures, evidence: "" };

  // =========================================================================
  // The goal itself
  // =========================================================================

  mkdirSync(RUN_DIR, { recursive: true });
  const dirs = createScratchRepo("ships", { artifactRepo: ARTIFACT_REPO });
  const stores = sqliteStores({ filename: STORE_FILE });
  const notifyLog: NotifyLog = createNotifyLog();

  /** Every prompt the manager built, so the anti-game reads what was actually sent. */
  const prompts: string[] = [];

  /**
   * Record the prompt on its way into the harness.
   *
   * A `.tap()` in front of the agent rather than a hook on the phase: the claim
   * is about what the *manager* handed the run, and re-running this check's own
   * copy of `buildPrompt` would grade a string this file produced.
   */
  const recordPrompt = handler({
    name: "devforce-ships-record-prompt",
    inputSchema: harnessRunInputSchema,
    outputSchema: z.object({ recorded: z.number() }),
    execute: (input: { prompt: string }) => ({ recorded: prompts.push(input.prompt) }),
  });

  const lab = await openLab({
    stores,
    workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
    coderSeatId: ASSIGNED_SEAT,
    runTimeoutMs: RUN_TIMEOUT_MS,
    logger: silentLogger,
    // Only the EM is addressed. The coder and the reviewer are declared members
    // of the channel and are true no-ops in the fan-out — recorded and skipped,
    // never dispatched to.
    channels: { addresses: { [COORDINATOR_SEAT]: COORDINATOR_SEAT }, log: notifyLog },
    harness: ({ cwd, resume, onSession }) =>
      sequencer({
        name: "devforce-ships-harness",
        inputSchema: harnessRunInputSchema,
        outputSchema: harnessRunHandleSchema,
      })
        .tap(recordPrompt)
        .step(
          claudeCodeAgent({
            cwd,
            resume,
            onSession,
            detached: true,
            recordWork: true,
            allowedTools: ["Read", "Write", "Edit", "Bash"],
            permissionMode: "acceptEdits",
            maxTurns: 30,
            systemPrompt:
              "You are a coding agent working in the directory you have been placed in. " +
              "Do what your instructions and your brief say, then commit your work with git. " +
              "Do nothing else.",
          } as never) as never,
        ) as unknown as HarnessBlock,
  });

  /** Filled in once the run has been published, so the legs after `dispose` can read them. */
  let branch: string | undefined;
  let channelId = "";

  try {
    if (lab.post === undefined || lab.transcript === undefined || lab.channelId === undefined) {
      return { failures: ["the lab opened no channel, so there is no door to post through"], evidence: "" };
    }
    channelId = lab.channelId;

    // ---- BR-9, first: the board does not start itself -------------------
    if ((await lab.row(TASK_ID)) !== undefined) {
      failures.push("a row existed before anybody posted, so the post is not what files it");
      return { failures, evidence: "" };
    }

    // ---- BR-6, BR-7: the post drives the filing --------------------------
    const posted = await lab.post(POST_LINE);
    if (posted.error !== undefined) {
      return { failures: [`the post was refused — ${posted.error}`], evidence: "" };
    }

    const transcript = await lab.transcript();
    if (transcript.length !== 1 || transcript[0]?.body !== POST_LINE) {
      failures.push(
        `the channel's transcript carries ${transcript.length} line(s); wanted exactly the one ` +
          `that was posted`,
      );
    }

    const filedRow = await waitForRow(lab, FILED_TIMEOUT_MS);
    if (filedRow === undefined) {
      return {
        failures: [`the post landed but no row "${TASK_ID}" was filed, so the EM seat was not reached`],
        evidence: "",
      };
    }

    // BR-8's positive half: exactly the EM was addressed, and the other two
    // declared members were seen and skipped. Not an absence — a record.
    const skipped = [...notifyLog.skipped].sort();
    const expectedSkips = DECLARED_MEMBERS.filter((m) => m !== COORDINATOR_SEAT).sort();
    if (notifyLog.addressed.join(",") !== COORDINATOR_SEAT) {
      failures.push(
        `the fan-out addressed [${notifyLog.addressed.join(", ")}]; wanted only ${COORDINATOR_SEAT}`,
      );
    }
    if (skipped.join(",") !== expectedSkips.join(",")) {
      failures.push(
        `the fan-out skipped [${skipped.join(", ")}]; wanted [${expectedSkips.join(", ")}] — ` +
          `a declared member the router never saw is a member the claim does not cover`,
      );
    }
    // The cycle break must not have fired. An operator's post carries no
    // `author`, so a member landing here means the guard swallowed the very
    // post this proof is about — which would look identical to a post that was
    // never delivered, and is why it is asserted rather than assumed.
    if (notifyLog.authored.length > 0) {
      failures.push(
        `the cycle break refused routing for [${notifyLog.authored.join(", ")}]; an operator's ` +
          `post carries no author and must reach the EM seat`,
      );
    }
    if (notifyLog.refusals.length > 0) {
      failures.push(`the fan-out recorded ${notifyLog.refusals.length} refusal(s): ${notifyLog.refusals.join("; ")}`);
    }
    if (failures.length > 0) return { failures, evidence: "" };

    evidence.push(
      `one post on ${lab.channelId} produced exactly one row (${TASK_ID}), with ` +
        `${expectedSkips.length} declared member(s) seen and skipped`,
    );

    // ---- the run --------------------------------------------------------
    await lab.drain(COORDINATOR_SEAT);
    const row = await settle(lab, SETTLE_TIMEOUT_MS);

    if (row?.status !== "completed") {
      failures.push(
        `the row settled "${row?.status ?? "never"}"; wanted "completed"` +
          `${row?.feedback === undefined ? "" : ` — ${row.feedback}`}`,
      );
    }

    // ---- BR-8, graded where the rule points: the board dispatch record ---
    const dispatches = await lab.dispatched(COORDINATOR_SEAT);
    const toReviewer = dispatches.filter((child) => child.flowId === REVIEWER_SEAT);
    if (toReviewer.length > 0) {
      failures.push(
        `${toReviewer.length} board dispatch(es) reached ${REVIEWER_SEAT}, which never receives work`,
      );
    }
    if (!dispatches.some((child) => child.flowId === ASSIGNED_SEAT)) {
      failures.push(
        `no board dispatch names ${ASSIGNED_SEAT}, so there is no record the row reached the ` +
          `seat it was addressed to`,
      );
    }

    // ---- BR-12: the prompt carried the seat's own files ------------------
    const prompt = prompts[0];
    if (prompt === undefined) {
      failures.push("the manager built no prompt, so the run was never reached");
    } else {
      for (const [token, home] of Object.entries(PROMPT_TOKEN_HOMES)) {
        if (!prompt.includes(token)) {
          failures.push(`the prompt does not carry ${token}, which lives only in ${home}`);
        }
      }
    }
    if (failures.length > 0) return { failures, evidence: "" };

    // ---- publish: the artifact gets an address (D1, S3) -----------------
    const cut = branchesUnder(dirs.sourceRepo, BRANCH_PREFIX);
    if (cut.length !== 1) {
      failures.push(`the run left ${cut.length} branch(es) under ${BRANCH_PREFIX}, wanted 1`);
      return { failures, evidence: "" };
    }
    branch = cut[0]!;
    publishArtifact(dirs.sourceRepo, [branch, BASE_REF]);
    evidence.push(`published ${branch} to ${ARTIFACT_REPO}`);
  } finally {
    await lab.dispose();
  }

  // =========================================================================
  // BR-1 — with nothing of the run still alive
  // =========================================================================
  //
  // The store is closed, the source repository and every checkout are gone.
  // What is left is the address. Everything below reads from it.

  rmSync(dirs.sourceRepo, { recursive: true, force: true });
  rmSync(dirs.root, { recursive: true, force: true });

  const published = branchesUnder(ARTIFACT_REPO, BRANCH_PREFIX);
  if (published.length !== 1 || published[0] !== branch) {
    failures.push(
      `the address holds [${published.join(", ")}] once the run is gone; wanted ${branch}`,
    );
    return { failures, evidence: "" };
  }

  const ahead = Number.parseInt(
    execFileSync("git", ["rev-list", "--count", `${BASE_REF}..${branch}`], {
      cwd: ARTIFACT_REPO,
      encoding: "utf8",
    }).trim(),
    10,
  );
  if (ahead < 1) {
    failures.push(`${branch} carries no commit that ${BASE_REF} does not have`);
    return { failures, evidence: "" };
  }
  evidence.push(`${branch} is ${ahead} commit(s) ahead of ${BASE_REF} at an address the run no longer holds`);

  // =========================================================================
  // BR-3 — both halves, off one checkout setup
  // =========================================================================

  const stage = mkdtempSync(join(tmpdir(), "devforce-accept-"));
  const producedTree = join(stage, "produced");
  const baseTree = join(stage, "base");
  cloneRef(ARTIFACT_REPO, branch!, producedTree);
  cloneRef(ARTIFACT_REPO, BASE_REF, baseTree);

  const producedVerdict = runAcceptance(producedTree);
  const baseVerdict = runAcceptance(baseTree);

  if (!producedVerdict.accepted) {
    failures.push(`the produced tree does not satisfy the brief — ${producedVerdict.reason}`);
  }
  if (baseVerdict.accepted) {
    failures.push(
      `the same check ACCEPTS the base ref, so it was already true before the run and is no ` +
        `evidence — ${baseVerdict.reason}`,
    );
  }
  if (failures.length === 0) {
    evidence.push(
      `the requester's check accepts the produced tree and rejects ${BASE_REF} ` +
        `(${baseVerdict.reason})`,
    );
  }

  // =========================================================================
  // BR-2 — the lab did not author what came back
  // =========================================================================

  let produced: string | undefined;
  try {
    produced = readFileSync(join(producedTree, ACCEPTANCE_MODULE), "utf8");
  } catch {
    failures.push(`the produced tree has no ${ACCEPTANCE_MODULE} to inspect`);
  }
  if (produced !== undefined) {
    const needle = normalize(produced);
    for (const [path, text] of artifactScan) {
      if (normalize(text).includes(needle)) {
        failures.push(`the artifact's content is also in ${path}, so the lab authored it`);
      }
    }
    const prompt = prompts[0] ?? "";
    if (normalize(prompt).includes(needle)) {
      failures.push("the artifact's content was handed to the seat in its own prompt");
    }
    evidence.push(
      `${ACCEPTANCE_MODULE} (${produced.length} bytes) appears in no lab file, no fixture and not ` +
        `in the prompt`,
    );
  }

  // =========================================================================
  // V4's control — the base-ref half can be made to go green
  // =========================================================================
  //
  // Built from the artifact the run produced rather than from an implementation
  // written here, for two reasons: writing one would put the answer in this
  // file, which is what BR-2 forbids one line above; and a base ref seeded with
  // the *actual* product is exactly the vacuous-green shape the rule is about.

  if (produced !== undefined) {
    const seeded = createScratchRepo("already-passing", {
      seed: { [ACCEPTANCE_MODULE]: produced },
    });
    try {
      const seededVerdict = runAcceptance(seeded.sourceRepo);
      if (!seededVerdict.accepted) {
        failures.push(
          `control already-passing: a base ref carrying the module was still REJECTED ` +
            `(${seededVerdict.reason}), so the base-ref half cannot be made to go green and ` +
            `proves nothing`,
        );
      } else {
        controls.push("already-passing red — the base-ref half ACCEPTS when the module is already there");
      }
    } finally {
      rmSync(seeded.sourceRepo, { recursive: true, force: true });
      rmSync(seeded.root, { recursive: true, force: true });
    }
  }

  rmSync(stage, { recursive: true, force: true });

  // =========================================================================
  // BR-11 — a fresh process reads the same file
  // =========================================================================

  // A separate process, not a re-opened handle: re-reading in the process that
  // wrote the file leaves it holding the caches, the registry and the open
  // connection, which is a weaker claim than BR-11 makes.
  const freshRead = spawnSync(
    "pnpm",
    ["tsx", REREAD, STORE_FILE, LAB_USER_ID, ROW_KEY, channelId],
    { encoding: "utf8", timeout: 120_000 },
  );
  if (freshRead.status !== 0) {
    failures.push(
      `a fresh process could not read the store back — ${(freshRead.stderr || freshRead.stdout).trim()}`,
    );
  } else {
    const seen = JSON.parse(freshRead.stdout.trim()) as {
      rowStatus: string | null;
      runRecords: number;
      runOutcome: string | null;
      transcriptLines: number | null;
    };
    if (seen.rowStatus !== "completed") {
      failures.push(`a fresh process read the row as "${seen.rowStatus}"; wanted "completed"`);
    }
    // Both halves: that a record survived, and that it carries what the run
    // reported. A row that re-read as an empty shell would satisfy a count and
    // would not be the run record BR-11 says is readable.
    if (seen.runRecords < 1) {
      failures.push("a fresh process found no run record over the same file");
    } else if (seen.runOutcome === null) {
      failures.push("the run record survived but carries no outcome, so it re-read as an empty shell");
    }
    if (seen.transcriptLines !== 1) {
      failures.push(
        `a fresh process read ${seen.transcriptLines} transcript line(s); wanted the one that was posted`,
      );
    }
    if (failures.length === 0) {
      evidence.push(
        `a fresh process over ${STORE_FILE} read the row "${seen.rowStatus}", ` +
          `${seen.runRecords} run record(s) reporting "${seen.runOutcome}" and ` +
          `${seen.transcriptLines} transcript line(s)`,
      );
    }
  }

  evidence.push(`leg: local bare repository, no gh, no token, no network`);
  evidence.push(`controls seen red — ${controls.join("; ")}`);

  return { failures, evidence: evidence.join("; ") };
});

