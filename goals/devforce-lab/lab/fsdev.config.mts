/**
 * The DevForce lab as a server: the config `fsdev dev` and App Lab load.
 *
 *     pnpm --filter @flow-state-dev/app-lab start --config goals/devforce-lab/lab/fsdev.config.mts
 *
 * `openLab` hires the tree, opens the channel, opens the inventory, and raises
 * the EM seat's ask. This file only adds what a check does not: in-memory
 * stores, the scripted harness, which members a post wakes, and the bearer
 * the page is handed.
 *
 * The harness is the lab's scripted stub. A real coding agent goes in the
 * same slot.
 */
import { inMemoryStores } from "@flow-state-dev/engine";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { type AskFeature } from "./ask.mts";
import { ASSIGNEE } from "./board.mts";
import { harnessStub } from "./harness-stub.mts";
import { LAB_TREE, LAB_USER_ID, openLab } from "./host.mts";
import { createNotifyLog } from "./notify.mts";
import { BASE_REF, createScratchRepo } from "./scratch-repo.mts";
import { CODER_KIND } from "./workforce/flows/workers/coder.mts";
import { EM_KIND } from "./workforce/flows/workers/em.mts";

/**
 * The bearer this server accepts, and the one handed to the page. A local
 * lab's credential: it only proves the request came from a page this server
 * handed it to.
 */
const BEARER = "devforce-lab-app";

/** The feature the EM seat asks a person to approve when the server opens. */
const ASK_FEATURE: AskFeature = {
  issue: "night-mode-toggle",
  goal: "Add a night-mode toggle to the settings page.",
};

const roster = await readDeclaredRoster(LAB_TREE);
if (roster.problems.length > 0) {
  throw new Error(
    `the tree at ${LAB_TREE} did not load cleanly:\n  - ${roster.problems.map((p) => `${p.path}: ${p.error.message}`).join("\n  - ")}`,
  );
}

const channel = roster.channels[0];
const members = Array.isArray(channel?.declared.members) ? (channel.declared.members as string[]) : [];
const kindOf = (id: string) => roster.workers.find((worker) => worker.id === id)?.declared.flow;
const coderSeat = roster.workers.find(
  (worker) => worker.declared.flow === CODER_KIND && worker.id.endsWith(`.${ASSIGNEE}`),
)?.id;
if (coderSeat === undefined) {
  throw new Error("the DevForce tree declares no coder seat the board's rows are handed to");
}

const scratch = createScratchRepo("app-lab");
const lab = await openLab({
  stores: inMemoryStores(),
  harness: harnessStub().slot,
  workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
  coderSeatId: coderSeat,
  channels: {
    addresses: Object.fromEntries(
      members.filter((member) => kindOf(member) === EM_KIND).map((member) => [member, member]),
    ),
    log: createNotifyLog(),
  },
  ask: ASK_FEATURE,
  inventory: true,
  devtool: { userId: LAB_USER_ID, bearerToken: BEARER },
});

export default lab.state;
