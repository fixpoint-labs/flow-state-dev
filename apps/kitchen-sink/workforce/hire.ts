/**
 * Kitchen-sink's workforce, assembled from its own files.
 *
 * The point of this module is what it does *not* contain: no kind is named
 * here, and no block is. `kinds` and `blocks` come from `workforce.gen.ts`,
 * which `fsdev gen` writes from the tree beside this file, and the roster comes
 * from the `teams/` folders. Adding a kind means adding a file and re-running
 * the command — there is no second place to edit.
 *
 * This subtree is the whole of the app's Layer 2 usage. Nothing in `app/`
 * reaches into it. Three edges lead in: `fsdev.config.ts`, which awaits the
 * hire below and spreads the seats into the map it serves, the
 * `workforce-admin` flow, which hires against `kitchenSinkKinds`, and the
 * `chat-agent` flow, whose `hireSeat` action (the rail's "Hire another") runs
 * on `kitchenSinkSeatHireOptions`. That first
 * edge is what makes the demonstration real — until it existed the bundler
 * never resolved `workforce.gen.ts`'s imports, so the claim this tree exists
 * to prove (a generated module of static imports survives a production build)
 * was asserted and untested (FIX-1429).
 *
 * One edge leads out: `lib/workforce-registrar`. The seat-hire tools on the
 * `agent` kind admit and release addresses through it, the same door the
 * admin flow and the boot reload use, so all three leave the provenance mark
 * `fire` reads.
 */
import {
  channelBoardIds,
  channelInstances,
  createSeatHireCapability,
  createWorkforceCapability,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  splitResourceModules,
  HIRED_ROSTER_RESOURCE,
  SEAT_INVENTORY_RESOURCE,
  type ChannelManifest,
  type HireOptions,
  type SeatHireCapabilityOptions,
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { workforceRegistrar } from "../lib/workforce-registrar";
import { notifyFor } from "./channel-notify";
import { blocks, channelKinds, kinds, packageBlocks, resourceModules, seatBlocks } from "./workforce.gen";

/**
 * What a `.ts` file in a `resources/` folder turned into.
 *
 * This tree's one module is a capability, so only that half is used here; a
 * module that exported a plain resource would come back on `resources` and be
 * spread into a flow's own resource map beside the Markdown documents. Read
 * once at module scope, not per hire.
 */
const { capabilities } = splitResourceModules(resourceModules);

/**
 * The kinds a seat may be hired into — generated, plus the built-in `agent`
 * carrying this tree's capabilities and tool catalog.
 *
 * Exported because a runtime hire and the boot reload must hire against the
 * SAME map the file-declared roster does. Calling `defineAgentWorkerFlow` a
 * second time elsewhere would build a *different* kind under the same name, so
 * a seat hired over `workforce-admin` would carry a different tool catalog from
 * its file-declared neighbours for no reason anyone stated.
 *
 * Declared before `agent` and filled in after it, because `agent` itself
 * carries the seat-hire tools, and those close over this object: a seat that
 * hires through them hires from this map, the same one the admin action and
 * the boot reload read.
 */
export const kitchenSinkKinds: NonNullable<HireOptions["kinds"]> = { ...kinds };

/**
 * How a seat hires and fires from its own tools: this app's kinds, and this
 * app's registrar as the door.
 *
 * Exported so any other caller of the seat-hire blocks hires from the same map
 * through the same door.
 *
 * - `register` goes through `registerFromRoster`, so a seat hired this way is
 *   marked as minted from a roster row. The admin action's `fire` and the boot
 *   reload both depend on that mark.
 * - `unregister` releases only an address that mark covers. The registrar's
 *   own `unregister` releases whatever holds the address; a seat declared in
 *   `workforce/teams/` at the same address is removed by editing its folder,
 *   so here it is left registered and the fire reports `released: false`.
 * - No `allowKinds`: a seat may hire any kind the admin action may.
 * - No `channelBoards`: the unattended-board warning would be computed against
 *   the one seat just hired, and would name boards the file seats already drain.
 * - No organization: it comes from the caller's verified principal at the call.
 */
export const kitchenSinkSeatHireOptions: SeatHireCapabilityOptions = {
  kinds: kitchenSinkKinds,
  register: (seat, pin) => workforceRegistrar.registerFromRoster(seat, { pin }),
  unregister: (id) => workforceRegistrar.isFromRoster(id) && workforceRegistrar.unregister(id),
  kindAt: (id) => workforceRegistrar.kindAt(id),
};

/**
 * `hire` and `fire`, offered to every seat of the `agent` kind. Offered, not
 * granted: a seat still names them in its `tools:` before the model can call
 * them.
 */
const seatHire = createSeatHireCapability(kitchenSinkSeatHireOptions);

/**
 * `discover`, so an agent seat can ask which seats this organization has hired.
 *
 * The declared roster is empty because this app writes no inventory rows for
 * the seats its folders declare, so `discover` could not list them either way.
 * It lists runtime hires: the inventory row and the roster row a hire writes.
 */
const discover = createWorkforceCapability({
  roster: { workers: [], channels: [] },
  inventory: { seats: SEAT_INVENTORY_RESOURCE },
  hiredRoster: HIRED_ROSTER_RESOURCE,
});

/**
 * The built-in worker kind, carrying what the team's folder declared.
 *
 * Registered under `agent`, so it is the kind every seat that names no `flow:`
 * is hired into. The app decides WHICH capabilities the roster may reach; each
 * seat's own file decides which of their presets it wants, and a seat that
 * names none carries the kind's defaults.
 *
 * `catalog: blocks` is the whole of the custom-tool recipe on the app's side:
 * the scanned `workforce/blocks/` map IS a tool catalog, so a seat naming one
 * of its keys in `tools:` can call it. The app decides what the catalog holds;
 * each seat decides which of it to use, and a key nobody names reaches nobody.
 */
kitchenSinkKinds.agent = defineAgentWorkerFlow({
  uses: [...capabilities, seatHire, discover],
  catalog: blocks,
});

/** This directory — the workforce root, read at run time the way Markdown always is. */
export const workforceRoot = dirname(fileURLToPath(import.meta.url));

/** One hired seat, the channels the tree declared, plus what the loader could not read. */
export interface HiredWorkforce {
  seats: FlowInstance[];
  /**
   * One instance per DISTINCT channel kind the roster selected — never one per
   * channel. Register these beside the seats; a channel is a named session on
   * the instance its `CHANNEL.md` selected.
   */
  channelFlows: FlowInstance[];
  /**
   * The channel records themselves, handed back so the caller can open them
   * once the runtime exists. Opening needs a session client, and there is no
   * session client until the FlowState is built — so this module builds the
   * instances and the caller opens the sessions.
   */
  channels: ChannelManifest[];
  /**
   * Everything the loader could not read, by path — from **all three** of its
   * error channels, not just the worker one.
   *
   * The three are separate on the loader's result because they are different
   * severities: a worker slot that failed is a seat this app does not have, a
   * skill that failed is a seat running short, and a `TEAM.md` that failed is a
   * whole team's seats running without instructions their author wrote. They
   * are flattened here because this app's answer to all three is the same —
   * say so — and because a channel a caller forgets to destructure is a
   * failure that reports nowhere, which is the one outcome collecting rather
   * than throwing is supposed to make impossible.
   *
   * **A channel that failed to load is NOT here.** It throws above instead, for
   * the reason the published channels guide gives: a seat short is a roster
   * running light, but a channel short is a team with nowhere to talk, and the
   * seats that did load go on posting into the channels that did open as though
   * nothing were missing. Degrading is the right answer for a seat and the
   * wrong one for a channel.
   *
   * **A package that failed to load is NOT here either.** It throws above, for
   * the rule packages ship with: every package problem is a start-time
   * refusal. A worker short a package is a worker without the instructions and
   * tools its author gave it, running as though it had them.
   */
  errors: string[];
}

/**
 * Read the team's files and hire every seat they describe.
 *
 * The `kinds` map is generated, not written: a seat's `flow:` names a kind that
 * is on it because a file with that basename exists, and for no other reason.
 *
 * @returns The hired seats, ordered by id, and any folder the loader reported.
 * @throws If any record cannot be hired; the message names every bad worker.
 */
export async function hireKitchenSinkWorkforce(): Promise<HiredWorkforce> {
  const { workers, errors, skillErrors, teamErrors, packageErrors } = await readWorkforce(workforceRoot);
  const { channels, errors: channelErrors } = await readChannelsDirectory(workforceRoot);

  // FATAL, unlike the worker-side errors below, and the published guide is why:
  // "a reported folder is a channel your app was supposed to have. Log a warning
  // and carry on, and the app boots with a team that has nowhere to talk."
  // A seat that fails to load is one seat short; a channel that fails to load is
  // a place the team cannot talk, and the rest of the roster keeps posting into
  // the ones that did open as though nothing were missing.
  if (channelErrors.length > 0) {
    throw new Error(
      `channels: ${channelErrors.length} channel(s) failed to load\n` +
        channelErrors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
    );
  }

  // FATAL too. A refused package is left off every record that would have held
  // it, and one with no blocks leaves the hire nothing to notice — so the only
  // place its failure shows is here, and it has to stop start.
  if (packageErrors.length > 0) {
    throw new Error(
      `packages: ${packageErrors.length} package problem(s)\n` +
        packageErrors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
    );
  }

  // `seatBlocks` registers what each worker's own folder holds, for that
  // worker alone. It grants nothing: a seat still names the block in its
  // `tools:` before the model can call it.
  //
  // `packageBlocks` carries every package's blocks by folder; the hire gives
  // each worker the ones of the packages it holds, and nothing else.
  //
  // `channelBoards` is what lets the hire say which declared board no seat
  // drains. Without it the check has no roster to read and says nothing —
  // which is the silence this app ships to make visible.
  //
  // Hired before the channels are built, because the fan-out block wakes these
  // seats: its addresses are the seats hired here, never a channel's stored
  // members.
  const seats = hireWorkforce(workers, {
    kinds: kitchenSinkKinds,
    seatBlocks,
    packageBlocks,
    channelBoards: channelBoardIds(channels),
  });

  // The generated map, plus the built-in under the key the binder seeds. No
  // kind of this app's own is named here: `channelKinds` carries whatever
  // files live under `flows/channels/`, and `channel` is the framework's own
  // seed, rebuilt only to give it this app's fan-out block.
  const channelFlows = channelInstances(channels, {
    kinds: { ...channelKinds, channel: defineChannelFlow({ notify: notifyFor(seats) }) },
  });

  return {
    seats,
    channelFlows,
    channels,
    errors: [
      ...errors.map((e) => e.path),
      ...skillErrors.flatMap((seat) => seat.errors.map((e) => e.path)),
      ...teamErrors.map((e) => e.path),
    ],
  };
}
