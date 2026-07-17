/**
 * localStorage helpers for panel state that should persist across reloads:
 * userId, active session per flow, last-dispatched action per flow, debug
 * toggles. All readers are SSR-safe — they return defaults when `window` is
 * undefined so the panel can render during a Next.js prerender pass.
 */
const USER_ID_KEY = "fsd.devtool.userId";
const DEFAULT_USER_ID = "devuser";
const ACTIVE_SESSION_PREFIX = "fsd.devtool.activeSession.";
const LAST_ACTION_PREFIX = "fsd.devtool.lastAction.";
const TRACE_ITEMS_VISIBLE_KEY = "fsd.devtool.traceItemsVisible";

const hasWindow = (): boolean => typeof window !== "undefined";

/**
 * Connection config `fsdev dev` injects into the page (`window.__FSD_DEVTOOL_CONFIG__`)
 * from the app's `fsdev.config.ts` `devtool` block. Present only under the
 * standalone `fsdev dev` shell; absent for embedded hosts and SSR.
 */
type InjectedConfig = { userId?: string; bearerToken?: string };

function readInjectedConfig(): InjectedConfig {
  if (!hasWindow()) return {};
  const injected = (window as unknown as { __FSD_DEVTOOL_CONFIG__?: unknown })
    .__FSD_DEVTOOL_CONFIG__;
  return injected !== null && typeof injected === "object"
    ? (injected as InjectedConfig)
    : {};
}

function injectedUserId(): string | undefined {
  const injected = readInjectedConfig().userId;
  return typeof injected === "string" && injected.trim() ? injected : undefined;
}

/** True when `fsdev dev` injected a non-blank `userId` into the page global. */
export function hasInjectedUserId(): boolean {
  return injectedUserId() !== undefined;
}

export function readUserId(): string {
  // The app-declared userId wins on boot (it's the identity a secured flow
  // expects); otherwise fall back to the operator's persisted choice.
  const injected = injectedUserId();
  if (injected) return injected;
  if (!hasWindow()) return DEFAULT_USER_ID;
  const stored = window.localStorage.getItem(USER_ID_KEY);
  return stored?.trim() ? stored : DEFAULT_USER_ID;
}

/** Bearer token injected from `fsdev.config.ts`, if any. Never persisted. */
export function readBearerToken(): string | undefined {
  const injected = readInjectedConfig().bearerToken;
  return typeof injected === "string" && injected.trim() ? injected : undefined;
}

export function writeUserId(userId: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(USER_ID_KEY, userId.trim());
}

export function readActiveSession(flowKind: string): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(ACTIVE_SESSION_PREFIX + flowKind) || null;
}

export function writeActiveSession(flowKind: string, sessionId: string | null): void {
  if (!hasWindow()) return;
  if (sessionId) {
    window.localStorage.setItem(ACTIVE_SESSION_PREFIX + flowKind, sessionId);
  } else {
    window.localStorage.removeItem(ACTIVE_SESSION_PREFIX + flowKind);
  }
}

export function readLastAction(flowKind: string): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(LAST_ACTION_PREFIX + flowKind) || null;
}

export function writeLastAction(flowKind: string, action: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(LAST_ACTION_PREFIX + flowKind, action);
}

export function readDebugMode(): boolean {
  if (!hasWindow()) return false;
  return window.localStorage.getItem("fsd.devtool.debugMode") === "true";
}

export function readTraceItemsVisible(): boolean {
  // Default off — the block-level detail sidebar is the primary surface for
  // trace data. Users can flip this on to show raw trace item rows.
  if (!hasWindow()) return false;
  return window.localStorage.getItem(TRACE_ITEMS_VISIBLE_KEY) === "true";
}

export function writeTraceItemsVisible(visible: boolean): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(TRACE_ITEMS_VISIBLE_KEY, String(visible));
}
