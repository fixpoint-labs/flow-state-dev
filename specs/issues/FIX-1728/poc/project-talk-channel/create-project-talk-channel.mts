/**
 * FIX-1728 POC · candidate factory: org project resource + templated talk session.
 *
 * Experimental. Nothing in `packages/workforce` imports this. A later
 * convention spike may promote the shape; do not promote by moving the file
 * onto a published export.
 *
 * The composition this file exists to show:
 *
 *   1. An org-scoped **project resource** holds the durable fields (name,
 *      status, owner, links).
 *   2. Creating one opens a **user-bound talk session** through the shipped
 *      `ChannelManifest` + `channelInstances` + `openChannels` path, on an
 *      existing channel kind (the built-in `"channel"` unless a kind is named).
 *   3. The link is explicit both ways: the resource stores `talkSessionId`,
 *      and the session id is `project-talk.<projectId>` so it parses back.
 *
 * What it refuses to do, on purpose:
 *
 *   - Put name / status / owner / links in channel session state.
 *   - Invent a `workforce/projects/` tree or an L1 Project type.
 *   - Write a CHANNELS.md room list.
 *   - Turn the talk session into a shared room (`flowIsolation: false` lives
 *     on the **resource**, so other flows in the org can discover the project;
 *     the session is still one `userId`).
 */

import { defineResourceCollection } from "../../../../../packages/core/src/index";
import {
  CHANNEL_KIND,
  channelInstances,
  openChannels,
  type ChannelKind,
  type OpenChannelsOptions
} from "../../../../../packages/workforce/src/channel";
import type { ChannelManifest } from "../../../../../packages/workforce/src/manifest";
import { z } from "zod";

/** Storage prefix for project rows. Org-scoped; not a tree folder. */
export const PROJECT_COLLECTION_PATTERN = "projects/*";

/** Session-id prefix. The rest of the id is the project id. */
export const TALK_SESSION_PREFIX = "project-talk.";

/** One org-discoverable project. Durable fields live here, not on the session. */
export const projectResourceSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  owner: z.string().nullable().default(null),
  links: z.array(z.string()).default([]),
  /** The talk session this create opened. The session id is also parseable. */
  talkSessionId: z.string().min(1)
});

export type ProjectResource = z.infer<typeof projectResourceSchema>;

const PROJECT_CLIENT_FIELDS = [
  "id",
  "name",
  "status",
  "owner",
  "links",
  "talkSessionId"
] as const;

/**
 * Org-scoped project collection. `flowIsolation: false` is the inventory
 * spelling: every flow in the org reads the same rows. That is discoverability
 * of the **resource**, not a shared talk room.
 */
export function defineProjectResourceCollection() {
  return defineResourceCollection({
    pattern: PROJECT_COLLECTION_PATTERN,
    scope: "org",
    flowIsolation: false,
    stateSchema: projectResourceSchema,
    client: { state: { read: true }, expose: PROJECT_CLIENT_FIELDS }
  });
}

/** The store the helper writes through. A real collection `.upsert` satisfies it. */
export type ProjectStore = {
  upsert(id: string, row: ProjectResource): Promise<void>;
  get(id: string): Promise<ProjectResource | undefined>;
};

export type CreateProjectTalkChannelInput = {
  project: {
    id: string;
    name: string;
    status?: string;
    owner?: string | null;
    links?: string[];
  };
  /** Who the talk session belongs to. Required: a channel session is one user. */
  userId: string;
  client: OpenChannelsOptions["client"];
  store: ProjectStore;
  /**
   * Channel kind to open on. Defaults to the built-in `"channel"`. A custom
   * name must be in `kinds` — the binder never falls back.
   */
  channelKind?: string;
  kinds?: Record<string, ChannelKind>;
  /** Seat ids that may post. Empty is fine; membership is not the room's owner. */
  members?: string[];
};

export type CreateProjectTalkChannelResult = {
  project: ProjectResource;
  talkSessionId: string;
  manifest: ChannelManifest;
};

/**
 * Create the org project and open its talk session on the shipped binder.
 *
 * Not atomic: a failed `openChannels` leaves the resource row behind. That is
 * named as unsolved, not papered over.
 */
export async function createProjectTalkChannel(
  input: CreateProjectTalkChannelInput
): Promise<CreateProjectTalkChannelResult> {
  if (input.userId.trim().length === 0) {
    throw new Error("createProjectTalkChannel requires a userId; a talk session is user-bound");
  }
  if (input.project.name.trim().length === 0) {
    throw new Error("createProjectTalkChannel requires a project name");
  }

  const id = assertProjectId(input.project.id);
  const talkSessionId = talkSessionIdFor(id);
  const project: ProjectResource = {
    id,
    name: input.project.name,
    status: input.project.status ?? "active",
    owner: input.project.owner ?? null,
    links: input.project.links ?? [],
    talkSessionId
  };

  await input.store.upsert(id, project);

  const manifest = talkChannelManifest({
    projectId: id,
    name: project.name,
    channelKind: input.channelKind,
    members: input.members
  });

  // Bind first so a missing kind refuses before a session is created.
  channelInstances([manifest], { kinds: input.kinds });
  await openChannels([manifest], { client: input.client, userId: input.userId });

  return { project, talkSessionId, manifest };
}

/** Deterministic session id for a project. The reverse parse is {@link projectIdFromTalkSession}. */
export function talkSessionIdFor(projectId: string): string {
  return `${TALK_SESSION_PREFIX}${assertProjectId(projectId)}`;
}

/** Reverse of {@link talkSessionIdFor}. `undefined` when the id is not this convention. */
export function projectIdFromTalkSession(sessionId: string): string | undefined {
  if (!sessionId.startsWith(TALK_SESSION_PREFIX)) return undefined;
  const id = sessionId.slice(TALK_SESSION_PREFIX.length);
  return isProjectId(id) ? id : undefined;
}

/**
 * Hand-built channel record for a project's talk session.
 *
 * The charter points at the resource. It does not copy durable fields — those
 * would rot the moment the resource changed, and they are the invent-kill.
 */
export function talkChannelManifest(input: {
  projectId: string;
  name: string;
  channelKind?: string;
  members?: string[];
}): ChannelManifest {
  const id = talkSessionIdFor(input.projectId);
  const kind = input.channelKind ?? CHANNEL_KIND;
  return {
    id,
    declared: {
      ...(kind === CHANNEL_KIND ? {} : { flow: kind }),
      description: `Talk about ${input.name}`,
      members: input.members ?? []
    },
    body: `Talk session about org project ${input.projectId}. Durable project fields live on the org resource, not in this session.`
  };
}

function isProjectId(id: string): boolean {
  return id.length > 0 && !id.includes("/") && !id.includes(".") && id !== ".." && id !== ".";
}

function assertProjectId(id: string): string {
  if (!isProjectId(id)) {
    throw new Error(
      `project id "${id}" must be a single segment (no dots or slashes); ` +
        `the talk session id is "${TALK_SESSION_PREFIX}<id>" and has to parse back`
    );
  }
  return id;
}
