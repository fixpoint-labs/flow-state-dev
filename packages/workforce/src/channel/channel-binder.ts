/**
 * The channel binder, in two phases because they happen at two times.
 *
 * `channelInstances` is build time and synchronous: it returns the instances to
 * register, one per DISTINCT kind, with the built-in seeded under `"channel"`
 * unless the caller passed their own. `openChannels` is runtime: it opens one
 * named session per record, at the record's own id, carrying that channel's
 * members and charter.
 *
 * Nothing is minted per record. A hundred channel files are a hundred sessions
 * on one instance, and the word `mint` is avoided here for that reason.
 *
 * **The two are paired: every roster `openChannels` opens must be one
 * `channelInstances` already validated.** `validate` is reached only from
 * `channelInstances`, so a caller that runs `openChannels` alone over a
 * hand-built roster gets no refusal at all — most visibly, a record carrying
 * BOTH a body and a frontmatter `instructions:` silently takes the body
 * (`stateFor`'s precedence) where `validate` would have refused it as two
 * sources for one setting.
 *
 * **Why the whole closed key list lives here.** Under an instance-per-channel
 * shape the flow's own `configSchema` refused an undeclared `CHANNEL.md` key
 * for free. It cannot now: per-channel facts are session state, and the session
 * route parses caller state against `stateSchema` but falls back to the
 * caller's RAW state on a parse failure — validation happens at
 * action-execution time, not at session create. So the route is not a
 * gatekeeper, and every refusal is this module's, checked in the one pass where
 * the roster is already being walked.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";
import {
  INSTRUCTIONS_KEY,
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type ChannelManifest
} from "../manifest";
import {
  CHANNEL_KIND,
  boundChannel,
  channelFlow,
  defineChannelFlow,
  holdsBoards,
  type ChannelSessionState
} from "./channel-flow";
import {
  CHANNEL_BOARDS_KEY,
  channelBoardId,
  channelBoardNameProblem
} from "./channel-board";

/**
 * Every key a `CHANNEL.md` may declare. Closed, and checked by name.
 *
 * `flow` is consumed and stripped — it selects the kind and never reaches
 * state. The other four are the channel's own facts. Anything else refuses,
 * including `id`, which is the record's identity rather than a setting.
 *
 * `boards` is the fifth member and the newest: a list of plain local names,
 * read exactly as `members` is. It never carries an id — the ledger's identity
 * is minted from where the channel sits.
 */
const DECLARABLE_KEYS = [
  "flow",
  "description",
  "members",
  CHANNEL_BOARDS_KEY,
  INSTRUCTIONS_KEY
] as const;

/**
 * A channel kind: a flow factory carrying the same identity contract the
 * built-in does — `cardinality: "singleton"`, so `flow.id === flow.kind`.
 *
 * Typed loosely on purpose. A kind's blocks and state shape are its own; what
 * this module needs of one is its `kind` and the ability to mint its single
 * instance, and asserting more would restate a guarantee the flow registry
 * makes at registration.
 */
export type ChannelKind = { kind: string } & (() => FlowInstance);

export interface ChannelInstancesOptions {
  /**
   * The channel kinds this app registers, by kind name. **The whole
   * registration surface, and the rare escape hatch** — an app registers
   * nothing to use channels, because the built-in is seeded under `"channel"`
   * when this map does not carry that key.
   *
   * Pass a kind here only when the workflow graph genuinely diverges. A record
   * whose `flow:` names a key that is not here refuses; it never falls back to
   * the built-in.
   */
  kinds?: Record<string, ChannelKind>;

  /**
   * Build the **built-in** kind carrying the live inventory's writer half, so
   * every channel it opens can publish its own row.
   *
   * Off by default: with this absent nothing is declared and nothing is
   * written, and channels behave exactly as they did before the inventory
   * existed. Turning it on here is half the wiring — `openInventory` is what
   * actually runs the write, after `openChannels`.
   *
   * It reaches the built-in only. A kind passed under `kinds` is the caller's
   * to build, and it carries the writer by spreading
   * `inventoryWriterActions(itsOwnKindName)` into its own actions — the same
   * way it already carries `cardinality: "singleton"`. There is nowhere to hand
   * this to one: a custom kind is zero-arg by contract.
   */
  inventory?: boolean;
}

export interface OpenChannelsOptions {
  /**
   * The session API. `createSession` carries the whole of a channel's state,
   * because it is the only route that accepts caller-supplied `state` at
   * create; the other two exist only to answer a 409.
   *
   * Structurally typed rather than imported so this package does not take a
   * dependency on `@flow-state-dev/client`; a real `SessionClient` satisfies it.
   */
  client: {
    createSession: (options: {
      flowKind: string;
      userId: string;
      sessionId?: string;
      description?: string;
      state?: Record<string, unknown>;
    }) => Promise<unknown>;
    /**
     * Reads the session sitting behind a taken id, so a 409 can be answered on
     * WHO holds the id and whether a channel is open there, rather than on
     * whether a session exists.
     *
     * `state` is the session's raw state — the same thing the post fence reads.
     * `flowKind`, `flowId` and `userId` are the occupant's identity, and they
     * are read before anything is deleted: a session id is unique per
     * principal, not per flow, so an id collision here is somebody else's
     * ordinary session and deleting it takes their content with it.
     */
    getSession: (sessionId: string) => Promise<{
      flowKind: string;
      /** Absent on a session written before instance ownership existed (BP-030). */
      flowId?: string;
      userId: string;
      state?: Record<string, unknown>;
    }>;
    /**
     * Releases an id held by this kind's own EMPTY session, because create is
     * the only route that writes session state. Never called on a bound
     * channel, on another flow's session, on another principal's, or on one
     * carrying state this binder cannot read.
     */
    deleteSession: (sessionId: string) => Promise<void>;
  };
  /**
   * The user every channel session is bound to.
   *
   * Required, and not an oversight: a session belongs to ONE user, so a channel
   * has one too. It is also the reason the `principal` on every line of a given
   * transcript is the same value — see `channel-flow.ts`'s header.
   */
  userId: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Is this thrown thing an HTTP 409 — the session id is already taken? */
function isAlreadyOpen(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { status?: unknown }).status === 409
  );
}

/**
 * The built-in kind holding the inventory writer, built at most once.
 *
 * Memoised rather than rebuilt per call for the same reason the board ledgers
 * are: a kind is a declaration, and two declarations of one kind in one process
 * are two objects the registry would have to tell apart. Lazy rather than a
 * module-level `const`, so an app that never turns the inventory on never
 * builds it.
 */
let inventoryChannelFlowMemo: ReturnType<typeof defineChannelFlow> | undefined;
function inventoryChannelFlow(): ReturnType<typeof defineChannelFlow> {
  inventoryChannelFlowMemo ??= defineChannelFlow({ inventory: true });
  return inventoryChannelFlowMemo;
}

/**
 * Records ordered by id, so one run's refusals read in a stable order.
 *
 * Exported for the inventory binder, which walks the same records and owes the
 * same stable order. Not re-exported from the package root.
 */
export function orderedById<T extends { id: string }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What a record's `flow:` selects, refusing rather than guessing.
 *
 * An omitted key selects the built-in — decision 1, and the reason the first
 * file in `channels/` carries no `flow:` line. A key that IS present and names
 * nothing registered is a misconfiguration and says so; it never falls back.
 *
 * Exported for the inventory binder, which addresses each channel's session on
 * the kind that opened it and must read the record the same way `openChannels`
 * did. A second derivation is a second answer to "which flow is this channel
 * on", and the two would diverge silently. Not re-exported from the package
 * root.
 */
export function kindOf(declared: Record<string, unknown>): { kind: string } | { problem: string } {
  if (!Object.hasOwn(declared, "flow")) return { kind: CHANNEL_KIND };
  const named = declared.flow;
  if (typeof named !== "string" || named.trim().length === 0) {
    return { problem: "declares a `flow:` that is not a kind name" };
  }
  return { kind: named };
}

/**
 * The one pass every record is checked in: the closed key list, the derived
 * keys, and the kind.
 *
 * Returns the record's kind, or the reason it was refused. The checks run in
 * the order an author would want to hear them — what they may not write first,
 * then what they wrote that nobody registered.
 */
function validate(
  manifest: ChannelManifest,
  kinds: Record<string, ChannelKind>,
  available: string
): { kind: string } | { problem: string } {
  const declared = manifest.declared;

  // Refused by its own name, and before the closed-list check, so an author
  // gets the rule rather than "not a declared setting".
  if (Object.hasOwn(declared, REFUSED_SYSTEM_KEY)) {
    return { problem: REFUSED_SYSTEM_KEY_MESSAGE };
  }

  if (Object.hasOwn(declared, "id")) {
    return {
      problem:
        "declares `id:` in its frontmatter. A channel's id is its identity — and literally its " +
        "session id — and comes from where the channel is declared, never from a setting."
    };
  }

  const undeclared = Object.keys(declared).filter(
    (key) => !(DECLARABLE_KEYS as readonly string[]).includes(key)
  );
  if (undeclared.length > 0) {
    return {
      problem:
        `declares ${undeclared.map((k) => `\`${k}\``).join(", ")}, which a channel does not ` +
        `declare. A channel declares: ${DECLARABLE_KEYS.map((k) => `\`${k}\``).join(", ")}.`
    };
  }

  // A body is a charter; whitespace is not. Same rule the seat factory applies
  // to a worker's instructions, and the same refusal when both are present.
  if (manifest.body.trim().length > 0 && Object.hasOwn(declared, INSTRUCTIONS_KEY)) {
    return {
      problem:
        `declares \`${INSTRUCTIONS_KEY}:\` in its frontmatter and carries a body — two sources ` +
        `for one setting, and there is no precedence rule. Remove one: a channel's charter is ` +
        `its body.`
    };
  }

  if (Object.hasOwn(declared, "members") && !isListOfNames(declared.members)) {
    return {
      problem:
        "declares a `members:` that is not a list of names. Membership decides whether an " +
        "`author` claim is refused and who a fan-out addresses, so it is read, not displayed."
    };
  }

  if (Object.hasOwn(declared, "description") && typeof declared.description !== "string") {
    return { problem: "declares a `description:` that is not text" };
  }

  // Shape first, then each name. A `boards:` that is not a list is one problem
  // with the file, not one problem per entry.
  if (Object.hasOwn(declared, CHANNEL_BOARDS_KEY)) {
    const boards = declared[CHANNEL_BOARDS_KEY];
    if (!isListOfNames(boards)) {
      return {
        problem:
          "declares a `boards:` that is not a list of plain names. A board entry is a local " +
          "name, as a member is — the ledger's id is minted from this channel's id, so no file " +
          "writes one."
      };
    }
    for (const name of boards) {
      const problem = channelBoardNameProblem(name);
      if (problem !== undefined) {
        return { problem: `declares board "${name}", and the board name ${problem}` };
      }
    }
  }

  if (Object.hasOwn(declared, INSTRUCTIONS_KEY) && typeof declared[INSTRUCTIONS_KEY] !== "string") {
    return { problem: `declares an \`${INSTRUCTIONS_KEY}:\` that is not text` };
  }

  const selected = kindOf(declared);
  if ("problem" in selected) return selected;

  // `hasOwn` rather than a bare lookup: `flow` is author-supplied, and
  // `kinds["constructor"]` would otherwise resolve off the prototype.
  const factory = Object.hasOwn(kinds, selected.kind) ? kinds[selected.kind] : undefined;
  if (factory === undefined) {
    return {
      problem:
        `names channel kind "${selected.kind}", which was not passed to channelInstances. ` +
        `Kinds passed: ${available}`
    };
  }

  // A kind filed under someone else's name. Nothing downstream would notice —
  // the instance registers under the other kind's address and this channel's
  // sessions run that kind's graph.
  if (factory.kind !== selected.kind) {
    return {
      problem:
        `declares channel kind "${selected.kind}", but the flow passed under that key is kind ` +
        `"${String(factory.kind)}" — this channel would run a different channel's graph. ` +
        `Pass each kind under its own name.`
    };
  }

  // Boards are held by a kind this framework built, and a record pairing them
  // with any other kind is refused BY NAME rather than silently holding none.
  // A kind a caller wrote is zero-arg by contract, so there is nowhere to hand
  // it the ledger ids its records declared — and a board that quietly does not
  // exist is worse than either a widened contract or this refusal.
  if (boardNamesOf(declared).length > 0 && !holdsBoards(factory)) {
    return {
      problem:
        `declares \`${CHANNEL_BOARDS_KEY}:\` and runs on channel kind "${selected.kind}", which ` +
        `is not a kind \`defineChannelFlow\` built. Boards are the built-in channel kind's: a ` +
        `custom kind is zero-arg, so there is no way to hand it the ledgers this roster minted. ` +
        `Drop the \`flow:\` line to hold a board, or drop the \`${CHANNEL_BOARDS_KEY}:\` line to ` +
        `keep the custom kind.`
    };
  }

  return { kind: selected.kind };
}

/**
 * The board names one record declared, or none.
 *
 * Reads only a well-formed list — `validate` refuses a malformed one first, and
 * this is also reached from {@link channelBoardIds}, where a caller may be
 * holding a roster nobody validated. A shape this cannot read is *no boards*
 * here, never a guess at what was meant.
 */
function boardNamesOf(declared: Record<string, unknown>): string[] {
  const boards = declared[CHANNEL_BOARDS_KEY];
  if (!isListOfNames(boards)) return [];
  return boards.filter((name) => channelBoardNameProblem(name) === undefined);
}

/**
 * Every ledger id a roster's channels mint, sorted and deduplicated.
 *
 * The one place a roster becomes a list of ids, so the binder and the
 * hire-time unattended-board check read the same answer rather than each
 * joining channel ids to board names themselves.
 *
 * **Reads only well-formed entries.** A `boards:` this cannot read, or a name
 * that breaks the rules, counts as NO board here rather than as a guess at
 * what was meant — `channelInstances` is what refuses those, and it may not
 * have run yet. So on an unvalidated roster this returns the ids of the
 * channels that would bind and silently omits the ones that would not. Call it
 * on a roster you also pass to `channelInstances`, or the set is a subset.
 *
 * @param manifests The roster — the same records `channelInstances` registers.
 * @returns The minted ids, `<channelId>.<boardName>`, in a stable order.
 */
export function channelBoardIds(manifests: readonly ChannelManifest[]): string[] {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    for (const name of boardNamesOf(manifest.declared)) {
      ids.add(channelBoardId(manifest.id, name));
    }
  }
  return [...ids].sort();
}

function isListOfNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Turn channel records into the flow instances to register — one per DISTINCT
 * kind, never one per record.
 *
 * The built-in is seeded, so an app that registers nothing still gets channels:
 * a record with no `flow:` runs on `"channel"`. Every problem is a startup
 * misconfiguration, so every problem throws — but they are collected first, so
 * one run names all of them. Nothing is returned partially.
 *
 * @param manifests The roster — from a loader, or hand-built.
 * @param options   `kinds`: extra or replacement channel kinds, by kind name.
 * @returns One `FlowInstance` per distinct kind, ordered by id. Register these.
 * @throws If any record cannot be bound; the message names every bad channel.
 */
export function channelInstances(
  manifests: readonly ChannelManifest[],
  options: ChannelInstancesOptions = {}
): FlowInstance[] {
  // The seed: the built-in fills the map only where the caller left the key
  // free, so `kinds: { channel: mine }` replaces it wholesale. With the
  // inventory asked for, the seed is the same built-in rebuilt holding the
  // writer — a second factory rather than a flag read at run time, because the
  // collections have to be DECLARED on the flow and a declaration cannot be
  // made per request.
  const kinds: Record<string, ChannelKind> = {
    [CHANNEL_KIND]: (options.inventory === true
      ? inventoryChannelFlow()
      : channelFlow) as unknown as ChannelKind,
    ...(options.kinds ?? {})
  };
  const available = Object.keys(kinds)
    .map((k) => `"${k}"`)
    .join(", ");

  const ordered = orderedById(manifests);
  const problems: string[] = [];
  const seen = new Set<string>();
  const selected = new Set<string>();
  /** Ledger id → the channel that minted it. A collision names both. */
  const minted = new Map<string, string>();
  /** The minted ids each selected kind must be built holding. */
  const boardsByKind = new Map<string, string[]>();

  for (const manifest of ordered) {
    const refuse = (reason: string): void => {
      problems.push(`channel "${manifest.id}" — ${reason}`);
    };

    // Caught here as well as at the registry so it reads as a ROSTER problem,
    // reported alongside the others. An id is an address, and here it is
    // literally a session id.
    if (seen.has(manifest.id)) {
      refuse("declared twice in this roster; a channel's id is its session id and must be unique");
      continue;
    }
    seen.add(manifest.id);

    const result = validate(manifest, kinds, available);
    if ("problem" in result) {
      refuse(result.problem);
      continue;
    }
    selected.add(result.kind);

    // Minted here rather than in `validate`, because uniqueness is a fact
    // about the ROSTER and not about one record. An id is a storage key: two
    // channels minting one is two teams' work in a single ledger, which reads
    // as rows appearing from nowhere rather than as a misconfiguration.
    for (const name of boardNamesOf(manifest.declared)) {
      const id = channelBoardId(manifest.id, name);
      const owner = minted.get(id);
      if (owner !== undefined) {
        // The two arms are not equally reachable, and saying so beats leaving a
        // reader to assume both fire. A channel id is unique across the roster
        // (refused above) and a board name carries no dot, so two DIFFERENT
        // channels cannot mint one id from any roster this package can build.
        // The second arm covers a hand-built `ChannelManifest`, whose ids are
        // caller-supplied and which this module cannot constrain — it is a
        // guard on an input it does not own, not dead code.
        refuse(
          owner === manifest.id
            ? `declares board "${name}" twice; a channel's board names are its ledger ids and ` +
                `must be unique (minted "${id}")`
            : `declares board "${name}", which mints ledger id "${id}" — already minted by ` +
                `channel "${owner}". An id is a storage key, and a duplicate is two teams' work ` +
                `in one ledger`
        );
        continue;
      }
      minted.set(id, manifest.id);
      boardsByKind.set(result.kind, [...(boardsByKind.get(result.kind) ?? []), id]);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `channelInstances refused ${problems.length} of ${ordered.length} ` +
        `channel${ordered.length === 1 ? "" : "s"}; nothing was registered:\n  - ${problems.join("\n  - ")}`
    );
  }

  return [...selected].sort().map((kind) => {
    const factory = kinds[kind]!;
    const boards = boardsByKind.get(kind);
    // A kind holding nothing is built exactly as it was before boards existed,
    // and `validate` has already refused the third case — boards named on a
    // kind that cannot hold them.
    return boards === undefined || !holdsBoards(factory)
      ? factory()
      : factory.withBoards(boards)();
  });
}

/**
 * The channel facts written into a channel's session at open.
 *
 * Built from named keys only, which is why an undeclared key cannot reach
 * state even though the session route would not refuse one: there is nowhere
 * for it to go.
 */
function stateFor(manifest: ChannelManifest): ChannelSessionState {
  const declared = manifest.declared;
  const charter =
    manifest.body.trim().length > 0
      ? manifest.body
      : typeof declared[INSTRUCTIONS_KEY] === "string"
        ? (declared[INSTRUCTIONS_KEY] as string)
        : "";
  return {
    members: isListOfNames(declared.members) ? declared.members : [],
    instructions: charter,
    transcript: []
  };
}

/**
 * Who holds this id, and is a channel open in it?
 *
 * Boundness is still the fence's own `boundChannel`, so the binder reads "is a
 * channel open here" exactly as the post path does. But boundness alone cannot
 * answer what to DO, and answering on it alone is how a session gets deleted:
 * a session id is unique per principal, not per flow, so an id that fails the
 * boundness test may be an ordinary session belonging to another flow entirely —
 * and the delete route takes that session's content and resource state with it.
 *
 * Three answers, because only one of the three is safe to tear down:
 *
 * - `"open"` — this kind's own bound channel, for this principal. Left exactly
 *   as it is, unless this run asked for an org the channel is not in, which is
 *   a `problem`: re-opening cannot move it.
 * - `"empty"` — this kind's own session for this principal carrying no state at
 *   all, which is precisely what the action path's create-or-get leaves behind.
 *   The only case the id is released in.
 * - a `problem` — anything else: another flow's session, another principal's,
 *   or one carrying state this binder cannot read as a channel. A collision is
 *   an operator error worth failing loudly on, and state that will not parse is
 *   data rather than an empty slot. Neither is repaired by deleting it.
 */
type ChannelOccupant = { status: "open" | "empty" } | { problem: string };

async function occupantOf(
  client: OpenChannelsOptions["client"],
  sessionId: string,
  kind: string,
  userId: string
): Promise<ChannelOccupant> {
  const session = await client.getSession(sessionId);

  if (session.flowKind !== kind) {
    return {
      problem:
        `the id is held by a "${session.flowKind}" session, not a "${kind}" one. A session id is ` +
        `unique per principal rather than per flow, so this is an id collision with somebody ` +
        `else's session — rename the channel rather than have its binder delete that session.`
    };
  }

  // `== null` per BP-030: absent on a session written before instance
  // ownership existed, and an absent owner is not a mismatched one.
  if (session.flowId != null && session.flowId !== kind) {
    return {
      problem:
        `the id is held by a session owned by flow instance "${session.flowId}" rather than by ` +
        `"${kind}". A channel kind is a singleton, so its instance address is its kind.`
    };
  }

  if (session.userId !== userId) {
    return {
      problem:
        `the id is held by a session belonging to "${session.userId}", not to "${userId}". ` +
        `A channel belongs to one user, and this one would be opened over somebody else's.`
    };
  }

  const state = session.state;
  if (state !== undefined && boundChannel(state) !== undefined) {
    // The binder used to compare the open channel's org against one this run
    // asked for. It no longer asks for one (FIX-1442): the organization is the
    // server's to decide from the verified principal, and re-opening is a
    // server-side create that the session route admits or refuses on that
    // basis. Comparing here would be a SECOND place deciding an org boundary,
    // out of a client's view of the session — and a client that omits `orgId`
    // from `getSession` would read as "no org" and make the check pass. The
    // user, flow and state checks stay: those are the binder's own.
    return { status: "open" };
  }
  if (state === undefined || Object.keys(state).length === 0) return { status: "empty" };

  return {
    problem:
      `the id is held by a "${kind}" session carrying state that is not a readable channel ` +
      `(keys: ${Object.keys(state).map((key) => `\`${key}\``).join(", ")}). It is not the empty ` +
      `session a premature post leaves, so it is not this binder's to delete.`
  };
}

/**
 * How many times a 409 is answered before the channel is refused.
 *
 * Bounded rather than a retry loop: each round costs a read, and a repair that
 * has lost the id three times is a channel something else keeps taking, which
 * is worth a startup failure rather than a fourth attempt.
 */
const REPAIR_ATTEMPTS = 3;

/**
 * Open one named session per record, on that record's kind, carrying the
 * channel's members, charter and description.
 *
 * Uses the session route rather than the action path, because that route is the
 * only one that accepts caller-supplied `state` at create. The action path is
 * create-or-get and creates with EMPTY state — an unbound channel, which the
 * post block refuses.
 *
 * **A 409 says the id is taken, not that a channel is open there**, so it is
 * answered by reading the session and branching on boundness:
 *
 * - **A bound channel** is left exactly as it is. That is what keeps re-running
 *   over an unchanged roster a no-op — and, for the same reason, an edited
 *   `members:`, charter or `description:` does not reach a channel that is
 *   already open — {@link stateFor} writes the first two into session state at
 *   create and `description` is a session field set there, and this branch
 *   returns before any of them is looked at again. Re-opening is not a
 *   migration. `boards:` is NOT one of them: the board list is built onto the
 *   kind from the roster on every bind and never written to the session, so it
 *   does reach a channel that is already open. The one thing that is not silently left behind is an
 *   the open channel is one this principal cannot reach: the same
 *   reasoning makes that unfixable here, so it refuses rather than reporting
 *   the channel opened.
 * - **This kind's own empty session** — one the action path minted when
 *   something posted to or read the id before this ran — is adopted: the id is
 *   released and re-created carrying the channel's state. Such a session holds
 *   no channel data, and writing that state is precisely what opening a channel
 *   means. Without this, one premature post leaves the channel unbound
 *   permanently: every later run 409s too, and no public route writes state
 *   into a session that already exists.
 * - **Anything else holding the id** is refused by name rather than repaired —
 *   see {@link occupantOf}.
 *
 * A repair that 409s again is answered the same way, not assumed to be another
 * binder's open channel: the racer may be the action path, which would leave
 * this resolving over a channel that is still unbound. So it re-reads and goes
 * round, up to {@link REPAIR_ATTEMPTS} times, then refuses.
 *
 * @param manifests The roster — the same records `channelInstances` registered.
 * @param options   `client`: the session API. `userId`: who every channel session belongs to.
 *                  The organization is the server's, from the verified principal.
 * @throws On any failure that is not a 409, and on a 409 this cannot answer, with the channel named.
 */
export async function openChannels(
  manifests: readonly ChannelManifest[],
  options: OpenChannelsOptions
): Promise<void> {
  // A board is org-scoped storage, and a channel that held one used to be
  // refused here when `openChannels` was given no `orgId` — there was nowhere
  // to keep its rows. That precondition is gone (FIX-1442): the session the
  // server creates always carries an organization, so a board always has an
  // address. The binder no longer takes an `orgId` at all, and never did have
  // the authority to choose one.

  for (const manifest of orderedById(manifests)) {
    const selected = kindOf(manifest.declared);
    if ("problem" in selected) {
      throw new Error(`channel "${manifest.id}" — ${selected.problem}`);
    }

    const declaredDescription = manifest.declared.description;
    const open = async (): Promise<void> => {
      await options.client.createSession({
        flowKind: selected.kind,
        userId: options.userId,
        sessionId: manifest.id,
        ...(typeof declaredDescription === "string" ? { description: declaredDescription } : {}),
        state: stateFor(manifest)
      });
    };

    const failed = (error: unknown): Error =>
      new Error(`channel "${manifest.id}" could not be opened — ${messageOf(error)}`, {
        cause: error
      });

    try {
      await open();
    } catch (error) {
      if (!isAlreadyOpen(error)) throw failed(error);

      let settled = false;
      for (let attempt = 0; attempt < REPAIR_ATTEMPTS && !settled; attempt += 1) {
        let occupant: ChannelOccupant;
        try {
          occupant = await occupantOf(
            options.client,
            manifest.id,
            selected.kind,
            options.userId
          );
        } catch (readError) {
          throw failed(readError);
        }

        if ("problem" in occupant) throw failed(new Error(occupant.problem));
        if (occupant.status === "open") {
          // A bound channel — theirs or a previous run's — is left exactly as
          // it is, which is where an unraced 409 lands too.
          settled = true;
          break;
        }

        try {
          await options.client.deleteSession(manifest.id);
          await open();
          settled = true;
        } catch (repairError) {
          // A second 409: the id was retaken between the read and the create.
          // The retaker may be the action path rather than another binder, so
          // the next round asks who holds it now — swallowing this is how a
          // channel is left unbound with `openChannels` reporting success.
          if (!isAlreadyOpen(repairError)) throw failed(repairError);
        }
      }

      if (!settled) {
        throw failed(
          new Error(
            `the id was taken again by an unbound session on each of ${REPAIR_ATTEMPTS} attempts ` +
              `to open it. Something is racing this binder for the channel's session id.`
          )
        );
      }
    }
  }
}
