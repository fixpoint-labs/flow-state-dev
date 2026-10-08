/**
 * Kitchen-sink's workforce, assembled from its own files.
 *
 * The point of this module is what it does *not* contain: no worker is named
 * here, and no block is. `blocks` comes from `workforce.gen.ts`, which
 * `fsdev gen` writes from the tree beside this file, and the workers come from
 * the `teams/` folders: one mailbox, `support.help`, and four specialists on
 * the built-in `agent` flow. Adding a tool means adding a file and re-running
 * the command — there is no second place to edit.
 *
 * The specialists are standard workers: every user has them, and they run on
 * one registered copy of `agent`. A user's own workers, hired or forked
 * through the roster flow, run on that same copy.
 *
 * This subtree is the whole of the app's Layer 2 usage. Nothing in `app/`
 * reaches into it. One edge leads in: `fsdev.config.ts`, which awaits the
 * build below and spreads the copies into the map it serves. That edge is what
 * makes the demonstration real — until it existed the bundler never resolved
 * `workforce.gen.ts`'s imports, so the claim this tree exists to prove (a
 * generated module of static imports survives a production build) was asserted
 * and untested (FIX-1429).
 *
 * The mailbox is routed: each post from a person reaches the one specialist
 * whose `description:` fits it (`routeByPurpose`, on `ROUTE_MODEL`), and that
 * specialist's answer lands in the mailbox under its name.
 */
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineMailboxFlow,
  hireWorkforce,
  mailboxBoardIds,
  mailboxInstances,
  routeByPurpose,
  workerMailboxPostCapability,
  type MailboxManifest,
  type WorkerInstallation,
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import { mailboxLandingControl } from "../lib/mailbox-landing-control";
import { mailboxPostControl } from "../lib/mailbox-post-control";
import { withMailboxRouteControl } from "../lib/mailbox-route-control";
import { escalateControl } from "../lib/escalate-control";
import { ROUTE_MODEL } from "../lib/models";
import { notifyFor } from "./mailbox-notify";
import { blocks, mailboxKinds, kinds, packageBlocks, seatBlocks } from "./workforce.gen";

/**
 * `post-to-mailbox`, so a specialist can answer in a mailbox it belongs to,
 * under its own name. Offered, not granted: only a worker whose file names the
 * tool can post, and every specialist's does. The goal check's
 * `post-without-author` control swaps in a stand-in, in test mode only.
 */
const mailboxPost = mailboxPostControl() ?? workerMailboxPostCapability;

/**
 * The tool catalog: the scanned `workforce/blocks/` map, which holds
 * `escalate`. The goal check's `no-filing` control swaps `escalate` for a
 * stand-in that files nothing, in test mode only.
 */
const catalog = escalateControl(blocks) ?? blocks;

/** This directory — the workforce root, read at run time the way Markdown always is. */
export const workforceRoot = dirname(fileURLToPath(import.meta.url));

/** The installation, the copies it registers, the mailboxes the tree declared, and what the loader could not read. */
export interface KitchenSinkWorkforce {
  /** The worker model: the standard workers, and the checks every session of a worker flow meets. */
  installation: WorkerInstallation;
  /** One copy per worker flow, and the roster flow. Register these. */
  copies: FlowInstance[];
  /**
   * One instance per DISTINCT mailbox kind the tree selected — never one per
   * mailbox. Register these beside the copies; a mailbox is a named session on
   * the instance its `MAILBOX.md` selected.
   */
  mailboxFlows: FlowInstance[];
  /**
   * The mailbox records themselves, handed back so the caller can open them
   * once the runtime exists. Opening needs a session client, and there is no
   * session client until the FlowState is built — so this module builds the
   * instances and the caller opens the sessions.
   */
  mailboxes: MailboxManifest[];
  /**
   * Everything the loader could not read, by path — from **all three** of its
   * error channels, not just the worker one. A worker folder that failed is a
   * worker this app does not have, a skill that failed is a worker running
   * short, and a `TEAM.md` that failed is a whole team running without the
   * instructions its author wrote. This app's answer to all three is the same:
   * say so.
   *
   * **A mailbox or a package that failed to load is NOT here.** Each throws
   * instead: a mailbox short is a team with nowhere to talk, and a worker short
   * a package runs without the instructions and tools its author gave it.
   */
  errors: string[];
}

/**
 * Read the team's files and build the workforce they describe.
 *
 * @returns The installation, its copies and mailbox flows, and any folder the loader reported.
 * @throws If a mailbox or a package fails to load, or a worker flow is refused.
 */
export async function buildKitchenSinkWorkforce(): Promise<KitchenSinkWorkforce> {
  const { workers, errors, skillErrors, teamErrors, packageErrors } = await readWorkforce(workforceRoot);
  const read = await readMailboxesDirectory(workforceRoot);
  const mailboxErrors = read.errors;
  // The goal checks' `no-route` control takes the `routing:` lines off here,
  // before anything is bound, in test mode only.
  const mailboxes = withMailboxRouteControl(read.mailboxes);

  if (mailboxErrors.length > 0) {
    throw new Error(
      `mailboxes: ${mailboxErrors.length} mailbox(es) failed to load\n` +
        mailboxErrors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
    );
  }
  if (packageErrors.length > 0) {
    throw new Error(
      `packages: ${packageErrors.length} package problem(s)\n` +
        packageErrors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
    );
  }

  // `seatBlocks` registers what each worker's own folder holds, for that
  // worker alone. It grants nothing: a worker still names the block in its
  // `tools:` before the model can call it. `packageBlocks` carries every
  // package's blocks by folder; a worker gets the ones of the packages it holds.
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: workers,
    workerFlows: () => flows as never,
    seatBlocks,
    packageBlocks,
  });
  // The generated flows, plus the built-in `agent` carrying the post tool and
  // the tool catalog. The goal check's `no-landing` control swaps it for one
  // that answers with the same tools and lands no text answer, in test mode only.
  flows = {
    ...kinds,
    agent:
      mailboxLandingControl(catalog, mailboxPost, installation) ??
      defineAgentWorkerFlow({ installation, uses: [mailboxPost], catalog }),
  };
  // `mailboxBoards` is what lets the build say which declared board no copy
  // drains. Without it the check has no roster to read and says nothing —
  // which is the silence this app ships to make visible.
  const copies = hireWorkforce(installation, { mailboxBoards: mailboxBoardIds(mailboxes) });

  // The generated map, plus the built-in under the key the binder seeds. The
  // fan-out wakes each standard worker the mailbox names, on its flow's copy.
  const mailboxFlows = mailboxInstances(mailboxes, {
    kinds: {
      ...mailboxKinds,
      mailbox: defineMailboxFlow({
        notify: notifyFor(copies, installation),
        route: routeByPurpose(copies, { model: ROUTE_MODEL, installation }),
      }),
    },
  });

  return {
    installation,
    copies,
    mailboxFlows,
    mailboxes,
    errors: [
      ...errors.map((e) => e.path),
      ...skillErrors.flatMap((seat) => seat.errors.map((e) => e.path)),
      ...teamErrors.map((e) => e.path),
    ],
  };
}
