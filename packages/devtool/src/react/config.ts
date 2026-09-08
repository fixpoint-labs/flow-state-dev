/**
 * localStorage helpers for panel state that should persist across reloads:
 * userId, the session hint per flow instance, last-dispatched action per
 * instance, debug toggles. All readers are SSR-safe — they return defaults when
 * `window` is undefined so the panel can render during a Next.js prerender pass.
 *
 * ## Why a session hint is scoped, and why it stays a hint
 *
 * A saved session is a convenience, never permission to guess which copy of a
 * flow the operator meant. Two instances of one kind have different ids and
 * different sessions, so the key carries the CONNECTION, the USER and the EXACT
 * INSTANCE ID — a session saved under `engineer-a` must not be offered under
 * `engineer-b`, nor under the same id on a different backend or for a different
 * operator. The bearer token is deliberately NOT part of the key: it is a
 * credential, and credentials are never written to localStorage.
 *
 * Reading one is still not installing it. The provider revalidates the hint
 * against an admitted session read before anything renders under it — see
 * `context/devtool-context.tsx`.
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

/**
 * What a saved session hint belongs to. Every part is load-bearing: the same
 * instance id on a different backend, or under a different operator identity,
 * addresses different sessions.
 */
export type SessionHintScope = {
  /** API base URL the panel is talking to; `undefined` means same-origin. */
  baseUrl: string | undefined;
  userId: string;
  /** The EXACT instance id — never a kind, and never an instance's position. */
  flowId: string;
};

/**
 * Encoded per part, so an id containing the separator cannot collide with a
 * different scope. Instance ids are opaque and this side prescribes no syntax.
 */
function sessionHintKey(scope: SessionHintScope): string {
  return (
    ACTIVE_SESSION_PREFIX +
    [scope.baseUrl ?? "", scope.userId, scope.flowId]
      .map((part) => encodeURIComponent(part))
      .join("|")
  );
}

/** The saved session id for this scope, or `null`. Always revalidate before use. */
export function readSessionHint(scope: SessionHintScope): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(sessionHintKey(scope)) || null;
}

/** Save (or, with `null`, forget) this scope's session hint. */
export function writeSessionHint(scope: SessionHintScope, sessionId: string | null): void {
  if (!hasWindow()) return;
  const key = sessionHintKey(scope);
  if (sessionId) {
    window.localStorage.setItem(key, sessionId);
  } else {
    window.localStorage.removeItem(key);
  }
}

/**
 * A hint written by an earlier panel, which keyed on the flow kind alone.
 *
 * Offered ONLY for a singleton, whose id and kind are the same string and which
 * therefore has exactly one possible owner. A collection member must never read
 * one: its kind names a family, so the saved session could belong to any peer,
 * and handing it over is exactly the "guess a copy" this design refuses.
 *
 * Like any hint it is revalidated before installation and dropped when that
 * fails. Nothing here migrates a key — it just stops offering one it has proven
 * useless.
 */
export function readLegacySingletonSessionHint(kind: string): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(ACTIVE_SESSION_PREFIX + kind) || null;
}

/** Forget a legacy kind-keyed hint that failed revalidation. */
export function clearLegacySingletonSessionHint(kind: string): void {
  if (!hasWindow()) return;
  window.localStorage.removeItem(ACTIVE_SESSION_PREFIX + kind);
}

/** Last action dispatched against this exact instance id. */
export function readLastAction(flowId: string): string | null {
  if (!hasWindow()) return null;
  return window.localStorage.getItem(LAST_ACTION_PREFIX + flowId) || null;
}

export function writeLastAction(flowId: string, action: string): void {
  if (!hasWindow()) return;
  window.localStorage.setItem(LAST_ACTION_PREFIX + flowId, action);
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
