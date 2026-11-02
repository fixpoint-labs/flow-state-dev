/**
 * Jump to (⌘K; Shift+⌘K opens it in message mode): find any screen the sidebar
 * reaches, a project, a workstream, a worker, a task or a declared document,
 * from the one snapshot, and go there (BR-10). A query matches a result's
 * shown name, its hint, or its id. A worker opens Roster on its team with its
 * row in view and focus. A document opens read-only. A Lab that serves no
 * document to the browser gets a line saying so, and a failed read of them, or
 * of a project's workstreams, says what the Lab answered.
 *
 * It is a dialog and a combobox (the stock `command` component): Up and Down
 * move the highlight, the pointer highlights what it is over, Enter opens the
 * highlighted one, Tab stays inside, and Esc closes it and puts focus back
 * where it was.
 *
 * A query that starts with `> ` is a message instead: the rest is handed to the
 * Shift Coordinator's own composer, which sends it as if it were typed there.
 * The palette closes and the Coordinator screen opens. A line that has no one to
 * go to leaves the palette open with the reason and the draft intact.
 */
import type { Client } from "@flow-state-dev/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { allRows, shiftCoordinatorOf, workerLabel, type LoadedSnapshot } from "../lib/derive";
import { handToShiftCoordinator } from "../lib/outbox";
import { projectReaderOf, readProject, type WorkstreamEntry } from "../lib/projects";
import { navigate, type Route } from "../lib/routes";
import { RouteLink } from "../components/RouteLink";
import type { Gaps } from "../gaps";

const GROUPS = ["Views", "Projects", "Workstreams", "Workers", "Tasks", "Resources"] as const;
type Group = (typeof GROUPS)[number];

/** One result: what it is called, a hint drawn beside it, and the other words it is found by (its id). */
type Entry = { group: Group; label: string; hint: string; keywords: string[]; to: Route; focus?: string };

/** The most results drawn per group. */
const PER_GROUP = 8;

/** Typing this first turns the palette into a message to the Shift Coordinator; Shift+⌘K opens the palette with it already typed. */
export const MESSAGE_PREFIX = "> ";

/** Every screen the sidebar reaches, by the name it shows there. */
const VIEWS: Entry[] = [
  { group: "Views", label: "Shift Coordinator", hint: "where Shift Manager opens", keywords: [], to: { level: "shift-coordinator" } },
  { group: "Views", label: "Inbox", hint: "what waits on you", keywords: [], to: { level: "inbox", item: null } },
  { group: "Views", label: "Tasks", hint: "every board's tasks", keywords: [], to: { level: "tasks", by: "state" } },
  { group: "Views", label: "Roster", hint: "every worker", keywords: [], to: { level: "roster", team: null } },
  { group: "Views", label: "Messages", hint: "between your workers", keywords: [], to: { level: "messages" } },
  { group: "Views", label: "Scheduled work", hint: "and its next runs", keywords: ["schedules"], to: { level: "schedules" } },
  { group: "Views", label: "Usage", hint: "what each harness has left", keywords: [], to: { level: "usage" } },
  { group: "Views", label: "Settings", hint: "your keys", keywords: [], to: { level: "settings" } },
];

/** A project's workstreams, read once when the palette opens; `failed` holds what the Lab answered. */
type Workstreams = { key: string; project: string; to: (entry: WorkstreamEntry) => Route; entries: WorkstreamEntry[] } | { key: string; project: string; failed: string };

/**
 * Each project's workstreams, read once per project while the palette is open:
 * a palette open for a minute does not poll.
 */
function useWorkstreams(snapshot: LoadedSnapshot, client: Client | undefined): Workstreams[] {
  const [reads, setReads] = useState<Workstreams[]>([]);
  const reader = projectReaderOf(snapshot.sessions);
  const projects = snapshot.projects.ok ? snapshot.projects.value.rows : [];
  const addresses = projects.map((p) => `${p.visibility}/${p.id}`).join("\n");
  useEffect(() => {
    if (client === undefined || reader === null) return;
    let live = true;
    void Promise.all(
      projects.map(async (project): Promise<Workstreams> => {
        const key = `${project.visibility}/${project.id}`;
        try {
          const read = await readProject(client, reader, { visibility: project.visibility, id: project.id });
          const to = (entry: WorkstreamEntry): Route => ({
            level: "project",
            projectId: project.id,
            tab: "workstreams",
            ...(project.visibility === "private" ? { visibility: "private" as const } : {}),
            entry: { owner: entry.owner, id: entry.id },
          });
          return { key, project: project.title, to, entries: read?.entries ?? [] };
        } catch (error) {
          return { key, project: project.title, failed: error instanceof Error ? error.message : String(error) };
        }
      }),
    ).then((done) => live && setReads(done));
    return () => {
      live = false;
    };
    // Read again only when the set of projects or the reader changes, never on a timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, reader, addresses]);
  return reads;
}

/** Focus the element `selector` names once the screen navigated to draws it, scrolled into view. */
function focusWhenDrawn(selector: string) {
  let tries = 0;
  const attempt = () => {
    const found = document.querySelector<HTMLElement>(selector);
    if (found !== null) {
      found.scrollIntoView?.({ block: "nearest" });
      found.focus();
    } else if ((tries += 1) < 60) requestAnimationFrame(attempt);
  };
  requestAnimationFrame(attempt);
}

export function JumpTo({
  snapshot,
  gaps,
  client,
  initialQuery = "",
  onClose,
}: {
  snapshot: LoadedSnapshot;
  /** Reads each project's workstreams when the palette opens; without one, Jump to lists no workstreams. */
  client?: Client;
  gaps: Gaps;
  /** Seeds the query; `"> "` (Shift+⌘K) opens straight into message mode. */
  initialQuery?: string;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [sendFailure, setSendFailure] = useState<string | null>(null);
  // Set once a result is picked: focus then goes where the pick leads, not back to where it was.
  const picked = useRef(false);
  // What had focus before the palette opened. The dialog only gives focus back to a trigger, and Jump to has none.
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const messaging = query.startsWith(MESSAGE_PREFIX);
  const workstreams = useWorkstreams(snapshot, client);

  const index = useMemo<Entry[]>(() => {
    const workers = snapshot.inventory.ok ? snapshot.inventory.value.workers : [];
    const projects = snapshot.projects.ok ? snapshot.projects.value.rows : [];
    return [
      ...VIEWS,
      ...projects.map((p): Entry => ({
        group: "Projects",
        label: p.title,
        hint: p.visibility === "private" ? "private project" : "project",
        keywords: [p.id],
        to: { level: "project", projectId: p.id, tab: "stream", ...(p.visibility === "private" ? { visibility: "private" as const } : {}) },
      })),
      ...workstreams.flatMap((read) =>
        "failed" in read
          ? []
          : read.entries.map((entry): Entry => ({ group: "Workstreams", label: entry.title, hint: `${read.project} · ${entry.status}`, keywords: [entry.id, entry.owner], to: read.to(entry) })),
      ),
      ...workers.map((w): Entry => ({
        group: "Workers",
        label: workerLabel(w.displayName),
        hint: [w.teamName, w.kind].filter(Boolean).join(" · "),
        keywords: [w.id],
        to: { level: "roster", team: w.team },
        focus: `[data-testid="roster-worker"][data-worker-id="${w.id.replace(/"/g, '\\"')}"]`,
      })),
      ...allRows(snapshot).map((r): Entry => ({ group: "Tasks", label: r.title, hint: `${r.status} · ${r.boardRef}`, keywords: [r.id], to: { level: "task", boardRef: r.boardRef, taskId: r.id, tab: "session" } })),
      ...(snapshot.resources.ok ? snapshot.resources.value : []).map((d): Entry => ({ group: "Resources", label: d.ref, hint: "read-only", keywords: [d.sessionId], to: { level: "resource", sessionId: d.sessionId, ref: d.ref } })),
    ];
  }, [snapshot, workstreams]);

  const needle = query.trim().toLowerCase();
  const matches = (e: Entry) => needle === "" || [e.label, e.hint, ...e.keywords].some((word) => word.toLowerCase().includes(needle));
  const groups = GROUPS.map((g) => [g, index.filter((e) => e.group === g && matches(e)).slice(0, PER_GROUP)] as const).filter(
    // Projects and workstreams show once the Lab has any; every other group says when nothing matches.
    ([g]) => (g !== "Projects" && g !== "Workstreams") || index.some((e) => e.group === g),
  );
  const failedWorkstreams = workstreams.filter((read): read is Extract<Workstreams, { failed: string }> => "failed" in read);

  const sendMessage = () => {
    const message = query.slice(MESSAGE_PREFIX.length).trim();
    if (message === "") return;
    if (!snapshot.inventory.ok) return setSendFailure("The Lab's workers didn't load, so there is no one to send this to.");
    const shiftCoordinator = shiftCoordinatorOf(snapshot.inventory.value.workers);
    if (shiftCoordinator.kind !== "one") return setSendFailure("There isn't exactly one Shift Coordinator to send this to.");
    if (shiftCoordinator.worker.door === null) return setSendFailure(`${workerLabel(shiftCoordinator.worker.id)} ${gaps.turn.noDoor}`);
    handToShiftCoordinator(message);
    picked.current = true;
    navigate({ level: "shift-coordinator" }); // in place: after a line is sent to the Shift Coordinator
    onClose();
  };

  // A result's link has gone to its address in this tab: the palette closes and focus goes where the pick leads.
  const went = (entry: Entry) => {
    picked.current = true;
    onClose();
    if (entry.focus !== undefined) focusWhenDrawn(entry.focus);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!picked.current) opener?.focus();
        }}
        className="top-24 max-w-lg translate-y-0 gap-0 rounded-none p-0 sm:max-w-lg"
        data-testid="jump-dialog"
      >
        <DialogTitle className="sr-only">Jump to</DialogTitle>
        <DialogDescription className="sr-only">Find a screen, project, workstream, worker, task or document, or start with &gt; to message the Shift Coordinator.</DialogDescription>
        <Command shouldFilter={false} label="Jump to" className="rounded-none">
          <CommandInput
            value={query}
            onValueChange={(value) => {
              setQuery(value);
              setSendFailure(null);
            }}
            onKeyDown={(e) => {
              if (messaging && e.key === "Enter") {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Jump to a screen, worker or task… or > to message the Coordinator"
            data-testid="jump-input"
          />
          {messaging ? (
            <div className="p-4 text-sm" data-testid="jump-message">
              <p className="text-xs font-semibold tracking-wider text-muted-foreground">MESSAGE TO SHIFT COORDINATOR</p>
              <p className="mt-1 text-muted-foreground">Press Enter to send.</p>
              {sendFailure !== null ? (
                <p className="mt-2 text-destructive" role="alert" data-testid="jump-message-failure">
                  {sendFailure}
                </p>
              ) : null}
            </div>
          ) : (
            <CommandList aria-label="Results" className="max-h-96 p-2">
              {groups.map(([group, entries]) => (
                <CommandGroup key={group} heading={group.toUpperCase()} className="mb-2 p-0 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wider">
                  {entries.length === 0 ? <p className="px-2 py-1 text-xs text-muted-foreground">No match.</p> : null}
                  {entries.map((entry) => (
                    <JumpResult key={`${entry.group}:${entry.label}:${entry.hint}:${entry.keywords.join(",")}`} entry={entry} onNavigate={() => went(entry)} />
                  ))}
                </CommandGroup>
              ))}
              {failedWorkstreams.map((read) => (
                <p key={read.key} className="px-2 py-1 text-xs text-muted-foreground" data-testid="jump-workstreams-failure">
                  {read.project}'s workstreams did not load: {read.failed}
                </p>
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
            </CommandList>
          )}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One result: a real link to its address, inside the palette's item. Enter (or
 * a click beside the link) is a plain click on that link, so every way to a
 * result goes through it; a modified click on the link is the browser's.
 */
function JumpResult({ entry, onNavigate }: { entry: Entry; onNavigate: () => void }) {
  const item = useRef<HTMLDivElement>(null);
  // Set while a click on the link bubbles to its item, so the item doesn't click the link again.
  const clickedLink = useRef(false);
  return (
    <CommandItem
      ref={item}
      value={`${entry.group}:${entry.label}:${entry.hint}:${entry.keywords.join(",")}`}
      onSelect={() => {
        if (clickedLink.current) return void (clickedLink.current = false);
        item.current?.querySelector("a")?.click();
      }}
      data-testid="jump-result"
      className="rounded-none p-0"
    >
      <RouteLink
        to={entry.to}
        tabIndex={-1}
        onClick={() => void (clickedLink.current = true)}
        onNavigate={onNavigate}
        className="flex w-full items-center justify-between px-2 py-1.5"
      >
        <span className="truncate">{entry.label}</span>
        <span className="ml-2 truncate text-xs text-muted-foreground">{entry.hint}</span>
      </RouteLink>
    </CommandItem>
  );
}
