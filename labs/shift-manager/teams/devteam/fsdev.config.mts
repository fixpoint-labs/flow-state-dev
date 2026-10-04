/**
 * The DevTeam team profile: a software team (an EM seat that files features, a
 * coder seat that runs them, a reviewer) and its chief of staff, as a server
 * Shift Manager and `fsdev dev` load.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start --team devteam
 *
 * The team is the DevForce lab's tree (`goals/devforce-lab/lab/`), where the
 * checks that prove it live. One `FlowState`, default-exported, opened through
 * the same `openLab` those checks use, so a server and a check boot the same
 * tree the same way.
 * What a long-lived server asks of it that a check doesn't:
 *
 * - **The mailbox and the inventory.** The feature mailbox is opened with its
 *   post reaching the EM members, and the organization's seat and mailbox
 *   collections are registered, which Shift Manager's TEAMS and PROJECTS read.
 * - **One ask waiting.** The EM seat's approval for {@link ASK_FEATURE} is
 *   raised in its own session (which also turns durable execution on), so
 *   Inbox has something to answer. Approve files the row and starts the coder
 *   seat; Deny files nothing.
 * - **The page's connection.** The lab's user and verified bearer go to the
 *   page through the `devtool` block, which the host injects on a loopback
 *   bind only. A request with no bearer is refused, as in the checks.
 *
 * The harness is picked by `DEVFORCE_LAB_HARNESS` (see `harness.mts`): the
 * lab's scripted run by default, no model, which says what it is doing in the
 * run's session and commits one file so the row settles; or `claude-code`, a
 * real coding agent.
 *
 * - **A store that survives a restart.** SQLite, at `DEVTEAM_STORE` or
 *   `labs/shift-manager/.fsdev/devteam.sqlite` by default. Seats the chief of
 *   staff hired are read back and serve again at the next start, a fire it
 *   made stays made, and an ask still waiting is still in Inbox. Delete the
 *   file for a fresh start.
 *
 * Which seat is the EM and which seat a row is handed to are read off the
 * tree, by the kind each `WORKER.md` names. No seat, mailbox or board is named
 * in this file.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { AskFeature } from "../../../../goals/devforce-lab/lab/ask.mts";
import { ASSIGNEE } from "../../../../goals/devforce-lab/lab/board.mts";
import { selectHarness } from "../../../../goals/devforce-lab/lab/harness.mts";
import { boardMailboxOf, LAB_CROWD, LAB_ORG_ID, LAB_TREE, LAB_USERS, openLab } from "../../../../goals/devforce-lab/lab/host.mts";
import { createNotifyLog } from "../../../../goals/devforce-lab/lab/notify.mts";
import { BASE_REF, createScratchRepo } from "../../../../goals/devforce-lab/lab/scratch-repo.mts";
import { CODER_KIND } from "../../../../goals/devforce-lab/lab/workforce/flows/workers/coder.mts";
import { EM_KIND } from "../../../../goals/devforce-lab/lab/workforce/flows/workers/em.mts";
import { setAsideLegacyOrgStore, setAsidePreRenameStore } from "./legacy-org-store.mts";

/**
 * The feature the EM seat asks a person to approve when the server opens: the
 * one the lab's asking check uses, read from its fixture at run time. Never
 * written here, because that check refuses a lab file that spells its
 * held-out feature.
 */
const ASK_FEATURE = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../../goals/devforce-lab/it-waits-for-a-person-before-it-files/fixtures/input.json", import.meta.url)), "utf8"),
  ) as { feature: AskFeature }
).feature;

/**
 * The Lab's two default projects, created at start as the Lab's owner with
 * the second user as a member, unless the store already holds them.
 *
 * A project belongs to the organization, not a team: `storefront` holds one
 * workstream from each of the two teams. The second holds none yet. Each team
 * keeps one more workstream that no default project lists, so a project
 * created later (by the chief of staff, say) has one from each team to take.
 * Those are the only mailbox ids written here: which workstreams a project
 * holds is the app's data, not the tree's.
 */
const DEFAULT_PROJECTS = [
  {
    id: "storefront",
    title: "Storefront",
    brief: "Get the storefront feature built and released: engineering builds it, operations ships it.",
    members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)],
    workstreams: ["eng.feature", "ops.release"],
  },
  {
    id: "platform",
    title: "Platform",
    brief: "Shared groundwork no single feature owns. It holds no workstream yet.",
    members: [LAB_USERS.member.userId, ...LAB_CROWD.map((u) => u.userId)],
  },
];

// The app's addresses, read off the tree: the coder seat whose name is the
// board's assignee, and the EM seats among the members of the mailbox that
// holds the board.
const roster = await readDeclaredRoster(LAB_TREE);
const kindOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const coderSeatId = roster.workers.find((w) => w.declared.flow === CODER_KIND && w.id.endsWith(`.${ASSIGNEE}`))?.id;
if (coderSeatId === undefined) throw new Error("the DevTeam tree declares no coder seat the board's rows are handed to");
const members = (boardMailboxOf(roster).declared.members as string[] | undefined) ?? [];
const addresses = Object.fromEntries(members.filter((m) => kindOf(m) === EM_KIND).map((m) => [m, m]));

/** Where this Lab keeps what it was told, across restarts. */
const STORE = process.env.DEVTEAM_STORE ?? fileURLToPath(new URL("../../.fsdev/devteam.sqlite", import.meta.url));
mkdirSync(dirname(STORE), { recursive: true });
// A store from before the lab's org id changed is set aside, loudly, not reused.
await setAsideLegacyOrgStore(STORE);
// So is one from before mailboxes were renamed.
await setAsidePreRenameStore(STORE, { mailboxIds: roster.mailboxes.map((m) => m.id), orgIds: [LAB_ORG_ID] });

const scratch = createScratchRepo("shift-manager");
const harness = selectHarness();

const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  harness: harness.slot,
  runTimeoutMs: harness.runTimeoutMs,
  workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
  coderSeatId,
  mailboxes: { addresses, log: createNotifyLog() },
  inventory: true,
  ask: ASK_FEATURE,
  devtool: true,
  projects: DEFAULT_PROJECTS,
});

export default lab.state;
