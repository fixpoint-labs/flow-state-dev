/**
 * Inbox, Tasks and Roster's part of the v2 look check: their look-table rows,
 * the regions graded whole on them, their exceptions, what the check reads
 * from the Lab's store for them, and their **content** grade.
 *
 * `run.mts` spreads these into its one table and calls the two functions; the
 * grading, the sweep and the legs stay there. Only types come back from
 * `run.mts`, so importing this module runs nothing.
 *
 * Every row cites the v2 line it came from, like the rows in `run.mts`, and
 * the content grade reads the store with the check's own requests, never
 * Shift Manager's state.
 */
import type { LabApi } from "../../lib/shift-manager.mts";
import type { Exception, Leg, Row, Store, Width } from "./run.mts";

/** One pending ask, as the check reads it from the ask's own session. */
type StoredAsk = {
  suspensionId: string;
  sessionId: string;
  /** The seat that owns the ask's session: the flow instance the session names. */
  seatId: string | null;
  kind: "approval" | "question";
  message: string;
  since: number;
  /** The last three tool calls stored before the ask, each as `tool`, `target`, `result`. */
  calls: Array<[string, string, string]>;
  /** The person's lines stored after the ask. */
  replies: string[];
};

/** What Inbox, Tasks and Roster draw that this check reads from the store. */
export type StoreScreens = {
  /** Pending asks, oldest first: Inbox's order. */
  asks: StoredAsk[];
  /** Every open row (not done) on every attached board. */
  open: Array<{ id: string; mailboxId: string; status: string; startedAt: number | null; runSession: string | null }>;
  /** Every seat's rows waiting on the person: Roster's task WAITING entries, by id and title. */
  parked: Array<{ id: string; title: string; seatId: string }>;
  onShift: number;
  onCall: number;
  /** The ON CALL FOR entries every seat has: its parked rows and its asks. */
  waits: number;
};

// ---- the store ---------------------------------------------------------------------

/** Suspension reasons that are a person being asked something. */
const PERSON_REASONS = new Set(["human_approval", "human_input"]);
const DONE = new Set(["completed", "cancelled"]);
const RUNNING = "in_progress";
/** `awaiting_review` is the word a row stored before `parked` replaced it. */
const isParked = (status: string) => status === "parked" || status === "awaiting_review";
/** Queued is every open row that isn't running or waiting on the person: v2's QUEUED (v2:916). */
const isQueued = (status: string) => !DONE.has(status) && status !== RUNNING && !isParked(status) && status !== "errored";

/**
 * The shape the registry's cards decide an approval by: anything but a
 * `human_input` that takes a submission. Must match the approval branch of
 * `suspensionShape` in `@flow-state-dev/react`; it is written out here because
 * that package's only entry loads React, which goals don't depend on.
 */
function kindOf(item: Record<string, any>): "approval" | "question" {
  return item.reason !== "human_input" || !Array.isArray(item.allow) || !item.allow.includes("submit") ? "approval" : "question";
}

/**
 * The order a session's items are shown in: `ts`, then `itemIndex`, then
 * `requestId`, then `id`, strings by code unit. Must match `compareItemOrder`
 * in `@flow-state-dev/contracts`, the order the store defines; it is written
 * out so the oracle shares no code with what it grades.
 */
function byItemOrder(a: Record<string, any>, b: Record<string, any>): number {
  if (a.ts !== b.ts) return Number(a.ts) - Number(b.ts);
  if (a.itemIndex !== b.itemIndex) return Number(a.itemIndex) - Number(b.itemIndex);
  if (a.requestId !== b.requestId) return String(a.requestId) < String(b.requestId) ? -1 : 1;
  if (a.id !== b.id) return String(a.id) < String(b.id) ? -1 : 1;
  return 0;
}

/**
 * The session a row's run link names, or `null` for a row with no whole link
 * (session, request and attempt): one stored before the link existed counts
 * as its own session. This is the board row's stored `run` field, read as the
 * store defines it.
 */
function runSessionOf(row: Record<string, any>): string | null {
  const run = row.run;
  return run != null && typeof run.sessionId === "string" && typeof run.requestId === "string" && typeof run.attempt === "number" ? run.sessionId : null;
}

/** How many sessions the running rows run in: one per linked run session, and one per unlinked running row. */
function runningSessions(open: StoreScreens["open"]): number {
  const running = open.filter((r) => r.status === RUNNING);
  return new Set(running.flatMap((r) => (r.runSession === null ? [] : [r.runSession]))).size + running.filter((r) => r.runSession === null).length;
}

function firstString(args: unknown): string {
  try {
    const value = Object.values(JSON.parse(String(args)) as Record<string, unknown>).find((v) => typeof v === "string");
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

/**
 * Read what the three screens draw: the person's pending asks with their
 * sessions around them, the open rows, and each seat's shift, worked out here
 * from the rows and asks rather than taken from Shift Manager.
 */
export async function readScreensStore(
  api: LabApi,
  userId: string,
  seen: { seats: Array<{ id: string; name: string }>; rows: Array<Record<string, any>> },
): Promise<StoreScreens> {
  const listing = await api.get(`/sessions?userId=${encodeURIComponent(userId)}&limit=500`);
  const asks: StoredAsk[] = [];
  for (const session of (listing.sessions ?? []) as Array<Record<string, any>>) {
    const found = await api.items(String(session.id), ["suspension", "suspension_resume"]);
    const resumed = new Set(found.filter((i) => i.type === "suspension_resume").map((i) => String(i.suspensionId)));
    const pending = found.filter((i) => i.type === "suspension" && PERSON_REASONS.has(String(i.reason)) && !resumed.has(String(i.suspensionId)));
    if (pending.length === 0) continue;
    // Ordered here, never in the order the read returned, so before and after are positions.
    const all = (await api.items(String(session.id), ["suspension", "tool_output", "message"])).sort(byItemOrder);
    for (const ask of pending) {
      const at = all.findIndex((i) => i.id === ask.id && i.requestId === ask.requestId);
      asks.push({
        suspensionId: String(ask.suspensionId),
        sessionId: String(session.id),
        // The worker the session runs, as its state names it.
        seatId: typeof session.state?.workerId === "string" ? session.state.workerId : null,
        kind: kindOf(ask),
        message: String(ask.message ?? ""),
        since: Number(ask.ts),
        calls: all
          .slice(0, at)
          .filter((i) => i.type === "tool_output")
          .slice(-3)
          .map((i) => {
            const first = typeof i.output === "string" ? i.output.split("\n")[0]!.trim() : "";
            return [String(i.toolCall?.name ?? ""), firstString(i.toolCall?.arguments), i.error !== undefined ? "failed" : first.length > 0 ? first : "done"];
          }),
        replies: all
          .slice(at + 1)
          .filter((i) => i.type === "message" && i.role === "user")
          .map((i) => ((i.content ?? []) as Array<{ text?: string }>).map((c) => c.text ?? "").join("").trim()),
      });
    }
  }
  asks.sort((a, b) => a.since - b.since);

  const open = seen.rows
    .filter((r) => !DONE.has(String(r.status)))
    .map((r) => ({ id: String(r.id), mailboxId: String(r.mailboxId), status: String(r.status), startedAt: typeof r.startedAt === "number" ? r.startedAt : null, runSession: runSessionOf(r) }));
  // A row is a seat's when its assignee is the seat's address or its name (the trees' convention).
  const holds = (seat: { id: string; name: string }, wanted: (status: string) => boolean) =>
    seen.rows.filter((r) => wanted(String(r.status)) && (r.assignee === seat.id || r.assignee === seat.name)).length;
  const parked: StoreScreens["parked"] = [];
  let onShift = 0;
  let onCall = 0;
  let waits = 0;
  for (const seat of seen.seats) {
    const held = seen.rows.filter((r) => isParked(String(r.status)) && (r.assignee === seat.id || r.assignee === seat.name));
    parked.push(...held.map((r) => ({ id: String(r.id), title: String(r.title ?? ""), seatId: seat.id })));
    const asked = asks.filter((a) => a.seatId === seat.id).length;
    waits += held.length + asked;
    if (holds(seat, (s) => s === RUNNING) > 0) onShift += 1;
    else if (held.length + asked > 0) onCall += 1;
  }
  return { asks, open, parked, onShift, onCall, waits };
}

// ---- the look table's rows --------------------------------------------------------

const INBOX = ["inbox"] as const;
const TASKS = ["tasks"] as const;
const ROSTER = ["roster"] as const;
const asks = (store: Store) => store.screens.asks.length;
const inFlight = (store: Store) => store.screens.open.filter((r) => !isQueued(r.status));
const anAsk = ({ store }: { store: Store }) => (asks(store) > 0 ? 1 : 0);

export const ROWS: Row[] = [
  // Inbox (v2:559-645).
  { id: "Inbox list width", audit: "I1", v2: { line: 559, has: "grid-template-columns:400px minmax(0,1fr)" }, select: "[data-testid=inbox-list]", on: INBOX, min: 1, want: { width: 400 } },
  { id: "Inbox meta line", audit: "I2", v2: { line: 562, has: "font:500 11px 'IBM Plex Mono',monospace;color:var(--ink3)\">{{ ib.sub }}" }, select: "[data-testid=inbox-sub]", on: INBOX, min: 1, want: { family: "mono", size: 11 } },
  { id: "Inbox filter strip", audit: "I3", v2: { line: 561, has: "border-bottom:1px solid rgba(var(--inkrgb),.2)" }, select: "[data-testid=inbox-list] [role=tablist]", on: INBOX, min: 1, want: {} },
  { id: "Inbox filter", audit: "I3", v2: { line: 563, has: "font:500 12px 'IBM Plex Mono'" }, select: "[data-testid=inbox-list] [role=tab], [data-testid=inbox-list] [role=tab] > span", on: INBOX, min: 6, want: { family: "mono", size: 12 } },
  { id: "Inbox filter, selected", audit: "I3", v2: { line: 1351, has: "bd: tab === k ? A : 'transparent'" }, select: "[data-testid=inbox-list] [role=tab][aria-selected=true]", on: INBOX, min: 1, want: { underline: "info" } },
  { id: "Inbox filter, others", audit: "I3", v2: { line: 1351, has: "bd: tab === k ? A : 'transparent'" }, select: "[data-testid=inbox-list] [role=tab][aria-selected=false]", on: INBOX, min: 2, want: { underline: "none" } },
  { id: "ask", audit: "I5", v2: { line: 569, has: "border-bottom:1px solid rgba(var(--inkrgb),.12)" }, select: "[data-testid=inbox-item]", on: INBOX, min: ({ store }) => asks(store), want: {} },
  { id: "ask, selected", audit: "I5", v2: { line: 1353, has: "bg: s ? 'var(--card)' : 'transparent', bar: s ? A" }, select: "[data-testid=inbox-item][aria-selected=true]", on: INBOX, min: anAsk, want: { surface: "card" } },
  { id: "ask's highlighter square", audit: "I5", v2: { line: 570, has: "width:8px;height:8px;margin-top:4px;box-sizing:border-box;background:var(--hl);border:1px solid var(--ink)" }, select: "[data-testid=inbox-item] [data-state-square]", on: INBOX, min: ({ store }) => asks(store), want: { square: "needs" } },
  { id: "ask's kind tag", audit: "I5", v2: { line: 572, has: "font-size:9.5px;letter-spacing:.1em;padding:0 4px\">{{ it.kind }}" }, select: "[data-testid=inbox-item-kind]", on: INBOX, min: ({ store }) => asks(store), want: { family: "mono", size: 9.5, tracking: 0.1 } },
  { id: "ask's question", audit: "I5", v2: { line: 573, has: "font-size:14px;font-weight:600;line-height:1.3" }, select: "[data-testid=inbox-item-question]", on: INBOX, min: ({ store }) => asks(store), want: { family: "sans", size: 14, weight: 600 } },
  { id: "ask's from line", audit: "I5", v2: { line: 574, has: "font:500 11px 'IBM Plex Mono',monospace;color:var(--ink3)\">{{ it.from }}" }, select: "[data-testid=inbox-item-from], [data-testid=inbox-item-from] *", on: INBOX, min: ({ store }) => asks(store), want: { family: "mono", size: 11 } },
  { id: "ask's wait", audit: "I5", v2: { line: 576, has: "font:500 10.5px 'IBM Plex Mono',monospace;color:var(--ink4)\">{{ it.wait }}" }, select: "[data-testid=inbox-item-wait]", on: INBOX, min: ({ store }) => asks(store), want: { family: "mono", size: 10.5 } },
  { id: "Inbox, nothing waiting", audit: "I8", v2: { line: 579, has: "padding:28px 18px;font-size:14px;line-height:1.5;color:var(--ink3)\">{{ ib.emptyTxt }}" }, select: "[data-testid=inbox-empty]", on: INBOX, min: ({ store }) => (asks(store) === 0 ? 1 : 0), want: { family: "sans", size: 14 } },
  { id: "Inbox detail head", audit: "I10", v2: { line: 596, has: "font:500 11px 'IBM Plex Mono',monospace;color:var(--ink3)" }, select: "[data-testid=inbox-detail-head]", on: INBOX, min: anAsk, want: { family: "mono", size: 11 } },
  { id: "Inbox detail title", audit: "I11", v2: { line: 597, has: "font-size:26px;line-height:1.15;letter-spacing:-.03em;font-weight:700" }, select: "[data-look=detail-title]", on: INBOX, min: anAsk, want: { family: "sans", size: 26, weight: 700, tracking: -0.03 } },
  { id: "FROM THE SESSION label", audit: "I17", v2: { line: 626, has: "font:500 10.5px 'IBM Plex Mono',monospace;letter-spacing:.12em" }, select: "[data-testid=inbox-from-session-label]", on: INBOX, min: anAsk, want: { family: "mono", size: 10.5, tracking: 0.12 } },
  { id: "FROM THE SESSION box", audit: "I17", v2: { line: 627, has: "background:var(--card);padding:6px 11px" }, select: "[data-testid=inbox-from-session-calls]", on: INBOX, min: anAsk, want: { surface: "card" } },
  // One call row per stored call: a row graded by its own count, never by how
  // many parts a row is drawn with. The first ask is the one the sweep
  // selects: Inbox lists oldest first.
  { id: "FROM THE SESSION call", audit: "I17", v2: { line: 629, has: "font:500 12px 'IBM Plex Mono'" }, select: "[data-testid=inbox-session-call]", on: INBOX, min: ({ store }) => store.screens.asks[0]?.calls.length ?? 0, want: { family: "mono", size: 12 } },
  { id: "FROM THE SESSION call text", audit: "I17", v2: { line: 629, has: "font:500 12px 'IBM Plex Mono'" }, select: "[data-testid=inbox-session-call] > span:not([data-state-square])", on: INBOX, min: ({ store }) => store.screens.asks[0]?.calls.length ?? 0, want: { family: "mono", size: 12 } },
  { id: "your reply", audit: "I18", v2: { line: 635, has: "border-left:2px solid var(--blue)" }, select: "[data-testid=inbox-reply-line]", on: INBOX, min: ({ store }) => store.screens.asks[0]?.replies.length ?? 0, want: {} },
  { id: "your reply's label", audit: "I18", v2: { line: 635, has: "font:500 10.5px 'IBM Plex Mono',monospace;color:var(--ink3)\">{{ r.label }}" }, select: "[data-testid=inbox-reply-line-label]", on: INBOX, min: ({ store }) => store.screens.asks[0]?.replies.length ?? 0, want: { family: "mono", size: 10.5 } },
  { id: "your reply's text", audit: "I18", v2: { line: 635, has: "font-size:14px;line-height:1.55" }, select: "[data-testid=inbox-reply-line-text]", on: INBOX, min: ({ store }) => store.screens.asks[0]?.replies.length ?? 0, want: { family: "sans", size: 14 } },

  // Tasks (v2:650-689).
  { id: "Tasks header", audit: "K1", v2: { line: 651, has: "padding:14px 22px 14px;border-bottom:1px solid rgba(var(--inkrgb),.2)" }, select: "[data-testid=tasks-header]", on: TASKS, min: 1, want: {} },
  { id: "ALL STREAMS tag", audit: "K1", v2: { line: 653, has: "font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.12em;border:1px solid rgba(var(--inkrgb),.4)" }, select: "[data-testid=tasks-tag]", on: TASKS, min: 1, want: { family: "mono", size: 10, tracking: 0.12 } },
  { id: "Tasks summary", audit: "K1", v2: { line: 654, has: "font:500 12px 'IBM Plex Mono',monospace;color:var(--ink3);margin-top:4px\">{{ tk.summary }}" }, select: "[data-testid=tasks-summary]", on: TASKS, min: 1, want: { family: "mono", size: 12 } },
  { id: "GROUP BY label", audit: "K2", v2: { line: 657, has: "font-size:10.5px;letter-spacing:.12em;color:var(--ink3)\">GROUP BY" }, select: "[data-testid=tasks-group-by-label]", on: TASKS, min: 1, want: { family: "mono", size: 10.5, tracking: 0.12 } },
  { id: "GROUP BY control", audit: "K2", v2: { line: 658, has: "display:flex;border:1px solid var(--ink)" }, select: "[data-testid=tasks-group-by]", on: TASKS, min: 1, want: { border: { width: 1, colour: "foreground" } } },
  { id: "GROUP BY option", audit: "K2", v2: { line: 656, has: "font:500 11.5px 'IBM Plex Mono'" }, select: "[data-testid=tasks-group-by] > [role=tab]", on: TASKS, min: 3, want: { family: "mono", size: 11.5 } },
  { id: "GROUP BY, current", audit: "K2", v2: { line: 1385, has: "bg: group === g ? INK : 'transparent'" }, select: "[data-testid=tasks-group-by] > [role=tab][aria-selected=true]", on: TASKS, min: 1, want: { surface: "foreground" } },
  { id: "Queued toggle", audit: "K3", v2: { line: 659, has: "border:1px solid rgba(var(--inkrgb),.45);padding:5px 10px" }, select: "[data-testid=tasks-queued-toggle], [data-testid=tasks-queued-count]", on: TASKS, min: 2, want: { family: "mono", size: 11.5 } },
  { id: "Queued box", audit: "K3", v2: { line: 659, has: "width:10px;height:10px;box-sizing:border-box;border:1px solid var(--ink)" }, select: "[data-testid=tasks-queued-box]", on: TASKS, min: 1, want: { width: 10, border: { width: 1, colour: "foreground" } } },
  { id: "Tasks column head", audit: "K5", v2: { line: 662, has: "font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.12em" }, select: "[data-testid=tasks-columns], [data-testid=tasks-columns] > th", on: TASKS, min: ({ store }) => (store.screens.open.length > 0 ? 9 : 0), want: { family: "mono", size: 10, tracking: 0.12 } },
  { id: "Tasks row", audit: "K9", v2: { line: 675, has: "padding:8px;border-bottom:1px solid rgba(var(--inkrgb),.1)" }, select: "[data-testid=task-row]", on: TASKS, min: ({ store }) => inFlight(store).length, want: {} },
  { id: "Tasks ID", audit: "K5", v2: { line: 677, has: "font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink3)\">{{ r.id }}" }, select: "[data-testid=task-row-id]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "mono", size: 11.5 } },
  { id: "Tasks title", audit: "K9", v2: { line: 678, has: "font-size:13.5px;white-space:nowrap" }, select: "[data-testid=task-row-title]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "sans", size: 13.5 } },
  { id: "Tasks NOW", audit: "K5", v2: { line: 679, has: "font:500 11.5px 'IBM Plex Mono',monospace;white-space:nowrap" }, select: "[data-testid=task-row-now]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "mono", size: 11.5 } },
  { id: "Tasks stream", audit: "K9", v2: { line: 680, has: "font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink2)" }, select: "[data-testid=task-row-stream]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "mono", size: 11.5 } },
  { id: "Tasks worker", audit: "K9", v2: { line: 681, has: "font-size:13px;white-space:nowrap" }, select: "[data-testid=task-row-worker]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "sans", size: 13 } },
  { id: "Tasks TIME", audit: "K8", v2: { line: 682, has: "font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink3)\">{{ r.el }}" }, select: "[data-testid=task-row-time]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "mono", size: 11.5 } },
  { id: "Tasks COST", audit: "K5", v2: { line: 683, has: "font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink3);text-align:right" }, select: "[data-testid=task-row-cost]", on: TASKS, min: ({ store }) => inFlight(store).length, want: { family: "mono", size: 11.5 } },

  // Roster (v2:693-725).
  { id: "Roster column head", audit: "R1", v2: { line: 701, has: "font:500 10px 'IBM Plex Mono',monospace;letter-spacing:.12em;color:var(--ink3)\"><span></span><span>WORKER</span>" }, select: "[data-testid=roster-columns], [data-testid=roster-columns] > span", on: ROSTER, min: 5, want: { family: "mono", size: 10, tracking: 0.12 } },
  { id: "Roster group heading", audit: "R8", v2: { line: 705, has: "border-bottom:1px solid rgba(var(--inkrgb),.3);font:500 11px 'IBM Plex Mono'" }, select: "[data-testid=roster-group] > h2, [data-testid=roster-group] > h2 > span", on: ROSTER, min: 1, want: { family: "mono", size: 11 } },
  { id: "Roster group name", audit: "R8", v2: { line: 705, has: "font-weight:600;letter-spacing:.1em;color:var(--ink)\">{{ g.label }}" }, select: "[data-testid=roster-group-label]", on: ROSTER, min: 1, want: { weight: 600, tracking: 0.1 } },
  { id: "ON CALL FOR tag", audit: "R6", v2: { line: 717, has: "grid-template-columns:66px minmax(0,1fr);gap:8px;align-items:baseline;font:500 11px 'IBM Plex Mono',monospace\"><span style=\"font-size:9.5px;letter-spacing:.1em" }, select: "[data-testid=roster-wait-tag]", on: ROSTER, min: ({ store }) => store.screens.waits, want: { family: "mono", size: 9.5, tracking: 0.1, width: 66 } },
  // Everything ON CALL FOR lists here waits on the person: WAITING, on the highlighter.
  { id: "ON CALL FOR, WAITING", audit: "R6", v2: { line: 1393, has: "WAITING: [INK, Y, 'var(--onhl)']" }, select: "[data-testid=roster-wait-tag]", on: ROSTER, min: ({ store }) => store.screens.waits, want: { square: "needs" } },
  { id: "ON CALL FOR lines", audit: "R6", v2: { line: 717, has: "font:500 11px 'IBM Plex Mono'" }, select: "[data-testid=roster-wait-what], [data-testid=roster-wait-when], [data-testid=roster-no-wait]", on: ROSTER, min: ({ store }) => store.screens.waits * 2, want: { family: "mono", size: 11 } },
];

export const EXCEPTIONS: Exception[] = [
  { id: "Inbox scope note", select: "[data-testid=inbox-scope]", why: "the named gap that says which asks Inbox lists; the organization-wide Inbox waits on FIX-1652" },
  { id: "Inbox, one filter empty", select: "[data-testid=inbox-filter-empty]", why: "v2 shows its nothing-needs-you sentence under an empty filter even while other asks wait; Shift Manager says the filter is empty instead" },
  { id: "FROM THE SESSION, nothing before", select: "[data-testid=inbox-from-session-none], [data-testid=inbox-from-session-unread]", why: "v2's every ask follows tool calls; an ask with none before it, or past what is read, says so" },
];

/** The regions on these screens every painting element of which a row or an exception covers. */
export const WHOLE: string[] = [
  "[data-testid=inbox-list] > header",
  "[data-testid=inbox-item]",
  "[data-testid=inbox-empty]",
  "[data-testid=inbox-detail-head]",
  "[data-look=detail-title]",
  "[data-testid=inbox-from-session]",
  "[data-testid=inbox-reply-line]",
  "[data-testid=tasks-header]",
  "[data-testid=tasks-columns]",
  "[data-testid=task-row]",
  "[data-testid=roster-columns]",
  "[data-testid=roster-group] > h2",
  "[data-testid=roster-wait]",
  "[data-testid=roster-no-wait]",
];

// ---- content -----------------------------------------------------------------------

/** What the sweep reads for content, by key: each match's text, its data attributes, and its parts' text by test id. */
export const TEXTS: Record<string, string> = {
  inboxSub: "[data-testid=inbox-sub]",
  inboxCounts: "[data-testid=inbox-list] [data-testid^=tab-count-]",
  inboxEmpty: "[data-testid=inbox-empty]",
  inboxSelected: "[data-testid=inbox-item][aria-selected=true]",
  inboxTitle: "[data-testid=inbox-detail-title]",
  inboxCalls: "[data-testid=inbox-session-call]",
  inboxNone: "[data-testid=inbox-from-session-none]",
  inboxReplies: "[data-testid=inbox-reply-line-text]",
  tasksSummary: "[data-testid=tasks-summary]",
  tasksColumns: "[data-testid=tasks-columns] > th",
  tasksRows: "[data-testid=task-row]",
  tasksQueued: "[data-testid=tasks-queued-count]",
  rosterColumns: "[data-testid=roster-columns] > span",
  rosterGroups: "[data-testid=roster-group]",
  rosterWaits: "[data-testid=roster-wait]",
};
export type Read = { text: string; data: Record<string, string>; parts: Record<string, string> };

const COLUMNS = ["", "ID", "TASK", "NOW", "STREAM", "WORKER", "TIME", "COST"];
const ROSTER_COLUMNS = ["WORKER", "SLOTS", "HOLDING", "ON CALL FOR"];
const GROUP_SUB: Record<string, string> = {
  "on shift": "holding live work",
  "on call": "subscribed and waiting · wakes on a trigger",
  "off shift": "nothing assigned, nothing subscribed",
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const list = (xs: readonly string[]) => `[${xs.join(", ")}]`;

/** `6m 40s` or `12m` as seconds, and how far off it may read; `null` for anything else. */
function seconds(text: string): { s: number; within: number } | null {
  const short = /^(\d+)m (\d\d)s$/.exec(text);
  if (short !== null) return { s: Number(short[1]) * 60 + Number(short[2]), within: 2 };
  const long = /^(\d+)m$/.exec(text);
  return long === null ? null : { s: Number(long[1]) * 60, within: 61 };
}

/**
 * The content leg on Inbox, Tasks and Roster: what each draws equals the
 * store, read by this check. `now` is the page's clock at the sweep.
 */
export function gradeContent(texts: Record<string, Read[]>, now: number, where: { screen: string; width: Width; store: Store }, fail: (leg: Leg, what: string) => void): void {
  const store = where.store.screens;
  const one = (key: string) => texts[key]?.[0]?.text ?? null;
  if (where.screen === "inbox") {
    if (store.asks.length === 0) {
      const want = `Nothing needs you. ${plural(runningSessions(store.open), "session is", "sessions are")} still running and ${plural(store.onCall, "worker is", "workers are")} on call.`;
      if (one("inboxEmpty") !== want) fail("content", `Inbox with nothing waiting reads "${one("inboxEmpty") ?? "nothing"}", the store gives "${want}" (v2:1354, audit I8)`);
      return;
    }
    const sub = one("inboxSub") ?? "";
    if (!sub.startsWith(`${store.asks.length} waiting · oldest `)) fail("content", `Inbox's meta line reads "${sub}", the store holds ${store.asks.length} pending ask(s) (v2:1349, audit I2)`);
    const counts = Object.fromEntries((texts.inboxCounts ?? []).map((c) => [c.data.testid?.replace("tab-count-", "") ?? "", c.text]));
    const approvals = store.asks.filter((a) => a.kind === "approval").length;
    const want = { All: store.asks.length, Approvals: approvals, Questions: store.asks.length - approvals };
    for (const [tab, n] of Object.entries(want)) {
      if (counts[tab] !== String(n)) fail("content", `Inbox's ${tab} filter counts ${counts[tab] ?? "nothing"}, the store holds ${n} (v2:1350, audit I3)`);
    }
    const selected = texts.inboxSelected?.[0]?.data.suspensionId;
    const ask = store.asks.find((a) => a.suspensionId === selected);
    if (ask === undefined) {
      fail("content", `Inbox selects ${selected ?? "nothing"}, which the store holds no pending ask for`);
      return;
    }
    if (one("inboxTitle") !== ask.message) fail("content", `Inbox's detail is titled "${one("inboxTitle") ?? ""}", the ask asks "${ask.message}" (v2:597, audit I11)`);
    const calls = (texts.inboxCalls ?? []).map((c) => c.text);
    const wantCalls = ask.calls.map((c) => c.join(""));
    if (JSON.stringify(calls) !== JSON.stringify(wantCalls) || (wantCalls.length === 0 && (texts.inboxNone ?? []).length !== 1)) {
      fail("content", `FROM THE SESSION shows ${list(calls)}, the session's last calls before the ask are ${list(wantCalls)} (v2:624-633, audit I17)`);
    }
    const replies = (texts.inboxReplies ?? []).map((r) => r.text);
    if (JSON.stringify(replies) !== JSON.stringify(ask.replies)) fail("content", `Inbox draws your replies ${list(replies)}, the session holds ${list(ask.replies)} after the ask (v2:634-636, audit I18)`);
  }
  if (where.screen === "tasks") {
    const flying = store.open.filter((r) => !isQueued(r.status));
    const summary = [
      `${flying.length} in flight`,
      `${store.asks.length} ${store.asks.length === 1 ? "needs" : "need"} you`,
      `${store.onShift} on shift`,
      `${store.onCall} on call`,
      plural(new Set(flying.map((r) => r.mailboxId)).size, "stream", "streams"),
    ].join(" · ");
    if (one("tasksSummary") !== summary) fail("content", `Tasks' summary reads "${one("tasksSummary") ?? ""}", the store gives "${summary}" (v2:1384, audit K1)`);
    const queued = store.open.filter((r) => isQueued(r.status)).length;
    if (one("tasksQueued") !== String(queued)) fail("content", `the Queued toggle counts ${one("tasksQueued") ?? "nothing"}, the store holds ${queued} queued row(s) (v2:1383, audit K4)`);
    const heads = (texts.tasksColumns ?? []).map((c) => c.text);
    if (flying.length > 0 && JSON.stringify(heads) !== JSON.stringify(COLUMNS)) fail("content", `Tasks' columns are ${list(heads)}, v2's are ${list(COLUMNS)} (v2:662, audit K5)`);
    const rows = texts.tasksRows ?? [];
    const shown = rows.map((r) => r.data.taskId ?? "").sort();
    const wanted = flying.map((r) => r.id).sort();
    if (JSON.stringify(shown) !== JSON.stringify(wanted)) fail("content", `Tasks shows ${list(shown)} with queued hidden, the store's rows in flight are ${list(wanted)} (v2:1372, audit K4)`);
    for (const row of rows) {
      const stored = flying.find((r) => r.id === row.data.taskId);
      if (stored === undefined) continue;
      // A missing cell is the look table's to name, by its expected count.
      const id = row.parts["task-row-id"];
      if (id !== undefined && id !== stored.id) fail("content", `${stored.id}'s ID cell reads "${id}" (v2:677, audit K5)`);
      const time = row.parts["task-row-time"] ?? "";
      if (stored.status === RUNNING && stored.startedAt !== null) {
        const read = seconds(time);
        const ran = Math.floor((now - stored.startedAt) / 1000);
        if (read === null || Math.abs(read.s - ran) > read.within) fail("content", `${stored.id}'s TIME reads "${time}", it started ${ran}s ago (v2:682, audit K8)`);
      } else if (time !== "—") {
        fail("content", `${stored.id}'s TIME reads "${time}", but it isn't running from a recorded start (v2:1134, audit K8)`);
      }
    }
  }
  if (where.screen === "roster") {
    const heads = (texts.rosterColumns ?? []).map((c) => c.text);
    if (JSON.stringify(heads) !== JSON.stringify(ROSTER_COLUMNS)) fail("content", `Roster's columns are ${list(heads)}, v2's are ${list(ROSTER_COLUMNS)} (v2:701, audit R1)`);
    for (const group of texts.rosterGroups ?? []) {
      const sub = group.parts["roster-group-sub"];
      if (sub !== GROUP_SUB[group.data.status ?? ""]) fail("content", `Roster's ${group.data.status} group says "${sub ?? ""}", v2 says "${GROUP_SUB[group.data.status ?? ""]}" (v2:1392, audit R8)`);
    }
    const drawnTasks: string[] = [];
    for (const wait of texts.rosterWaits ?? []) {
      // Both lines come from the store: an ask's kind and message, a parked row's id and title.
      let want: [string, string] | null = null;
      if (wait.data.kind === "ask") {
        const ask = store.asks.find((a) => a.suspensionId === wait.data.id);
        if (ask !== undefined) want = [`you · ${ask.kind}`, ask.message];
      } else {
        drawnTasks.push(wait.data.id ?? "");
        const row = store.parked.find((r) => r.id === wait.data.id);
        if (row !== undefined) want = [`you · ${row.id}`, row.title];
      }
      if (want === null) {
        fail("content", `Roster lists ${wait.data.kind === "ask" ? "an ask" : "a task"} ${wait.data.id} waiting on the person, and the store holds no such ${wait.data.kind === "ask" ? "pending ask" : "parked row"} (audit R6)`);
        continue;
      }
      if (wait.parts["roster-wait-tag"] !== "WAITING" || wait.parts["roster-wait-what"] !== want[0] || wait.parts["roster-wait-when"] !== want[1]) {
        fail("content", `Roster's ON CALL FOR entry ${wait.data.id} reads "${wait.parts["roster-wait-tag"]} ${wait.parts["roster-wait-what"]} / ${wait.parts["roster-wait-when"]}", the store gives "WAITING ${want[0]} / ${want[1]}" (v2:1130, audit R6)`);
      }
    }
    const parkedIds = store.parked.map((r) => r.id).sort();
    if (texts.rosterWaits !== undefined && JSON.stringify(drawnTasks.sort()) !== JSON.stringify(parkedIds)) {
      fail("content", `Roster's waiting tasks are ${list(drawnTasks)}, the store's parked rows are ${list(parkedIds)} (audit R6)`);
    }
  }
}
