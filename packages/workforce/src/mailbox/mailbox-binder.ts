/**
 * The mailbox binder, in two phases because they happen at two times.
 *
 * `mailboxInstances` is build time and synchronous: it returns the instances to
 * register, one per DISTINCT kind, with the built-in seeded under `"mailbox"`
 * unless the caller passed their own. `openMailboxes` is runtime: it opens one
 * named session per record, at the record's own id, carrying that mailbox's
 * members and charter.
 *
 * Nothing is minted per record. A hundred mailbox files are a hundred sessions
 * on one instance, and the word `mint` is avoided here for that reason.
 *
 * **The two are paired: every roster `openMailboxes` opens must be one
 * `mailboxInstances` already validated.** `validate` is reached only from
 * `mailboxInstances`, so a caller that runs `openMailboxes` alone over a
 * hand-built roster gets no refusal at all — most visibly, a record carrying
 * BOTH a body and a frontmatter `instructions:` silently takes the body
 * (`stateFor`'s precedence) where `validate` would have refused it as two
 * sources for one setting.
 *
 * **Why the whole closed key list lives here.** Under an instance-per-mailbox
 * shape the flow's own `configSchema` refused an undeclared `MAILBOX.md` key
 * for free. It cannot now: per-mailbox facts are session state, and the session
 * route parses caller state against `stateSchema` but falls back to the
 * caller's RAW state on a parse failure — validation happens at
 * action-execution time, not at session create. So the route is not a
 * gatekeeper, and every refusal is this module's, checked in the one pass where
 * the roster is already being walked.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";
import { readDeclaredFlow } from "../declared-flow";
import {
  INSTRUCTIONS_KEY,
  REFUSED_SYSTEM_KEY,
  REFUSED_SYSTEM_KEY_MESSAGE,
  type MailboxManifest
} from "../manifest";
import {
  MAILBOX_KIND,
  MAILBOX_SET_UP_ACTION,
  MAILBOX_SUBSCRIBE_ACTION,
  MAILBOX_UNSUBSCRIBE_ACTION,
  boundMailbox,
  mailboxFlow,
  defineMailboxFlow,
  holdsBoards,
  membershipChangedSchema,
  routeOf,
  wakesSeats,
  type MailboxSessionState
} from "./mailbox-flow";
import {
  MAILBOX_BOARDS_KEY,
  RUN_TIME_TASK_LIST,
  mailboxBoardId,
  mailboxBoardNameProblem
} from "./mailbox-board";
import { validateSegment } from "../loader/segments";
import type { InventoryActionRequest } from "../inventory/open-inventory";
import type { MailboxRouting } from "./mailbox-route";
import { PRE_RENAME_NAMES, preRenameKindNameProblem, preRenameOccupantProblem } from "./pre-rename";
import { PROJECTS_COLLECTION } from "../projects/collections";
import {
  isTemplateMailbox,
  orgTalkTemplateOf,
  registeredTalkTemplate,
  registerTalkTemplate,
  talkTemplateConflict,
  templateSeatsProblem,
  type TalkTemplateFacts
} from "../projects/talk-template";

/** The `MAILBOX.md` key that routes a mailbox, and its one subkey. */
const ROUTING_KEY = "routing";
const FALLBACK_KEY = "fallback";

/** The `MAILBOX.md` key that exposes a mailbox's boards' task tools as actions. */
const BOARD_ACTIONS_KEY = "boardActions";

/** The `MAILBOX.md` key that marks the file a project talk template, not a mailbox. */
const MINT_FOR_KEY = "mintFor";

/**
 * Every key a `MAILBOX.md` may declare. Closed, and checked by name.
 *
 * `flow` is consumed and stripped — it selects the kind and never reaches
 * state. The other four are the mailbox's own facts. Anything else refuses,
 * including `id`, which is the record's identity rather than a setting.
 *
 * `boards` is the fifth member: a list of plain local names, read exactly as
 * `members` is. It never carries an id — the ledger's identity is minted from
 * where the mailbox sits.
 *
 * `routing` is the sixth: a mapping with one subkey, `fallback:`, the member
 * who takes a post the route cannot place. Like `boards`, it is built onto the
 * kind at every boot and never written into the mailbox's session.
 *
 * `boardActions` is the seventh: `true` exposes each of the mailbox's boards'
 * eight task tools as mailbox actions. Boolean only, off by default, and built
 * onto the kind the same way.
 *
 * `mintFor` is the eighth and the newest: it names a collection in the org's
 * resource map, and makes the file that collection's project talk template
 * rather than a mailbox. A template is never opened and never registered; its
 * `members:` are the seats a post in a project's room wakes and its body is
 * the room's charter, built onto the kind at every boot.
 */
const DECLARABLE_KEYS = [
  "flow",
  "description",
  "members",
  MAILBOX_BOARDS_KEY,
  INSTRUCTIONS_KEY,
  ROUTING_KEY,
  BOARD_ACTIONS_KEY,
  MINT_FOR_KEY
] as const;

/**
 * Is this record a project talk template (`mintFor:`) rather than a mailbox?
 * A template is never opened and never registered in the inventory, so
 * `openMailboxes` and `openInventory` pass it over. Not re-exported from the
 * package root.
 */
export function isTalkTemplate(manifest: MailboxManifest): boolean {
  return Object.hasOwn(manifest.declared, MINT_FOR_KEY);
}

/**
 * Why a template file is not one, or `undefined`. A template is the shape of a
 * project's room, not a mailbox: it holds no board (a board per project is
 * still an open question), routes no post (every seat it names hears every
 * post), and its `members:` are seat ids.
 */
function templateFileProblem(declared: Record<string, unknown>): string | undefined {
  const target = declared[MINT_FOR_KEY];
  if (typeof target !== "string" || target.trim().length === 0) {
    return `declares a \`${MINT_FOR_KEY}:\` that is not a collection name. Name the collection whose rows this template mints a room for, as \`${MINT_FOR_KEY}: projects\`.`;
  }
  const notHeld = ["flow", MAILBOX_BOARDS_KEY, ROUTING_KEY, BOARD_ACTIONS_KEY].filter((key) => Object.hasOwn(declared, key));
  if (notHeld.length > 0) {
    return (
      `declares \`${MINT_FOR_KEY}:\` and ${notHeld.map((key) => `\`${key}:\``).join(", ")}. A talk template is ` +
      `not a mailbox: it holds no board, routes no post, and runs on the built-in mailbox kind. ` +
      `Drop ${notHeld.length === 1 ? "that line" : "those lines"}.`
    );
  }
  if (Object.hasOwn(declared, "members") && isListOfNames(declared.members)) {
    const problem = templateSeatsProblem(declared.members);
    if (problem !== undefined) return `declares \`${MINT_FOR_KEY}:\`, and ${problem}`;
  }
  return undefined;
}

/** One talk template, from either site, as the binder checks and builds it. */
type DeclaredTemplate = {
  /** Where it was declared, for a refusal to name. */
  site: string;
  collection: object;
  /** The collection's ref in the org's resource map. */
  ref: string;
  facts: TalkTemplateFacts;
};

/**
 * A mailbox kind: a flow factory carrying the same identity contract the
 * built-in does — `cardinality: "singleton"`, so `flow.id === flow.kind`.
 *
 * Typed loosely on purpose. A kind's blocks and state shape are its own; what
 * this module needs of one is its `kind` and the ability to mint its single
 * instance, and asserting more would restate a guarantee the flow registry
 * makes at registration.
 */
export type MailboxKind = { kind: string } & (() => FlowInstance);

export interface MailboxInstancesOptions {
  /**
   * The mailbox kinds this app registers, by kind name. **The whole
   * registration surface, and the rare escape hatch** — an app registers
   * nothing to use mailboxes, because the built-in is seeded under `"mailbox"`
   * when this map does not carry that key.
   *
   * Pass a kind here only when the workflow graph genuinely diverges. A record
   * whose `flow:` names a key that is not here refuses; it never falls back to
   * the built-in.
   */
  kinds?: Record<string, MailboxKind>;

  /**
   * Build the **built-in** kind carrying the live inventory's writer half, so
   * every mailbox it opens can publish its own row.
   *
   * Off by default: with this absent nothing is declared and nothing is
   * written, and mailboxes behave exactly as they did before the inventory
   * existed. Turning it on here is half the wiring — `openInventory` is what
   * actually runs the write, after `openMailboxes`.
   *
   * It reaches the built-in only. A kind passed under `kinds` is the caller's
   * to build, and it carries the writer by spreading
   * `inventoryWriterActions(itsOwnKindName)` into its own actions — the same
   * way it already carries `cardinality: "singleton"`. There is nowhere to hand
   * this to one: a custom kind is zero-arg by contract.
   */
  inventory?: boolean;

  /**
   * The organization's resource map, keyed by ref: the `resources` half of
   * `splitResourceModules(resourceModules)`, or the app's own map. Where the
   * project talk templates are read from. The org-level default rides on the
   * projects collection itself (`defineProjectsCollection({ talk })`), and a
   * `MAILBOX.md`'s `mintFor:` names a collection by its ref here.
   *
   * Absent, no org-level template is read, and a `mintFor:` names no
   * collection, so it is refused.
   *
   * **The first call that finds a projects template registers it for the
   * process** and sets `reactTo.created` on the one projects declaration, so
   * creating a row in a flow turn mints the creator's talk session on the
   * built-in mailbox kind. Every later call builds its mailbox kind from that
   * registration, whether or not it passes `resources`, so its talk sessions
   * hold the same seats and charter. A later call that finds a different
   * template throws, and every call's mailbox kind must be able to wake the
   * template's seats.
   */
  resources?: Readonly<Record<string, unknown>>;
}

export interface OpenMailboxesOptions {
  /**
   * The session API. `createSession` carries the whole of a mailbox's state,
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
     * WHO holds the id and whether a mailbox is open there, rather than on
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
     * mailbox, on another flow's session, on another principal's, or on one
     * carrying state this binder cannot read.
     */
    deleteSession: (sessionId: string) => Promise<void>;
  };
  /**
   * The user every mailbox session is bound to.
   *
   * Required, and not an oversight: a session belongs to ONE user, so a mailbox
   * has one too. It is also the reason the `principal` on every line of a given
   * transcript is the same value — see `mailbox-flow.ts`'s header.
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
let inventoryMailboxFlowMemo: ReturnType<typeof defineMailboxFlow> | undefined;
function inventoryMailboxFlow(): ReturnType<typeof defineMailboxFlow> {
  inventoryMailboxFlowMemo ??= defineMailboxFlow({ inventory: true });
  return inventoryMailboxFlowMemo;
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
 * file in `mailboxes/` carries no `flow:` line. A key that IS present and names
 * nothing registered is a misconfiguration and says so; it never falls back.
 *
 * Exported for the inventory binder, which addresses each mailbox's session on
 * the kind that opened it and must read the record the same way `openMailboxes`
 * did. A second derivation is a second answer to "which flow is this mailbox
 * on", and the two would diverge silently. Not re-exported from the package
 * root.
 *
 * The rule itself — absent, blank, or not a string — is `readDeclaredFlow`,
 * shared with the worker door. This adapter supplies the mailbox default and
 * words both refusal cases the one way the mailbox door always has.
 */
export function kindOf(declared: Record<string, unknown>): { kind: string } | { problem: string } {
  const read = readDeclaredFlow(declared, MAILBOX_KIND);
  if ("kind" in read) return read;
  return { problem: "declares a `flow:` that is not a kind name" };
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
  manifest: MailboxManifest,
  kinds: Record<string, MailboxKind>,
  available: string
): { kind: string; routing?: MailboxRouting } | { problem: string } {
  const declared = manifest.declared;

  // Refused by its own name, and before the closed-list check, so an author
  // gets the rule rather than "not a declared setting".
  if (Object.hasOwn(declared, REFUSED_SYSTEM_KEY)) {
    return { problem: REFUSED_SYSTEM_KEY_MESSAGE };
  }

  if (Object.hasOwn(declared, "id")) {
    return {
      problem:
        "declares `id:` in its frontmatter. A mailbox's id is its identity — and literally its " +
        "session id — and comes from where the mailbox is declared, never from a setting."
    };
  }

  const undeclared = Object.keys(declared).filter(
    (key) => !(DECLARABLE_KEYS as readonly string[]).includes(key)
  );
  if (undeclared.length > 0) {
    return {
      problem:
        `declares ${undeclared.map((k) => `\`${k}\``).join(", ")}, which a mailbox does not ` +
        `declare. A mailbox declares: ${DECLARABLE_KEYS.map((k) => `\`${k}\``).join(", ")}.`
    };
  }

  // A body is a charter; whitespace is not. Same rule the seat factory applies
  // to a worker's instructions, and the same refusal when both are present.
  if (manifest.body.trim().length > 0 && Object.hasOwn(declared, INSTRUCTIONS_KEY)) {
    return {
      problem:
        `declares \`${INSTRUCTIONS_KEY}:\` in its frontmatter and carries a body — two sources ` +
        `for one setting, and there is no precedence rule. Remove one: a mailbox's charter is ` +
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

  if (Object.hasOwn(declared, MINT_FOR_KEY)) {
    const problem = templateFileProblem(declared);
    if (problem !== undefined) return { problem };
  }

  // Shape first, then each name. A `boards:` that is not a list is one problem
  // with the file, not one problem per entry.
  if (Object.hasOwn(declared, MAILBOX_BOARDS_KEY)) {
    const boards = declared[MAILBOX_BOARDS_KEY];
    if (!isListOfNames(boards)) {
      return {
        problem:
          "declares a `boards:` that is not a list of plain names. A board entry is a local " +
          "name, as a member is — the ledger's id is minted from this mailbox's id, so no file " +
          "writes one."
      };
    }
    for (const name of boards) {
      const problem = mailboxBoardNameProblem(name);
      if (problem !== undefined) {
        return { problem: `declares board "${name}", and the board name ${problem}` };
      }
    }
  }

  if (Object.hasOwn(declared, INSTRUCTIONS_KEY) && typeof declared[INSTRUCTIONS_KEY] !== "string") {
    return { problem: `declares an \`${INSTRUCTIONS_KEY}:\` that is not text` };
  }

  if (Object.hasOwn(declared, BOARD_ACTIONS_KEY) && typeof declared[BOARD_ACTIONS_KEY] !== "boolean") {
    return {
      problem:
        `declares a \`${BOARD_ACTIONS_KEY}:\` that is not \`true\` or \`false\`. It turns on the ` +
        `mailbox's board task actions, so it is read as a switch and nothing else.`
    };
  }

  const routing = routingOf(declared);
  if (routing !== undefined && "problem" in routing) return routing;

  const selected = kindOf(declared);
  if ("problem" in selected) return selected;

  // `hasOwn` rather than a bare lookup: `flow` is author-supplied, and
  // `kinds["constructor"]` would otherwise resolve off the prototype.
  const factory = Object.hasOwn(kinds, selected.kind) ? kinds[selected.kind] : undefined;
  if (factory === undefined) {
    return {
      problem:
        `names mailbox kind "${selected.kind}", which was not passed to mailboxInstances. ` +
        `Kinds passed: ${available}`
    };
  }

  // A kind filed under someone else's name. Nothing downstream would notice —
  // the instance registers under the other kind's address and this mailbox's
  // sessions run that kind's graph.
  if (factory.kind !== selected.kind) {
    return {
      problem:
        `declares mailbox kind "${selected.kind}", but the flow passed under that key is kind ` +
        `"${String(factory.kind)}" — this mailbox would run a different mailbox's graph. ` +
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
        `declares \`${MAILBOX_BOARDS_KEY}:\` and runs on mailbox kind "${selected.kind}", which ` +
        `is not a kind \`defineMailboxFlow\` built. Boards are the built-in mailbox kind's: a ` +
        `custom kind is zero-arg, so there is no way to hand it the ledgers this roster minted. ` +
        `Drop the \`flow:\` line to hold a board, or drop the \`${MAILBOX_BOARDS_KEY}:\` line to ` +
        `keep the custom kind.`
    };
  }

  if (routing === undefined) return { kind: selected.kind };

  // A route is what places a post, and only a kind built with one has it. The
  // line on any other kind would read as routed and wake every member.
  const route = routeOf(factory);
  if (route === undefined) {
    return {
      problem:
        `declares \`${ROUTING_KEY}:\` and runs on mailbox kind "${selected.kind}", which was built ` +
        `without a route. Build the kind with \`defineMailboxFlow({ notify, route: ` +
        `routeByPurpose(seats, { model }) })\`, or drop the \`${ROUTING_KEY}:\` line.`
    };
  }
  const members = isListOfNames(declared.members) ? declared.members : [];
  if (!members.includes(routing.fallback)) {
    return {
      problem:
        `declares \`${ROUTING_KEY}:\` with \`${FALLBACK_KEY}: ${routing.fallback}\`, and ` +
        `"${routing.fallback}" is not among its \`members:\`. The fallback takes the posts the ` +
        `route cannot place, so it has to be a member.`
    };
  }
  if (!route.members.includes(routing.fallback)) {
    return {
      problem:
        `declares \`${ROUTING_KEY}:\` with \`${FALLBACK_KEY}: ${routing.fallback}\`, and no seat ` +
        `the route was built with hears posts for it. Every post the route cannot place would ` +
        `reach nobody. Hire "${routing.fallback}" on a kind that hears posts, or name another ` +
        `member.`
    };
  }
  return { kind: selected.kind, routing };
}

/**
 * The record's `routing:`, read and shape-checked: `undefined` when it
 * declares none, the setting when it is well formed, or why it is not.
 */
function routingOf(declared: Record<string, unknown>): MailboxRouting | { problem: string } | undefined {
  if (!Object.hasOwn(declared, ROUTING_KEY)) return undefined;
  const routing = declared[ROUTING_KEY];
  if (typeof routing !== "object" || routing === null || Array.isArray(routing)) {
    return {
      problem:
        `declares a \`${ROUTING_KEY}:\` that is not a mapping. Write it as ` +
        `\`${ROUTING_KEY}:\` with \`${FALLBACK_KEY}: <member>\` indented under it.`
    };
  }
  const unknown = Object.keys(routing).filter((key) => key !== FALLBACK_KEY);
  if (unknown.length > 0) {
    return {
      problem:
        `declares ${unknown.map((key) => `\`${key}\``).join(", ")} under \`${ROUTING_KEY}:\`, and ` +
        `\`${ROUTING_KEY}:\` declares only \`${FALLBACK_KEY}:\`. The route's model is the app's, ` +
        `named once in code.`
    };
  }
  const fallback = (routing as Record<string, unknown>)[FALLBACK_KEY];
  if (typeof fallback !== "string" || fallback.trim().length === 0) {
    return {
      problem:
        `declares \`${ROUTING_KEY}:\` with no \`${FALLBACK_KEY}:\` member. Name the member who ` +
        `takes a post the route cannot place.`
    };
  }
  return { fallback };
}

/**
 * The board names one record declared, or none.
 *
 * Reads only a well-formed list — `validate` refuses a malformed one first, and
 * this is also reached from {@link mailboxBoardIds}, where a caller may be
 * holding a roster nobody validated. A shape this cannot read is *no boards*
 * here, never a guess at what was meant.
 */
function boardNamesOf(declared: Record<string, unknown>): string[] {
  const boards = declared[MAILBOX_BOARDS_KEY];
  if (!isListOfNames(boards)) return [];
  return boards.filter((name) => mailboxBoardNameProblem(name) === undefined);
}

/**
 * Every ledger id a roster's mailboxes mint, sorted and deduplicated.
 *
 * The one place a roster becomes a list of ids, so the binder and the
 * hire-time unattended-board check read the same answer rather than each
 * joining mailbox ids to board names themselves.
 *
 * **Reads only well-formed entries.** A `boards:` this cannot read, or a name
 * that breaks the rules, counts as NO board here rather than as a guess at
 * what was meant — `mailboxInstances` is what refuses those, and it may not
 * have run yet. So on an unvalidated roster this returns the ids of the
 * mailboxes that would bind and silently omits the ones that would not. Call it
 * on a roster you also pass to `mailboxInstances`, or the set is a subset.
 *
 * @param manifests The roster — the same records `mailboxInstances` registers.
 * @returns The minted ids, `<mailboxId>.<boardName>`, in a stable order.
 */
export function mailboxBoardIds(manifests: readonly MailboxManifest[]): string[] {
  const ids = new Set<string>();
  for (const manifest of manifests) {
    for (const name of boardNamesOf(manifest.declared)) {
      ids.add(mailboxBoardId(manifest.id, name));
    }
  }
  return [...ids].sort();
}

function isListOfNames(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * Turn mailbox records into the flow instances to register — one per DISTINCT
 * kind, never one per record.
 *
 * The built-in is seeded, so an app that registers nothing still gets mailboxes:
 * a record with no `flow:` runs on `"mailbox"`. Every problem is a startup
 * misconfiguration, so every problem throws — but they are collected first, so
 * one run names all of them. Nothing is returned partially.
 *
 * @param manifests The roster — from a loader, or hand-built.
 * @param options   `kinds`: extra or replacement mailbox kinds, by kind name.
 * @returns One `FlowInstance` per distinct kind, ordered by id. Register these.
 * @throws If any record cannot be bound; the message names every bad mailbox.
 */
export function mailboxInstances(
  manifests: readonly MailboxManifest[],
  options: MailboxInstancesOptions = {}
): FlowInstance[] {
  // Before anything else: every session on this name reads as old data, so
  // the app's own store would be refused on its next boot.
  if (options.kinds !== undefined && Object.hasOwn(options.kinds, PRE_RENAME_NAMES.kind)) {
    throw new Error(preRenameKindNameProblem("mailboxInstances"));
  }

  // The seed: the built-in fills the map only where the caller left the key
  // free, so `kinds: { mailbox: mine }` replaces it wholesale. With the
  // inventory asked for, the seed is the same built-in rebuilt holding the
  // writer — a second factory rather than a flag read at run time, because the
  // collections have to be DECLARED on the flow and a declaration cannot be
  // made per request.
  const kinds: Record<string, MailboxKind> = {
    [MAILBOX_KIND]: (options.inventory === true
      ? inventoryMailboxFlow()
      : mailboxFlow) as unknown as MailboxKind,
    ...(options.kinds ?? {})
  };
  const available = Object.keys(kinds)
    .map((k) => `"${k}"`)
    .join(", ");

  const ordered = orderedById(manifests);
  const problems: string[] = [];
  const seen = new Set<string>();
  const selected = new Set<string>();
  /** Ledger id → the mailbox that minted it. A collision names both. */
  const minted = new Map<string, string>();
  /** The minted ids each selected kind must be built holding. */
  const boardsByKind = new Map<string, string[]>();
  /** Each selected kind's routed mailboxes: mailbox id → its `routing:`. */
  const routingByKind = new Map<string, Record<string, MailboxRouting>>();
  /** Each selected kind's mailboxes that declared `boardActions: true`. */
  const boardActionsByKind = new Map<string, string[]>();
  /** Every project talk template, from either site, checked. */
  const templates: DeclaredTemplate[] = [];

  // The org-level defaults first: each rides on the collection it was
  // declared beside, in the org's resource map.
  let orgDeclarations = 0;
  const readCollections = new Set<unknown>();
  for (const [ref, entry] of Object.entries(options.resources ?? {})) {
    const template = orgTalkTemplateOf(entry);
    if (template === undefined) continue;
    // One collection under two refs is one declaration, not two rivals.
    if (readCollections.has(entry)) continue;
    readCollections.add(entry);
    orgDeclarations += 1;
    const site = `the talk template beside "${ref}" in the org's resources`;
    // Its seats were checked where it was declared (`defineProjectsCollection`).
    const declared = templateFrom(
      { ref, seats: template.seats, charter: template.charter ?? "" },
      site,
      options.resources
    );
    if ("problem" in declared) problems.push(`${site} — ${declared.problem}`);
    else templates.push(declared);
  }

  for (const manifest of ordered) {
    const refuse = (reason: string): void => {
      problems.push(`mailbox "${manifest.id}" — ${reason}`);
    };

    // Caught here as well as at the registry so it reads as a ROSTER problem,
    // reported alongside the others. An id is an address, and here it is
    // literally a session id.
    if (seen.has(manifest.id)) {
      refuse("declared twice in this roster; a mailbox's id is its session id and must be unique");
      continue;
    }
    seen.add(manifest.id);

    const result = validate(manifest, kinds, available);
    if ("problem" in result) {
      refuse(result.problem);
      continue;
    }

    // A template is the shape of a project's room, not a mailbox: it adds its
    // template, and nothing a mailbox adds.
    if (isTalkTemplate(manifest)) {
      const ref = manifest.declared[MINT_FOR_KEY] as string;
      const declared = templateFrom(
        {
          ref,
          seats: isListOfNames(manifest.declared.members) ? manifest.declared.members : [],
          charter: stateFor(manifest).instructions
        },
        `mailbox "${manifest.id}"`,
        options.resources
      );
      if ("problem" in declared) refuse(declared.problem);
      else templates.push(declared);
      continue;
    }

    selected.add(result.kind);
    if (result.routing !== undefined) {
      routingByKind.set(result.kind, { ...routingByKind.get(result.kind), [manifest.id]: result.routing });
    }
    if (manifest.declared[BOARD_ACTIONS_KEY] === true) {
      boardActionsByKind.set(result.kind, [...(boardActionsByKind.get(result.kind) ?? []), manifest.id]);
    }

    // Minted here rather than in `validate`, because uniqueness is a fact
    // about the ROSTER and not about one record. An id is a storage key: two
    // mailboxes minting one is two teams' work in a single ledger, which reads
    // as rows appearing from nowhere rather than as a misconfiguration.
    for (const name of boardNamesOf(manifest.declared)) {
      const id = mailboxBoardId(manifest.id, name);
      const owner = minted.get(id);
      if (owner !== undefined) {
        // The two arms are not equally reachable, and saying so beats leaving a
        // reader to assume both fire. A mailbox id is unique across the roster
        // (refused above) and a board name carries no dot, so two DIFFERENT
        // mailboxes cannot mint one id from any roster this package can build.
        // The second arm covers a hand-built `MailboxManifest`, whose ids are
        // caller-supplied and which this module cannot constrain — it is a
        // guard on an input it does not own, not dead code.
        refuse(
          owner === manifest.id
            ? `declares board "${name}" twice; a mailbox's board names are its ledger ids and ` +
                `must be unique (minted "${id}")`
            : `declares board "${name}", which mints ledger id "${id}" — already minted by ` +
                `mailbox "${owner}". An id is a storage key, and a duplicate is two teams' work ` +
                `in one ledger`
        );
        continue;
      }
      minted.set(id, manifest.id);
      boardsByKind.set(result.kind, [...(boardsByKind.get(result.kind) ?? []), id]);
    }
  }

  // One template per collection, across both sites. A project's members each
  // hold one talk session on it, so its rows are minted from one template.
  // One refusal per collection, naming every template that shares it.
  const byCollection = new Map<object, DeclaredTemplate[]>();
  for (const template of templates) {
    byCollection.set(template.collection, [...(byCollection.get(template.collection) ?? []), template]);
  }
  for (const rivals of byCollection.values()) {
    if (rivals.length < 2) continue;
    problems.push(
      `the "${rivals[0]!.ref}" collection has ${rivals.length} talk templates: ` +
        `${rivals.map((other) => other.site).join("; ")}. A project's ` +
        `members each hold one talk session, so a collection's rows are minted from one template. Keep one.`
    );
  }

  // The template this call builds on: the one it found, or the one an earlier
  // call registered for the process. Either way, this call's mailbox kind
  // runs the talk sessions, so it must be able to hold and wake it.
  const found = templates.find((template) => template.collection === PROJECTS_COLLECTION);
  // A template found here that differs from the one an earlier call
  // registered is refused with everything else, not after it.
  const conflict = found === undefined ? undefined : talkTemplateConflict(PROJECTS_COLLECTION, found);
  if (conflict !== undefined) problems.push(`${found!.site} — ${conflict}`);
  const standing = found ?? registeredTalkTemplate(PROJECTS_COLLECTION);
  if (standing !== undefined) {
    const problem = talkKindProblem(kinds, standing.facts);
    if (problem !== undefined) {
      problems.push(
        found !== undefined
          ? `${found.site} — ${problem}`
          : `the talk template registered in this process (${standing.site}) — ${problem}`
      );
    }
  }

  if (problems.length > 0) {
    // Worded as before when every declaration is a mailbox file.
    const declarations = ordered.length + orgDeclarations;
    const noun = orgDeclarations > 0 ? "declarations" : ordered.length === 1 ? "mailbox" : "mailboxes";
    throw new Error(
      `mailboxInstances refused ${problems.length} of ${declarations} ` +
        `${noun}; nothing was registered:\n  - ${problems.join("\n  - ")}`
    );
  }

  // The template found here is registered for the process, with the reaction
  // that mints a creator's talk session (`talk-template.ts`); a different one
  // already registered throws. The mailbox kind is then built holding the
  // registered template, and registered even when no mailbox runs on it: its
  // talk sessions do. A call that finds no template still builds from the
  // registration, so every mailbox kind in the process holds the same one.
  if (found !== undefined) {
    const templateIds = ordered.filter(isTalkTemplate).map((manifest) => manifest.id);
    registerTalkTemplate(PROJECTS_COLLECTION, { site: found.site, facts: found.facts }, MAILBOX_KIND, templateIds);
  }
  const template = registeredTalkTemplate(PROJECTS_COLLECTION);
  if (template !== undefined) selected.add(MAILBOX_KIND);

  return [...selected].sort().map((kind) => {
    const factory = kinds[kind]!;
    const boards = boardsByKind.get(kind);
    const routing = routingByKind.get(kind);
    // A kind holding nothing is built exactly as it was before boards existed,
    // and `validate` has already refused the third case — boards named on a
    // kind that cannot hold them. Routing and templates likewise: only a kind
    // this package built gets here holding any.
    if (!holdsBoards(factory)) return factory();
    const boardActions = boardActionsByKind.get(kind);
    const facts = kind === MAILBOX_KIND ? template?.facts : undefined;
    const withBoards = boards === undefined ? factory : factory.withBoards(boards);
    const withRouting = routing === undefined ? withBoards : withBoards.withRouting(routing);
    const withBoardActions = boardActions === undefined ? withRouting : withRouting.withBoardActions(boardActions);
    return (facts === undefined ? withBoardActions : withBoardActions.withTemplate(facts))();
  });
}

/**
 * Check one talk template's collection, from either site. It must be the
 * projects collection in the org's resource map: a talk session is about a
 * project, and its entries read that collection.
 */
function templateFrom(
  declared: { ref: string; seats: readonly string[]; charter: string },
  site: string,
  resources: Readonly<Record<string, unknown>> | undefined
): DeclaredTemplate | { problem: string } {
  const collection = resources !== undefined && Object.hasOwn(resources, declared.ref) ? resources[declared.ref] : undefined;
  if (collection === undefined) {
    return {
      problem:
        `names collection "${declared.ref}", which is not in the org's resources passed to mailboxInstances. ` +
        `Declare it in \`org/resources/${declared.ref}.ts\` and pass the org's resource map as \`resources\`.`
    };
  }
  if (collection !== PROJECTS_COLLECTION) {
    return {
      problem:
        `names "${declared.ref}", which is not the projects collection. A talk session is about a project, ` +
        `so a template mints rooms for the rows \`defineProjectsCollection()\` declares.`
    };
  }
  return {
    site,
    collection,
    ref: declared.ref,
    facts: { seats: [...declared.seats], charter: declared.charter }
  };
}

/**
 * Why this call's mailbox kind cannot run talk sessions on `facts`, or
 * `undefined`. Talk sessions run on the built-in kind (`"mailbox"`), so what
 * sits under that key must be a kind {@link defineMailboxFlow} built (the
 * template is built onto it, as `boards:` is), of that kind, and able to wake
 * the template's seats.
 */
function talkKindProblem(kinds: Record<string, MailboxKind>, facts: TalkTemplateFacts): string | undefined {
  const factory = kinds[MAILBOX_KIND]!;
  if (factory.kind !== MAILBOX_KIND) {
    return (
      `talk sessions run on kind "${MAILBOX_KIND}", but the flow passed under that key is kind ` +
      `"${String(factory.kind)}" — they would run a different mailbox's graph.`
    );
  }
  if (!holdsBoards(factory)) {
    return (
      `talk sessions run on kind "${MAILBOX_KIND}", and the flow passed under that key is not one ` +
      `\`defineMailboxFlow\` built. A custom kind is zero-arg, so there is no way to hand it the template's ` +
      `seats and charter.`
    );
  }
  if (facts.seats.length > 0 && !wakesSeats(factory)) {
    return (
      `names seats, but talk sessions run on kind "${MAILBOX_KIND}", which was built with no \`notify\` ` +
      `block, so a post would wake none of them. Pass it built with one, as ` +
      `\`kinds: { mailbox: defineMailboxFlow({ notify: wakeMemberSeats(seats) }) }\`.`
    );
  }
  return undefined;
}

/**
 * The mailbox facts written into a mailbox's session at open.
 *
 * Built from named keys only, which is why an undeclared key cannot reach
 * state even though the session route would not refuse one: there is nowhere
 * for it to go. `resourceId` is a talk session's alone, and a declared
 * mailbox's state carries no such key. Nor does it carry `origin`,
 * `taskLists` or `workersByList`: a file's mailbox reads them as `null`
 * until a membership change writes them.
 */
function stateFor(manifest: MailboxManifest): Pick<MailboxSessionState, "members" | "instructions" | "transcript"> {
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
 * Who holds this id, and is a mailbox open in it?
 *
 * Boundness is still the fence's own `boundMailbox`, so the binder reads "is a
 * mailbox open here" exactly as the post path does. But boundness alone cannot
 * answer what to DO, and answering on it alone is how a session gets deleted:
 * a session id is unique per principal, not per flow, so an id that fails the
 * boundness test may be an ordinary session belonging to another flow entirely —
 * and the delete route takes that session's content and resource state with it.
 *
 * Three answers, because only one of the three is safe to tear down:
 *
 * - `"open"` — this kind's own bound mailbox, for this principal. Left exactly
 *   as it is, unless this run asked for an org the mailbox is not in, which is
 *   a `problem`: re-opening cannot move it.
 * - `"empty"` — this kind's own session for this principal carrying no state at
 *   all, which is precisely what the action path's create-or-get leaves behind.
 *   The only case the id is released in.
 * - a `problem` — anything else: another flow's session, another principal's,
 *   or one carrying state this binder cannot read as a mailbox. A collision is
 *   an operator error worth failing loudly on, and state that will not parse is
 *   data rather than an empty slot. Neither is repaired by deleting it.
 */
type MailboxOccupant =
  | { status: "open"; origin: MailboxSessionState["origin"] }
  | { status: "empty" }
  | { problem: string };

async function occupantOf(
  client: OpenMailboxesOptions["client"],
  sessionId: string,
  kind: string,
  userId: string
): Promise<MailboxOccupant> {
  const session = await client.getSession(sessionId);

  // Before the collision answer, which would send someone to rename their
  // mailbox: a session from before the rename is old data, not somebody else's.
  if (session.flowKind === PRE_RENAME_NAMES.kind) return { problem: preRenameOccupantProblem() };

  if (session.flowKind !== kind) {
    return {
      problem:
        `the id is held by a "${session.flowKind}" session, not a "${kind}" one. A session id is ` +
        `unique per principal rather than per flow, so this is an id collision with somebody ` +
        `else's session — rename the mailbox rather than have its binder delete that session.`
    };
  }

  // `== null` per BP-030: absent on a session written before instance
  // ownership existed, and an absent owner is not a mismatched one.
  if (session.flowId != null && session.flowId !== kind) {
    return {
      problem:
        `the id is held by a session owned by flow instance "${session.flowId}" rather than by ` +
        `"${kind}". A mailbox kind is a singleton, so its instance address is its kind.`
    };
  }

  if (session.userId !== userId) {
    return {
      problem:
        `the id is held by a session belonging to "${session.userId}", not to "${userId}". ` +
        `A mailbox belongs to one user, and this one would be opened over somebody else's.`
    };
  }

  const state = session.state;
  const bound = state === undefined ? undefined : boundMailbox(state);
  if (bound !== undefined) {
    // The binder used to compare the open mailbox's org against one this run
    // asked for. It no longer asks for one (FIX-1442): the organization is the
    // server's to decide from the verified principal, and re-opening is a
    // server-side create that the session route admits or refuses on that
    // basis. Comparing here would be a SECOND place deciding an org boundary,
    // out of a client's view of the session — and a client that omits `orgId`
    // from `getSession` would read as "no org" and make the check pass. The
    // user, flow and state checks stay: those are the binder's own.
    return { status: "open", origin: bound.origin };
  }
  if (state === undefined || Object.keys(state).length === 0) return { status: "empty" };

  return {
    problem:
      `the id is held by a "${kind}" session carrying state that is not a readable mailbox ` +
      `(keys: ${Object.keys(state).map((key) => `\`${key}\``).join(", ")}). It is not the empty ` +
      `session a premature post leaves, so it is not this binder's to delete.`
  };
}

/**
 * How many times a 409 is answered before the mailbox is refused.
 *
 * Bounded rather than a retry loop: each round costs a read, and a repair that
 * has lost the id three times is a mailbox something else keeps taking, which
 * is worth a startup failure rather than a fourth attempt.
 */
const REPAIR_ATTEMPTS = 3;

/**
 * Open one named session per record, on that record's kind, carrying the
 * mailbox's members, charter and description.
 *
 * Uses the session route rather than the action path, because that route is the
 * only one that accepts caller-supplied `state` at create. The action path is
 * create-or-get and creates with EMPTY state — an unbound mailbox, which the
 * post block refuses.
 *
 * **A 409 says the id is taken, not that a mailbox is open there**, so it is
 * answered by reading the session and branching on boundness:
 *
 * - **A bound mailbox** is left exactly as it is. That is what keeps re-running
 *   over an unchanged roster a no-op — and, for the same reason, an edited
 *   `members:`, charter or `description:` does not reach a mailbox that is
 *   already open — {@link stateFor} writes the first two into session state at
 *   create and `description` is a session field set there, and this branch
 *   returns before any of them is looked at again. Re-opening is not a
 *   migration. `boards:` is NOT one of them: the board list is built onto the
 *   kind from the roster on every bind and never written to the session, so it
 *   does reach a mailbox that is already open. The one case not silently left
 *   behind is an open mailbox this principal cannot reach: the same reasoning
 *   makes that unfixable here, so it refuses rather than reporting the mailbox
 *   opened. A mailbox set up at run time (`origin: "runtime"`) at a file's id
 *   is left the same way, and the clash is reported with a `console.warn`
 *   naming the mailbox, since the file's members never reach it.
 * - **This kind's own empty session** — one the action path minted when
 *   something posted to or read the id before this ran — is adopted: the id is
 *   released and re-created carrying the mailbox's state. Such a session holds
 *   no mailbox data, and writing that state is precisely what opening a mailbox
 *   means. Without this, one premature post leaves the mailbox unbound
 *   permanently: every later run 409s too, and no public route writes state
 *   into a session that already exists.
 * - **Anything else holding the id** is refused by name rather than repaired —
 *   see {@link occupantOf}.
 *
 * A repair that 409s again is answered the same way, not assumed to be another
 * binder's open mailbox: the racer may be the action path, which would leave
 * this resolving over a mailbox that is still unbound. So it re-reads and goes
 * round, up to {@link REPAIR_ATTEMPTS} times, then refuses.
 *
 * @param manifests The roster — the same records `mailboxInstances` registered.
 * @param options   `client`: the session API. `userId`: who every mailbox session belongs to.
 *                  The organization is the server's, from the verified principal.
 * @throws On any failure that is not a 409, and on a 409 this cannot answer, with the mailbox named.
 */
export async function openMailboxes(
  manifests: readonly MailboxManifest[],
  options: OpenMailboxesOptions
): Promise<void> {
  // A board is org-scoped storage, and a mailbox that held one used to be
  // refused here when `openMailboxes` was given no `orgId` — there was nowhere
  // to keep its rows. That precondition is gone (FIX-1442): the session the
  // server creates always carries an organization, so a board always has an
  // address. The binder no longer takes an `orgId` at all, and never did have
  // the authority to choose one.

  // A talk template is the shape of a project's room, never a mailbox, so it
  // is never opened.
  for (const manifest of orderedById(manifests.filter((record) => !isTalkTemplate(record)))) {
    const selected = kindOf(manifest.declared);
    if ("problem" in selected) {
      throw new Error(`mailbox "${manifest.id}" — ${selected.problem}`);
    }

    const declaredDescription = manifest.declared.description;
    const opened = await openOne(options, {
      id: manifest.id,
      kind: selected.kind,
      description: typeof declaredDescription === "string" ? declaredDescription : undefined,
      state: stateFor(manifest)
    });

    // A file whose id a mailbox set up at run time already holds is an edit
    // that does not reach it, like any edit to an open mailbox: its members,
    // charter and tasks stay, and the file's boards are on the kind already.
    // Reported rather than refused, so one org's data never stops the app.
    if (opened.status === "open" && opened.origin === "runtime") {
      console.warn(
        `[workforce] mailbox "${manifest.id}" has a MAILBOX.md, and a mailbox with that id was set up while ` +
          "the app ran. The open mailbox is kept as it is: the file's members and charter do not apply to " +
          "it, and its boards are added. Subscribe the file's members, or rename the file."
      );
    }
  }
}

/** One mailbox to open: its id, the kind it runs on, and what its session starts with. */
interface MailboxToOpen {
  id: string;
  kind: string;
  description: string | undefined;
  state: Record<string, unknown>;
}

/**
 * Open one mailbox's session, or find one already open at its id.
 *
 * The 409 handling {@link openMailboxes} documents, written once so a mailbox
 * set up at run time meets exactly the refusals a file's does: a bound mailbox
 * is left as it is, this kind's own empty session is adopted, and anything
 * else holding the id is refused by name.
 *
 * @returns `opened` when this call opened it; `open`, with the open mailbox's
 *   origin, when a mailbox was already open at the id.
 * @throws With the mailbox named, on anything this cannot answer.
 */
async function openOne(
  options: OpenMailboxesOptions,
  mailbox: MailboxToOpen
): Promise<{ status: "opened" } | { status: "open"; origin: MailboxSessionState["origin"] }> {
  const open = async (): Promise<void> => {
    await options.client.createSession({
      flowKind: mailbox.kind,
      userId: options.userId,
      sessionId: mailbox.id,
      ...(mailbox.description === undefined ? {} : { description: mailbox.description }),
      state: mailbox.state
    });
  };

  const failed = (error: unknown): Error =>
    new Error(`mailbox "${mailbox.id}" could not be opened — ${messageOf(error)}`, {
      cause: error
    });

  try {
    await open();
    return { status: "opened" };
  } catch (error) {
    if (!isAlreadyOpen(error)) throw failed(error);
  }

  for (let attempt = 0; attempt < REPAIR_ATTEMPTS; attempt += 1) {
    let occupant: MailboxOccupant;
    try {
      occupant = await occupantOf(options.client, mailbox.id, mailbox.kind, options.userId);
    } catch (readError) {
      throw failed(readError);
    }

    if ("problem" in occupant) throw failed(new Error(occupant.problem));
    // A bound mailbox — theirs or a previous run's — is left exactly as it
    // is, which is where an unraced 409 lands too.
    if (occupant.status === "open") return occupant;

    try {
      await options.client.deleteSession(mailbox.id);
      await open();
      return { status: "opened" };
    } catch (repairError) {
      // A second 409: the id was retaken between the read and the create.
      // The retaker may be the action path rather than another binder, so
      // the next round asks who holds it now — swallowing this is how a
      // mailbox is left unbound with `openMailboxes` reporting success.
      if (!isAlreadyOpen(repairError)) throw failed(repairError);
    }
  }

  throw failed(
    new Error(
      `the id was taken again by an unbound session on each of ${REPAIR_ATTEMPTS} attempts ` +
        `to open it. Something is racing this binder for the mailbox's session id.`
    )
  );
}

/** What {@link openMailboxAtRunTime} needs: the session API and user `openMailboxes` takes, and two more. */
export interface OpenMailboxAtRunTimeOptions extends OpenMailboxesOptions {
  /**
   * The action door the mailbox's internal entries are run through, as the
   * app: the same door `openInventory` takes, forwarding `source` into
   * `runAction`. **It must reject when the action fails**, or a refused
   * change reads as a done one.
   */
  run: (request: InventoryActionRequest) => Promise<unknown>;
  /**
   * The organization's teams, by id. A mailbox's id is `<team>.<name>`, as a
   * file's is, and a team not listed here is refused.
   */
  teams: readonly string[];
}

/** What setting a mailbox up takes. The org is the caller's, never a tool's input. */
export interface RunTimeMailboxSetUp {
  /** The organization the mailbox's rows are written in: the calling worker's. */
  orgId: string;
  /** The team it belongs to: the first half of its id. */
  team: string;
  /** Its name in the team: the second half of its id. Follows a mailbox folder's naming rule. */
  name: string;
  /** One line saying what it is for, as a file's `description:`. */
  description: string;
  /** Its charter, as a file's body. */
  charter: string;
  /** Its first members, already resolved to worker names. */
  members: readonly string[];
  /** Record the first members as working its task list. Off by default. */
  worksTaskList?: boolean;
}

/** What changing an open mailbox's members takes. */
export interface RunTimeMembershipChange {
  /** The organization the rows are written in: the calling worker's. */
  orgId: string;
  /** The mailbox, by id. Any mailbox on the built-in kind, a file's included. */
  mailboxId: string;
  /** Worker names, already resolved. */
  workers: readonly string[];
}

/** The host's door to opening and changing mailboxes while the app runs. */
export interface RunTimeMailboxOpener {
  /**
   * Open `<team>.<name>` with its members and charter, one task list named
   * `tasks`, and an inventory row marked `origin: "runtime"`.
   *
   * @throws Naming the problem, opening nothing, when the team does not exist,
   *   the name breaks the naming rule, or the id is already a mailbox. A
   *   mailbox set up at run time whose inventory row is missing gets the row
   *   written before that refusal, so a retried setup makes it findable.
   */
  setUp(request: RunTimeMailboxSetUp): Promise<{ mailboxId: string; taskList: string }>;
  /** Add workers to a mailbox; with `worksTaskList`, also to its task lists. Twice is a no-op. */
  subscribe(request: RunTimeMembershipChange & { worksTaskList?: boolean }): Promise<{ members: string[] }>;
  /** Take workers off a mailbox and its task lists. Their open tasks stay. An emptied mailbox stays open. */
  unsubscribe(request: RunTimeMembershipChange): Promise<{ members: string[] }>;
}

/**
 * The host's opener for mailboxes set up while the app runs, beside
 * {@link openMailboxes}, and the door to every mailbox's membership entries.
 *
 * A mailbox opened here meets a file's rules: its id is `<team>.<name>`, its
 * team must exist, its name follows a mailbox folder's rule, and an id that is
 * already a mailbox is refused. It runs on the built-in kind and lives in the
 * org's data, its session and its inventory row; nothing is written to a file.
 *
 * Every change goes through the mailbox's own internal entries, run as the app
 * through `run`, so the session stays the one record and the rows follow it.
 * A mailbox whose `MAILBOX.md` picks a custom kind owns its own state, and is
 * refused by name.
 *
 * Worker names arrive already resolved: checking them against the org's
 * workers is the caller's, which holds the live list.
 *
 * @param options `client` and `userId`, as `openMailboxes` takes them; `run`,
 *   the action door; `teams`, the organization's team ids.
 * @returns The opener.
 */
export function openMailboxAtRunTime(options: OpenMailboxAtRunTimeOptions): RunTimeMailboxOpener {
  const teams = new Set(options.teams);

  /** Run one internal entry on a mailbox, as the app, in the caller's org. */
  const entry = (orgId: string, mailboxId: string, action: string, input: unknown) =>
    options.run({
      action,
      input,
      userId: options.userId,
      orgId,
      flowKind: MAILBOX_KIND,
      sessionId: mailboxId,
      source: "internal"
    });

  /** Refuse a mailbox these entries cannot change, naming why. */
  const assertChangeable = async (mailboxId: string): Promise<void> => {
    let session: Awaited<ReturnType<OpenMailboxesOptions["client"]["getSession"]>>;
    try {
      session = await options.client.getSession(mailboxId);
    } catch (error) {
      throw new Error(`mailbox "${mailboxId}" could not be read — ${messageOf(error)}`, { cause: error });
    }
    if (session.flowKind !== MAILBOX_KIND) {
      throw new Error(
        `mailbox "${mailboxId}" runs on mailbox kind "${session.flowKind}", which owns its own state and ` +
          "actions. Only a mailbox on the built-in kind can have its workers changed here."
      );
    }
    if (session.state === undefined || boundMailbox(session.state) === undefined) {
      throw new Error(`"${mailboxId}" is not an open mailbox. Set it up, or open its file, first.`);
    }
  };

  const changeOutput = (ran: unknown): { members: string[] } => membershipChangedSchema.parse(ran);

  return {
    async setUp(request) {
      try {
        validateSegment(request.team, "Team");
        validateSegment(request.name, "Mailbox");
      } catch (error) {
        throw new Error(`a mailbox cannot be set up as "${request.team}.${request.name}" — ${messageOf(error)}`);
      }
      if (!teams.has(request.team)) {
        throw new Error(
          `a mailbox cannot be set up in team "${request.team}": the organization has no such team. ` +
            `Teams: ${[...teams].sort().join(", ") || "(none)"}.`
        );
      }
      const mailboxId = `${request.team}.${request.name}`;
      if (isTemplateMailbox(PROJECTS_COLLECTION, mailboxId)) {
        throw new Error(`"${mailboxId}" is a project talk template's id, not one a mailbox can take.`);
      }

      const members = [...new Set(request.members)];
      const state: Omit<MailboxSessionState, "resourceId"> = {
        members,
        instructions: request.charter,
        transcript: [],
        origin: "runtime",
        taskLists: [RUN_TIME_TASK_LIST],
        workersByList:
          request.worksTaskList === true && members.length > 0
            ? { [RUN_TIME_TASK_LIST]: { added: members, removed: [] } }
            : null
      };
      const opened = await openOne(options, {
        id: mailboxId,
        kind: MAILBOX_KIND,
        description: request.description,
        state
      });

      if (opened.status === "open") {
        // The one repair a refusal makes: a mailbox set up at run time writes
        // its own row again, so one whose row never landed becomes findable.
        if (opened.origin === "runtime") await entry(request.orgId, mailboxId, MAILBOX_SET_UP_ACTION, {});
        throw new Error(`"${mailboxId}" is already a mailbox. Pick another name, or subscribe workers to it.`);
      }

      await entry(request.orgId, mailboxId, MAILBOX_SET_UP_ACTION, { description: request.description });
      return { mailboxId, taskList: RUN_TIME_TASK_LIST };
    },

    async subscribe(request) {
      await assertChangeable(request.mailboxId);
      return changeOutput(
        await entry(request.orgId, request.mailboxId, MAILBOX_SUBSCRIBE_ACTION, {
          workers: [...request.workers],
          ...(request.worksTaskList === true ? { worksTaskList: true } : {})
        })
      );
    },

    async unsubscribe(request) {
      await assertChangeable(request.mailboxId);
      return changeOutput(
        await entry(request.orgId, request.mailboxId, MAILBOX_UNSUBSCRIBE_ACTION, { workers: [...request.workers] })
      );
    }
  };
}
