/**
 * Goal check — conductor drives one issue to a merge-ready branch.
 *
 * The real path throughout: the `conductor-self-drive` example's own
 * `conductor.config.ts`, resolved by `resolveConductor` against this checkout;
 * the dispatcher discovery that picks whichever coding harness is installed; a
 * real git remote; and a real agent run doing the coding. Nothing is mocked and
 * nothing is stubbed — see goal.md for the contract and the anti-game rules.
 *
 * **This fails today, for one reason: conductor has no tick.** The model, the
 * driver, the GitHub reader, the dispatcher seam, branch policy, and the config
 * layer all exist; nothing assembles them, persists a ledger, or fronts them
 * with a CLI. So the runner does its preflight for real — resolving the config,
 * reporting what discovery found — and then fails with the list of what is
 * missing rather than a stack trace. That list is M1's definition of done.
 *
 * Shape:
 *
 *   preflight   resolve the example's config; assert level 1 discovered it all
 *   require     the tick surface — FAILS TODAY, legibly
 *   drive       manage one work item, tick until it reaches a human gate
 *   stability   tick again with an unchanged world: zero rows, zero dispatches
 *   restart     drop the session, re-open over the same state, tick: no double
 *               dispatch, no lost gate, no phase move
 *   grade       cut a worktree from the pushed branch and RUN the example on it,
 *               against held-out cases the coding harness never saw
 *   never-merge the base branch points at the same commit it started at
 *
 * Run: pnpm tsx goals/conductor/drives-one-issue-to-a-merge-ready-branch/run.mts
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as conductor from "@flow-state-dev/conductor";
import {
  ConductorConfigError,
  decide,
  resolveConductor,
  type ConductorConfig,
  type ConductorEntity,
  type Gate,
  type IssueType,
  type LedgerEntryState,
  type Phase,
  type ResolvedConductor,
} from "@flow-state-dev/conductor";
import {
  goalTmpDir,
  loadFixture,
  repoPath,
  runGoal,
  RUN_STAMP,
} from "../../lib/index.mts";

/* ------------------------------------------------------------------------- *
 * The acceptance contract
 *
 * Every TYPE below is conductor's own. Only the four method names are this
 * goal's proposal for M1's tick surface, and they are the one thing to update
 * if M1 lands with different ones — the assertions further down are about
 * behaviour and do not care what it is called.
 * ------------------------------------------------------------------------- */

/** A work item as conductor currently holds it, read back from durable state. */
interface ManagedWork {
  readonly entity: ConductorEntity;
  /** The gate derived from this tick's world — never a stored one. */
  readonly gate: Gate | null;
  /** The entity's ledger rows, ordered by `seq`. */
  readonly ledger: readonly LedgerEntryState[];
  /** How many dispatches have been performed for this entity, ever. */
  readonly dispatchCount: number;
}

/** What conductor is asked to take on. */
interface WorkItem {
  readonly id: string;
  readonly kind: "issue";
  readonly issueType: IssueType;
  /** The phase the item enters at. A bug enters at implementation. */
  readonly phase: Phase;
  /** What the work item asks for, in plain language. Carried into the brief. */
  readonly summary: string;
}

/** One conductor process's handle on durable state. Re-opening it is a restart. */
interface ConductorSession {
  /** Put a work item under management. Idempotent on `id`. */
  manage(item: WorkItem): Promise<ManagedWork>;
  /** One tick: read the world, reduce, execute the actions, append the ledger. */
  tick(entityId: string): Promise<ManagedWork>;
  /** Read the item back without ticking. */
  read(entityId: string): Promise<ManagedWork>;
}

/** The M1 entry point this goal drives. */
interface ConductorRuntime {
  openConductor(input: {
    readonly config: ResolvedConductor;
    /** Durable location the ledger, entities, and observations live in. */
    readonly statePath: string;
  }): Promise<ConductorSession>;
}

/**
 * The tick surface, or `null` when M1 has not built it.
 *
 * A name probe rather than a shim: nothing fake is ever substituted, so a run
 * that gets past this line is a run against the real thing.
 */
function conductorRuntime(): ConductorRuntime | null {
  const ns = conductor as unknown as Record<string, unknown>;
  return typeof ns.openConductor === "function" ? (ns as unknown as ConductorRuntime) : null;
}

/* ------------------------------------------------------------------------- *
 * Fixtures, paths, and the small amount of shelling out this needs
 * ------------------------------------------------------------------------- */

interface WorkItemFixture {
  /** The operation conductor is asked to add. */
  readonly operation: string;
  /** The work item text. The only thing the coding harness is shown. */
  readonly brief: string;
  /** Held out from the harness entirely; the only thing the result is graded on. */
  readonly cases: readonly { readonly input: string; readonly expected: string }[];
}

const fixture = loadFixture<WorkItemFixture>(import.meta.url, "work-item.json");

const EXAMPLE_DIR = repoPath("examples", "conductor-self-drive");
/** Repo-relative, so it resolves inside a worktree cut from the produced branch. */
const EXAMPLE_CLI = join("examples", "conductor-self-drive", "src", "cli.ts");

const TMP = goalTmpDir("conductor-self-drive");
const STATE_PATH = join(TMP, "state");

const WORK_ID = `GOAL-${RUN_STAMP}`;
const OPEN_PR = process.env.CONDUCTOR_GOAL_OPEN_PR === "1";
const KEEP_BRANCH = process.env.CONDUCTOR_GOAL_KEEP_BRANCH === "1";

/** Gates only a human releases. Reaching one is where an unattended drive stops. */
const HUMAN_GATES = new Set<Gate>([
  "awaiting_spec_approval",
  "awaiting_review",
  "awaiting_merge",
  "awaiting_objective_approval",
]);

/** Ticks allowed before the drive is called a loop. */
const TICK_CAP = 20;

interface Ran {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

function run(bin: string, args: readonly string[], cwd: string): Ran {
  const result = spawnSync(bin, [...args], { cwd, encoding: "utf8" });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? (result.error ? String(result.error) : ""),
  };
}

const git = (args: readonly string[], cwd: string): Ran => run("git", args, cwd);

/** The repo's own `tsx`, so the example runs in a worktree with no node_modules. */
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");

/** Run the example's real command line inside a checkout of it. */
function exampleCli(checkout: string, args: readonly string[]): Ran {
  return run(process.execPath, [TSX_CLI, join(checkout, EXAMPLE_CLI), ...args], checkout);
}

/* ------------------------------------------------------------------------- *
 * Assertions over the ledger
 * ------------------------------------------------------------------------- */

/**
 * Check that no phase moved outside a recorded action, and that each row's
 * recorded action is the one `decide` actually produces from that row's own
 * arguments.
 *
 * The structural half — `seq` contiguity, an unbroken `phaseBefore`/`phaseAfter`
 * chain, `enterPhase` as the only action a phase change may ride on, the stored
 * phase agreeing with the last row — catches a phase that moved outside the
 * ledger. It does not catch a chain that is internally consistent and entirely
 * made up, which is what {@link replayFailures} is for.
 */
function ledgerFailures(
  ledger: readonly LedgerEntryState[],
  startPhase: Phase,
  storedPhase: Phase,
): string[] {
  const failures: string[] = [];
  if (ledger.length === 0) {
    return ["the ledger is empty — conductor recorded no transition for this item"];
  }

  let expectedSeq = 1;
  let expectedPhase: string = startPhase;
  for (const row of ledger) {
    if (row.seq !== expectedSeq) {
      failures.push(
        `ledger seq is not contiguous: expected ${expectedSeq}, got ${row.seq} ` +
          `(a hole means a transition was recorded somewhere else, or not at all)`,
      );
    }
    expectedSeq = row.seq + 1;

    if (row.phaseBefore !== expectedPhase) {
      failures.push(
        `ledger row ${row.seq} starts from phase "${row.phaseBefore}" but the previous ` +
          `row left the entity in "${expectedPhase}" — the chain is broken, so something ` +
          `moved the phase outside the ledger`,
      );
    }
    if (row.phaseBefore !== row.phaseAfter && row.actionKind !== "enterPhase") {
      failures.push(
        `ledger row ${row.seq} moved the phase from "${row.phaseBefore}" to ` +
          `"${row.phaseAfter}" on action "${row.actionKind}" — only enterPhase may move a phase`,
      );
    }
    expectedPhase = row.phaseAfter;
  }

  if (expectedPhase !== storedPhase) {
    failures.push(
      `the stored phase is "${storedPhase}" but the ledger's last row leaves the entity ` +
        `in "${expectedPhase}" — the phase moved without being recorded`,
    );
  }
  return failures;
}

/**
 * Re-run `decide` from each row's own recorded arguments and require it to
 * produce that row's action.
 *
 * This is the literal reading of the invariant, and the reason the schema
 * carries `signal` and `world` at all: a row that records an action `decide`
 * would not take from the state the row itself recorded is a row written as
 * decoration. Nothing here is hand-built — the entity, the signal and the world
 * all come out of the row.
 *
 * A row whose payload is `null` predates those fields (BP-030). It is reported
 * as unreplayable rather than counted as a pass, so a driver that stopped
 * writing the payload shows up as coverage falling to zero rather than as green.
 */
function replayFailures(ledger: readonly LedgerEntryState[]): {
  readonly failures: readonly string[];
  readonly replayed: number;
} {
  const failures: string[] = [];
  let replayed = 0;

  for (const row of ledger) {
    if (row.signal === null || row.world === null || row.entityKind === null) {
      failures.push(
        `ledger row ${row.seq} carries no ${row.signal === null ? "signal" : row.world === null ? "world" : "entity kind"} — ` +
          `the transition it records cannot be re-run, so "reproducible from the ledger" ` +
          `does not hold for it`,
      );
      continue;
    }

    const produced = decide(
      { id: row.entityId, kind: row.entityKind, phase: row.phaseBefore as Phase },
      row.signal,
      row.world,
    ).map((action): string => action.kind);

    if (!produced.includes(row.actionKind)) {
      failures.push(
        `replaying ledger row ${row.seq} produced [${produced.join(", ") || "nothing"}] but the ` +
          `row records "${row.actionKind}" — the recorded action is not what \`decide\` derives ` +
          `from the signal and world the row itself carries`,
      );
    }
    replayed += 1;
  }

  return { failures, replayed };
}

/* ------------------------------------------------------------------------- *
 * The check
 * ------------------------------------------------------------------------- */

await runGoal(async () => {
  const failures: string[] = [];

  // — preflight: the example's config, resolved for real —

  const configModule = (await import(
    pathToFileURL(join(EXAMPLE_DIR, "conductor.config.ts")).href
  )) as { default?: ConductorConfig };
  const declared = configModule.default;
  if (!declared) {
    return {
      failures: [`${EXAMPLE_DIR}/conductor.config.ts has no default export`],
      evidence: "",
    };
  }

  let resolved: ResolvedConductor;
  try {
    resolved = await resolveConductor(declared, { cwd: EXAMPLE_DIR });
  } catch (error) {
    if (error instanceof ConductorConfigError) {
      return {
        failures: [
          `BLOCKED — discovery could not answer for "${error.field}": ${error.message}`,
        ],
        evidence: "",
      };
    }
    throw error;
  }

  // Level 1 means the example configured nothing. If any of these says
  // "configured", the config file has grown a field discovery should have covered.
  for (const [field, origin] of Object.entries(resolved.origins)) {
    if (origin !== "discovered") {
      failures.push(
        `the example configured "${field}" — level 1 is meant to discover it, so either ` +
          `discovery regressed or the example stopped being level 1`,
      );
    }
  }

  const discovered =
    `${resolved.repo.owner}/${resolved.repo.repo} on ${resolved.repo.host}, base ` +
    `"${resolved.baseBranch}", dispatcher "${resolved.dispatcher.vendor}" ` +
    `(isolation "${resolved.dispatcher.isolation}"), repo root ${resolved.repoRoot}`;

  // — require the tick —

  const runtime = conductorRuntime();
  if (!runtime) {
    return {
      failures: [
        `@flow-state-dev/conductor exports no \`openConductor\` — the tick does not exist yet.`,
        `What resolved fine: the example's level-1 config → ${discovered}.`,
        `What M1 still owes, and this goal is waiting on:`,
        `  - the tick that composes pollGitHub → reconcile → decide → dispatch → ledger`,
        `  - persistence for the entity, artifact, dispatch, observation and ledger`,
        `    collections declared in src/model/entities.ts (they are declared, never registered)`,
        `  - phase execution: turning a DispatchAction into a provisioned workspace, a brief,`,
        `    and a settled DispatchResult fed back as a signal`,
        `  - an entry point that opens durable state so a restart re-attaches to it`,
        `See goal.md → "What this needs before it can pass" for the contract asserted here.`,
      ],
      evidence: "",
    };
  }

  // — the base branch, before anything runs —

  const fetchBase = git(["fetch", "origin", resolved.baseBranch], resolved.repoRoot);
  if (fetchBase.code !== 0) {
    return {
      failures: [`BLOCKED — could not fetch origin/${resolved.baseBranch}: ${fetchBase.stderr}`],
      evidence: "",
    };
  }
  const baseShaBefore = git(["rev-parse", "FETCH_HEAD"], resolved.repoRoot).stdout.trim();

  // — drive —

  const summary = [
    fixture.brief,
    "",
    OPEN_PR
      ? "Commit on this branch, push it, and open a pull request for it."
      : "Commit on this branch and push it. Do not open a pull request.",
  ].join("\n");

  const item: WorkItem = {
    id: WORK_ID,
    kind: "issue",
    // A bug enters at implementation — SPEC's exit is a human approval gate, which
    // an unattended drive correctly cannot pass. Conductor does not derive this
    // from `issueType` today; the caller states it. See goal.md.
    issueType: "Bug" satisfies IssueType,
    phase: "IMPLEMENTATION",
    summary,
  };

  const session = await runtime.openConductor({ config: resolved, statePath: STATE_PATH });
  let managed = await session.manage(item);
  const startPhase = managed.entity.phase;

  let ticks = 0;
  let settled = false;
  while (ticks < TICK_CAP) {
    const before = managed;
    managed = await session.tick(WORK_ID);
    ticks += 1;

    if (managed.entity.phase === "SETTLED") {
      settled = true;
      break;
    }
    if (managed.gate !== null && HUMAN_GATES.has(managed.gate)) {
      settled = true;
      break;
    }
    if (
      managed.ledger.length === before.ledger.length &&
      managed.dispatchCount === before.dispatchCount
    ) {
      // Quiescent: nothing changed and nothing was dispatched, so there is
      // nothing left for conductor to do without the world moving.
      settled = true;
      break;
    }
  }
  if (!settled) {
    failures.push(
      `the drive did not reach a gate or quiesce within ${TICK_CAP} ticks — it is looping ` +
        `(last phase "${managed.entity.phase}", gate "${managed.gate}", ` +
        `${managed.ledger.length} ledger rows, ${managed.dispatchCount} dispatches)`,
    );
  }

  const atGate = managed;

  // — signal 3: nothing moved the phase outside the ledger, and every row
  //   replays to the action it recorded —

  failures.push(...ledgerFailures(atGate.ledger, startPhase, atGate.entity.phase));
  const replay = replayFailures(atGate.ledger);
  failures.push(...replay.failures);

  // — signal 4: no coordinator model call decided a transition —
  //
  // Two identical reads of an unchanged world must produce identical answers. A
  // reducer that consulted a model would not be stable across them.

  const stable = await session.tick(WORK_ID);
  if (stable.ledger.length !== atGate.ledger.length) {
    failures.push(
      `ticking again against an unchanged world appended ${stable.ledger.length - atGate.ledger.length} ` +
        `ledger row(s) — the tick is not stable, so something other than the world decided a transition`,
    );
  }
  if (stable.dispatchCount !== atGate.dispatchCount) {
    failures.push(
      `ticking again against an unchanged world dispatched again ` +
        `(${atGate.dispatchCount} → ${stable.dispatchCount})`,
    );
  }

  // — signal 5: killed mid-gate, restarted, continues —
  //
  // Dropping the handle and opening a new one over the same durable state is the
  // restart. Nothing in-process carries over, which is the whole point: a gate is
  // derived every tick, so there is no remembered gate to lose.

  const restarted = await runtime.openConductor({ config: resolved, statePath: STATE_PATH });
  const reattached = await restarted.read(WORK_ID);
  if (reattached.gate !== atGate.gate) {
    failures.push(
      `after the restart the derived gate is "${reattached.gate}", not "${atGate.gate}" — the gate was lost`,
    );
  }
  if (reattached.entity.phase !== atGate.entity.phase) {
    failures.push(
      `after the restart the phase is "${reattached.entity.phase}", not "${atGate.entity.phase}"`,
    );
  }
  if (reattached.dispatchCount !== atGate.dispatchCount) {
    failures.push(
      `re-opening durable state changed the dispatch count ` +
        `(${atGate.dispatchCount} → ${reattached.dispatchCount}) without ticking`,
    );
  }

  const afterRestartTick = await restarted.tick(WORK_ID);
  if (afterRestartTick.dispatchCount !== atGate.dispatchCount) {
    failures.push(
      `the first tick after the restart dispatched again ` +
        `(${atGate.dispatchCount} → ${afterRestartTick.dispatchCount}) — the work was redone, not resumed`,
    );
  }
  const newRows = afterRestartTick.ledger.slice(atGate.ledger.length);
  const rePhased = newRows.filter((row) => row.actionKind === "enterPhase");
  if (rePhased.length > 0) {
    failures.push(
      `the first tick after the restart moved the phase (${rePhased
        .map((row) => `${row.phaseBefore}→${row.phaseAfter}`)
        .join(", ")}) — the gate was re-derived as released when it is not`,
    );
  }
  if (afterRestartTick.gate !== atGate.gate) {
    failures.push(
      `after restarting and ticking, the gate is "${afterRestartTick.gate}", not "${atGate.gate}"`,
    );
  }

  // — signal 2: a merge-ready branch, graded by running the example on it —

  const branch = `fix/${WORK_ID}`;
  const onOrigin = git(["ls-remote", "--exit-code", "--heads", "origin", branch], resolved.repoRoot);
  let branchSha = "";
  if (onOrigin.code !== 0) {
    failures.push(`no branch \`${branch}\` on origin — conductor produced nothing to merge`);
  } else {
    git(["fetch", "origin", branch], resolved.repoRoot);
    branchSha = git(["rev-parse", "FETCH_HEAD"], resolved.repoRoot).stdout.trim();
    const ahead = git(
      ["rev-list", "--count", `${baseShaBefore}..${branchSha}`],
      resolved.repoRoot,
    ).stdout.trim();
    if (!(Number(ahead) > 0)) {
      failures.push(`\`${branch}\` is not ahead of ${resolved.baseBranch} — it carries no commits`);
    }

    const checkout = join(TMP, "graded");
    const added = git(["worktree", "add", "--detach", checkout, branchSha], resolved.repoRoot);
    if (added.code !== 0) {
      failures.push(`could not check out \`${branch}\` to grade it: ${added.stderr}`);
    } else {
      const verified = exampleCli(checkout, ["--verify"]);
      if (verified.code !== 0) {
        failures.push(
          `the example's registry does not hold together on \`${branch}\`: ${verified.stderr.trim() || verified.stdout.trim()}`,
        );
      }

      const listed = exampleCli(checkout, ["--list"]);
      const names = listed.stdout
        .split("\n")
        .map((line) => line.split("\t")[0]!.trim())
        .filter((name) => name !== "");
      if (!names.includes(fixture.operation)) {
        failures.push(
          `\`${fixture.operation}\` is not in the registry the example renders (--list gave: ` +
            `${names.join(", ") || "nothing"}) — a function in the file is not a registered operation`,
        );
      }

      for (const testCase of fixture.cases) {
        const ran = exampleCli(checkout, [fixture.operation, testCase.input]);
        const got = ran.stdout.replace(/\n$/, "");
        if (ran.code !== 0) {
          failures.push(
            `running \`${fixture.operation}\` on ${JSON.stringify(testCase.input)} exited ` +
              `${ran.code}: ${ran.stderr.trim()}`,
          );
          continue;
        }
        if (got !== testCase.expected) {
          failures.push(
            `\`${fixture.operation}\` on ${JSON.stringify(testCase.input)} printed ` +
              `${JSON.stringify(got)}, expected ${JSON.stringify(testCase.expected)}`,
          );
        }
      }

      git(["worktree", "remove", "--force", checkout], resolved.repoRoot);
    }
  }

  // — the PR half, only when asked for —

  if (OPEN_PR && atGate.gate !== "awaiting_review") {
    failures.push(
      `with CONDUCTOR_GOAL_OPEN_PR=1 the drive should stop at "awaiting_review" — the human ` +
        `gate conductor waits at and never releases — but it stopped at "${atGate.gate}"`,
    );
  }

  // — signal 6: conductor never merges —

  git(["fetch", "origin", resolved.baseBranch], resolved.repoRoot);
  const baseShaAfter = git(["rev-parse", "FETCH_HEAD"], resolved.repoRoot).stdout.trim();
  if (baseShaAfter !== baseShaBefore) {
    failures.push(
      `origin/${resolved.baseBranch} moved from ${baseShaBefore.slice(0, 8)} to ` +
        `${baseShaAfter.slice(0, 8)} during the run — conductor never merges`,
    );
  }

  // A passing run cleans up after itself; a failing one leaves the branch to look at.
  if (failures.length === 0 && !KEEP_BRANCH && !OPEN_PR && branchSha !== "") {
    git(["push", "origin", "--delete", branch], resolved.repoRoot);
  }

  return {
    failures,
    evidence:
      `level 1 config discovered ${discovered}; conductor drove ${WORK_ID} in ${ticks} tick(s) ` +
      `to phase "${atGate.entity.phase}" at gate "${atGate.gate}" over ${atGate.ledger.length} ` +
      `ledger rows and ${atGate.dispatchCount} dispatch(es); the seq/phase chain is contiguous and ` +
      `the stored phase matches its last row; all ${replay.replayed} row(s) re-ran through ` +
      `\`decide\` from their own recorded signal and world and produced the action they record; ` +
      `a further tick against an unchanged world appended ` +
      `nothing and dispatched nothing; re-opening durable state and ticking kept the same gate, ` +
      `phase and dispatch count; \`${branch}\` on origin runs the example green for all ` +
      `${fixture.cases.length} held-out \`${fixture.operation}\` cases and lists it in the registry; ` +
      `origin/${resolved.baseBranch} never moved.`,
  };
});
