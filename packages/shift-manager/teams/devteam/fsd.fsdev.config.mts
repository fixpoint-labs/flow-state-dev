/**
 * The `fsd` team profile: a Lab for working on this repository with Shift
 * Manager itself. What `pnpm shift-manager:dev` opens with no `--config`.
 *
 *     pnpm shift-manager:dev
 *     DEVFORCE_LAB_HARNESS=stub pnpm shift-manager:dev     # the scripted coder, no credential
 *
 * The same tree as DevTeam's profile (`fsdev.config.mts`), opened through the
 * same `openLab`. What differs:
 *
 * - **Two projects, FSD and Shift Manager**, created at start as the Lab's
 *   owner, with the project members DevTeam's projects have, unless the store
 *   already holds them. Both are shared, and both name this repository's
 *   remote, and both name Linear's MCP server (`fsd-projects.mts`).
 * - **Linear, for a coding run.** The Lab offers Linear's hosted MCP server,
 *   and a run on either project reads Linear with the key of the user it runs
 *   for, set on Settings. `LINEAR_MCP_API_KEY` stands in for the Lab's own
 *   user's key until that user stores one.
 * - **Its own coder brief and commit style** ({@link FSD_DOCUMENTS},
 *   {@link FSD_SKILLS}), in place of the tree's.
 * - **Nothing else at open**: no ask waiting in Inbox and no workstream, so a
 *   user's first act is asking for work.
 * - **Claude Code as the coder by default** (`harness.mts`): at start the Lab
 *   asks Claude Code for an account and refuses to start without one, naming
 *   what to set. `DEVFORCE_LAB_HARNESS=stub` runs the scripted coder instead.
 * - **A coding run waits for your review.** A run that made commits holds its
 *   task in Inbox, *Ready for review* with the judge's line, until you Accept
 *   or Ask for changes (harness-manager's `reviewChanges`).
 * - **Runs work in this checkout.** A coding run on FSD or Shift Manager gets
 *   a fresh worktree of the checkout this file sits in, on a branch of its
 *   own cut from the newer of local `main` and its upstream ({@link CHECKOUTS},
 *   in `fsd-checkouts.mts`). The checkout's location is worked out from that
 *   file's, never written down.
 * - **No remote is cloned.** The workspace hosts allow none, so a run the
 *   mapping misses (a project a user made, or one in another organization) is
 *   refused, naming the remote, and nothing is cloned. The one remote reached
 *   is the checkout's own upstream, fetched before a new run's branch is cut.
 * - **The Error Reporter**, with Claude Code: every request that stays
 *   failed and every task that ends errored becomes one report, previewed in
 *   Inbox and filed in FSD's Linear once the Lab's user answers. Its worker
 *   is the tree's `error-reporter`. It drafts with Claude Code even when the
 *   coder is scripted, and a draft waits for an account when there is none.
 * - **Its own store**: SQLite at `FSD_STORE` or
 *   `packages/shift-manager/.fsdev/fsd.sqlite`. DevTeam's rows never show
 *   here. Delete the file for a fresh start.
 *
 * The default export is the Lab's `FlowState`, as every fsdev config's is.
 * {@link lab} is the Lab itself, for checks that drive it in-process.
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { CHECKOUT, CHECKOUTS } from "./fsd-checkouts.mts";
import { FSD_DOCUMENTS, FSD_MCP_SERVERS, FSD_PROJECTS, FSD_SKILLS } from "./fsd-projects.mts";
import { readClaudeUsage } from "@flow-state-dev/claude-code/sdk";
import { claudeCodeEnv, errorReporterHarness, startHarness } from "./harness.mts";
import { LAB_TREE, openLab } from "./host.mts";
import { CODER_FLOW } from "./workforce/flows/workers/coder.mts";
import { EM_FLOW } from "./workforce/flows/workers/em.mts";

/** Where this Lab keeps what it was told, across restarts. */
const STORE = process.env.FSD_STORE ?? fileURLToPath(new URL("../../.fsdev/fsd.sqlite", import.meta.url));
mkdirSync(dirname(STORE), { recursive: true });

// Read off the tree, as DevTeam's profile reads it: the EM, and the coder its
// doors file for, its first delegate on the coder worker flow.
const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
if (em === undefined) throw new Error("the DevTeam tree declares no EM");
const coderWorkerId = ((em.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error(`the DevTeam's EM "${em.id}" names no delegate on the coder worker flow`);

// Before anything is opened: with no Claude Code account this throws, and the Lab never listens.
const harness = await startHarness("claude-code");

/** The Lab this profile serves. */
export const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: harness.slot,
  runTimeoutMs: harness.runTimeoutMs,
  // Runs' places beside the store, the two projects' worktrees of this checkout
  // among them. No remote is allowed: a run is never cloned from one.
  workspace: { root: join(dirname(STORE), "fsd-runs"), remotes: { allow: [] }, checkouts: CHECKOUTS },
  coderWorkerId,
  // A coding run that committed waits in Inbox for the user's review before its task completes.
  reviewChanges: true,
  inventory: true,
  devtool: true,
  projects: FSD_PROJECTS,
  mcpServers: FSD_MCP_SERVERS,
  documents: FSD_DOCUMENTS,
  skills: FSD_SKILLS,
  memoryCapture: process.env.DEVTEAM_MEMORY_CAPTURE === "1",
  // The Error Reporter files into FSD's Linear, through the FSD project's MCP
  // servers with the Lab user's key, and drafts with Claude Code from this
  // checkout's code, whichever coder the Lab runs.
  errorReporter: { harness: errorReporterHarness, cwd: CHECKOUT, tracker: { project: "shared/fsd" } },
  // Who Claude Code is signed in as, read when someone opens Usage; its
  // windows come from the coder's runs.
  usage: {
    "claude-code": ({ signal } = {}) => readClaudeUsage({ env: claudeCodeEnv(), ...(signal === undefined ? {} : { signal }) }),
  },
});

export default lab.state;
