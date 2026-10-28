/**
 * Shift Manager's addresses. The level and the tab live in the URL, so a link opens
 * the same view.
 *
 * Pinned (FIX-1662 PLAN, "Pinned names"): the task route and the project
 * route. The rest are Shift Manager's own.
 *
 *     /cos                           Chief of Staff: where `/` and any unknown path land
 *     /inbox[/<item>]                one Inbox item: a suspension id, or a held question's row (`inbox.ts`)
 *     /tasks[?by=state|worker|stream]
 *     /tasks/<boardRef>/<taskId>/<session|diff|checks|brief>
 *     /messages                      every message between the user's workers (FIX-1989)
 *     /schedules                     the user's scheduled work, each with its next run (FIX-2085)
 *     /usage                         how much of each harness's subscription the user has used (FIX-2141)
 *     /s/<sessionId>                 one of the user's sessions with a worker, as a conversation
 *     /p/<projectId>/<stream|board|workstreams|brief>[?owner=<userId>&ws=<workstreamId>]
 *     /p/private/<projectId>/<tab>[?owner=…&ws=…]   one of the user's own private projects
 *     /r/<sessionId>/<resourceRef>   a declared document, read-only
 *     /roster[?team=<teamId>]        every worker, or one team's (pinned, FIX-1723)
 *     /roster/<workerId>/settings    one worker's settings: its standing rules for the user (FIX-2007)
 *     /roster/<workerId>/rules       the same page, at the address it had before (read, never written)
 *     /settings                      the user's own keys for the Lab's MCP servers (pinned, FIX-1905)
 */
import { useSyncExternalStore } from "react";

export const PROJECT_TABS = ["stream", "board", "workstreams", "brief"] as const;
export const TASK_TABS = ["session", "diff", "checks", "brief"] as const;
export const TASK_GROUPINGS = ["state", "worker", "stream"] as const;

export type ProjectTab = (typeof PROJECT_TABS)[number];
export type TaskTab = (typeof TASK_TABS)[number];
export type TaskGrouping = (typeof TASK_GROUPINGS)[number];

/** Where the user is. */
export type Route =
  | { level: "cos" }
  | { level: "inbox"; item: string | null }
  | { level: "tasks"; by: TaskGrouping }
  | { level: "task"; boardRef: string; taskId: string; tab: TaskTab }
  | { level: "messages" }
  | { level: "schedules" }
  | { level: "usage" }
  | { level: "session"; sessionId: string }
  | {
      level: "project";
      projectId: string;
      tab: ProjectTab;
      /** `"private"` for one of the user's own private projects; absent for a shared one. */
      visibility?: "private";
      /** One workstream of the project, opened from its Workstreams: its owner and its id. */
      entry?: { owner: string; id: string };
    }
  | { level: "resource"; sessionId: string; ref: string }
  /** `team: null` is All. */
  | { level: "roster"; team: string | null }
  /** One worker's settings: not the user's own `settings`. */
  | { level: "worker-settings"; worker: string }
  | { level: "settings" };

function oneOf<T extends string>(values: readonly T[], value: string | undefined, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

/** Read a route from a path and query string. `/`, `/cos` and anything unknown are Chief of Staff (BR-1). */
export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b, c] = parts;
  if (head === "p" && a === "private" && b !== undefined && c !== undefined) {
    return { level: "project", projectId: b, visibility: "private", tab: oneOf(PROJECT_TABS, c, "stream"), ...entryOf(search) };
  }
  if (head === "tasks" && a !== undefined && b !== undefined) {
    return { level: "task", boardRef: a, taskId: b, tab: oneOf(TASK_TABS, c, "session") };
  }
  if (head === "tasks") {
    return { level: "tasks", by: oneOf(TASK_GROUPINGS, new URLSearchParams(search).get("by") ?? undefined, "state") };
  }
  if (head === "p" && a !== undefined) return { level: "project", projectId: a, tab: oneOf(PROJECT_TABS, b, "stream"), ...entryOf(search) };
  if (head === "r" && a !== undefined && b !== undefined) return { level: "resource", sessionId: a, ref: b };
  // `/rules` was this page's address; links to it keep opening it (an unknown path would open Chief of Staff).
  if (head === "roster" && a !== undefined && (b === "settings" || b === "rules")) return { level: "worker-settings", worker: a };
  if (head === "roster") return { level: "roster", team: new URLSearchParams(search).get("team") || null };
  if (head === "messages") return { level: "messages" };
  if (head === "schedules") return { level: "schedules" };
  if (head === "usage") return { level: "usage" };
  if (head === "s" && a !== undefined) return { level: "session", sessionId: a };
  if (head === "inbox") return { level: "inbox", item: a ?? null };
  if (head === "settings") return { level: "settings" };
  return { level: "cos" };
}

/** The workstream a project route's query names, when it names both its owner and its id. */
function entryOf(search: string): { entry?: { owner: string; id: string } } {
  const query = new URLSearchParams(search);
  const owner = query.get("owner");
  const id = query.get("ws");
  return owner && id ? { entry: { owner, id } } : {};
}

/** The path for a route. */
export function pathFor(route: Route): string {
  const e = encodeURIComponent;
  switch (route.level) {
    case "cos":
      return "/cos";
    case "inbox":
      return route.item === null ? "/inbox" : `/inbox/${e(route.item)}`;
    case "tasks":
      return route.by === "state" ? "/tasks" : `/tasks?by=${route.by}`;
    case "task":
      return `/tasks/${e(route.boardRef)}/${e(route.taskId)}/${route.tab}`;
    case "messages":
      return "/messages";
    case "schedules":
      return "/schedules";
    case "usage":
      return "/usage";
    case "session":
      return `/s/${e(route.sessionId)}`;
    case "project": {
      const at = route.visibility === "private" ? `/p/private/${e(route.projectId)}` : `/p/${e(route.projectId)}`;
      const entry = route.entry === undefined ? "" : `?owner=${e(route.entry.owner)}&ws=${e(route.entry.id)}`;
      return `${at}/${route.tab}${entry}`;
    }
    case "resource":
      return `/r/${e(route.sessionId)}/${e(route.ref)}`;
    case "roster":
      return route.team === null ? "/roster" : `/roster?team=${e(route.team)}`;
    case "worker-settings":
      return `/roster/${e(route.worker)}/settings`;
    case "settings":
      return "/settings";
  }
}

const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}
const snapshot = () => `${window.location.pathname}${window.location.search}`;

/** Go to `route`, adding a history entry. */
export function navigate(route: Route): void {
  const path = pathFor(route);
  if (path === snapshot()) return;
  window.history.pushState(null, "", path);
  for (const listener of listeners) listener();
}

/** The current route, re-rendering on navigation and back/forward. */
export function useRoute(): Route {
  const location = useSyncExternalStore(subscribe, snapshot, () => "/");
  const q = location.indexOf("?");
  return parseRoute(q < 0 ? location : location.slice(0, q), q < 0 ? "" : location.slice(q));
}
