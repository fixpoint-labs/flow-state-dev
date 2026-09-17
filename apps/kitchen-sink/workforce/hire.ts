/**
 * Kitchen-sink's workforce, assembled from its own files.
 *
 * The point of this module is what it does *not* contain: no kind is named
 * here, and no block is. `kinds` and `blocks` come from `workforce.gen.ts`,
 * which `fsdev gen` writes from the tree beside this file, and the roster comes
 * from the `teams/` folders. Adding a kind means adding a file and re-running
 * the command — there is no second place to edit.
 *
 * Deliberately isolated: this subtree is the whole of the app's Layer 2 usage,
 * and nothing in `flows/` or `app/` reaches into it.
 */
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { kinds } from "./workforce.gen";

/** This directory — the workforce root, read at run time the way Markdown always is. */
export const workforceRoot = dirname(fileURLToPath(import.meta.url));

/** One hired seat, plus what the loader could not read. */
export interface HiredWorkforce {
  seats: FlowInstance[];
  /** Folders that should have been a worker and were not, by path. */
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
  const { workers, errors } = await readWorkforce(workforceRoot);
  return { seats: hireWorkforce(workers, { kinds }), errors: errors.map((e) => e.path) };
}
