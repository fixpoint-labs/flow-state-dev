const USER_ID_KEY = "fsd.devtool.userId";
const DEFAULT_USER_ID = "devuser";
const ACTIVE_SESSION_PREFIX = "fsd.devtool.activeSession.";
const LAST_ACTION_PREFIX = "fsd.devtool.lastAction.";

export function readUserId(): string {
  if (typeof window === "undefined") return DEFAULT_USER_ID;
  const stored = window.localStorage.getItem(USER_ID_KEY);
  return stored?.trim() ? stored : DEFAULT_USER_ID;
}

export function writeUserId(userId: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(USER_ID_KEY, userId.trim());
}

export function readActiveSession(flowKind: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACTIVE_SESSION_PREFIX + flowKind) || null;
}

export function writeActiveSession(flowKind: string, sessionId: string | null): void {
  if (typeof window === "undefined") return;
  if (sessionId) {
    window.localStorage.setItem(ACTIVE_SESSION_PREFIX + flowKind, sessionId);
  } else {
    window.localStorage.removeItem(ACTIVE_SESSION_PREFIX + flowKind);
  }
}

export function readLastAction(flowKind: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_ACTION_PREFIX + flowKind) || null;
}

export function writeLastAction(flowKind: string, action: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_ACTION_PREFIX + flowKind, action);
}

export function readDebugMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem("fsd.devtool.debugMode") === "true";
}
