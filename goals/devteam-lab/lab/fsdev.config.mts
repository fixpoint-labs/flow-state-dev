/**
 * The DevTeam lab as a server: the config `fsdev dev` and shift-manager load.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start --config goals/devteam-lab/lab/fsdev.config.mts
 *
 * One `FlowState`, default-exported, opened through the same `openLab` the
 * lab's checks use, so a server and a check boot the same tree the same way.
 * What a long-lived server asks of it that a check doesn't:
 *
 * - **The channel and the inventory.** The feature channel is opened with its
 *   post reaching the EM members, and the organization's seat and channel
 *   collections are registered, which shift-manager's TEAMS and PROJECTS read.
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
 * real coding agent. The stores are in memory, so every start is fresh.
 *
 * Which seat is the EM and which seat a row is handed to are read off the
 * tree, by the kind each `WORKER.md` names. No seat, channel or board is named
 * in this file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inMemoryStores } from "@flow-state-dev/engine";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { AskFeature } from "./ask.mts";
import { ASSIGNEE } from "./board.mts";
import { selectHarness } from "./harness.mts";
import { LAB_TREE, openLab } from "./host.mts";
import { createNotifyLog } from "./notify.mts";
import { BASE_REF, createScratchRepo } from "./scratch-repo.mts";
import { CODER_KIND } from "./workforce/flows/workers/coder.mts";
import { EM_KIND } from "./workforce/flows/workers/em.mts";

/**
 * The feature the EM seat asks a person to approve when the server opens: the
 * one the lab's asking check uses, read from its fixture at run time. Never
 * written here, because that check refuses a lab file that spells its
 * held-out feature.
 */
const ASK_FEATURE = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../it-waits-for-a-person-before-it-files/fixtures/input.json", import.meta.url)), "utf8"),
  ) as { feature: AskFeature }
).feature;

// The app's addresses, read off the tree: the coder seat whose name is the
// board's assignee, and the channel's members that are EM seats.
const roster = await readDeclaredRoster(LAB_TREE);
const kindOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const coderSeatId = roster.workers.find((w) => w.declared.flow === CODER_KIND && w.id.endsWith(`.${ASSIGNEE}`))?.id;
if (coderSeatId === undefined) throw new Error("the DevTeam tree declares no coder seat the board's rows are handed to");
const members = (roster.channels[0]?.declared.members as string[] | undefined) ?? [];
const addresses = Object.fromEntries(members.filter((m) => kindOf(m) === EM_KIND).map((m) => [m, m]));

const scratch = createScratchRepo("shift-manager");
const harness = selectHarness();

const lab = await openLab({
  stores: inMemoryStores(),
  harness: harness.slot,
  runTimeoutMs: harness.runTimeoutMs,
  workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
  coderSeatId,
  channels: { addresses, log: createNotifyLog() },
  inventory: true,
  ask: ASK_FEATURE,
  devtool: true,
});

export default lab.state;
