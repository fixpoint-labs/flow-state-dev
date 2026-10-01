/**
 * DevTeam, served for this goal: the DevForce lab's tree and `openLab`,
 * with this goal's recording harness in the `coder` kind's slot
 * (`recording-harness.mts`) and two rows already running on the coder seat.
 *
 * What it adds over `labs/shift-manager/teams/devteam/fsdev.config.mts`, and nothing
 * else:
 *
 * - **The harness.** Every attempt records what it was handed to the file
 *   `TURN_GOAL_RUNS` names, and holds until it is stopped.
 *   `TURN_GOAL_CONTROL=fresh-session` drops the resume id it was offered.
 * - **The store**, a SQLite file at `TURN_GOAL_STORE`, so the check can read
 *   a row's retry counters where they are stored. The board's browser view
 *   doesn't carry them.
 * - **Two rows, filed and drained at boot** through the EM seat's own
 *   actions, so the coder has two running tasks: one for the task composer,
 *   and a second for `@coder`'s picker.
 *
 * The EM seat's ask is raised as DevTeam raises it, so Inbox shows an ask on
 * a seat whose kind takes no message. Which seat is which is read off the
 * tree by the kind each `WORKER.md` names.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import type { AskFeature } from "../../../devforce-lab/lab/ask.mts";
import { ASSIGNEE } from "../../../devforce-lab/lab/board.mts";
import { LAB_TREE, openLab } from "../../../devforce-lab/lab/host.mts";
import { createNotifyLog } from "../../../devforce-lab/lab/notify.mts";
import { BASE_REF, createScratchRepo } from "../../../devforce-lab/lab/scratch-repo.mts";
import { CODER_KIND } from "../../../devforce-lab/lab/workforce/flows/workers/coder.mts";
import { EM_KIND } from "../../../devforce-lab/lab/workforce/flows/workers/em.mts";
import { recordingHarness } from "./recording-harness.mts";
import { ROWS, STORE_ENV } from "./rows.mts";

/** How long one held attempt may run before the manager gives up on it. */
const RUN_TIMEOUT_MS = 15 * 60_000;

const ASK_FEATURE = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../../devforce-lab/it-waits-for-a-person-before-it-files/fixtures/input.json", import.meta.url)), "utf8"),
  ) as { feature: AskFeature }
).feature;

const roster = await readDeclaredRoster(LAB_TREE);
const kindOf = (id: string) => roster.workers.find((w) => w.id === id)?.declared.flow;
const coderSeatId = roster.workers.find((w) => w.declared.flow === CODER_KIND && w.id.endsWith(`.${ASSIGNEE}`))?.id;
if (coderSeatId === undefined) throw new Error("the DevTeam tree declares no coder seat the board's rows are handed to");
const members = (roster.channels[0]?.declared.members as string[] | undefined) ?? [];
const emSeats = members.filter((m) => kindOf(m) === EM_KIND);
if (emSeats.length !== 1) throw new Error(`wanted one EM seat in the channel, found ${emSeats.length}`);
const emSeatId = emSeats[0]!;

const storeFile = process.env[STORE_ENV];
if (storeFile === undefined || storeFile === "") throw new Error(`${STORE_ENV} names no file for the store`);

const scratch = createScratchRepo("shift-manager-turn");
const lab = await openLab({
  stores: sqliteStores({ filename: storeFile }),
  harness: recordingHarness,
  runTimeoutMs: RUN_TIMEOUT_MS,
  workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
  coderSeatId,
  channels: { addresses: { [emSeatId]: emSeatId }, log: createNotifyLog() },
  inventory: true,
  ask: ASK_FEATURE,
  devtool: true,
});

for (const row of ROWS) {
  const filed = await lab.file(emSeatId, row);
  if (filed.error !== undefined) throw new Error(`filing ${row.issue}: ${filed.error}`);
}
const drained = await lab.drain(emSeatId);
if (drained.error !== undefined) throw new Error(`draining the board: ${drained.error}`);

export default lab.state;
