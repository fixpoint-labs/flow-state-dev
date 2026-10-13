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
 *   remote ({@link REPOSITORY}).
 * - **Nothing else at open**: no ask waiting in Inbox and no workstream, so a
 *   user's first act is asking for work.
 * - **Claude Code as the coder by default** (`harness.mts`): at start the Lab
 *   asks Claude Code for an account and refuses to start without one, naming
 *   what to set. `DEVFORCE_LAB_HARNESS=stub` runs the scripted coder instead.
 * - **Runs work in this checkout.** A coding run on FSD or Shift Manager gets
 *   a fresh worktree of the checkout this file sits in, on a branch of its
 *   own cut from the newer of local `main` and its upstream ({@link CHECKOUTS},
 *   in `fsd-checkouts.mts`). The checkout's location is worked out from that
 *   file's, never written down.
 * - **No remote is cloned.** The workspace hosts allow none, so a run the
 *   mapping misses (a project a user made, or one in another organization) is
 *   refused, naming the remote, and nothing is cloned. The one remote reached
 *   is the checkout's own upstream, fetched before a new run's branch is cut.
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
import { CHECKOUTS, REPOSITORY } from "./fsd-checkouts.mts";
import { startHarness } from "./harness.mts";
import { LAB_CROWD, LAB_TREE, LAB_USERS, openLab } from "./host.mts";
import { CODER_FLOW } from "./workforce/flows/workers/coder.mts";
import { EM_FLOW } from "./workforce/flows/workers/em.mts";

/** Where this Lab keeps what it was told, across restarts. */
const STORE = process.env.FSD_STORE ?? fileURLToPath(new URL("../../.fsdev/fsd.sqlite", import.meta.url));
mkdirSync(dirname(STORE), { recursive: true });

/** Who may open workstreams in each project: the Lab's other users, as in DevTeam's. */
const OTHER_USERS = [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)];

/** The two projects a fresh open shows. */
const PROJECTS = [
  {
    id: "fsd",
    title: "FSD",
    brief: "The framework: the packages under packages/ other than Shift Manager, their docs and their goal checks.",
    members: OTHER_USERS,
    repository: REPOSITORY,
  },
  {
    id: "shift-manager",
    title: "Shift Manager",
    brief: "This app: packages/shift-manager, its pages, its team profiles and its checks under goals/shift-manager/.",
    members: OTHER_USERS,
    repository: REPOSITORY,
  },
];

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
  inventory: true,
  devtool: true,
  projects: PROJECTS,
  memoryCapture: process.env.DEVTEAM_MEMORY_CAPTURE === "1",
});

export default lab.state;
