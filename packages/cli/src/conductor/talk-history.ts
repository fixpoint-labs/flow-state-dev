/**
 * Remember operator talk across `/quit`.
 *
 * Compose drafts already persist what you typed. The transcript did not —
 * a later open showed `nothing yet` even though the coordinator session
 * still had the turn. This file is next to the lab store, one per operator
 * session and epic — the same split last-focus and drafts use.
 *
 * Only talk lines. Status-poll noise and a child request's tools stay out;
 * those reload from the journal when a row is selected.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { safeEpic } from "./last-focus";

/** How many talk lines stay in memory and on disk. */
export const TALK_HISTORY_CAP = 50;

/** One transcript line the operator said or the coordinator answered. */
export interface TalkLine {
  at: number;
  text: string;
}

/** Sidecar next to the config's `.fsdev` store. */
export function lastTalkPath(configPath: string, sessionId: string, epic?: string): string {
  const dir = join(dirname(configPath), ".fsdev");
  if (epic === undefined || epic === "") {
    return join(dir, `tui-talk-${sessionId}`);
  }
  return join(dir, `tui-talk-${sessionId}__${safeEpic(epic)}`);
}

/**
 * Lines the transcript should keep across `/quit`. Child journals and
 * status-poll leftovers are not talk.
 */
export function isOperatorTalkLine(text: string): boolean {
  return (
    text.startsWith("you · ") ||
    text.startsWith("message · ") ||
    text.startsWith("coord · ") ||
    text === "coordinator turn finished"
  );
}

/** Board-only talk lines, newest last. */
export function talkLinesFromActivity(
  activity: readonly { at: number; text: string; requestId?: string }[],
): TalkLine[] {
  const lines: TalkLine[] = [];
  for (const item of activity) {
    if (item.requestId !== undefined) continue;
    if (!isOperatorTalkLine(item.text)) continue;
    lines.push({ at: item.at, text: item.text });
  }
  return lines.length <= TALK_HISTORY_CAP ? lines : lines.slice(-TALK_HISTORY_CAP);
}

/** Talk lines, newest last. Missing or invalid is empty. */
export function readTalk(path: string): TalkLine[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(parsed)) return [];
    const lines: TalkLine[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const rec = item as { at?: unknown; text?: unknown };
      if (typeof rec.at !== "number" || !Number.isFinite(rec.at)) continue;
      if (typeof rec.text !== "string" || rec.text.trim() === "") continue;
      if (!isOperatorTalkLine(rec.text)) continue;
      lines.push({ at: rec.at, text: rec.text });
    }
    return lines.length <= TALK_HISTORY_CAP ? lines : lines.slice(-TALK_HISTORY_CAP);
  } catch {
    return [];
  }
}

/** Persist talk lines. Empty is a no-op so a first open does not write. */
export function writeTalk(path: string, activity: readonly { at: number; text: string; requestId?: string }[]): void {
  const lines = talkLinesFromActivity(activity);
  if (lines.length === 0) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lines)}\n`);
}
