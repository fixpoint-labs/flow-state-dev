const USER_ID_KEY = "fsd.devtool.userId";
const DEFAULT_USER_ID = "devuser";
const ACTIVE_SESSION_PREFIX = "fsd.devtool.activeSession.";
const LAST_ACTION_PREFIX = "fsd.devtool.lastAction.";

export function readUserId(): string {
  const stored = window.localStorage.getItem(USER_ID_KEY);
  return stored?.trim() ? stored : DEFAULT_USER_ID;
}

export function writeUserId(userId: string): void {
  window.localStorage.setItem(USER_ID_KEY, userId.trim());
}

export function readActiveSession(flowKind: string): string | null {
  return window.localStorage.getItem(ACTIVE_SESSION_PREFIX + flowKind) || null;
}

export function writeActiveSession(flowKind: string, sessionId: string | null): void {
  if (sessionId) {
    window.localStorage.setItem(ACTIVE_SESSION_PREFIX + flowKind, sessionId);
  } else {
    window.localStorage.removeItem(ACTIVE_SESSION_PREFIX + flowKind);
  }
}

export function readLastAction(flowKind: string): string | null {
  return window.localStorage.getItem(LAST_ACTION_PREFIX + flowKind) || null;
}

export function writeLastAction(flowKind: string, action: string): void {
  window.localStorage.setItem(LAST_ACTION_PREFIX + flowKind, action);
}

export function readDebugMode(): boolean {
  return window.localStorage.getItem("fsd.devtool.debugMode") === "true";
}

const TRACE_ITEMS_VISIBLE_KEY = "fsd.devtool.traceItemsVisible";

export function readTraceItemsVisible(): boolean {
  // Default off — block-level detail sidebar is the primary surface for
  // trace data. Users can flip this on to show raw trace item rows.
  return window.localStorage.getItem(TRACE_ITEMS_VISIBLE_KEY) === "true";
}

export function writeTraceItemsVisible(visible: boolean): void {
  window.localStorage.setItem(TRACE_ITEMS_VISIBLE_KEY, String(visible));
}
