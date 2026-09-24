/**
 * The seats and channels manifest sources (FIX-817) — the workforce's two
 * projections into the discovery door.
 *
 * ## Two layers, joined, because neither one alone is an honest answer
 *
 * The **declared** layer (a tree of `WORKER.md` and `CHANNEL.md`) is the only
 * place a *purpose* is written: a seat's `description:` is what an orchestrator
 * picks on. It cannot say what is live — a file has no idea whether its channel
 * was ever opened.
 *
 * The **live** layer (FIX-1405's `inventory/seats/*` and `inventory/channels/*`)
 * knows what actually got registered in this org. It cannot say what anything is
 * for: a row carries an id, a kind, and for a channel its members. And it is
 * **append-only** — `open-inventory.ts` is explicit that "a row means *was
 * registered in this org*, not *still declared*", and nothing ever reconciles or
 * deletes. So a row on its own cannot mean *open*.
 *
 * An entry is therefore projected only where BOTH layers answer. That is the
 * liveness filter (BR-12a) and it is also what makes a well-formed entry
 * possible at all: a row with no declaration behind it has no purpose line, and
 * an entry whose purpose reads "unknown" is exactly the entry an orchestrator
 * must not plan against. An orchestrator is never handed a channel that has
 * closed — closing removes the declaration, and the row alone no longer
 * qualifies.
 *
 * The direction of the error is deliberate. A partial roster (one boot's view
 * of a tree another process also writes to) under-reports rather than
 * over-reports, and a missing seat costs a planner one `discover` call while a
 * phantom one costs it the task.
 *
 * ## Where the declared half is read
 *
 * From BOOT state, handed in once — the file tree — plus, when the app names
 * the hired-roster key, from that collection at call time. A runtime hire has
 * no file; its roster row is the declared half so Discover can see it
 * (FIX-1526). `readDeclaredRoster` is a synchronous filesystem tree walk, and
 * this runs behind a tool a model may call on every step — so the file tree is
 * resolved where the app already resolves it and passed here as data. That is
 * also why this module is node-free and lives at the package root rather than
 * behind `./loader`.
 *
 * Neither reader is modified. The inventory's storage keys and row schemas are
 * a public surface with persisted data behind them; these sources read them and
 * write nothing. The hired roster is the same: this module reads it.
 */

import type { BlockManifestSource, ManifestEntry } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { resolveResourceCollection } from "@flow-state-dev/orchestration";
import type { ChannelManifest, WorkerManifest } from "./manifest";
import type { ChannelInventoryRow, SeatInventoryRow } from "./inventory/collections";
import { hiredSeatManifestFromStored } from "./roster/rows";

/**
 * The declared half, as the sources need it — a structural subset of
 * `DeclaredRoster`, so `readDeclaredRoster(...)`'s result satisfies it
 * directly.
 *
 * Typed this loosely on purpose: a hand-built roster is as valid a declaration
 * as a walked tree, and requiring the loader's exact return would drag a
 * node-only type into a node-free module.
 */
export interface DeclaredWorkforce {
  /** One record per declared worker. */
  workers: readonly WorkerManifest[];
  /** One record per declared channel. */
  channels: readonly ChannelManifest[];
}

/**
 * Which resource-registry keys the live inventory collections are mounted
 * under, on the block that carries the door.
 *
 * A key is how a source finds its collection at call time; a domain whose key
 * is omitted registers no source at all, so the door simply carries one domain
 * fewer. That is the ordinary state for an app that opened channels but wired
 * no seat inventory, and it reads as "nothing here" rather than as a fault.
 */
export interface InventoryKeys {
  /** Registry key for the seat inventory (`defineSeatInventoryCollection`). */
  seats?: string;
  /** Registry key for the channel inventory (`defineChannelInventoryCollection`). */
  channels?: string;
}

export interface WorkforceManifestSourceOptions {
  /** What the tree declared, resolved at boot. */
  roster: DeclaredWorkforce;
  /** Where the live rows are mounted. A domain with no key gets no source. */
  inventory: InventoryKeys;
  /**
   * Registry key for the durable hired roster (`defineHiredRosterCollection`).
   *
   * When named, a roster row with no file is the declared half for that seat
   * — so Discover sees a runtime hire the same way it sees a file-declared
   * one (FIX-1526). Omitted, only the boot-resolved file tree is declared,
   * which is the ordinary state for an app that does not hire at runtime.
   */
  hiredRoster?: string;
}

/**
 * One line saying what a declared record is for — its `description:`, or
 * for a runtime hire its instructions.
 *
 * Required on a `CHANNEL.md` by the reader and conventional on a `WORKER.md`
 * (the hire step reserves the key). A record that carries none falls back to
 * its id, which is all the declaration actually says.
 */
function purposeOf(
  declared: Record<string, unknown>,
  id: string,
  noun: string,
  instructions?: string,
): string {
  const described = declared["description"];
  if (typeof described === "string" && described.trim() !== "") return described.trim();
  if (typeof instructions === "string" && instructions.trim() !== "") return instructions.trim();
  return `The ${noun} "${id}". Its file declares no description.`;
}

/**
 * The org this discover call runs under, from the verified principal.
 */
function orgOf(ctx: BlockContext): string | undefined {
  const orgId = ctx.org?.identity.orgId ?? ctx.org?.identity.id;
  return typeof orgId === "string" && orgId.length > 0 ? orgId : undefined;
}

/**
 * List one collection's rows, or throw a message naming the key.
 *
 * A registered source pointed at a collection this scope does not hold is a
 * wiring mistake, not an empty domain — the door degrades it to a `problem` on
 * this domain and every other domain still answers.
 *
 * Resolved through `resolveResourceCollection` rather than a bare
 * `ctx.resources[key]`, so a key means the same thing here that it means to
 * every other collection consumer in the framework — including its `get()` and
 * pattern-prefix fallbacks.
 *
 * **This lists the whole collection and keeps a subset, which is the thing
 * BP-033 tells you not to do.** Stated here rather than left for a reader to
 * find: an inventory row is never deleted, so the listed set grows with every
 * seat and channel ever registered in the org while the kept set stays bounded
 * by what the tree currently declares — and this sits behind a tool a model may
 * call on every step.
 *
 * It is still the right read today. The alternative is a `getOptional` per
 * declared record, which trades one list for N point reads and is only cheaper
 * once the dead rows outnumber the live ones. Nothing in the framework pushes
 * a filter into the store for these keys (`membershipPrefix` says the same
 * about its own prefix), so there is no third option. Revisit it when an org's
 * historical rows are an order of magnitude past its roster; until then the
 * list is one read and the join is in memory.
 */
async function listRows<T>(
  ctx: BlockContext,
  key: string,
  domain: string,
): Promise<{ state: T }[]> {
  const collection = resolveResourceCollection(ctx, key);
  if (collection === undefined) {
    throw new Error(
      `The ${domain} collection "${key}" is not registered on ctx.resources. ` +
        `Install it on the block that carries the discovery door, or drop that key ` +
        `from createWorkforceCapability.`,
    );
  }
  return ((await collection.list()) ?? []) as unknown as { state: T }[];
}

/**
 * The seats domain: registered seats that are still declared.
 *
 * `kind` on the entry is the manifest kind (`"seat"`), not the flow kind the
 * seat was hired into — that one is a fact about how it runs and belongs on the
 * contract line, where a planner reads it only when it asks for detail.
 */
function seatsSource(
  roster: DeclaredWorkforce,
  key: string,
  hiredRosterKey?: string,
): BlockManifestSource {
  const files = new Map(roster.workers.map((worker) => [worker.id, worker]));
  return {
    domain: "seats",
    origin: "createWorkforceCapability",
    entries: async (ctx: BlockContext): Promise<ManifestEntry[]> => {
      const declared = new Map(files);
      if (hiredRosterKey !== undefined) {
        const orgId = orgOf(ctx);
        if (orgId !== undefined) {
          for (const stored of await listRows<unknown>(ctx, hiredRosterKey, "hired roster")) {
            // One bad row is one skip, as in `reloadHiredSeats` — which names
            // each skipped row in its `problems`. Discover skips silently: a
            // row it cannot list is simply not a seat here.
            const record = hiredSeatManifestFromStored(orgId, stored.state);
            if ("problem" in record) continue;
            if (!declared.has(record.manifest.id)) {
              declared.set(record.manifest.id, record.manifest);
            }
          }
        }
      }

      const entries: ManifestEntry[] = [];
      for (const row of await listRows<SeatInventoryRow>(ctx, key, "seats")) {
        // A row that lost its required fields reads back empty rather than
        // throwing (the collection's schema is closed and required) — guard it
        // the same way a row written before an optional field is guarded.
        const id = row.state?.id;
        if (typeof id !== "string" || id === "") continue;
        const worker = declared.get(id);
        if (worker === undefined) continue;
        const kind = row.state.kind;
        entries.push({
          id,
          kind: "seat",
          purpose: purposeOf(worker.declared, id, "seat", worker.body),
          contract:
            `Hired into the "${typeof kind === "string" && kind !== "" ? kind : "agent"}" ` +
            `worker kind. Hand it work by its id.`,
        });
      }
      return entries;
    },
  };
}

/**
 * The channels domain: registered channels that are still declared.
 *
 * `members` and `openedAt` are `== null`-guarded rather than assumed: both
 * carry defaults for rows written before they existed (BP-030), and a row that
 * predates them projects normally instead of failing the entry.
 *
 * **The contract states addressing, never liveness.** A manifest entry means
 * the channel is declared and has an inventory row — both survive a closed or
 * deleted session, because the declaration map is built at boot and the
 * inventory is append-only (FIX-1485: rows never close). So the entry says how
 * the channel is addressed and stops there. Telling the model to post to it
 * would be the catalog claiming something it cannot see, and the model has no
 * way to learn otherwise until the post fails. `openedAt` is kept because it is
 * a recorded past event rather than a claim about now.
 */
function channelsSource(roster: DeclaredWorkforce, key: string): BlockManifestSource {
  const declared = new Map(roster.channels.map((channel) => [channel.id, channel]));
  return {
    domain: "channels",
    origin: "createWorkforceCapability",
    entries: async (ctx: BlockContext): Promise<ManifestEntry[]> => {
      const entries: ManifestEntry[] = [];
      for (const row of await listRows<ChannelInventoryRow>(ctx, key, "channels")) {
        const id = row.state?.id;
        if (typeof id !== "string" || id === "") continue;
        const channel = declared.get(id);
        if (channel === undefined) continue;
        const members = row.state.members ?? [];
        const openedAt = row.state.openedAt;
        entries.push({
          id,
          kind: "channel",
          purpose: purposeOf(channel.declared, id, "channel"),
          contract:
            `${members.length} member${members.length === 1 ? "" : "s"}` +
            `${members.length > 0 ? `: ${members.join(", ")}` : ""}. ` +
            `${openedAt == null ? "Opened at an unrecorded time." : `Opened ${openedAt}.`} ` +
            `Addressed by its id. Listed here means registered, not open.`,
        });
      }
      return entries;
    },
  };
}

/**
 * The workforce's manifest sources — one per domain whose inventory key was
 * named.
 *
 * Exported beside `createWorkforceCapability` for an app that assembles its own
 * registry (a flow that is not a worker kind, say). The capability is the
 * ordinary door and calls this.
 *
 * @param options The boot-resolved roster and the inventory registry keys.
 * @returns Zero, one or two sources, seats first.
 */
export function workforceManifestSources(
  options: WorkforceManifestSourceOptions,
): BlockManifestSource[] {
  const sources: BlockManifestSource[] = [];
  if (options.inventory.seats !== undefined) {
    sources.push(seatsSource(options.roster, options.inventory.seats, options.hiredRoster));
  }
  if (options.inventory.channels !== undefined) {
    sources.push(channelsSource(options.roster, options.inventory.channels));
  }
  return sources;
}
