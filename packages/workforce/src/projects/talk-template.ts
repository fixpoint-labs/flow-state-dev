/**
 * The talk template: the shape of a project's room, and the reaction that
 * mints a creator's talk session when a row is created.
 *
 * A template names the seats a post in a project's room wakes, the room's
 * charter, and the channel kind talk sessions run on. It is declared at one of
 * two sites, and the channel binder (`channelInstances`) reads both:
 *
 * - **The org-level default**, beside the collection in
 *   `org/resources/projects.ts`:
 *   `export default defineProjectsCollection({ talk: { seats, charter } })`.
 * - **A team's**, in a `CHANNEL.md` marked `mintFor: projects`, whose
 *   `members:` are the seats and whose body is the charter.
 *
 * A template is not a channel: it is never opened and never registered in the
 * inventory. Its seats and charter are built onto the kind at every boot and
 * never written into a session, so an edit reaches every project's room at the
 * next restart.
 *
 * **Process-wide, on purpose.** The projects collection is one shared
 * declaration (a flow refuses two declarations under one ref), so the org
 * template recorded on it and the reaction installed on it are the process's
 * too: the last `defineProjectsCollection({ talk })` call names the org
 * template, and a `channelInstances` call that finds a template installs the
 * reaction, which no later call removes. One process serves one
 * organization's tree, with its rooms on one kind.
 */

import { dispatcher, handler, resourceChangeSchema, type ResourceChange } from "@flow-state-dev/core";
import { z } from "zod";
import { validateSegment } from "../loader/segments";

/** A project's talk template, as the org-level default declares it. */
export type TalkTemplate = {
  /**
   * The seats a post in the room wakes, once each, under the poster. A full
   * seat id from any team (`eng.em`), or a dotless org seat id
   * (`chief-of-staff`). These are not the project's members: members are the
   * people who may read and post.
   */
  seats: readonly string[];
  /** The room's charter. Every project's room shares it. Empty when omitted. */
  charter?: string;
  /** The channel kind talk sessions run on. Defaults to the built-in `channel`. */
  kind?: string;
};

/** What a channel kind is built holding: the template's seats and charter. */
export type TalkTemplateFacts = { seats: readonly string[]; charter: string };

/** The talk kind's internal entry that binds a session to a project. */
export const TALK_BIND_ACTION = "bind";

/**
 * The key a creator's talk session is dispatched under, from the creating
 * session: `talk:<projectId>`. One function for the reaction and for
 * `createProject`'s own bind, so the two land on one session.
 */
export function talkSessionKey(projectId: string): string {
  return `talk:${projectId}`;
}

/** Absorbs a refused `bind` dispatch: the row stands, unbound, until a repair. */
export const noteBindRefusal = handler({
  name: "project-bind-refused",
  inputSchema: z.unknown(),
  outputSchema: z.object({ bound: z.literal(false), reason: z.string() }),
  execute: async (error: unknown) => ({
    bound: false as const,
    reason: `talk session not bound: ${error instanceof Error ? error.message : String(error)}`
  })
});

/** Org templates by the collection declaration they were declared beside. */
const orgTemplates = new WeakMap<object, TalkTemplate>();

/**
 * Record the org-level template declared beside `collection`. Replaces an
 * earlier one.
 *
 * @throws When `seats` is not a list of seat ids, naming the first bad one:
 *   the same check a template file's `members:` gets at bind, made here so a
 *   bad org template fails where it is declared.
 */
export function recordOrgTalkTemplate(collection: object, template: TalkTemplate): void {
  const problem = Array.isArray(template.seats)
    ? templateSeatsProblem(template.seats)
    : "`seats` is not a list of seat ids";
  if (problem !== undefined) throw new Error(`defineProjectsCollection: the talk template's ${problem}`);
  orgTemplates.set(collection, {
    seats: [...template.seats],
    ...(template.charter === undefined ? {} : { charter: template.charter }),
    ...(template.kind === undefined ? {} : { kind: template.kind })
  });
}

/** The org-level template declared beside `collection`, or `undefined`. */
export function orgTalkTemplateOf(collection: unknown): TalkTemplate | undefined {
  return typeof collection === "object" && collection !== null ? orgTemplates.get(collection) : undefined;
}

/** Forget the org-level template declared beside `collection`. For tests that declare several in one process. */
export function forgetOrgTalkTemplate(collection: object): void {
  orgTemplates.delete(collection);
}

/**
 * Why a template's seat id is not one, or `undefined` when it is: a full seat
 * id (`team.seat`) or a dotless org seat id, each part by the tree's name rule.
 *
 * A local check, kept minimal: the org seat loader's own parser is being
 * reworked beside this (FIX-1719), and the two are to be consolidated once it
 * lands.
 */
export function templateSeatIdProblem(id: unknown): string | undefined {
  if (typeof id !== "string") return `seat ${JSON.stringify(id)} is not a seat id`;
  const parts = id.split(".");
  if (parts.length > 2) {
    return `seat "${id}" is not a seat id: name a team's seat as \`team.seat\`, or an org seat by its own name`;
  }
  try {
    if (parts.length === 2) validateSegment(parts[0]!, "Team");
    validateSegment(parts[parts.length - 1]!, "Worker");
  } catch (error) {
    return `seat "${id}" is not a seat id: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

/**
 * Why a template's seat list is not one, or `undefined` when it is: every id
 * a seat id ({@link templateSeatIdProblem}) and none listed twice, since a
 * seat listed twice would be woken twice by one post. Both declaration sites
 * check with this.
 */
export function templateSeatsProblem(seats: readonly unknown[]): string | undefined {
  const seen = new Set<unknown>();
  for (const seat of seats) {
    const problem = templateSeatIdProblem(seat);
    if (problem !== undefined) return problem;
    if (seen.has(seat)) return `seat "${String(seat)}" is listed twice: a post would wake it twice. List each seat once`;
    seen.add(seat);
  }
  return undefined;
}

/** The reactions this module installed, by the kind each mints on. */
const installed = new WeakMap<object, string>();

/**
 * Install the reaction that mints a creator's talk session: `reactTo.created`
 * on `collection` dispatches `kind`'s `bind` into a child of the creating
 * session, keyed {@link talkSessionKey}. It runs inside the turn that created
 * the row, so a row written outside any turn mints nothing. Rescued: the mint
 * is not atomic with the row, and a refused bind leaves the row unbound until
 * its owner's `join` or a re-sent create.
 *
 * **One talk kind per process.** The collection is process-wide, so its
 * reaction is too. Installing again on the same kind replaces it (a restart
 * in one process); a second, different kind is refused, since rows would mint
 * on whichever was installed last. Nothing here ever removes a reaction, so a
 * host that builds several flows and calls `channelInstances` more than once
 * keeps the one a template installed.
 *
 * The kind must also be the one every `createProject` binds on
 * ({@link noteTalkBindKind}), or a create would ready two sessions.
 *
 * @throws When a reaction this module installed mints on another kind, or a
 *   `createProject` binds on another kind.
 */
export function installTalkReaction(collection: object, kind: string): void {
  const target = collection as { reactTo?: { created?: unknown } };
  const current = target.reactTo === undefined ? undefined : installed.get(target.reactTo);
  if (current !== undefined && current !== kind) {
    throw new Error(
      `channelInstances: project talk sessions already mint on kind "${current}" in this process, and a ` +
        `template now names kind "${kind}". The projects collection is one per process, so its rooms run on one kind.`
    );
  }
  const other = [...(bindKinds.get(collection) ?? [])].find((bound) => bound !== kind);
  if (other !== undefined) throw new Error(talkKindMismatch(other, kind));
  const mint = dispatcher({
    name: "project-mint-talk",
    flowKind: kind,
    action: TALK_BIND_ACTION,
    // The row's own fields are not read: the key is the row id, and `bind`
    // reads the row itself.
    inputSchema: resourceChangeSchema(z.object({}).passthrough()),
    session: { key: (change: ResourceChange) => talkSessionKey(change.key) },
    payload: (change: ResourceChange) => ({ resourceId: change.key })
  }).rescue([{ block: noteBindRefusal }]);
  const reactTo = { created: mint };
  installed.set(reactTo, kind);
  target.reactTo = reactTo;
}

/**
 * The kinds `defineProjectBlocks` built a `createProject` binding on, per
 * collection. `createProject` binds its creator on its kind and the template's
 * reaction binds on the template's, under one key: on two kinds they are two
 * sessions, so the two must agree.
 */
const bindKinds = new WeakMap<object, Set<string>>();

function talkKindMismatch(bindKind: string, templateKind: string): string {
  return (
    `createProject binds talk sessions on kind "${bindKind}" (\`defineProjectBlocks({ talkKind })\`, ` +
    `"channel" by default), and the talk template mints them on kind "${templateKind}". Each create would ` +
    `ready two talk sessions on two kinds. Name the same kind in both.`
  );
}

/**
 * Note the kind a `createProject` dispatches `bind` to. Refuses one that
 * differs from the kind an installed template reaction mints on; whichever of
 * the two is built second throws, so the mismatch fails at boot either way.
 *
 * @throws When a template reaction on `collection` mints on another kind.
 */
export function noteTalkBindKind(collection: object, kind: string): void {
  const reactTo = (collection as { reactTo?: object }).reactTo;
  const templateKind = reactTo === undefined ? undefined : installed.get(reactTo);
  if (templateKind !== undefined && templateKind !== kind) throw new Error(talkKindMismatch(kind, templateKind));
  const kinds = bindKinds.get(collection) ?? new Set<string>();
  kinds.add(kind);
  bindKinds.set(collection, kinds);
}

/**
 * Remove the reaction this module installed on `collection`, and the bind
 * kinds noted on it. For tests that boot several hosts in one process.
 */
export function forgetTalkReaction(collection: object): void {
  const target = collection as { reactTo?: object };
  if (target.reactTo !== undefined && installed.has(target.reactTo)) delete target.reactTo;
  bindKinds.delete(collection);
}
