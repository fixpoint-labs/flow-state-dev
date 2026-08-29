/**
 * Remember submitted compose lines across `/quit`.
 *
 * ↑ already walks in-memory drafts. Those died when the board left.
 * This file is next to the lab store, one per operator session and epic —
 * the same split last-focus uses, so two epics do not share a history.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeEpic } from "./last-focus";

/** How many submitted lines stay in memory and on disk. */
export const COMPOSE_HISTORY_CAP = 50;

/** Sidecar next to the config's `.fsdev` store. */
export function lastDraftsPath(configPath: string, sessionId: string, epic?: string): string {
  const dir = join(dirname(configPath), ".fsdev");
  if (epic === undefined || epic === "") {
    return join(dir, `tui-drafts-${sessionId}`);
  }
  return join(dir, `tui-drafts-${sessionId}__${safeEpic(epic)}`);
}

/** Submitted compose lines, newest last. Missing or invalid is empty. */
export function readDrafts(path: string): string[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const lines = parsed.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    return lines.length <= COMPOSE_HISTORY_CAP ? lines : lines.slice(-COMPOSE_HISTORY_CAP);
  } catch {
    return [];
  }
}

/** Persist submitted compose lines. Empty is a no-op so a first open does not write. */
export function writeDrafts(path: string, drafts: readonly string[]): void {
  if (drafts.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  const kept = drafts.length <= COMPOSE_HISTORY_CAP ? drafts : drafts.slice(-COMPOSE_HISTORY_CAP);
  writeFileSync(path, `${JSON.stringify(kept)}\n`);
}
