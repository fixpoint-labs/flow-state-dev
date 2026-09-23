/**
 * THE MISTAKE, ON PURPOSE. This file is a fixture and is never hired cleanly.
 *
 * It is the shape an author reaches for when the tree looks bare: the manager
 * holds no board tool in its `tools:` line, so surely one has to be *written*
 * somewhere — and a seat's own `blocks/` folder is the nearest place to write
 * it. So here is a block, in one seat's folder, declaring the channel's board.
 *
 * `hireWorkforce` refuses the **whole roster** over it, naming this block. A
 * seat's own folder belongs to one seat and a resource belongs to the kind, so
 * there is nowhere to install an org-scoped board that would not also install
 * it for every sibling seat of that kind.
 *
 * The corrected twin next door simply does not have this file, and hires. That
 * is the honest fix, and it is the whole of BR-3: **the seat-tool fence is not
 * widened to let a board tool into a folder.** The grant is the kind composing
 * `channelBoardTaskTools`, and it is not a file-level thing at all.
 */

import { handler } from "@flow-state-dev/core";
import { channelBoard } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The board this block should not be declaring. Same channel, same local name. */
const work = channelBoard("eng.queue", "work");

export default handler({
  name: "desk-board",
  // The refusal. An org-scoped resource, declared from inside one seat's folder.
  resources: { [work.id]: work },
  inputSchema: z.object({}).optional(),
  outputSchema: z.object({ rows: z.number() }),
  execute: async () => ({ rows: 0 }),
});
