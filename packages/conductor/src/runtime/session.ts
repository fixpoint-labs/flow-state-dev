/**
 * `openConductor` — one process's handle on durable state.
 *
 * This is the entry point everything else in `./` is reached through: put a
 * work item under management, tick it, read it back. **Re-opening it over the
 * same `statePath` is a restart**, and that is not a metaphor — the returned
 * object holds no entity, no phase, no gate and no cursor of its own. Every
 * answer comes from the store, every gate is derived from a world read on the
 * spot, so dropping the handle mid-gate loses precisely nothing.
 *
 * ```
 * openConductor({ config, statePath })
 *   └─ manage(item) ──▶ registry row, entity row, the work item's own prose
 *   └─ tick(id)     ──▶ observe → decide → execute → ledger      (./tick)
 *   └─ read(id)     ──▶ the same answer, reducing nothing
 * ```
 *
 * **Where a work item lives.** Session identity is minted here and read back
 * afterwards, never derived: `manage` mints one session id per work item and
 * writes it to the org-scoped registry, and every later call reads that row to
 * find out where the item's state is. An id computed from the issue key would
 * be one two processes could compute their way to different answers about; a
 * value written once is not.
 *
 * M1 manages **top-level work** — an epic, or an issue running without one — so
 * a managed item's own session is its lineage root and the two session
 * altitudes resolve to the same address. That is the case `entities.ts` calls
 * out as needing no special handling. What it does *not* yet cover is an issue
 * running under an epic, which needs a workstream session whose lineage is the
 * epic's: the registry has one `sessionId` per row and nowhere to record the
 * second id, so the address exists in `./collections` and nothing mints it yet.
 */

import { createGitHubClient } from "../github/client";
import { githubObserver } from "../github/observe";
import { defaultGitRunner } from "../config/discover";
import type { ResolvedConductor } from "../config/define";
import type { GitRunner } from "../dispatch/branch";
import type { Observer } from "../observe/types";
import type { EntityKind, Phase } from "../model/phases";
import type { IssueType, RegistryEntryState } from "../model/entities";
import { conductorRegistry } from "../model/entities";
import {
  collectionHandle,
  conductorCollections,
  type ConductorCollections,
  type ConductorScopeIds,
} from "./collections";
import { fileStateStore, type StateStore } from "./store";
import {
  ConductorNotManagedError,
  managedWork,
  mintSessionId,
  observeWorld,
  runTick,
  type ManagedWork,
  type TickContext,
} from "./tick";
import type { RuntimeDeps } from "./deps";

/**
 * What conductor is asked to take on.
 *
 * A union rather than one interface with optional halves: `issueType` is a
 * routing key an issue must have and an epic has no concept of, and a shape
 * that lets you omit it for an issue would be a shape that quietly defaults it.
 */
export type WorkItem = IssueWorkItem | EpicWorkItem;

/** Fields both kinds of work item carry. */
interface WorkItemBase {
  readonly id: string;
  /**
   * The phase the item enters at. Stated by the caller, not derived: a bug
   * enters at implementation and a feature at spec, and conductor does not do
   * that routing today — see `goals/conductor/…/goal.md`.
   */
  readonly phase: Phase;
  /**
   * What the work item asks for, in plain language. Stored as the entity's
   * resource **content** and carried into every phase brief. `decide` never
   * reads it, which is exactly why it is content rather than state.
   */
  readonly summary?: string;
  /** The tracker's own identifier, when a connector supplies one. */
  readonly externalKey?: string | null;
}

/** One unit of work moving through the issue phases. */
export interface IssueWorkItem extends WorkItemBase {
  readonly kind: "issue";
  /** Selects discipline and review lenses. Not a state machine. */
  readonly issueType: IssueType;
}

/** A set of related issues under a shared objective. */
export interface EpicWorkItem extends WorkItemBase {
  readonly kind: "epic";
}

/** One conductor process's handle on durable state. Re-opening it is a restart. */
export interface ConductorSession {
  /**
   * Put a work item under management. **Idempotent on `id`**: managing an item
   * conductor already holds returns it as it stands and rewinds nothing — a
   * second call with an earlier phase must not un-do a running item.
   */
  manage(item: WorkItem): Promise<ManagedWork>;
  /**
   * One tick: read the world, reduce, execute the actions, append the ledger.
   *
   * **Ticks for one entity run one at a time within a process**, so a cron
   * sweep and a webhook arriving together produce one dispatch rather than two.
   * The boundary of that guarantee — and what is left unprotected — is on
   * `serializeTick` in this file.
   */
  tick(entityId: string): Promise<ManagedWork>;
  /** Read the item back without ticking — reduces nothing, persists nothing. */
  read(entityId: string): Promise<ManagedWork>;
}

/** What {@link openConductor} needs. Only the first two have no default. */
export interface OpenConductorInput {
  /** Everything resolved from the config file and the machine. */
  readonly config: ResolvedConductor;
  /** Durable location the ledger, entities, and observations live in. */
  readonly statePath: string;
  /**
   * How the world is read. Defaults to GitHub, built from the config's repo and
   * token. A local checkout (`localObserver`) is the other implementation, and
   * is what makes the loop runnable without burning real pull requests.
   */
  readonly observer?: Observer;
  /**
   * The org the registry is addressed under. Org-scoped state requires the
   * request to resolve one from its principal, and a CLI binds none — so it
   * defaults to the repository under management, which is the coarsest thing a
   * standalone conductor genuinely knows about itself.
   */
  readonly orgId?: string;
  /** How git is run for workspace provisioning. Defaults to spawning `git`. */
  readonly git?: GitRunner;
  /** The clock. Defaults to the wall clock. */
  readonly now?: () => Date;
  /** The store. Defaults to a directory under `statePath`. */
  readonly store?: StateStore;
}

/** The org a standalone conductor addresses its registry under. */
function defaultOrgId(config: ResolvedConductor): string {
  return `${config.repo.host}/${config.repo.owner}/${config.repo.repo}`;
}

/**
 * Ticks in flight, keyed by the state directory and entity they run against.
 *
 * Module-level rather than per-session because the thing being serialized is the
 * durable state, not the handle: two handles over one `statePath` in one process
 * is the ordinary shape — a cron sweep and a webhook route both open conductor.
 */
const ticksInFlight = new Map<string, Promise<void>>();

/**
 * Run one tick with every other tick for the same entity queued behind it.
 *
 * A tick is a read-modify-write and no part of it is atomic: it reads the
 * ledger's last `seq`, the observation cursor and the dispatch count, reduces,
 * hands work to a vendor, then writes. Two overlapping ticks — the cron sweep and
 * the webhook conductor is *meant* to be driven by, arriving together — read the
 * same three values, mint the same ledger key and the same dispatch id, and
 * independently run the same paid dispatch. The atomic rename that follows makes
 * the records agree, so the store looks correct while the money has been spent
 * twice, and no count read back from storage can tell you it happened.
 * Serializing the whole cycle is what makes the second tick observe the first
 * one's rows and reduce to nothing.
 *
 * **What this does not cover, stated rather than implied: a second process.**
 * The queue is a promise chain in one process's memory. A cron job and a webhook
 * handler deployed as *separate processes* over the same `statePath` race exactly
 * as they did before, so **one process per `statePath` is a deployment
 * requirement**. A durable lock is the fix for that and is not a drop-in: it has
 * to be held across a dispatch that can run for many minutes, so a lease short
 * enough to recover from a holder that crashed is also short enough to expire
 * under one that is merely working — and an expiry there re-opens this exact
 * duplicate. Conductor has no answer to that yet, which is a real gap rather
 * than a decision.
 */
async function serializeTick<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = ticksInFlight.get(key) ?? Promise.resolve();
  // Queued behind the predecessor whether it resolved or threw: a tick that
  // failed still leaves the state it wrote, and the next one must read it.
  const mine = previous.then(run, run);
  const settled = mine.then(
    () => undefined,
    () => undefined,
  );
  ticksInFlight.set(key, settled);
  try {
    return await mine;
  } finally {
    if (ticksInFlight.get(key) === settled) ticksInFlight.delete(key);
  }
}

/**
 * Open conductor over a durable state directory.
 *
 * @param input The resolved config, where state lives, and any seam overrides.
 * @returns A session whose every answer is read back from the store.
 */
export async function openConductor(input: OpenConductorInput): Promise<ConductorSession> {
  const { config, statePath } = input;
  const store = input.store ?? fileStateStore(statePath);
  const orgId = input.orgId ?? defaultOrgId(config);
  const now = input.now ?? (() => new Date());
  const git = input.git ?? defaultGitRunner;

  const observer =
    input.observer ??
    githubObserver(
      createGitHubClient({
        owner: config.repo.owner,
        repo: config.repo.repo,
        token: config.token,
      }),
    );

  const deps: RuntimeDeps = { config, observer, dispatcher: config.dispatcher, git, now };

  // The registry on its own, addressed before any work item's session is known
  // — which is the only collection that can be. Building the whole set here
  // would raise on the session-scoped ones, correctly.
  const registry = collectionHandle(store, conductorRegistry, {
    orgId,
    sessionId: null,
    lineageId: null,
  });

  /**
   * Top-level work is its own lineage root, so both session altitudes resolve
   * to the session the registry recorded. See this file's header for the case
   * this does not yet cover.
   */
  const scopesFor = (entry: RegistryEntryState): ConductorScopeIds => ({
    orgId,
    sessionId: entry.sessionId,
    lineageId: entry.sessionId,
  });

  /** Resolve a managed item to the collections its state lives in. */
  async function contextFor(entityId: string): Promise<TickContext> {
    const entry = await registry.read(entityId);
    if (!entry) throw new ConductorNotManagedError(entityId);
    const collections: ConductorCollections = conductorCollections(store, scopesFor(entry));
    return { entityId, entityKind: entry.kind as EntityKind, collections, deps };
  }

  /** Read an item back, deriving its gate from a world read on the spot. */
  async function read(entityId: string): Promise<ManagedWork> {
    const context = await contextFor(entityId);
    const ledger = (await context.collections.ledger.list())
      .filter((row) => row.entityId === entityId)
      .sort((a, b) => a.seq - b.seq);

    const stored =
      context.entityKind === "epic"
        ? await context.collections.epics.read(entityId)
        : await context.collections.issues.read(entityId);
    if (!stored) throw new ConductorNotManagedError(entityId);

    const entity = {
      id: stored.id,
      kind: context.entityKind,
      // The ledger is the authority for a transition; a stored phase behind it
      // is a process killed between a row and the entity write that follows it.
      // `runTick` repairs it durably — a read reports it.
      phase: (ledger.at(-1)?.phaseAfter ?? stored.phase) as Phase,
    };

    return managedWork(context, entity, await observeWorld(context, entity));
  }

  /** Create the item's entity row and its prose, once. */
  async function createEntity(
    collections: ConductorCollections,
    item: WorkItem,
  ): Promise<void> {
    if (item.kind === "epic") {
      if ((await collections.epics.read(item.id)) !== null) return;
      await collections.epics.write(item.id, {
        id: item.id,
        kind: "epic",
        // Safe by construction: an epic is managed into an epic phase, and a
        // phase outside its kind's table reduces to no transition anyway.
        phase: item.phase as "FRAMING",
        externalKey: item.externalKey ?? null,
        lastSignalAt: null,
      });
      if (item.summary !== undefined) {
        await collections.epics.writeContent(item.id, item.summary);
      }
      return;
    }

    if ((await collections.issues.read(item.id)) !== null) return;
    await collections.issues.write(item.id, {
      id: item.id,
      kind: "issue",
      phase: item.phase as "SPEC",
      issueType: item.issueType,
      epicId: null,
      externalKey: item.externalKey ?? null,
      lastSignalAt: null,
    });
    if (item.summary !== undefined) {
      await collections.issues.writeContent(item.id, item.summary);
    }
  }

  return {
    async manage(item) {
      const existing = await registry.read(item.id);
      const entry: RegistryEntryState = existing ?? {
        id: item.id,
        kind: item.kind,
        sessionId: mintSessionId(),
        addedAt: now().toISOString(),
      };
      if (!existing) await registry.write(item.id, entry);

      await createEntity(conductorCollections(store, scopesFor(entry)), item);
      return read(item.id);
    },

    async tick(entityId) {
      // The registry read is inside the queue with the rest of the cycle: it is
      // where the entity's session — and so every address the tick writes to —
      // comes from. NUL joins the two halves because it occurs in neither a path
      // nor an id, so no two pairs can collide on one key.
      return serializeTick(`${statePath}\u0000${entityId}`, async () =>
        runTick(await contextFor(entityId)),
      );
    },

    read,
  };
}
