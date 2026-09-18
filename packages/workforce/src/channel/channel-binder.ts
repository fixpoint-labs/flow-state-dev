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
import { CHANNEL_KIND, boundChannel, channelFlow, type ChannelSessionState } from "./channel-flow";

/**
 * Every key a `CHANNEL.md` may declare. Closed, and checked by name.
 *
 * `flow` is consumed and stripped — it selects the kind and never reaches
 * state. The other three are the channel's own facts. Anything else refuses,
 * including `id`, which is the record's identity rather than a setting.
 */
const DECLARABLE_KEYS = ["flow", "description", "members", INSTRUCTIONS_KEY] as const;

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
      orgId?: string;
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
      /**
       * The org the occupant is bound to, read only when this run passed an
       * `orgId` — a channel already open under a different org (or under none)
       * is refused rather than resolved over, because re-opening cannot move
       * it. A real `SessionDetail` carries this; a hand-written client that
       * omits it reads as "no org", and the refusal says so.
       */
      orgId?: string;
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
  /**
   * The org every channel session is opened under. Optional, because an app
   * with no orgs has none to give.
   *
   * An app that HAS one needs this, and the failure without it is not a loud
   * one: file-declared documents install at `scope: "org"`, and an org-scoped
   * lookup is matched against the org the session was opened with — so a
   * channel opened without one wakes seats that resolve every declared
   * document as unregistered. A session's org is fixed at creation, so this is
   * the only moment it can be set. Re-opening is not a migration and cannot
   * move an open channel into an org, so a channel already open under a
   * different org — or under none, which is every channel opened before this
   * option existed — is refused by name rather than reported as opened.
   *
   * **What the binder hands the client, not a claim about where the session
   * ends up.** On a host that authenticates its callers, the session takes the
   * verified principal's org and a caller-supplied one is ignored — BP-031,
   * pinned by `management-route-auth.test.ts`'s "takes orgId from the
   * principal, not body.orgId". Such an app opens its channels as a principal
   * whose identity already carries the org; this option is what reaches the
   * default resolver, which reads the request body.
   */
  orgId?: string;
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

/** Records ordered by id, so one run's refusals read in a stable order. */
function orderedById<T extends { id: string }>(records: readonly T[]): T[] {
  return [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * What a record's `flow:` selects, refusing rather than guessing.
 *
 * An omitted key selects the built-in — decision 1, and the reason the first
 * file in `channels/` carries no `flow:` line. A key that IS present and names
 * nothing registered is a misconfiguration and says so; it never falls back.
 */
function kindOf(declared: Record<string, unknown>): { kind: string } | { problem: string } {
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

  return { kind: selected.kind };
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
  // free, so `kinds: { channel: mine }` replaces it wholesale.
  const kinds: Record<string, ChannelKind> = {
    [CHANNEL_KIND]: channelFlow as unknown as ChannelKind,
    ...(options.kinds ?? {})
  };
  const available = Object.keys(kinds)
    .map((k) => `"${k}"`)
    .join(", ");

  const ordered = orderedById(manifests);
  const problems: string[] = [];
  const seen = new Set<string>();
  const selected = new Set<string>();

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
  }

  if (problems.length > 0) {
    throw new Error(
      `channelInstances refused ${problems.length} of ${ordered.length} ` +
        `channel${ordered.length === 1 ? "" : "s"}; nothing was registered:\n  - ${problems.join("\n  - ")}`
    );
  }

  return [...selected].sort().map((kind) => kinds[kind]!());
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
  userId: string,
  orgId: string | undefined
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
    // Asked for an org, and the channel already open there is not in it. Left
    // alone this reports success and the app finds out at its first post, when
    // the delivery is refused for crossing an org boundary. The common way to
    // arrive here is an upgrade: channels opened before anyone passed an
    // `orgId` are bound to no org, and re-opening cannot move them.
    if (orgId !== undefined && session.orgId !== orgId) {
      return {
        problem:
          `a channel is already open there under ` +
          `${session.orgId === undefined ? "no org" : `org "${session.orgId}"`}, but this run ` +
          `asked for org "${orgId}". A session's org is fixed at creation, so re-opening cannot ` +
          `move it: delete that session to have this run open the channel under the new org, or ` +
          `drop the \`orgId\`. If your client's \`getSession\` does not return \`orgId\`, return ` +
          `it — this check reads it, and a channel that omits it reads as having no org.`
      };
    }
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
 *   `CHANNEL.md` does not reach a channel that is already open. Re-opening is
 *   not a migration. The one thing that is not silently left behind is an
 *   `orgId` this run asked for that the open channel is not in: the same
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
 *                  `orgId`: the org they are opened under, which org-scoped documents are
 *                  matched against.
 * @throws On any failure that is not a 409, and on a 409 this cannot answer, with the channel named.
 */
export async function openChannels(
  manifests: readonly ChannelManifest[],
  options: OpenChannelsOptions
): Promise<void> {
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
        // Spread rather than passed as `orgId: options.orgId`: an app with no
        // orgs sends no key at all, rather than an explicit `undefined` the
        // session route would have to read past.
        ...(options.orgId === undefined ? {} : { orgId: options.orgId }),
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
            options.userId,
            options.orgId
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
