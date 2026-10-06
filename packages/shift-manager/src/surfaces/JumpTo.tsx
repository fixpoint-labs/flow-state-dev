/**
 * Jump to (⌘K): find Chief of Staff, a workstream, a worker, a task or a declared document by
 * name, from the one snapshot, and go there (BR-10). A document opens
 * read-only. A Lab that serves no document to the browser gets a line saying
 * so, and a failed read of them says what the Lab answered. Up and Down move
 * the highlight through the results, the pointer highlights what it is over,
 * and Enter opens the highlighted one.
 *
 * A query that starts with `> ` is a message instead: the rest is sent to the
 * Shift Coordinator through the one send path, and the palette closes once the
 * session holds the line, on the coordinator's conversation. A line that can't
 * be sent leaves the palette open with the reason and the draft intact.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { allRows, chiefOfStaffOf, type LoadedSnapshot } from "../lib/derive";
import { currentConversation, newConversationId, sendToChiefOfStaff } from "../lib/cos";
import { useLab } from "../lib/lab-data";
import { describeFailure } from "../lib/reads";
import { startChiefOfStaffWork } from "../lib/working";
import { navigate, type Route } from "../lib/routes";
import type { Gaps } from "../gaps";

type Entry = { group: "Views" | "Workstreams" | "Workers" | "Tasks" | "Resources"; label: string; hint: string; to: Route };

/** The most results drawn per group. */
const PER_GROUP = 8;

/** Typing this first turns the palette into a message to the Shift Coordinator. */
const MESSAGE_PREFIX = "> ";

export function JumpTo({ snapshot, gaps, onClose }: { snapshot: LoadedSnapshot; gaps: Gaps; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const { clients, refresh } = useLab();
  const [sending, setSending] = useState(false);
  const [sendFailure, setSendFailure] = useState<string | null>(null);
  const messaging = query.startsWith(MESSAGE_PREFIX);
  useEffect(() => input.current?.focus(), []);

  const index = useMemo<Entry[]>(() => {
    const workstreams = snapshot.inventory.ok ? snapshot.inventory.value.workstreams : [];
    const seats = snapshot.inventory.ok ? snapshot.inventory.value.seats : [];
    return [
      { group: "Views", label: "Shift Coordinator", hint: "where Shift Manager opens", to: { level: "cos" } },
      ...workstreams.map((w): Entry => ({ group: "Workstreams", label: w.id, hint: `${w.members.length} members`, to: { level: "workstream", mailboxId: w.id, tab: "stream" } })),
      ...seats.map((s): Entry => ({ group: "Workers", label: s.id, hint: s.kind ?? "", to: { level: "roster", team: null } })),
      ...allRows(snapshot).map((r): Entry => ({ group: "Tasks", label: r.title, hint: `${r.status} · ${r.boardRef}`, to: { level: "task", boardRef: r.boardRef, taskId: r.id, tab: "session" } })),
      ...(snapshot.resources.ok ? snapshot.resources.value : []).map((d): Entry => ({ group: "Resources", label: d.ref, hint: "read-only", to: { level: "resource", sessionId: d.sessionId, ref: d.ref } })),
    ];
  }, [snapshot]);

  const needle = query.trim().toLowerCase();
  const found = index.filter((e) => needle === "" || e.label.toLowerCase().includes(needle));
  const groups = (["Views", "Workstreams", "Workers", "Tasks", "Resources"] as const).map((g) => [g, found.filter((e) => e.group === g).slice(0, PER_GROUP)] as const);
  // The results in the order they are drawn, which is the order the arrows walk.
  const shown = groups.flatMap(([, entries]) => entries);
  const highlighted = Math.min(active, shown.length - 1);

  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [highlighted]);

  const sendMessage = async () => {
    const message = query.slice(MESSAGE_PREFIX.length).trim();
    if (message === "" || sending) return;
    if (!snapshot.inventory.ok) return setSendFailure("The Lab's seats didn't load, so there is no one to send this to.");
    const cos = chiefOfStaffOf(snapshot.inventory.value.seats, snapshot.orgId);
    if (cos.kind !== "one") return setSendFailure("There isn't exactly one Shift Coordinator to send this to.");
    if (cos.seat.door === null) return setSendFailure(`${cos.seat.id} ${gaps.turn.noDoor}`);
    const sessionId = currentConversation(snapshot.sessions, cos.seat.id, null) ?? newConversationId();
    setSending(true);
    setSendFailure(null);
    const settled = startChiefOfStaffWork();
    try {
      await sendToChiefOfStaff(clients, { seatId: cos.seat.id, door: cos.seat.door, sessionId }, message, () => {
        // The session holds the line: show the conversation while the reply is in flight.
        void refresh();
        navigate({ level: "cos" });
        onClose();
      });
      void refresh();
    } catch (error) {
      void refresh();
      setSendFailure(describeFailure(error).message);
      setSending(false);
    } finally {
      settled();
    }
  };

  const go = (entry: Entry) => {
    navigate(entry.to);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center bg-foreground/20 pt-24" onClick={onClose} data-testid="jump-dialog">
      <div role="dialog" aria-label="Jump to" className="w-full max-w-lg border bg-popover text-popover-foreground shadow-lg" onClick={(e) => e.stopPropagation()}>
        <input
          ref={input}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setSendFailure(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (messaging) {
              if (e.key === "Enter") void sendMessage();
              return;
            }
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              // Keep the caret where it is; the arrows belong to the list here.
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              setActive(Math.max(0, Math.min(shown.length - 1, highlighted + step)));
            }
            if (e.key === "Enter" && shown[highlighted] !== undefined) go(shown[highlighted]);
          }}
          placeholder="Jump to a workstream, worker or task… or > to message the Coordinator"
          className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none"
          data-testid="jump-input"
        />
        {messaging ? (
          <div className="p-4 text-sm" data-testid="jump-message">
            <p className="text-xs font-semibold tracking-wider text-muted-foreground">MESSAGE TO SHIFT COORDINATOR</p>
            <p className="mt-1 text-muted-foreground">{sending ? "Sending…" : "Press Enter to send."}</p>
            {sendFailure !== null ? (
              <p className="mt-2 text-destructive" role="alert" data-testid="jump-message-failure">
                {sendFailure}
              </p>
            ) : null}
          </div>
        ) : (
        <div ref={list} role="listbox" aria-label="Results" className="max-h-96 overflow-y-auto p-2">
          {groups.map(([group, entries]) => (
            <section key={group} role="group" aria-label={group} className="mb-2">
              <p className="px-2 py-1 text-[11px] font-semibold tracking-wider text-muted-foreground">{group.toUpperCase()}</p>
              {entries.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No match.</p> : null}
              {entries.map((entry) => {
                const at = shown.indexOf(entry);
                return (
                  <button
                    key={`${entry.group}:${entry.label}:${entry.hint}`}
                    type="button"
                    role="option"
                    aria-selected={at === highlighted}
                    onClick={() => go(entry)}
                    onMouseMove={() => setActive(at)}
                    data-testid="jump-result"
                    className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-sm ${at === highlighted ? "bg-accent text-accent-foreground" : ""}`}
                  >
                    <span className="truncate">{entry.label}</span>
                    <span className="ml-2 truncate text-xs text-muted-foreground">{entry.hint}</span>
                  </button>
                );
              })}
            </section>
          ))}
          {!snapshot.resources.ok ? (
            <p className="px-2 py-1 text-xs text-muted-foreground" data-testid="jump-resources-failure">
              The Lab's documents did not load: {snapshot.resources.failure.message}
            </p>
          ) : snapshot.resources.value.length === 0 ? (
            <p className="px-2 py-1 text-xs text-muted-foreground" data-testid="jump-resources-gap">
              {gaps.resources}
            </p>
          ) : null}
        </div>
        )}
      </div>
    </div>
  );
}
