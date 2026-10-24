/**
 * `openInventory` — the boot binder that fills the live inventory.
 *
 * It writes nothing itself. Everything the inventory holds is written from
 * inside a flow, because a resource collection has no door outside one: the
 * session routes carry session state, and the resource routes carry a
 * collection item's *content*, not its state. So the binder's whole job is to
 * run one action in the right place and to name what failed.
 *
 * A **worker** has no session. What it is — its id and the worker flow it was hired into
 * — is the roster the process was hired from, which the binder already holds,
 * so the worker rows go out in ONE run carrying all of them.
 *
 * **Nothing is deleted for being absent.** A row means *was registered in this
 * org*, not *still declared*. A roster handed to one boot may be a partial one,
 * and a binder that reconciled against it would drop the row of a live worker
 * another process registered. A reader tolerates a row naming something it
 * cannot reach; there is no undoing a row that should not have been removed.
 *
 * Each removal is positive evidence, not absence: `fire` (`removeHiredWorker`)
 * deletes the row of the hired worker it removes, which it knows exactly.
 */

import { STANDING_RULES_ACTION } from "../standing-rules/keys";
import { workerDoorOf } from "../worker-door";
import { INVENTORY_REGISTER_WORKERS } from "./worker-writer";

/**
 * One registered worker, as the binder needs it.
 *
 * Structurally typed, and satisfied by `hireWorkforce`'s own return value: a
 * hired worker is a flow copy carrying these three fields. Typed this
 * loosely on purpose — what belongs in the inventory is the workers that
 * actually exist, and a manifest the hire step refused never became one.
 */
export interface InventoryWorker {
  /** The worker's id (`"<teamId>.<name>"`, or a bare `"<name>"` for an org worker) — the id its row is keyed by. */
  id: string;
  /** The worker flow it was hired into. */
  kind: string;
  /**
   * The worker's public actions, which its door is read from (see
   * `worker-door.ts`). A hired worker carries them. Required, so a caller that
   * builds `{ id, kind }` by hand can't register a worker as taking no message
   * by forgetting them: pass `{}` to say the worker has no door.
   */
  actions: Readonly<Record<string, unknown>>;
  /** The worker's display name; absent or `null` when it has none, and a view shows its id. */
  name?: string | null;
  /** Its team's display name; absent or `null` when the team has none, or the worker has no team. */
  teamName?: string | null;
}

/** What the binder registers: the workers that were hired. */
export interface InventoryRoster {
  /** The registered workers: `inventoryWorkers(installation)`, the standard workers with their flows' actions. */
  workers: readonly InventoryWorker[];
}

/** One action the binder asks the app's door to run. */
export interface InventoryActionRequest {
  /** The action's name: {@link INVENTORY_REGISTER_WORKERS}. */
  action: string;
  /** The action's input: the worker rows. */
  input: unknown;
  /** The user the run is made as. */
  userId: string;
  /** The org the rows are written in. Always present: the binder refuses without one. */
  orgId: string;
  /** The flow to run on: the worker writer's. */
  flowKind: string;
  /** The session to run in: the worker writer's. */
  sessionId: string;
  /**
   * `"internal"`: the worker write.
   *
   * The worker-registration action lives only in the flow's `internal.actions`
   * map, not its public one (see `inventoryWriterActions` in
   * `worker-writer.ts`), because its whole input is caller-supplied row data
   * with nothing to validate it against. `run` must forward this straight
   * into `runAction`'s own `source` option — `runAction({ source:
   * request.source, ... })` — so the worker write resolves from `internal.actions`
   * instead of the public one. A door that drops this field on the floor
   * makes the worker write unreachable rather than insecure: `resolveEntry`
   * reads one map per dispatch type with no fallback, so a `run` that always
   * dispatches as `"http"` gets `no-entry` for the worker write, never a
   * public hit on it.
   */
  source?: string;
}

/** Where the worker rows are written. @see OpenInventoryOptions.workerWriter */
export interface InventoryWorkerWriter {
  /** A flow kind carrying {@link INVENTORY_REGISTER_WORKERS}. */
  flowKind: string;
  /** The session to run the write in. Defaults to {@link INVENTORY_WORKER_WRITER_SESSION}. */
  sessionId?: string;
}

/**
 * The session the worker write runs in when the caller names none.
 *
 * An ordinary session on the writer's flow, created on the first boot and
 * reused after.
 */
export const INVENTORY_WORKER_WRITER_SESSION = "inventory-binder";

export interface OpenInventoryOptions {
  /**
   * The action door — one call, for the workers.
   *
   * Structurally typed and supplied by the app, because this package depends
   * on no client package. It is a one-liner over whatever the app already uses
   * to run an action:
   *
   * ```ts
   * const run = (req) =>
   *   createClient({ baseUrl, userId: req.userId })
   *     .flow(req.flowKind)
   *     .send(req.action, req.input, { sessionId: req.sessionId });
   * ```
   *
   * **It must reject when the action fails.** A door that hands back a failed
   * run as an ordinary value reports the workers written when nothing was, and
   * the binder has no other way to tell: an action's return value
   * arrives in whatever shape that door gives it, so the rejection is the only
   * signal this package can read.
   *
   * Return the action's output, or a run result carrying it as `output`
   * (`runAction`'s shape), and `InventoryBinding.workers` counts the worker rows
   * that actually landed; any other return counts the rows sent.
   */
  run: (request: InventoryActionRequest) => Promise<unknown>;

  /**
   * Where the WORKER rows are written.
   *
   * A worker has no session of its own, and a collection can only be written from
   * inside a running flow — so the worker rows need a flow to run in, and the
   * binder cannot derive one. Any flow of the app's own that spreads
   * `inventoryWriterActions()` into its `internal.actions` carries the writer.
   * Naming it is one line, and it is the single thing
   * about this call that is not already decided by the roster.
   *
   * Required when the roster carries workers, and refused by name when it is
   * missing. A roster with no workers does not need one.
   */
  workerWriter?: InventoryWorkerWriter;

  /** The user the run is made as. */
  userId: string;

  /**
   * The org the rows are written in.
   *
   * Optional in this type only because the boot options beside it are; a run
   * without one is refused. The inventory is org-scoped storage, so a write
   * with no org goes somewhere no flow in the app can read back — the failure
   * is an inventory that reads empty everywhere, which points at nothing.
   */
  orgId?: string;
}

/** What one boot wrote, and what it could not. */
export interface InventoryBinding {
  /**
   * How many worker rows were written. The count is the worker action's own, read
   * from what `run` returns: the action's output, or a run result carrying it
   * as `output`. A door whose return carries neither (an HTTP action client
   * returns no output) gets the number of rows sent instead.
   */
  workers: number;
  /**
   * What failed, named. Never thrown: the caller decides whether a workerless
   * inventory is worth refusing to boot over.
   */
  problems: string[];
}

/**
 * The worker action's `written` count from what the door returned: the action's
 * output itself, or a run result carrying it as `output` (what `runAction`
 * returns). `undefined` when the return carries neither.
 */
function writtenOf(ran: unknown): number | undefined {
  const read = (value: unknown) => {
    const written = (value as { written?: unknown } | null | undefined)?.written;
    return typeof written === "number" ? written : undefined;
  };
  return read(ran) ?? read((ran as { output?: unknown } | null | undefined)?.output);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Fill the org's live inventory: one row per hired worker.
 *
 * Re-running over an unchanged roster is a no-op: every write is keyed by the
 * record's own id, so nothing duplicates and nothing appends.
 *
 * @param roster  The hired workers.
 * @param options `run`: the action door. `workerWriter`: the flow the worker rows
 *   are written through. `userId` / `orgId`: who and where.
 * @returns What was written, and one named entry per failure. Nothing is
 *   retried.
 * @throws If no `orgId` was given, or if the roster carries workers and no
 *   `workerWriter` was named. Both are wiring mistakes an app should not boot
 *   past — a run that continued would report success and write where nobody
 *   can read. An app with no authentication passes `DEFAULT_ORG_ID`
 *   explicitly; it is the absent value, not that one, that is refused.
 */
export async function openInventory(
  roster: InventoryRoster,
  options: OpenInventoryOptions
): Promise<InventoryBinding> {
  const workers = orderedById(roster.workers);

  // `openInventory` writes through trusted direct execution, below any
  // resolver, so it names the organization itself (BR-4) — an ABSENT one is
  // refused rather than guessed. The inventory is org-scoped storage: an app
  // that authenticates and forgets to pass its verified organization would
  // write its entire inventory into a namespace none of its sessions read
  // back, and the only symptom is an inventory that reads empty everywhere,
  // which points at nothing.
  //
  // Naming `DEFAULT_ORG_ID` explicitly is a different thing and goes through
  // (D3): a development app with no resolver has its sessions bound to the
  // framework default, and saying so here is how its rows land where those
  // sessions read them. The refusal is about the caller who said nothing.
  const orgId = options.orgId;
  if (orgId === undefined) {
    throw new Error(
      `openInventory was given no \`orgId\`. The inventory is org-scoped storage, so a write ` +
        `with no organization lands where no flow in the app can read it back. Pass the same ` +
        `organization the app's sessions are opened under — the verified one if the app ` +
        `authenticates, or \`DEFAULT_ORG_ID\` from \`@flow-state-dev/core\` if it does not.`
    );
  }

  if (workers.length > 0 && options.workerWriter === undefined) {
    throw new Error(
      `openInventory was given ${workers.length} worker${workers.length === 1 ? "" : "s"} and no ` +
        `\`workerWriter\`. A worker has no session, so its row has to be written from inside some ` +
        `flow, and there is nothing in the roster that says which. Pass ` +
        `\`workerWriter: { flowKind }\` naming a flow kind whose \`internal.actions\` spread ` +
        `\`inventoryWriterActions()\`.`
    );
  }

  const problems: string[] = [];
  let workersWritten = 0;

  if (workers.length > 0) {
    const writer = options.workerWriter!;
    try {
      const ran = await options.run({
        action: INVENTORY_REGISTER_WORKERS,
        // Id, kind, door, rules, display names, origin and incarnation only. A worker's row is the whole of what the
        // inventory knows about it, and everything else on a record is the
        // declared layer's to answer.
        input: {
          workers: workers.map((worker) => ({
            id: worker.id,
            kind: worker.kind,
            door: workerDoorOf(worker).door,
            rules: Object.hasOwn(worker.actions, STANDING_RULES_ACTION),
            name: worker.name ?? null,
            teamName: worker.teamName ?? null,
            hired: false,
            incarnation: null,
          })),
        },
        userId: options.userId,
        orgId,
        flowKind: writer.flowKind,
        sessionId: writer.sessionId ?? INVENTORY_WORKER_WRITER_SESSION,
        // The worker writer lives in `internal.actions` only — see
        // `InventoryActionRequest.source`.
        source: "internal"
      });
      // The action's own count is the one reported, when the door hands it back.
      workersWritten = writtenOf(ran) ?? workers.length;
    } catch (error) {
      // Collected, not thrown: the caller is the one that knows whether a
      // workerless inventory is worth refusing to boot over.
      problems.push(`the worker rows could not be written — ${messageOf(error)}`);
    }
  }

  return { workers: workersWritten, problems };
}

/**
 * Records ordered by id, so one run's rows and refusals read in a stable order.
 */
export function orderedById<T extends { id: string }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
