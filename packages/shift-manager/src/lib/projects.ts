// BR-18; BR-38.
/**
 * A project's reads: the rows the user reads, a project's workstreams, an
 * entry's report and the Lab's project setup.
 *
 * **The rows.** Every row of the organization's `projects` and of the user's
 * own private one, read whole and kept current by `react`'s `useResource`
 * (the directory holds the one read, `directory.tsx`), each parsed by
 * {@link toProject} so a row an earlier version wrote still reads.
 *
 * **A project's workstreams** are its entries by one prefix, read whole and
 * kept current by `useResource` while something on screen draws them: only
 * a notice under that project's prefix reads them again. Progress is worked
 * out from the entries here, by Workforce's own `projectProgress`, so the
 * view and the project coordinator count the same way; nothing is stored.
 *
 * **The project setup**: the standard worker each user talks to a project
 * through, their project coordinator, from workforce's `projectSetup` view.
 * A Lab with no projects flow serves no such view (404), and has none.
 *
 * Shift Manager opens no workstream itself. The user asks their project
 * coordinator for the work, and the coordinator opens one with a lead from
 * their roster.
 */
import { useEffect, useMemo, useState } from "react";
import type { Client } from "@flow-state-dev/client";
import { useResource, useView } from "@flow-state-dev/react";
import {
  DONE_STATUS,
  parseWorkstreamEntry,
  projectProgress,
  projectSetupView,
  PROJECTS_PATTERN,
  STALE_AFTER_MS,
  WORKSTREAMS_PATTERN,
  workstreamReportView,
  type ParsedWorkstreamEntry,
  type ProjectProgress,
  type ProjectSetup,
} from "@flow-state-dev/workforce/browser";
import { useLab } from "./lab-data";
import type { Failure } from "./failure";

/** Where a project lives: the organization's, or the user's own. */
export type ProjectVisibility = "shared" | "private";

/** A project's address: where it lives, and its id. */
export type ProjectAddress = { visibility: ProjectVisibility; id: string };

/**
 * A project: a row of the organization's `projects` collection (shared), or of
 * the user's own (private), with where it lives. Its address is its
 * visibility and its id: a private project and a shared one can share an id.
 */
export type Project = {
  /** The row id; with the visibility, the project's address. */
  id: string;
  /** Where the row lives. */
  visibility: ProjectVisibility;
  title: string;
  /** What the project is for; its Brief tab. `null` when none was given. */
  brief: string | null;
  status: string;
  ownerUserId: string;
  /** On a shared project, who may open workstreams in it. */
  members: string[];
  /** The git remote the project's code lives in, or `null` when it has none. A row written before the field reads as none. */
  repository: string | null;
};

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// BP-030.
/**
 * A project entry, as the projects collection's browser read publishes it. One
 * missing its id, title or owner is not a project anyone can address or own,
 * and is left out; every other field reads as empty when absent, so an entry an
 * earlier version wrote still reads.
 */
export function toProject(value: unknown, visibility: ProjectVisibility = "shared"): Project | undefined {
  const id = text(field(value, "id"));
  const title = text(field(value, "title"));
  const ownerUserId = text(field(value, "ownerUserId"));
  if (id === null || title === null || ownerUserId === null) return undefined;
  return {
    id,
    visibility,
    title,
    // An empty brief is still the brief the row was given; only a missing or non-string one is none.
    brief: typeof field(value, "brief") === "string" ? (field(value, "brief") as string) : null,
    status: text(field(value, "status")) ?? "active",
    ownerUserId,
    members: strings(field(value, "members")),
    repository: text(field(value, "repository")),
  };
}

// BR-12.
/** One workstream of a project: its entry as Workforce parses it, its storage key, and whether it has gone quiet. */
export type WorkstreamEntry = ParsedWorkstreamEntry & {
  /** Its storage key in the project's workstreams. */
  key: string;
  // BR-19.
  /** Whether it has gone quiet, as the project's progress counts it: one clock, `progress.stale`. */
  stale: boolean;
};

/** A project's workstreams as its view draws them, and the progress worked out from them as of a moment. */
export type ProjectWorkstreams = { entries: WorkstreamEntry[]; progress: ProjectProgress };

/**
 * An entry, from what the entries' browser read publishes, parsed by
 * Workforce's own entry parser so this view and `readProject` read one shape.
 * A row that doesn't parse as an entry is left out.
 */
function toEntry(storageKey: string, data: unknown): Omit<WorkstreamEntry, "stale"> | undefined {
  try {
    const parsed = parseWorkstreamEntry(storageKey, data);
    return parsed === undefined ? undefined : { ...parsed, key: storageKey };
  } catch {
    return undefined;
  }
}

/** Every row of a read that parses as an entry. */
function entriesOf(stored: readonly { storageKey: string; value: unknown }[]): Omit<WorkstreamEntry, "stale">[] {
  return stored.map((each) => toEntry(each.storageKey, each.value)).filter((entry): entry is Omit<WorkstreamEntry, "stale"> => entry !== undefined);
}

/**
 * Entries as of `now`: their progress, worked out by Workforce's own
 * `projectProgress`, and each entry marked gone quiet by that same clock.
 */
function withProgress(entries: readonly Omit<WorkstreamEntry, "stale">[], now: number): ProjectWorkstreams {
  const progress = projectProgress(entries, now);
  const quiet = new Set(progress.stale.map((entry) => `${entry.owner}/${entry.id}`));
  return { entries: entries.map((entry) => ({ ...entry, stale: quiet.has(`${entry.owner}/${entry.id}`) })), progress };
}

/** Where a project at `visibility` lives: a shared one in the organization, a private one in the user's own scope. */
const scopeOf = (visibility: ProjectVisibility) => (visibility === "private" ? "user" : "org");

/** The workstreams' collection at each scope, as a browser reads it. */
const WORKSTREAMS = {
  org: { scope: "org", pattern: WORKSTREAMS_PATTERN },
  user: { scope: "user", pattern: WORKSTREAMS_PATTERN },
} as const;

/** The prefix of one project's entries: the slash keeps `apollo` from reading `apollo2`'s. */
const entriesPrefix = (projectId: string) => `workstreams/${projectId}/`;

// FIX-2624.
/**
 * Read a project once, with no session: its row, and every one of its entries
 * by the project's one prefix, with their progress as of `now`. Jump to's
 * search reads each project so when it opens. `null` when the user can't read
 * a row at that address: none there, or another user's private project.
 */
export async function readProject(
  client: Pick<Client, "resource">,
  address: ProjectAddress,
  now = Date.now(),
): Promise<({ project: Project } & ProjectWorkstreams) | null> {
  const scope = scopeOf(address.visibility);
  const [stored, listed] = await Promise.all([
    client.resource({ scope, pattern: PROJECTS_PATTERN }).entry(`projects/${address.id}`).read(),
    client.resource({ scope, pattern: WORKSTREAMS_PATTERN }).listAll({ topicPrefix: entriesPrefix(address.id) }),
  ]);
  const project = stored.value === null ? undefined : toProject(stored.value, address.visibility);
  return project === undefined ? null : { project, ...withProgress(entriesOf(listed), now) };
}

/** The longest delay `setTimeout` keeps; a longer one fires at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

// BR-19.
/**
 * When the next of `entries` goes quiet, by `projectProgress`'s rule (an
 * unfinished entry unchanged for {@link STALE_AFTER_MS}), or `undefined` when
 * none will: a quiet entry is one nobody writes, so no notice says so.
 */
function nextQuietAt(entries: readonly WorkstreamEntry[]): number | undefined {
  let next: number | undefined;
  for (const entry of entries) {
    if (entry.stale || entry.status === DONE_STATUS) continue;
    const updated = Date.parse(entry.updatedAt);
    if (!Number.isFinite(updated)) continue;
    const at = updated + STALE_AFTER_MS;
    if (next === undefined || at < next) next = at;
  }
  return next;
}

/** A read on screen: its value once it lands, why the last read failed, and a read on demand. */
export type ScreenRead<T> = { value: T | undefined; failure: Failure | undefined; refresh: () => void };

// BR-18.
/**
 * A project's workstreams, read whole by the project's one prefix under its
 * scope (the org's for a shared project, its owner's for a private one) and
 * kept current by their own notices: a workstream opened by someone else's
 * turn shows without a reload. Mounted only while something on screen draws
 * them. A failed read again keeps the entries already drawn, beside its
 * `failure`; only a failed first read shows alone.
 */
export function useProjectWorkstreams(address: ProjectAddress): ScreenRead<ProjectWorkstreams> {
  const { client } = useLab();
  const read = useResource(WORKSTREAMS[scopeOf(address.visibility)], { client, all: true, topicPrefix: entriesPrefix(address.id) });
  const listed = read.value;
  // Going quiet is the absence of writes, so the page's own clock says when:
  // one recompute at the next entry's threshold, with no read, then the next.
  const [now, setNow] = useState(() => Date.now());
  const value = useMemo(() => (listed === null ? undefined : withProgress(entriesOf(listed), now)), [listed, now]);
  useEffect(() => {
    if (value === undefined) return;
    const at = nextQuietAt(value.entries);
    if (at === undefined) return;
    // A delay past setTimeout's cap fires early, as does one the wall clock stepped
    // back under: such a fire changes nothing and sets the timer again, here.
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      timer = setTimeout(() => {
        if (Date.now() < at) return arm();
        setNow(Date.now());
      }, Math.min(MAX_TIMER_MS, Math.max(0, at - Date.now())));
    };
    arm();
    return () => clearTimeout(timer);
  }, [value]);
  return { value, failure: read.failure, refresh: read.refresh };
}

// FIX-2624.
/**
 * An entry's latest report, through the roster flow's `workstreamReport`
 * view, with no session, kept current by the view: `null` when its owner has
 * written none.
 */
export function useEntryReport(project: ProjectAddress, entry: Pick<WorkstreamEntry, "owner" | "id">): ScreenRead<string | null> {
  const { client } = useLab();
  const { value, failure, refresh } = useView(workstreamReportView, { project, owner: entry.owner, id: entry.id }, { client });
  return { value: value === undefined ? undefined : value.report, failure, refresh };
}

/**
 * The Lab's project setup, from workforce's `projectSetup` view, read with no
 * session and kept current by it. `null` for a Lab that serves none (a 404):
 * it has no projects flow, so no project coordinator.
 */
export function useProjectSetup(): ScreenRead<ProjectSetup | null> {
  const { client } = useLab();
  const { value, failure, refresh } = useView(projectSetupView, {}, { client });
  const none = value === undefined && failure?.httpStatus === 404;
  return { value: none ? null : value, failure: none ? undefined : failure, refresh };
}
