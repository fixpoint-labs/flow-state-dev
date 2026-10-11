/**
 * The DevTeam team profile: a software team (an EM that files features, a
 * coder that runs them, a reviewer) and its chief of staff, as a server Shift
 * Manager and `fsdev dev` load.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start
 *
 * The team is the tree beside this file, which the DevForce lab's checks
 * (`goals/devforce-lab/`) prove. One `FlowState`, default-exported, opened
 * through the same `openLab` those checks use, so a server and a check boot the
 * same tree the same way.
 * What a long-lived server asks of it that a check doesn't:
 *
 * - **The inventory, the projects and their workstreams.** The organization's
 *   worker collection is registered, which Shift Manager's TEAMS reads; the
 *   default projects are created as the Lab's owner; and Storefront's two
 *   workstreams, `feature` and `release`, are opened as the Lab's second user,
 *   each led by the EM.
 * - **One ask waiting.** The EM worker's approval for {@link ASK_FEATURE} is
 *   raised in its own session (which also turns durable execution on), so
 *   Inbox has something to answer. Approve files the row and starts the coder
 *   worker; Deny files nothing.
 * - **The page's connection.** The lab's user and verified bearer go to the
 *   page through the `devtool` block, which the host injects on a loopback
 *   bind only. A request with no bearer is refused, as in the checks.
 *
 * The harness is picked by `DEVFORCE_LAB_HARNESS` (see `harness.mts`): the
 * lab's scripted run by default, no model, which says what it is doing in the
 * run's session and commits one file so the row settles; or `claude-code`, a
 * real coding agent.
 *
 * - **Each project's own code.** The coder runs on a workspace host whose
 *   source is the project of the workstream a task was filed from: Storefront
 *   names a repository (a bare one beside the store, reached over `file://`,
 *   which the host allows), so its runs are branches of it with the project's
 *   files in `project/` beside the checkout; Sandbox names none, so a run there
 *   works on the project's files alone. No folder is named for any of it.
 *
 * - **A store that survives a restart.** SQLite, at `DEVTEAM_STORE` or
 *   `packages/shift-manager/.fsdev/devteam.sqlite` by default. Workers the chief of
 *   staff hired are read back and serve again at the next start, a fire it
 *   made stays made, and an ask still waiting is still in Inbox. Delete the
 *   file for a fresh start.
 *
 * Which worker is the EM and which worker its doors file for are read off the
 * tree: the EM by the worker flow its `WORKER.md` names, the coder as its first
 * delegate on the coder worker flow.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { AskFeature } from "./ask.mts";
import { selectHarness } from "./harness.mts";
import { LAB_CROWD, LAB_ORG_ID, LAB_TREE, LAB_USERS, openLab } from "./host.mts";
import { createBareRemote } from "./scratch-repo.mts";
import { CODER_FLOW } from "./workforce/flows/workers/coder.mts";
import { EM_FLOW } from "./workforce/flows/workers/em.mts";
import { setAsideLegacyOrgStore, setAsidePreRenameStore } from "./legacy-org-store.mts";

/**
 * The feature the EM worker asks a person to approve when the server opens, from
 * `ask.json` beside this file. Data, not code: the lab's asking check refuses a
 * lab module that spells a feature, and brings its own held-out one. Its
 * `issue` keys the ask's claim in the store, so changing it raises a new ask.
 */
const ASK_FEATURE = JSON.parse(readFileSync(fileURLToPath(new URL("./ask.json", import.meta.url)), "utf8")) as AskFeature;

/** Where this Lab keeps what it was told, across restarts. */
const STORE = process.env.DEVTEAM_STORE ?? fileURLToPath(new URL("../../.fsdev/devteam.sqlite", import.meta.url));
mkdirSync(dirname(STORE), { recursive: true });

/**
 * Storefront's repository: a bare one beside the store, made once and kept, so
 * the project row a restart reads back still names a remote that exists.
 */
const storefrontRemote = createBareRemote("devteam-storefront", { at: join(dirname(STORE), "devteam-storefront.git") });

/**
 * The Lab's three default projects, created at start as the Lab's owner with
 * the second user as a member, unless the store already holds them.
 *
 * A project belongs to the organization, not a team: `storefront` names its
 * repository, and its workstreams are opened below. The other two hold none
 * yet; `sandbox` has no repository, so coding work moved onto it runs on its
 * files.
 */
const DEFAULT_PROJECTS = [
  {
    id: "storefront",
    title: "Storefront",
    brief: "Get the storefront feature built and released: engineering builds it, operations ships it.",
    members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)],
    repository: storefrontRemote.url,
  },
  {
    id: "platform",
    title: "Platform",
    brief: "Shared groundwork no single feature owns. It holds no workstream yet.",
    members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)],
  },
  {
    id: "sandbox",
    title: "Sandbox",
    brief: "A prototype from scratch: no repository, so its coding work runs on the project's own files.",
    members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)],
  },
];

// Read off the tree: the EM, and the coder its doors file for, its first
// delegate on the coder worker flow.
const roster = await readDeclaredRoster(LAB_TREE);
const workerFlowOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const em = roster.workers.find((w) => w.declared.flow === EM_FLOW);
if (em === undefined) throw new Error("the DevTeam tree declares no EM");
const coderWorkerId = ((em.declared.delegates as string[] | undefined) ?? []).find((id) => workerFlowOf(id) === CODER_FLOW);
if (coderWorkerId === undefined) throw new Error(`the DevTeam's EM "${em.id}" names no delegate on the coder worker flow`);

/**
 * Storefront's two workstreams, `feature` and `release`, each led by the EM.
 * Opened as the Lab's second user, not its owner: a workstream belongs to the
 * person who opens it, and the owner opens her own from the app.
 */
const DEFAULT_WORKSTREAMS = [
  { id: "feature", title: "Feature", objectives: ["Build the storefront feature"] },
  { id: "release", title: "Release", objectives: ["Ship what engineering finished"] },
].map((workstream) => ({
  as: "member" as const,
  input: { project: { visibility: "shared" as const, id: "storefront" }, lead: em.id, ...workstream },
}));

// A store from before the lab's org id changed is set aside, loudly, not reused.
await setAsideLegacyOrgStore(STORE);
// So is one from before mailboxes were renamed.
await setAsidePreRenameStore(STORE, { mailboxIds: roster.mailboxes.map((m) => m.id), orgIds: [LAB_ORG_ID] });

const harness = selectHarness();

const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: harness.slot,
  runTimeoutMs: harness.runTimeoutMs,
  // Runs' places and the host's clones, beside the store; only `file://` remotes are reached.
  workspace: { root: join(dirname(STORE), "devteam-runs"), remotes: { allow: ["file"] } },
  coderWorkerId,
  inventory: true,
  ask: ASK_FEATURE,
  devtool: true,
  projects: DEFAULT_PROJECTS,
  workstreams: DEFAULT_WORKSTREAMS,
  // The shift coordinator records each conversation into its memory only when asked.
  memoryCapture: process.env.DEVTEAM_MEMORY_CAPTURE === "1",
});

export default lab.state;
