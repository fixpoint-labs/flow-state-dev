/**
 * The v2 look table's rows for the sidebar's entries and Shift Coordinator
 * (FIX-1737 slice B): audit rows F12–F16, F18, F20, F22, C1, C2, C3 and C5
 * (the shell around the registry's parts), C7, C8 and C10. Spread into
 * `run.mts`'s table, exceptions and graded regions, so each screen slice adds
 * its rows in a file of its own.
 *
 * Also here: what these rows draw from the Lab, graded in the **content**
 * leg against the store `run.mts` reads.
 */
import type { Exception, Row, Screen, Store, Where } from "../run.mts";

const NAV = "[data-testid=sidebar] [data-testid^=nav-]";
/**
 * Screens whose sidebar always has a current row other than Shift Coordinator's: every one but
 * Shift Coordinator and the project, whose No project row is drawn only while a workstream is in no project.
 */
const WITH_CURRENT: readonly Screen[] = ["workstream", "board", "task", "tasks", "inbox", "roster"];

/**
 * Per workstream, the dot v2 gives it (v2:1183-1184): needs-you first, then running, else none.
 * Must match Shift Manager's `streamMark` (`labs/shift-manager/src/lib/shell.ts`); kept as this
 * check's own copy, since an oracle that imported the app's rule would grade the app against itself.
 */
export function dotOf(channel: Store["channels"][string]): "needs" | "run" | "none" {
  return channel.needs ? "needs" : channel.running > 0 ? "run" : "none";
}
/** One element while the sweep holds a line to the chief of staff in flight, none otherwise. */
const whileWorking = ({ working }: Where) => (working === true ? 1 : 0);
const channelsWith = (store: Store, dot: "needs" | "run") => Object.values(store.channels).filter((c) => dotOf(c) === dot).length;

export const SIDEBAR_AND_COS_ROWS: Row[] = [
  // The sidebar's entries.
  { id: "Shift Coordinator entry", audit: "F12", v2: { line: 52, has: "border:1px solid {{ nav.cosBd }};background:{{ nav.cosBg }}" }, select: "[data-testid=nav-cos]:not([aria-current=page])", on: ["workstream", "board", "task", "tasks", "inbox", "roster", "project"], min: 1, want: { surface: "card", border: { width: 1, colour: "foreground" } } },
  { id: "Shift Coordinator entry, current", audit: "F12", v2: { line: 1176, has: "cosBg: v.v === 'cos' ? INK" }, select: "[data-testid=nav-cos][aria-current=page]", on: ["cos"], min: 1, want: { surface: "foreground", border: { width: 1, colour: "foreground" } } },
  { id: "Shift Coordinator entry name", audit: "F12", v2: { line: 52, has: "font-size:13.5px;font-weight:600" }, select: "[data-testid=nav-cos] > [data-look=nav-label]", min: 1, want: { family: "sans", size: 13.5, weight: 600 } },
  { id: "Shift Coordinator entry square", audit: "F12", v2: { line: 53, has: "width:18px;height:18px;box-sizing:border-box;border:1px solid {{ nav.cosAvBd }}" }, select: "[data-testid=nav-cos] > [data-look=avatar]", min: 1, want: { family: "mono", size: 7.5, weight: 600, width: 18 } },
  { id: "Shift Coordinator working dot", audit: "F12", v2: { line: 55, has: "width:7px;height:7px;background:{{ nav.cosDot }}" }, select: "[data-testid=nav-cos] > [data-look=working][data-working=true]", min: whileWorking, want: { surface: "info", width: 7 } },
  { id: "nav icon", audit: "F13", v2: { line: 58, has: "width:14px;height:14px" }, select: `${NAV} > [data-look=nav-icon]`, min: 3, want: { width: 14 } },
  { id: "Inbox count, something waits", audit: "F14", v2: { line: 1174, has: "inboxBadgeBg: openIds.length ? Y" }, select: "[data-testid=nav-inbox-count][data-waiting=true]", min: ({ store }) => (store.asks > 0 ? 1 : 0), want: { highlight: true, weight: 600 } },
  { id: "Tasks count", audit: "F15", v2: { line: 65, has: "font:500 10.5px 'IBM Plex Mono',monospace;color:var(--blue)" }, select: "[data-testid=nav-tasks-count]", min: 1, want: { colour: "info" } },
  { id: "current row tint", audit: "F16", v2: { line: 908, has: "NAVSEL = 'rgba(var(--bluergb),.12)'" }, select: `${NAV}[aria-current=page]:not([data-testid=nav-cos]), [data-testid=team][aria-current=page]`, min: ({ screen }) => (WITH_CURRENT.includes(screen) ? 1 : 0), want: { surface: "accent" } },
  { id: "current entry weight", audit: "F16", v2: { line: 1173, has: "[k + 'Fw']: v.v === k ? '700' : '500'" }, select: `:is([data-testid=nav-inbox], [data-testid=nav-tasks], [data-testid=nav-roster])[aria-current=page] > [data-look=nav-label]`, on: ["task", "tasks", "inbox", "roster"], min: 1, want: { weight: 700 } },
  { id: "other entry weight", audit: "F16", v2: { line: 1173, has: "[k + 'Fw']: v.v === k ? '700' : '500'" }, select: `:is([data-testid=nav-inbox], [data-testid=nav-tasks], [data-testid=nav-roster]):not([aria-current=page]) > [data-look=nav-label]`, min: 2, want: { weight: 500 } },
  { id: "current workstream weight", audit: "F16", v2: { line: 1184, has: "fw: s ? '600' : '400'" }, select: "[data-testid^=nav-workstream-][aria-current=page] > [data-look=nav-label]", on: ["workstream", "board"], min: 1, want: { weight: 600 } },
  { id: "workstream #", audit: "F18", v2: { line: 88, has: "font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink4)\">#" }, select: "[data-testid^=nav-workstream-] > [data-look=meta-meta]", min: ({ store }) => Object.keys(store.channels).length, want: { family: "mono", size: 11.5 } },
  { id: "workstream name", audit: "F18", v2: { line: 88, has: "padding:5px 6px;font-size:13px" }, select: "[data-testid^=nav-workstream-] > [data-look=nav-label]", min: ({ store }) => Object.keys(store.channels).length, want: { family: "sans", size: 13 } },
  { id: "workstream dot, needs you", audit: "F18", v2: { line: 1184, has: "dot: wn ? Y : wr ? A" }, select: "[data-testid^=nav-workstream-] > [data-state-square=needs]", min: ({ store }) => channelsWith(store, "needs"), want: { square: "needs", width: 6 } },
  { id: "workstream dot, running", audit: "F18", v2: { line: 1184, has: "dotBd: wn ? INK : wr ? A" }, select: "[data-testid^=nav-workstream-] > [data-state-square=run]", min: ({ store }) => channelsWith(store, "run"), want: { square: "run", width: 6 } },
  { id: "TEAMS heading", audit: "F20", v2: { line: 97, has: "<span>TEAMS</span><span>on shift</span>" }, select: "[data-testid=teams-heading] > [data-look=meta-label]", min: 2, want: { family: "mono", size: 10 } },
  { id: "footer initials", audit: "F22", v2: { line: 110, has: "width:22px;height:22px;box-sizing:border-box;border:1px solid var(--ink)" }, select: "[data-testid=footer-user]", min: 1, want: { family: "mono", size: 10, width: 22, border: { width: 1, colour: "foreground" } } },

  // Shift Coordinator's centre.
  { id: "Shift Coordinator feed", audit: "C10", v2: { line: 123, has: "padding:36px 32px 12px" }, select: "[data-look=cos-feed]", on: ["cos"], min: 1, want: { padding: [36, 32, 12, 32] } },
  { id: "Shift Coordinator column", audit: "C10", v2: { line: 124, has: "max-width:720px" }, select: "[data-look=cos-column]", on: ["cos"], min: 1, want: { width: 720 } },
  { id: "Shift Coordinator square", audit: "C1", v2: { line: 126, has: "width:40px;height:40px;background:var(--ink);color:var(--paper);font:600 13px 'IBM Plex Mono'" }, select: "[data-testid=cos-header] > [data-look=avatar]", on: ["cos"], min: 1, want: { width: 40, surface: "foreground", family: "mono", size: 13, weight: 600 } },
  { id: "Shift Coordinator sub line", audit: "C1", v2: { line: 127, has: "font:500 11.5px 'IBM Plex Mono'" }, select: "[data-testid=cos-sub], [data-testid=cos-watching]", on: ["cos"], min: 1, want: { family: "mono", size: 11.5 } },
  { id: "message label", audit: "C2", v2: { line: 135, has: "font:500 10.5px 'IBM Plex Mono',monospace;letter-spacing:.12em" }, select: "[data-testid=cos] [data-look=message-label]", on: ["cos"], min: 1, want: { family: "mono", size: 10.5, tracking: 0.12 } },
  { id: "message time", audit: "C5", v2: { line: 135, has: "<span style=\"letter-spacing:0;color:var(--ink4)\">{{ m.time }}</span>" }, select: "[data-testid=cos] [data-look=message-time]", on: ["cos"], min: ({ store }) => (store.replied ? 1 : 0), want: { family: "mono", size: 10.5, tracking: 0 } },
  { id: "summary prose", audit: "C2", v2: { line: 136, has: "font-size:16px;line-height:1.55" }, select: "[data-look=summary-prose] > p, [data-look=summary-prose] > p > span", on: ["cos"], min: 2, want: { family: "sans", size: 16, lineHeight: 1.55 } },
  { id: "asks list", audit: "C3", v2: { line: 138, has: "border:1px solid var(--ink);background:var(--card)" }, select: "[data-testid=cos-asks]", on: ["cos"], min: ({ store }) => (store.asks > 0 ? 1 : 0), want: { surface: "card", border: { width: 1, colour: "foreground" } } },
  { id: "ask item", audit: "C3", v2: { line: 140, has: "padding:12px 14px;border-top:{{ it.bt }}" }, select: "[data-testid=cos-ask]", on: ["cos"], min: ({ store }) => store.asks, want: { padding: [12, 14, 12, 14] } },
  { id: "needs-you tag", audit: "C3", v2: { line: 142, has: "border:1px solid var(--ink);font:600 9.5px 'IBM Plex Mono',monospace;letter-spacing:.12em" }, select: "[data-look=needs-tag]", on: ["cos"], min: ({ store }) => store.asks, want: { highlight: true, family: "mono", size: 9.5, weight: 600, tracking: 0.12, border: { width: 1, colour: "foreground" } } },
  { id: "ask meta", audit: "C3", v2: { line: 143, has: "font:500 11px 'IBM Plex Mono',monospace;color:var(--ink3)" }, select: "[data-look=ask-meta], [data-look=ask-meta] > button", on: ["cos"], min: ({ store }) => store.asks, want: { family: "mono", size: 11 } },
  { id: "thinking line", audit: "C7", v2: { line: 168, has: "font:500 11.5px 'IBM Plex Mono',monospace;color:var(--ink3)" }, select: "[data-testid=cos-working]", on: ["cos"], min: whileWorking, want: { family: "mono", size: 11.5 } },
  { id: "thinking square", audit: "C7", v2: { line: 168, has: "width:7px;height:7px;background:var(--blue)" }, select: "[data-testid=cos-working] > [data-look=working]", on: ["cos"], min: whileWorking, want: { surface: "info", width: 7 } },
  { id: "suggestion", audit: "C8", v2: { line: 174, has: "border:1px dashed rgba(var(--inkrgb),.45)" }, select: "[data-look=suggestion]", on: ["cos"], min: ({ store }) => (store.chiefOfStaff ? 1 : 0), want: { family: "mono", size: 11.5, border: { width: 1, colour: "foreground", style: "dashed" } } },
];

export const SIDEBAR_AND_COS_EXCEPTIONS: Exception[] = [
  { id: "registry ask card", select: "[data-testid=cos] [data-testid=ask-card], [data-testid=cos] [data-testid=ask-card] *", why: "the registry's approval and question cards, unedited (ER-6); their Approve and Reject stay v1's by decision" },
  { id: "registry item", select: "[data-look=registry-item], [data-look=registry-item] *", why: "the registry's message, reasoning and tool cards, unedited (ER-6; audit C5, T4, T6)" },
  { id: "workstream gone", select: "[data-testid=nav-workstream-gone]", why: "a workstream a project lists whose channel left the Lab, shown with no link; v2's Labs never lose one" },
  { id: "no single chief of staff", select: "[data-testid=cos-none], [data-testid=cos-none] *, [data-testid=cos-several], [data-testid=cos-several] *", why: "the named state a Lab without one chief of staff gets; v2 always has one" },
  { id: "conversation not yet read", select: "[data-testid=cos-conversation-empty], [data-testid=cos-conversation-reading], [data-testid=cos-truncated]", why: "Shift Manager's named states for a conversation not started, being read, or longer than one read; v2 draws one under way" },
];

/** Shift Coordinator's centre is graded whole: every painting element in it is a row or an exception. */
export const SIDEBAR_AND_COS_WHOLE: string[] = ["[data-testid=cos]"];

/** What the sidebar and Shift Coordinator draw from the Lab, read in the page by `run.mts`'s sweep. */
export type SidebarAndCosRead = {
  inbox: { text: string; waiting: string | null } | null;
  dots: Array<{ channel: string; dot: string | null }>;
  sub: string | null;
  /** The sub line's store-backed tail, "watching N streams and M workers". */
  watching: string | null;
  suggestions: string[] | null;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The **content** leg for these rows: each value drawn equals what the store
 * holds. Returns one failure line per mismatch, each citing its v2 line.
 */
export function sidebarAndCosContent(read: SidebarAndCosRead, store: Store, screen: Screen, working = false): string[] {
  const failures: string[] = [];
  if (read.inbox === null) failures.push("the sidebar draws no Inbox count (v2:60)");
  else {
    if (read.inbox.text !== String(store.asks)) failures.push(`the Inbox count says ${read.inbox.text}, the store holds ${store.asks} pending ask(s) (v2:60)`);
    if (read.inbox.waiting !== String(store.asks > 0)) failures.push(`the Inbox count's highlighter is ${read.inbox.waiting === "true" ? "on" : "off"} with ${store.asks} pending ask(s) (v2:1174)`);
  }
  for (const [channel, held] of Object.entries(store.channels)) {
    const drawn = read.dots.find((d) => d.channel === channel);
    if (drawn === undefined) failures.push(`PROJECTS draws no #${channel} (v2:88)`);
    else if (drawn.dot !== dotOf(held)) failures.push(`#${channel}'s dot is ${drawn.dot ?? "missing"}, the store gives ${dotOf(held)} (${held.needs ? "an ask waits" : "no ask waits"}, ${held.running} running) (v2:1183-1184)`);
  }
  if (screen === "cos") {
    const watching = `watching ${plural(Object.keys(store.channels).length, "stream", "streams")} and ${plural(store.seats, "worker", "workers")}`;
    if (working) {
      if (read.sub !== "working…") failures.push(`Shift Coordinator's sub line says "${read.sub ?? ""}" while a line is in flight, v2 says "working…" (v2:1424)`);
    } else if (read.watching !== watching) {
      failures.push(`Shift Coordinator's sub line says "${read.watching ?? ""}", the store gives "${watching}" (v2:1424)`);
    }
    if (store.chiefOfStaff) {
      const channels = Object.entries(store.channels);
      const stream = channels.find(([, c]) => c.needs) ?? channels.find(([, c]) => c.running > 0);
      const want = [...(stream === undefined ? [] : [`What's blocking #${stream[0]}?`]), "Who's on call?"];
      if (JSON.stringify(read.suggestions) !== JSON.stringify(want)) {
        failures.push(`Shift Coordinator offers [${(read.suggestions ?? []).join(" | ")}], the store gives [${want.join(" | ")}] (v2:1422)`);
      }
    }
  }
  return failures;
}
