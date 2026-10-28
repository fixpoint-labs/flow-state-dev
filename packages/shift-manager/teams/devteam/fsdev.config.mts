/**
 * The DevTeam team profile: a software team (an EM that files features, a
 * coder that runs them, a reviewer) and its Shift Coordinator, as a server Shift
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
 * lab's scripted run by default (this profile's; the `fsd` profile's is Claude Code), no model, which says what it is doing in the
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
 * - **The Error Reporter.** A request that stays failed, or a task that ends
 *   errored, becomes one report in Inbox, drafted by Claude Code from this
 *   checkout's code. This team names no tracker, so reports are kept, not
 *   filed; a draft needs a Claude Code account, and waits for one otherwise.
 *
 * - **Usage left.** Usage shows how much of each Codex window this machine's
 *   Codex sign-in has used, read from the Codex CLI when someone looks, at
 *   most once a minute. Nothing is read until then. For Claude Code, a look
 *   reads who is signed in, and each window comes from a coding run, as
 *   Claude Code reports it.
 *
 * - **A store that survives a restart.** SQLite, at `DEVTEAM_STORE` or
 *   `packages/shift-manager/.fsdev/devteam.sqlite` by default. Workers the Shift
 *   Coordinator hired are read back and serve again at the next start, a fire it
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
import { readClaudeUsage } from "@flow-state-dev/claude-code/sdk";
import { readCodexUsage } from "@flow-state-dev/codex";
import { harnessEnv } from "@flow-state-dev/core";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { AskFeature } from "./ask.mts";
import { claudeCodeEnv, errorReporterHarness, startHarness } from "./harness.mts";
import { CHECKOUT } from "./fsd-checkouts.mts";
import { LAB_CROWD, LAB_TREE, LAB_USERS, openLab } from "./host.mts";
import { createBareRemote } from "./scratch-repo.mts";
import { CODER_FLOW } from "./workforce/flows/workers/coder.mts";
import { EM_FLOW } from "./workforce/flows/workers/em.mts";
import { setAsideLegacyOrgStore } from "./legacy-org-store.mts";

/**
 * The feature the EM worker asks a user to approve when the server opens, from
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
 * the second user as a project member, unless the store already holds them.
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
 * user who opens it, and the owner opens her own from the app.
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

const harness = await startHarness("stub");

/**
 * What the Codex usage read is handed: what a Codex run gets, so the read sees
 * the account the runs use (`CODEX_HOME`'s sign-in, or `CODEX_API_KEY`) over
 * the same proxy and CA settings.
 */
const CODEX_USAGE_PASS = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "CODEX_API_KEY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
] as const;

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
  // A goal that grades a call's default deadline shortens it (DEVTEAM_WAIT_DEFAULT_MS).
  ...(process.env.DEVTEAM_WAIT_DEFAULT_MS === undefined ? {} : { waitDeadlines: { defaultMs: Number(process.env.DEVTEAM_WAIT_DEFAULT_MS) } }),
  // The Error Reporter reads this checkout's code with Claude Code and keeps
  // its reports in Inbox: this team names no tracker, so nothing is filed.
  errorReporter: { harness: errorReporterHarness, cwd: CHECKOUT },
  // Read when someone opens Usage. Local only: OpenAI does not permit
  // app-server sign-in in a hosted service.
  usage: {
    codex: ({ signal } = {}) =>
      readCodexUsage({ env: harnessEnv({ pass: CODEX_USAGE_PASS }), ...(signal === undefined ? {} : { signal }) }),
    "claude-code": ({ signal } = {}) => readClaudeUsage({ env: claudeCodeEnv(), ...(signal === undefined ? {} : { signal }) }),
  },
});

export default lab.state;
