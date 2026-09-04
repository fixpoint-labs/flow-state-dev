/**
 * Remember which board row the operator was on.
 *
 * The board session is durable. The selected row is not — `/quit` and a
 * later open used to land on the first row. This file is next to the
 * lab store, one per operator session and epic. Two epics on the same
 * store must not share a remembered row.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Sidecar next to the config's `.fsdev` store. */
export function lastFocusPath(configPath: string, sessionId: string, epic?: string): string {
  const dir = join(dirname(configPath), ".fsdev");
  if (epic === undefined || epic === "") {
    return join(dir, `tui-focus-${sessionId}`);
  }
  return join(dir, `tui-focus-${sessionId}__${safeEpic(epic)}`);
}

/** Filesystem-safe epic segment. `__` is the session/epic split; do not emit it. */
export function safeEpic(epic: string): string {
  return epic.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/_+/g, "-").slice(0, 80);
}

/** Session-only sidecar written before last-focus was per epic. */
export function legacyLastFocusPath(path: string): string | undefined {
  const at = path.lastIndexOf("__");
  if (at < 0) return undefined;
  return path.slice(0, at);
}

/** The issue id (or task id) last selected, if the sidecar exists. */
export function readLastFocus(path: string): string | undefined {
  const direct = readSidecar(path);
  if (direct !== undefined) return direct;
  const legacy = legacyLastFocusPath(path);
  if (legacy === undefined) return undefined;
  return readSidecar(legacy);
}

/** Persist the selected row's issue, or its task id when it has no issue. */
export function writeLastFocus(path: string, issue: string): void {
  if (issue === "") return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${issue}\n`);
}

function readSidecar(path: string): string | undefined {
  try {
    const text = readFileSync(path, "utf8").trim();
    return text === "" ? undefined : text;
  } catch {
    return undefined;
  }
}
