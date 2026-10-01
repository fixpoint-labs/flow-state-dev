/**
 * shift-manager's addresses. The level and the tab live in the URL, so a link opens
 * the same view.
 *
 * Pinned (FIX-1662 PLAN, "Pinned names"): the task route, the workstream route
 * and the project route. The rest are shift-manager's own.
 *
 *     /inbox[/<suspensionId>]
 *     /tasks[?by=state|worker|stream]
 *     /tasks/<boardRef>/<taskId>/<session|diff|checks|brief>
 *     /w/<channelId>/<stream|board|brief|results>
 *     /p/<projectId>/<stream|board|workstreams|brief>
 *     /r/<sessionId>/<resourceRef>   a declared document, read-only
 */
import { useSyncExternalStore } from "react";

export const WORKSTREAM_TABS = ["stream", "board", "brief", "results"] as const;
export const PROJECT_TABS = ["stream", "board", "workstreams", "brief"] as const;
export const TASK_TABS = ["session", "diff", "checks", "brief"] as const;
export const TASK_GROUPINGS = ["state", "worker", "stream"] as const;

export type WorkstreamTab = (typeof WORKSTREAM_TABS)[number];
export type ProjectTab = (typeof PROJECT_TABS)[number];
export type TaskTab = (typeof TASK_TABS)[number];
export type TaskGrouping = (typeof TASK_GROUPINGS)[number];

/**
 * The project the PROJECTS heading opens while no projects ship: every
 * workstream, held by no project.
 */
export const NO_PROJECT = "unassigned";

/** Where the person is. */
export type Route =
  | { level: "inbox"; suspensionId: string | null }
  | { level: "tasks"; by: TaskGrouping }
  | { level: "task"; boardRef: string; taskId: string; tab: TaskTab }
  | { level: "workstream"; channelId: string; tab: WorkstreamTab }
  | { level: "project"; projectId: string; tab: ProjectTab }
  | { level: "resource"; sessionId: string; ref: string };

function oneOf<T extends string>(values: readonly T[], value: string | undefined, fallback: T): T {
  return values.includes(value as T) ? (value as T) : fallback;
}

/** Read a route from a path and query string. Anything unknown is Inbox. */
export function parseRoute(pathname: string, search = ""): Route {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [head, a, b, c] = parts;
  if (head === "tasks" && a !== undefined && b !== undefined) {
    return { level: "task", boardRef: a, taskId: b, tab: oneOf(TASK_TABS, c, "session") };
  }
  if (head === "tasks") {
    return { level: "tasks", by: oneOf(TASK_GROUPINGS, new URLSearchParams(search).get("by") ?? undefined, "state") };
  }
  if (head === "w" && a !== undefined) return { level: "workstream", channelId: a, tab: oneOf(WORKSTREAM_TABS, b, "stream") };
  if (head === "p" && a !== undefined) return { level: "project", projectId: a, tab: oneOf(PROJECT_TABS, b, "stream") };
  if (head === "r" && a !== undefined && b !== undefined) return { level: "resource", sessionId: a, ref: b };
  return { level: "inbox", suspensionId: head === "inbox" && a !== undefined ? a : null };
}

/** The path for a route. */
export function pathFor(route: Route): string {
  const e = encodeURIComponent;
  switch (route.level) {
    case "inbox":
      return route.suspensionId === null ? "/inbox" : `/inbox/${e(route.suspensionId)}`;
    case "tasks":
      return route.by === "state" ? "/tasks" : `/tasks?by=${route.by}`;
    case "task":
      return `/tasks/${e(route.boardRef)}/${e(route.taskId)}/${route.tab}`;
    case "workstream":
      return `/w/${e(route.channelId)}/${route.tab}`;
    case "project":
      return `/p/${e(route.projectId)}/${route.tab}`;
    case "resource":
      return `/r/${e(route.sessionId)}/${e(route.ref)}`;
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
