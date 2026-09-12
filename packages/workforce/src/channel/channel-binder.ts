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
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type ChannelManifest
} from "../manifest";
import { CHANNEL_KIND, channelFlow, type ChannelSessionState } from "./channel-flow";

/**
 * Every key a `CHANNEL.md` may declare. Closed, and checked by name.
 *
 * `flow` is consumed and stripped — it selects the kind and never reaches
 * state. The other three are the channel's own facts. Anything else refuses,
 * including `id`, which is the record's identity rather than a setting.
 */
const DECLARABLE_KEYS = ["flow", "description", "members", "instructions"] as const;

/** The one setting name a channel's charter arrives under. */
const INSTRUCTIONS_KEY = "instructions";

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
   * The session API. `createSession` is the only method used, and the only
   * route that accepts caller-supplied `state` at create.
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
 * Open one named session per record, on that record's kind, carrying the
 * channel's members, charter and description.
 *
 * Uses the session route rather than the action path, because that route is the
 * only one that accepts caller-supplied `state` at create. The action path is
 * create-or-get and creates with EMPTY state — an unbound channel, which the
 * post block refuses.
 *
 * **Idempotent: a 409 means the channel is already open and is swallowed.** So
 * re-running over an unchanged roster is a no-op — and, for the same reason, an
 * edited `CHANNEL.md` does not reach a channel that is already open. Re-opening
 * is not a migration.
 *
 * @param manifests The roster — the same records `channelInstances` registered.
 * @param options   `client`: the session API. `userId`: who every channel session belongs to.
 * @throws On any failure that is not a 409, with the channel named.
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
    try {
      await options.client.createSession({
        flowKind: selected.kind,
        userId: options.userId,
        sessionId: manifest.id,
        ...(typeof declaredDescription === "string" ? { description: declaredDescription } : {}),
        state: stateFor(manifest)
      });
    } catch (error) {
      if (isAlreadyOpen(error)) continue;
      throw new Error(`channel "${manifest.id}" could not be opened — ${messageOf(error)}`, {
        cause: error
      });
    }
  }
}
