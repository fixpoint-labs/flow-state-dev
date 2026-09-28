/**
 * Kitchen-sink's workforce, assembled from its own files.
 *
 * The point of this module is what it does *not* contain: no seat is named
 * here, and no block is. `blocks` comes from `workforce.gen.ts`, which
 * `fsdev gen` writes from the tree beside this file, and the roster comes from
 * the `teams/` folders: one channel, `support.help`, and four specialists on
 * the built-in `agent` kind. Adding a tool means adding a file and re-running
 * the command — there is no second place to edit.
 *
 * This subtree is the whole of the app's Layer 2 usage. Nothing in `app/`
 * reaches into it. Two edges lead in: `fsdev.config.ts`, which awaits the hire
 * below and spreads the seats into the map it serves, and the
 * `workforce-admin` flow, which hires against `kitchenSinkKinds`. That first
 * edge is what makes the demonstration real — until it existed the bundler
 * never resolved `workforce.gen.ts`'s imports, so the claim this tree exists
 * to prove (a generated module of static imports survives a production build)
 * was asserted and untested (FIX-1429).
 *
 * The channel is routed: each post from a person reaches the one specialist
 * whose `description:` fits it (`routeByPurpose`, on `ROUTE_MODEL`), and that
 * specialist's answer lands in the channel under its name.
 */
import {
  channelBoardIds,
  channelInstances,
  channelPostCapability,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  routeByPurpose,
  type ChannelManifest,
  type HireOptions,
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { channelLandingControl } from "../lib/channel-landing-control";
import { channelPostControl } from "../lib/channel-post-control";
import { withChannelRouteControl } from "../lib/channel-route-control";
import { escalateControl } from "../lib/escalate-control";
import { ROUTE_MODEL } from "../lib/models";
import { notifyFor } from "./channel-notify";
import { blocks, channelKinds, kinds, packageBlocks, seatBlocks } from "./workforce.gen";

/**
 * `post-to-channel`, so a specialist can answer in a channel it belongs to,
 * under its own name. Offered, not granted: only a seat whose file names the
 * tool can post, and every specialist's does. The goal check's
 * `post-without-author` control swaps in a stand-in, in test mode only.
 */
const channelPost = channelPostControl() ?? channelPostCapability;

/**
 * The tool catalog: the scanned `workforce/blocks/` map, which holds
 * `escalate`. The goal check's `no-filing` control swaps `escalate` for a
 * stand-in that files nothing, in test mode only.
 */
const catalog = escalateControl(blocks) ?? blocks;

/**
 * The kinds a seat may be hired into — generated, plus the built-in `agent`
 * carrying the post tool and the tool catalog.
 *
 * Exported because a runtime hire and the boot reload must hire against the
 * SAME map the file-declared roster does. Calling `defineAgentWorkerFlow` a
 * second time elsewhere would build a *different* kind under the same name, so
 * a seat hired over `workforce-admin` would carry a different tool catalog from
 * its file-declared neighbours for no reason anyone stated.
 *
 * `catalog` is the whole of the custom-tool recipe on the app's side: the
 * scanned map IS a tool catalog, so a seat naming one of its keys in `tools:`
 * can call it. The app decides what the catalog holds; each seat decides which
 * of it to use, and a key nobody names reaches nobody.
 *
 * The goal check's `no-landing` control swaps the kind for one that answers
 * with the same tools and lands no text answer, in test mode only.
 */
export const kitchenSinkKinds: NonNullable<HireOptions["kinds"]> = {
  ...kinds,
  agent: channelLandingControl(catalog, channelPost) ?? defineAgentWorkerFlow({ uses: [channelPost], catalog }),
};

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
  const read = await readChannelsDirectory(workforceRoot);
  const channelErrors = read.errors;
  // The goal checks' `no-route` control takes the `routing:` lines off here,
  // before anything is bound, in test mode only.
  const channels = withChannelRouteControl(read.channels);

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
  // seed, rebuilt to give it this app's fan-out block and its route. The route
  // does nothing for a channel whose file has no `routing:` lines.
  const channelFlows = channelInstances(channels, {
    kinds: {
      ...channelKinds,
      channel: defineChannelFlow({
        notify: notifyFor(seats),
        route: routeByPurpose(seats, { model: ROUTE_MODEL }),
      }),
    },
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
