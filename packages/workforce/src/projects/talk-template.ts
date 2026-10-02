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
 * template, and the last `channelInstances` call decides the reaction. One
 * process serves one organization's tree.
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

/** Record the org-level template declared beside `collection`. Replaces an earlier one. */
export function recordOrgTalkTemplate(collection: object, template: TalkTemplate): void {
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

/** The reactions this module installed, so a later bind only ever replaces its own. */
const installed = new WeakSet<object>();

/**
 * Install, replace or clear the reaction that mints a creator's talk session.
 *
 * With a kind: `reactTo.created` on `collection` dispatches that kind's `bind`
 * into a child of the creating session, keyed {@link talkSessionKey}. It runs
 * inside the turn that created the row, so a row written outside any turn
 * mints nothing. Rescued: the mint is not atomic with the row, and a refused
 * bind leaves the row unbound until its owner's `join` or a re-sent create.
 *
 * With `undefined`: removes a reaction this module installed, so a roster with
 * no template binds as before.
 */
export function installTalkReaction(collection: object, kind: string | undefined): void {
  const target = collection as { reactTo?: { created?: unknown } };
  if (kind === undefined) {
    if (target.reactTo !== undefined && installed.has(target.reactTo)) delete target.reactTo;
    return;
  }
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
  installed.add(reactTo);
  target.reactTo = reactTo;
}
