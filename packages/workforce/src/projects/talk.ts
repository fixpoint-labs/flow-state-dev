/**
 * The talk entries: how a person's own session reaches a project's room.
 *
 * A talk session is a session on the channel kind whose state holds one field,
 * `resourceId`: the project it is about. That field **grants nothing**. A
 * caller writes session state when it creates a session, so anyone can create
 * one naming any project; every room entry therefore looks the row up and runs
 * the membership gate (`membership-gate.ts`) against the session's owner as
 * the engine recorded it. Nobody's session is shared: each member reaches the
 * room through their own, and the room itself is org data (`room-store.ts`).
 *
 * Five entries, built into every channel kind by `defineChannelFlow`:
 *
 * - `bind` (internal): bind this session to a project.
 * - `join`: the same, for a person — members only.
 * - `post` and `answer`: a person's line and a seat's answer, into the room.
 * - `read { after }`: one page of committed lines after a cursor.
 *
 * `bind` and `join` are keyed by the project and the person, never by the
 * calling session: when the row already lists a talk session for this user,
 * that session is the answer, so a second window adopts it and `sessions`
 * never holds two entries for one user. Otherwise the calling session is
 * bound and appended, under the room's retry (`cas-retry.ts`); if another
 * window won that race, the calling session is unbound again and the winner
 * is returned.
 *
 * Project talk is written to `room-lines` only. No entry here emits a
 * `channel-post` item, in any session.
 */

import { handler } from "@flow-state-dev/core";
import { withOutcome } from "@flow-state-dev/core/helpers";
import type { BlockContext, ResourceCollectionRef, ResourceRef } from "@flow-state-dev/core/types";
import { z } from "zod";
import { retryOnConflict } from "./cas-retry";
import {
  defineProjectsCollection,
  defineRoomLinesCollection,
  defineRoomSeqCollection,
  PROJECTS_RESOURCE,
  ROOM_LINES_RESOURCE,
  ROOM_SEQ_RESOURCE,
  roomLineSchema,
  type ProjectRow,
  type RoomLine,
  type RoomSeq
} from "./collections";
import { isMember } from "./membership-gate";
import { ProjectRefusedError } from "./project-refusal";
import { appendRoomLine, readRoom, type RoomCollections } from "./room-store";

/**
 * The talk half of a channel session's state. Nullable with a `null` default
 * (BP-023, BP-030): a declared channel never sets it, and a session written
 * before it existed reads as unbound.
 */
export const talkSessionStateSchema = z.object({
  resourceId: z.string().nullable().default(null)
});

/**
 * The project a session is bound to, or `undefined`. Selects which row the
 * gate checks; never a grant on its own.
 */
export function talkProjectOf(state: Readonly<Record<string, unknown>>): string | undefined {
  const value = state.resourceId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** `bind`'s input: the project to bind this session to. */
const talkBindInputSchema = z.object({ resourceId: z.string().min(1) }).strict();

/** `join`'s input: the project to join. */
const talkJoinInputSchema = z.object({ projectId: z.string().min(1) }).strict();

/** What `bind` and `join` return: the caller's one talk session on the project. */
const talkSessionOutputSchema = z.object({ sessionId: z.string() });

/** `read`'s input: the cursor, the last `seq` already seen. */
const talkReadInputSchema = z.object({ after: z.number().int().min(0).default(0) });

/** One page of the room, and the cursor for the next read. */
export const talkReadOutputSchema = z.object({
  projectId: z.string(),
  lines: z.array(roomLineSchema),
  nextCursor: z.number().int()
});

/** @see talkReadOutputSchema */
export type TalkReadOutput = z.infer<typeof talkReadOutputSchema>;

/** The resources every talk entry declares: one map, since a flow refuses two declarations under one ref. */
const TALK_RESOURCES = {
  [PROJECTS_RESOURCE]: defineProjectsCollection(),
  [ROOM_LINES_RESOURCE]: defineRoomLinesCollection(),
  [ROOM_SEQ_RESOURCE]: defineRoomSeqCollection()
};

function projectsOf(ctx: BlockContext): ResourceCollectionRef<ProjectRow> {
  return ctx.resources[PROJECTS_RESOURCE] as unknown as ResourceCollectionRef<ProjectRow>;
}

function roomOf(ctx: BlockContext): RoomCollections {
  return {
    lines: ctx.resources[ROOM_LINES_RESOURCE] as unknown as ResourceCollectionRef<RoomLine>,
    seq: ctx.resources[ROOM_SEQ_RESOURCE] as unknown as ResourceCollectionRef<RoomSeq>
  };
}

/** The session's owner, as the engine recorded it. The only identity the gate reads. */
function ownerOf(ctx: BlockContext): string | undefined {
  return ctx.session.identity.userId;
}

/** The row, if the session's owner is one of its members. Refuses otherwise, and writes nothing. */
async function memberRow(ctx: BlockContext, projectId: string): Promise<ResourceRef<ProjectRow>> {
  const row = await projectsOf(ctx).getOptional(projectId);
  if (row === undefined) {
    throw new ProjectRefusedError("no-such-project", `this organization has no project "${projectId}".`);
  }
  if (!isMember(row.state, ownerOf(ctx))) {
    throw new ProjectRefusedError(
      "not-a-member",
      `project "${projectId}"'s room is for its members, and this session's owner is not one.`
    );
  }
  return row;
}

/** The project this session is bound to, or the refusal. */
function boundProject(ctx: BlockContext): string {
  const projectId = talkProjectOf(ctx.session.state);
  if (projectId === undefined) {
    throw new ProjectRefusedError(
      "talk-not-bound",
      `session "${ctx.session.identity.id}" is bound to no project. Call \`join\` with the project's id first.`
    );
  }
  return projectId;
}

/**
 * Bind the calling session to `projectId`, or hand back the talk session the
 * row already lists for this user. See the module header.
 */
async function bindTalk(ctx: BlockContext, projectId: string): Promise<{ sessionId: string }> {
  const self = ctx.session.identity.id;
  // A declared channel's session carries its roster and charter. Binding it
  // would turn its own `post` and `read` into the project's room.
  if ("members" in ctx.session.state || "instructions" in ctx.session.state) {
    throw new ProjectRefusedError(
      "talk-on-a-channel",
      `session "${self}" is a declared channel's session. Join a project from a session of its own.`
    );
  }
  const bound = talkProjectOf(ctx.session.state);
  if (bound !== undefined && bound !== projectId) {
    throw new ProjectRefusedError(
      "talk-bound-elsewhere",
      `session "${self}" is already bound to project "${bound}". A talk session is about one project.`
    );
  }
  const row = await memberRow(ctx, projectId);
  // Present, because the gate refuses a session with no owner.
  const owner = ownerOf(ctx) as string;

  const listed = row.state.sessions.find((link) => link.userId === owner);
  if (listed !== undefined) {
    if (listed.sessionId === self && bound === undefined) await ctx.session.patchState({ resourceId: projectId });
    return { sessionId: listed.sessionId };
  }

  // The session side first. A session that holds `resourceId` but is not
  // listed is harmless — the field grants nothing — while a listed session
  // without it would be handed to the next window unbound.
  if (bound === undefined) await ctx.session.patchState({ resourceId: projectId });

  const winner = await retryOnConflict(() =>
    withOutcome(
      (mutator: (state: ProjectRow) => ProjectRow) => row.updateState(mutator),
      (state: ProjectRow) => {
        const existing = state.sessions.find((link) => link.userId === owner);
        if (existing !== undefined) return { state, result: existing.sessionId };
        return { state: { ...state, sessions: [...state.sessions, { sessionId: self, userId: owner }] }, result: self };
      }
    )
  );
  if (winner === undefined) throw new Error(`project "${projectId}": the sessions write committed no session`);

  // Another window won: this session is discarded in favour of that one.
  if (winner !== self && bound === undefined) await ctx.session.patchState({ resourceId: null });
  return { sessionId: winner };
}

/**
 * `bind` (internal): bind this session to a project. Refused when no row holds
 * the id, when this session is bound to another project, or when its owner is
 * not a member. Idempotent: binding a bound session again changes nothing.
 */
export const talkBind = handler({
  name: "talk-bind",
  inputSchema: talkBindInputSchema,
  outputSchema: talkSessionOutputSchema,
  sessionStateSchema: talkSessionStateSchema,
  resources: TALK_RESOURCES,
  execute: (input, ctx) => bindTalk(ctx as unknown as BlockContext, input.resourceId)
});

/**
 * `join`: a member's way into a project's room. Returns the member's one talk
 * session: the one the row lists, or this session, now bound and listed. A
 * non-member is refused and nothing is written; `join` never adds its caller
 * to `members`. A declared channel's own session is refused too: `join` binds
 * a session of its own, never a channel. Also repairs a row whose owner was never bound.
 */
export const talkJoin = handler({
  name: "talk-join",
  inputSchema: talkJoinInputSchema,
  outputSchema: talkSessionOutputSchema,
  sessionStateSchema: talkSessionStateSchema,
  resources: TALK_RESOURCES,
  execute: (input, ctx) => bindTalk(ctx as unknown as BlockContext, input.projectId)
});

/** A person's post on a talk session. Same closed input as a channel post. */
const talkPostInputSchema = z
  .object({ body: z.string().min(1), author: z.string().optional() })
  .strict();

/**
 * `post` on a talk session: one line into the room, as the session's owner. A
 * person's line names no `author`; a seat's words go through `answer`.
 */
export const talkPost = handler({
  name: "talk-post",
  inputSchema: talkPostInputSchema,
  outputSchema: roomLineSchema,
  sessionStateSchema: talkSessionStateSchema,
  resources: TALK_RESOURCES,
  execute: async (input, rawCtx): Promise<RoomLine> => {
    const ctx = rawCtx as unknown as BlockContext;
    if (input.author !== undefined) {
      throw new ProjectRefusedError(
        "author-on-a-person-post",
        "a line posted to a project's room is the session owner's own; a seat's line goes through `answer`."
      );
    }
    const projectId = boundProject(ctx);
    await memberRow(ctx, projectId);
    return appendRoomLine(roomOf(ctx), { projectId, userId: ownerOf(ctx) as string, author: null, body: input.body });
  }
});

/** A seat's answer: the same closed input a channel answer takes. */
const talkAnswerInputSchema = z
  .object({ postId: z.string().min(1), body: z.string().min(1), author: z.string().min(1) })
  .strict();

/**
 * `answer` on a talk session: a seat's line, delivered into the session of the
 * person whose post woke it. The line's `userId` is that session's owner; its
 * `author` is the seat. `postId` names what is being answered and is not
 * stored: a room line has no post id.
 */
export const talkAnswer = handler({
  name: "talk-answer",
  inputSchema: talkAnswerInputSchema,
  outputSchema: roomLineSchema,
  sessionStateSchema: talkSessionStateSchema,
  resources: TALK_RESOURCES,
  execute: async (input, rawCtx): Promise<RoomLine> => {
    const ctx = rawCtx as unknown as BlockContext;
    const projectId = boundProject(ctx);
    await memberRow(ctx, projectId);
    return appendRoomLine(roomOf(ctx), {
      projectId,
      userId: ownerOf(ctx) as string,
      author: input.author,
      body: input.body
    });
  }
});

/** `read { after }` on a talk session: one page of committed lines after the cursor. */
export const talkRead = handler({
  name: "talk-read",
  inputSchema: talkReadInputSchema,
  outputSchema: talkReadOutputSchema,
  sessionStateSchema: talkSessionStateSchema,
  resources: TALK_RESOURCES,
  execute: async (input, rawCtx): Promise<TalkReadOutput> => {
    const ctx = rawCtx as unknown as BlockContext;
    const projectId = boundProject(ctx);
    await memberRow(ctx, projectId);
    const page = await readRoom(roomOf(ctx), projectId, input.after);
    return { projectId, ...page };
  }
});
