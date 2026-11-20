/**
 * The worker directory's rows: the organization's worker inventory joined
 * with the user's roster (D1). Every screen that draws a worker draws one of
 * these, joined here once, so two screens never name a worker two ways.
 *
 * A worker the user hired is theirs alone, so the inventory never names it:
 * it comes from their roster, on the flow its entry names, with that flow's
 * door and flags read off the inventory rows on the same flow. A standard
 * worker's harness rides on its roster entry, not on its inventory row.
 */
import type { SessionSummary } from "@flow-state-dev/client";
import { WORKER_ID_STATE_KEY, WORKSTREAM_STATE_KEY, type RosterEntry } from "@flow-state-dev/workforce/browser";

/** A worker, as the inventory registers it and the roster adds to it. */
export type Worker = {
  /**
   * The worker's id: `<team>.<name>`, or a bare name for an org worker. Boards
   * name the worker by it, and its sessions carry it as their `workerId`.
   */
  id: string;
  /** The worker flow the worker runs on, which is also that flow's copy id; `null` on a row that has none. */
  kind: string | null;
  /**
   * The action that takes a user's message into this worker's sessions, as
   * the hire published it; `null` when its worker flow takes none, or on a row
   * written before doors were published.
   */
  door: string | null;
  /** Whether the worker keeps standing rules: its worker flow declares the rules action. */
  rules: boolean;
  /** Whether its door takes the task a line is sent from (`taskId`). A door that doesn't is sent none. */
  doorTakesTask: boolean;
  /** The id of the team it sits under, or {@link GENERAL_TEAM} for an org worker. */
  team: string;
  /** Its team's display name: the team's own, "General" for {@link GENERAL_TEAM}, else the team id. */
  teamName: string;
  /** Its id without the team: what a board may name it by. */
  name: string;
  /** What a user reads it by: its display name, or its id when it has none. */
  displayName: string;
  /** The coding harness its roster entry's settings name; absent when it names none, or before the roster is read. */
  harness?: string;
};

function field(row: unknown, key: string): unknown {
  return typeof row === "object" && row !== null ? (row as Record<string, unknown>)[key] : undefined;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * The worker a session runs, as its state names it (`workerId`), or `null`
 * when it names none.
 */
export function workerOf(session: SessionSummary): string | null {
  return text(field((session as { state?: unknown }).state, WORKER_ID_STATE_KEY));
}

/**
 * The workstream a session leads, as its readonly `workstreamId` names it
 * (`<visibility>/<project>/<workstream>`), or `null` for a session outside
 * any workstream.
 */
export function workstreamOf(session: SessionSummary): string | null {
  return text(field((session as { state?: unknown }).state, WORKSTREAM_STATE_KEY));
}

/**
 * The id of the group an org worker sits in: a worker whose address has no
 * team, such as a Shift Coordinator or a researcher. A user reads it as
 * {@link GENERAL_TEAM_NAME}. The underscore keeps it outside Workforce's team
 * ids (lowercase letters, digits and hyphens), so a team folder named
 * `general` stays its own team.
 */
export const GENERAL_TEAM = "_general";

/** {@link GENERAL_TEAM}'s display name. */
export const GENERAL_TEAM_NAME = "General";

/**
 * A worker's team and names, from its id and the display names its row
 * carries (each `null` when unset):
 *
 * - `<team>.<name>` sits under its team: a team id carries no dot, so the team
 *   is everything before the first one;
 * - an id with no dot is an org worker, and sits in {@link GENERAL_TEAM}.
 */
export function workerNames(
  id: string,
  displayName: string | null,
  teamName: string | null,
): Pick<Worker, "team" | "teamName" | "name" | "displayName"> {
  const dot = id.indexOf(".");
  const team = dot > 0 ? id.slice(0, dot) : GENERAL_TEAM;
  return {
    team,
    teamName: dot > 0 ? (teamName ?? team) : GENERAL_TEAM_NAME,
    name: dot > 0 ? id.slice(dot + 1) : id,
    displayName: displayName ?? id,
  };
}

/** A worker inventory row, as its browser read publishes it, grouped and named by {@link workerNames}. */
export function toWorker(row: unknown): Worker | undefined {
  const id = text(field(row, "id"));
  if (id === null) return undefined;
  return {
    id,
    kind: text(field(row, "kind")),
    door: text(field(row, "door")),
    rules: field(row, "rules") === true,
    doorTakesTask: field(row, "doorTakesTask") === true,
    ...workerNames(id, text(field(row, "name")), text(field(row, "teamName"))),
  };
}

/** The harness a roster entry's settings name, as a {@link Worker} field; nothing when it names none. */
function harnessOf(entry: RosterEntry | undefined): Pick<Worker, "harness"> {
  const harness = entry?.settings?.harness;
  return typeof harness === "string" ? { harness } : {};
}

/**
 * The user's own workers as rows beside the inventory's: each on the flow it
 * names, with that flow's door and its rules and task flags, grouped and
 * named the way an inventory row is.
 */
function ownWorkers(entries: readonly RosterEntry[], inventory: readonly Worker[]): Worker[] {
  return entries
    .filter((entry) => !entry.standard && !inventory.some((worker) => worker.id === entry.id))
    .map((entry) => {
      const onFlow = inventory.find((worker) => worker.kind === entry.flow);
      return {
        id: entry.id,
        kind: entry.flow,
        door: onFlow?.door ?? null,
        rules: onFlow?.rules ?? false,
        doorTakesTask: onFlow?.doorTakesTask ?? false,
        ...workerNames(entry.id, entry.name, entry.teamName),
        ...harnessOf(entry),
      };
    });
}

/** The joined directory: every worker, and which of them are the user's own. */
export type JoinedWorkers = { workers: Worker[]; own: Worker[] };

/**
 * The inventory's workers (`undefined` while it is unread or failed) joined
 * with the roster's entries. With the inventory unread, the standard workers
 * the roster lists are still the user's, so they are drawn too.
 */
export function joinWorkers(inventory: readonly Worker[] | undefined, entries: readonly RosterEntry[]): JoinedWorkers {
  const declared = (inventory ?? []).map((worker) => ({ ...worker, ...harnessOf(entries.find((entry) => entry.id === worker.id)) }));
  const own = ownWorkers(entries, declared);
  const standard =
    inventory === undefined ? ownWorkers(entries.filter((entry) => entry.standard).map((entry) => ({ ...entry, standard: false })), declared) : [];
  return { workers: [...declared, ...standard, ...own], own };
}
