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
  defineAgentWorkerFlow,
  hireWorkforce,
  splitResourceModules,
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { blocks, kinds, resourceModules, seatBlocks } from "./workforce.gen";

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

/** One hired seat, plus what the loader could not read. */
export interface HiredWorkforce {
  seats: FlowInstance[];
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
  return {
    // `seatBlocks` registers what each worker's own folder holds, for that
    // worker alone. It grants nothing: a seat still names the block in its
    // `tools:` before the model can call it.
    seats: hireWorkforce(workers, { kinds: kitchenSinkKinds, seatBlocks }),
    errors: [
      ...errors.map((e) => e.path),
      ...skillErrors.flatMap((seat) => seat.errors.map((e) => e.path)),
      ...teamErrors.map((e) => e.path),
    ],
  };
}
