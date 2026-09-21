/**
 * Kitchen-sink's workforce, assembled from its own files.
 *
 * The point of this module is what it does *not* contain: no kind is named
 * here, and no block is. `kinds` and `blocks` come from `workforce.gen.ts`,
 * which `fsdev gen` writes from the tree beside this file, and the roster comes
 * from the `teams/` folders. Adding a kind means adding a file and re-running
 * the command — there is no second place to edit.
 *
 * This subtree is the whole of the app's Layer 2 usage. Nothing in `flows/` or
 * `app/` reaches into it; the one edge out is `fsdev.config.ts`, which awaits
 * the hire below and spreads the seats into the map it serves. That edge is
 * what makes the demonstration real — until it existed the bundler never
 * resolved `workforce.gen.ts`'s imports, so the claim this tree exists to
 * prove (a generated module of static imports survives a production build)
 * was asserted and untested (FIX-1429).
 */
import {
  channelBoardIds,
  channelInstances,
  defineAgentWorkerFlow,
  defineChannelFlow,
  hireWorkforce,
  splitResourceModules,
  type ChannelManifest,
} from "@flow-state-dev/workforce";
import { readChannelsDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import notify from "./channel-notify";
import { blocks, channelKinds, kinds, resourceModules, seatBlocks } from "./workforce.gen";

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
const agent = defineAgentWorkerFlow({ uses: capabilities, catalog: blocks });

/**
 * The kinds a seat may be hired into — generated, plus the built-in `agent`
 * carrying this tree's capabilities and tool catalog.
 *
 * Exported because a runtime hire and the boot reload must hire against the
 * SAME map the file-declared roster does. Calling `defineAgentWorkerFlow` a
 * second time elsewhere would build a *different* kind under the same name, so
 * a seat hired over `workforce-admin` would carry a different tool catalog from
 * its file-declared neighbours for no reason anyone stated.
 */
export const kitchenSinkKinds = { ...kinds, agent };

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
  const { workers, errors, skillErrors, teamErrors } = await readWorkforce(workforceRoot);
  const { channels, errors: channelErrors } = await readChannelsDirectory(workforceRoot);

  // The generated map, plus the built-in under the key the binder seeds. No
  // kind of this app's own is named here: `channelKinds` carries whatever
  // files live under `flows/channels/`, and `channel` is the framework's own
  // seed, rebuilt only to give it this app's fan-out block.
  const channelFlows = channelInstances(channels, {
    kinds: { ...channelKinds, channel: defineChannelFlow({ notify }) },
  });

  return {
    // `seatBlocks` registers what each worker's own folder holds, for that
    // worker alone. It grants nothing: a seat still names the block in its
    // `tools:` before the model can call it.
    //
    // `channelBoards` is what lets the hire say which declared board no seat
    // drains. Without it the check has no roster to read and says nothing —
    // which is the silence this app ships to make visible.
    seats: hireWorkforce(workers, {
      kinds: kitchenSinkKinds,
      seatBlocks,
      channelBoards: channelBoardIds(channels),
    }),
    channelFlows,
    channels,
    errors: [
      ...errors.map((e) => e.path),
      ...skillErrors.flatMap((seat) => seat.errors.map((e) => e.path)),
      ...teamErrors.map((e) => e.path),
      ...channelErrors.map((e) => e.path),
    ],
  };
}
