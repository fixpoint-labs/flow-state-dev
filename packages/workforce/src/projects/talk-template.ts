/**
 * The talk template: the shape of a project's room, and the reaction that
 * mints a creator's talk session when a row is created.
 *
 * A template names the seats a post in a project's room wakes and the room's
 * charter. Talk sessions run on the built-in channel kind. It is declared at one of
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
 * template, and the first `channelInstances` call that finds a template
 * registers it and installs the reaction. Every later call builds the channel
 * kind from that registration, and nothing removes it. One process serves one
 * organization's tree, with its rooms on the built-in channel kind.
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
 * Record the org-level template declared beside `collection`. The first
 * declaration stands: the same template declared again (any module may call
 * `defineProjectsCollection({ talk })`) is a no-op, and a different one throws
 * where it is declared, rather than silently replacing the first.
 *
 * @throws When `seats` is not a list of seat ids, naming the first bad one:
 *   the same check a template file's `members:` gets at bind, made here so a
 *   bad org template fails where it is declared. And when another template is
 *   already declared beside `collection`.
 */
export function recordOrgTalkTemplate(collection: object, template: TalkTemplate): void {
  const problem = Array.isArray(template.seats)
    ? templateSeatsProblem(template.seats)
    : "`seats` is not a list of seat ids";
  if (problem !== undefined) throw new Error(`defineProjectsCollection: the talk template's ${problem}`);
  const current = orgTemplates.get(collection);
  if (current !== undefined) {
    const facts = (t: TalkTemplate): TalkTemplateFacts => ({ seats: t.seats, charter: t.charter ?? "" });
    if (sameFacts(facts(current), facts(template))) return;
    throw new Error(
      `defineProjectsCollection: a talk template is already declared beside this collection ` +
        `(seats ${JSON.stringify(current.seats)}), and this call declares a different one ` +
        `(seats ${JSON.stringify(template.seats)}). Every project's room shares one template: declare it once.`
    );
  }
  orgTemplates.set(collection, {
    seats: [...template.seats],
    ...(template.charter === undefined ? {} : { charter: template.charter })
  });
}

/** The org-level template declared beside `collection`, or `undefined`. */
export function orgTalkTemplateOf(collection: unknown): TalkTemplate | undefined {
  return typeof collection === "object" && collection !== null ? orgTemplates.get(collection) : undefined;
}

/** Forget the org-level template declared beside `collection`. For tests that stand for several processes in one. */
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

/** One registered template: where it was declared, what it holds, and the reaction it installed. */
type Registration = { site: string; facts: TalkTemplateFacts; reactTo: object };

/** The process's one talk template per collection, set by the first `channelInstances` call that finds one. */
const registrations = new WeakMap<object, Registration>();

/**
 * Register the talk template for `collection`, once per process, and install
 * the reaction that mints a creator's talk session: `reactTo.created` on the
 * collection dispatches `kind`'s `bind` into a child of the creating session,
 * keyed {@link talkSessionKey}. It runs inside the turn that created the row,
 * so a row written outside any turn mints nothing. Rescued: the mint is not
 * atomic with the row, and a refused bind leaves the row unbound until its
 * owner's `join` or a re-sent create.
 *
 * **Set once, read by every call.** The collection is process-wide, so its
 * reaction is too, and the template lives beside it: every `channelInstances`
 * call builds its channel kind from {@link registeredTalkTemplate}, whether or
 * not that call was handed the template's site. Registering the same template
 * again (the same site and facts, as a host that binds one roster per flow
 * does) is a no-op. Nothing here ever removes a registration.
 *
 * @throws When another template is already registered for `collection`.
 */
export function registerTalkTemplate(
  collection: object,
  template: { site: string; facts: TalkTemplateFacts },
  kind: string
): void {
  const conflict = talkTemplateConflict(collection, template);
  if (conflict !== undefined) throw new Error(`channelInstances: ${conflict}`);
  if (registrations.has(collection)) return;
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
  registrations.set(collection, {
    site: template.site,
    facts: { seats: [...template.facts.seats], charter: template.facts.charter },
    reactTo
  });
  (collection as { reactTo?: object }).reactTo = reactTo;
}

/**
 * Why `template` cannot be registered for `collection`, or `undefined` when it
 * can: another template is registered already. The same one (site and facts)
 * is no conflict. The binder reports this with its other refusals, before it
 * registers anything.
 */
export function talkTemplateConflict(
  collection: object,
  template: { site: string; facts: TalkTemplateFacts }
): string | undefined {
  const current = registrations.get(collection);
  if (current === undefined) return undefined;
  if (current.site === template.site && sameFacts(current.facts, template.facts)) return undefined;
  return (
    `project rooms already have a talk template in this process (${current.site}), and ` +
    `${template.site} would be a second${current.site === template.site ? " with other seats or charter" : ""}. ` +
    `Every project's room shares one template. Keep one.`
  );
}

/** The talk template registered for `collection` in this process, or `undefined`. */
export function registeredTalkTemplate(collection: object): { site: string; facts: TalkTemplateFacts } | undefined {
  const current = registrations.get(collection);
  return current === undefined ? undefined : { site: current.site, facts: current.facts };
}

function sameFacts(a: TalkTemplateFacts, b: TalkTemplateFacts): boolean {
  return a.charter === b.charter && a.seats.length === b.seats.length && a.seats.every((seat, i) => seat === b.seats[i]);
}

/**
 * Forget the template registered for `collection`, and remove the reaction it
 * installed. For tests that stand for several processes in one.
 */
export function forgetTalkTemplate(collection: object): void {
  const current = registrations.get(collection);
  if (current === undefined) return;
  const target = collection as { reactTo?: object };
  if (target.reactTo === current.reactTo) delete target.reactTo;
  registrations.delete(collection);
}
