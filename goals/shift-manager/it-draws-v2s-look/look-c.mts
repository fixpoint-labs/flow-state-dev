/**
 * The v2 look table's rows for the workstream, its Board, the task screen and
 * the project's team strip and Board lanes (FIX-1737 slice C: W1, W5, W11, T7, T9, T13, P2,
 * P5, P7, P8), with the exceptions and graded regions those screens add.
 *
 * Kept beside `run.mts`, which spreads them into its table, so each screen's
 * rows sit together. Every row cites the v2 line it came from, and `run.mts`'s
 * setup fails when that line no longer holds what the row claims.
 */
import type { Exception, Row, Screen } from "./run.mts";

const WORKSTREAM: readonly Screen[] = ["workstream", "board"];
/** Where the Board is drawn: a workstream's Board tab, and its project's Board, one lane per workstream. */
const BOARDS: readonly Screen[] = ["board", "project"];

/** The five columns, in the order v2 draws them (v2:1327), and the one v2 tints. */
const COLUMN_ORDER = ["QUEUED", "RUNNING", "IN REVIEW", "NEEDS YOU", "DONE"] as const;
const COLS_LINE = { line: 1327, has: "const COLS = ['queued', 'run', 'review', 'needs', 'done']" };

/** A channel's feed, from the store: its kept lines (the page shows the newest 50) and its members' pending asks. */
const feed = (store: { channels: Record<string, { lines: number; asks: number }> }) => {
  const channel = Object.values(store.channels)[0];
  return { lines: Math.min(channel?.lines ?? 0, 50), asks: channel?.asks ?? 0 };
};

export const SLICE_C_ROWS: Row[] = [
  // A workstream's header (W1).
  { id: "workstream #", audit: "W1", v2: { line: 215, has: "font:500 15px 'IBM Plex Mono'" }, select: "[data-testid=workstream-header] > [data-look=title-hash]", on: WORKSTREAM, min: 1, want: { family: "mono", size: 15 } },
  {
    id: "WORKSTREAM tag",
    audit: "W1",
    v2: { line: 215, has: "font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.12em;border:1px solid rgba(var(--inkrgb),.4)" },
    select: "[data-testid=workstream-header] > [data-look=screen-tag]",
    on: WORKSTREAM,
    min: 1,
    want: { family: "mono", size: 10, tracking: 0.12 },
  },

  // The Stream's feed (W5) and the asks in it (W11).
  { id: "day divider", audit: "W5", v2: { line: 227, has: "font:500 10.5px 'IBM Plex Mono',monospace;letter-spacing:.14em" }, select: "[data-look=day-divider] > span:first-child", on: ["workstream"], min: ({ store }) => (feed(store).lines + feed(store).asks > 0 ? 1 : 0), want: { family: "mono", size: 10.5, tracking: 0.14 } },
  { id: "feed name", audit: "W5", v2: { line: 232, has: "font-weight:600;font-size:13.5px" }, select: "[data-testid=transcript] [data-look=feed-name]", on: ["workstream"], min: ({ store }) => feed(store).lines + feed(store).asks, want: { family: "sans", size: 13.5, weight: 600 } },
  { id: "feed line", audit: "W5", v2: { line: 235, has: "font-size:14px;line-height:1.55" }, select: "[data-testid=transcript-line-body]", on: ["workstream"], min: ({ store }) => feed(store).lines, want: { family: "sans", size: 14 } },
  {
    id: "NEEDS YOU tag",
    audit: "W5, W11",
    v2: { line: 232, has: "background:var(--hl);font:600 10px 'IBM Plex Mono',monospace;letter-spacing:.12em" },
    select: "[data-testid=feed-ask] [data-look=needs-tag]",
    on: ["workstream"],
    min: ({ store }) => feed(store).asks,
    want: { family: "mono", size: 10, weight: 600, tracking: 0.12, highlighter: true },
  },
  { id: "ask in inbox", audit: "W11", v2: { line: 290, has: "font:500 12px 'IBM Plex Mono'" }, select: "[data-testid=feed-ask-inbox]", on: ["workstream"], min: ({ store }) => feed(store).asks, want: { family: "mono", size: 12 } },

  // A workstream's Board, and each lane of its project's (P5, P7, P8): columns in v2's order, hairlines, no fill but RUNNING's tint.
  ...COLUMN_ORDER.map(
    (column, i): Row => ({
      id: `board column ${i + 1}, ${column}`,
      audit: column === "RUNNING" ? "P5" : "P5, P8",
      v2: column === "RUNNING" ? { line: 1335, has: "bg: st === 'run' ? 'rgba(var(--bluergb),.035)' : 'transparent'" } : COLS_LINE,
      select: `[data-testid=board] > [data-testid=board-column]:nth-child(${i + 1})[data-column="${column}"]`,
      on: BOARDS,
      min: 1,
      want: column === "RUNNING" ? {} : { surface: "none" },
    }),
  ),
  {
    id: "board column head",
    audit: "P5",
    v2: { line: 528, has: "font:500 10.5px 'IBM Plex Mono',monospace;letter-spacing:.1em" },
    select: "[data-testid=board-column] > [data-look=column-head], [data-testid=board-column] > [data-look=column-head] > span:not([data-state-square])",
    on: BOARDS,
    min: 15,
    want: { family: "mono", size: 10.5, tracking: 0.1 },
  },
  { id: "board running square", audit: "P5", v2: { line: 894, has: "run: { nb: A, nbd: A, nbs: 'solid' }" }, select: "[data-testid=board] [data-state-square=run]", on: BOARDS, min: 1, want: { square: "run" } },
  { id: "DONE line", audit: "P7", v2: { line: 547, has: "font:500 11px 'IBM Plex Mono'" }, select: "[data-column=DONE] [data-look=done-line], [data-column=DONE] [data-look=done-line] > span", on: BOARDS, min: 0, want: { family: "mono", size: 11 } },

  // The task screen: the activity line (T9), an ask the run waits on (T7, T13).
  { id: "activity line", audit: "T9", v2: { line: 429, has: "font:500 11px 'IBM Plex Mono'" }, select: "[data-testid=task-activity] > span:not([aria-hidden])", on: ["task"], min: 1, want: { family: "mono", size: 11 } },
  { id: "activity mark", audit: "T9", v2: { line: 429, has: "width:7px;height:7px;box-sizing:border-box;background:{{ ts.actDot }}" }, select: "[data-testid=task-activity] > [data-look=activity-dot]", on: ["task"], min: 0, want: {} },
  { id: "activity running square", audit: "T9", v2: { line: 894, has: "run: { nb: A, nbd: A, nbs: 'solid' }" }, select: "[data-testid=task-activity] > [data-state-square=run]", on: ["task"], min: 0, want: { square: "run" } },
  {
    id: "session ask kind",
    audit: "T7",
    v2: { line: 407, has: "background:var(--hl);color:var(--onhl);font:600 9.5px 'IBM Plex Mono',monospace;letter-spacing:.12em" },
    select: "[data-testid=session-ask] > [data-look=ask-kind]",
    on: ["task"],
    min: 0,
    want: { family: "mono", size: 9.5, weight: 600, tracking: 0.12, highlighter: true },
  },
  {
    id: "needs banner",
    audit: "T13",
    v2: { line: 463, has: "border:1px solid var(--ink);background:var(--hl);color:var(--onhl);padding:8px 10px;display:flex;justify-content:space-between;font:500 11.5px 'IBM Plex Mono'" },
    select: "[data-testid=inspector-needs]",
    on: ["task"],
    at: [1600],
    min: 0,
    want: { family: "mono", size: 11.5, border: { width: 1, colour: "foreground" }, highlighter: true },
  },
  { id: "needs banner text", audit: "T13", v2: { line: 463, has: "font:500 11.5px 'IBM Plex Mono'" }, select: "[data-testid=inspector-needs] > span", on: ["task"], at: [1600], min: 0, want: { family: "mono", size: 11.5 } },

  // The project's team strip (P2).
  { id: "team strip", audit: "P2", v2: { line: 513, has: "padding:8px 22px;border-bottom:1px solid rgba(var(--inkrgb),.12)" }, select: "[data-testid=team-strip]", on: ["project"], min: 1, want: {} },
  { id: "team strip name", audit: "P2", v2: { line: 516, has: "font:500 10.5px 'IBM Plex Mono',monospace;letter-spacing:.12em" }, select: "[data-testid=team-strip-team] > span:first-child", on: ["project"], min: ({ store }) => store.teams, want: { family: "mono", size: 10.5, tracking: 0.12 } },
  { id: "team strip meta", audit: "P2", v2: { line: 518, has: "font:500 11px 'IBM Plex Mono'" }, select: "[data-testid=team-strip-team] > span:nth-child(2)", on: ["project"], min: ({ store }) => store.teams, want: { family: "mono", size: 11 } },
];

export const SLICE_C_EXCEPTIONS: Exception[] = [
  { id: "registry ask card", select: "[data-testid=ask-card], [data-testid=ask-card] *", why: "the registry's approval and question card (ER-6); its Approve and Reject stay v1's until FIX-1652 settles them" },
  { id: "board card", select: "[data-testid=board-card]:not([data-look=done-line]), [data-testid=board-card]:not([data-look=done-line]) *", why: "an open task's card: v2's (id, NEEDS YOU tag, step, avatar) waits on FIX-1651's step (P6), so it is drawn as shipped" },
  { id: "IN REVIEW gap", select: "[data-column='IN REVIEW'] [data-look=column-cell] > p", why: "the named gap IN REVIEW keeps until FIX-1651 says what is in review" },
  { id: "turn receipt", select: "[data-testid=turn-receipt], [data-testid=turn-receipt] *", why: "a delivered @mention's receipt; v2's inline receipt waits on FIX-1652's harness name (W8)" },
  { id: "load older", select: "[data-testid=load-older]", why: "pages a long transcript in; v2's feed is one page" },
  { id: "empty feed", select: "[data-testid=feed-empty]", why: "v2 draws no empty feed" },
  { id: "reading", select: "[data-testid=transcript] > p", why: "the feed's loading line; v2 draws no loading state" },
];

/** The regions these screens add to those graded whole. */
export const SLICE_C_WHOLE = [
  "[data-testid=workstream-header]",
  "[data-testid=transcript]",
  "[data-testid=board]",
  "[data-testid=task-activity]",
  "[data-testid=session-ask]",
  "[data-testid=inspector-needs]",
  "[data-testid=team-strip]",
];
