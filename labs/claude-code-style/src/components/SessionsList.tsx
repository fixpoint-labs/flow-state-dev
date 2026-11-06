import { PlusIcon } from "lucide-react";
import type { KeyboardEvent } from "react";
import type { SessionRow } from "../adapter";
import { cn } from "../lib/utils";
import { age, useNow } from "../lib/use-watch";
import { MODES, type ModeId } from "../modes";
import { PaneHeader } from "./PaneHeader";
import { PanelToggle } from "./PanelToggle";

/**
 * The left pane: the view switch (Sessions or Projects) on top, then
 * *New session*, then the view's sessions, newest first. The view sets the
 * mode, so *New session* opens one in the view's mode. Each row is a title,
 * its age, a dot while its turn runs, and how many of its tasks wait on you.
 *
 * The view switch is one Tab stop, as a tab list is: ← and → (Home, End)
 * move to the other view and select it, skipping one the adapter doesn't serve.
 *
 * Collapsed (`[`), it is a rail: the toggle that opens it, and *New session*.
 */
export function SessionsList({
  view,
  sessions,
  selectedId,
  onView,
  onSelect,
  onNew,
  modes,
  collapsed,
  onToggle,
}: {
  view: ModeId;
  sessions: SessionRow[];
  selectedId: string | undefined;
  onView: (view: ModeId) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** The modes the adapter serves; a view whose mode it doesn't serve shows disabled. */
  modes: readonly ModeId[];
  /** Draw the rail instead of the list. */
  collapsed: boolean;
  /** Collapse the list, or open it back. */
  onToggle: () => void;
}) {
  const now = useNow(true, 30_000);
  const served = MODES.filter((mode) => mode.available && modes.includes(mode.id)).map((mode) => mode.id);
  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const at = served.indexOf(view);
    const to =
      event.key === "ArrowRight" ? served[(at + 1) % served.length]
      : event.key === "ArrowLeft" ? served[(at - 1 + served.length) % served.length]
      : event.key === "Home" ? served[0]
      : event.key === "End" ? served[served.length - 1]
      : undefined;
    if (to === undefined) return;
    event.preventDefault();
    onView(to);
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-view="${to}"]`)?.focus();
  };
  if (collapsed) {
    return (
      <nav aria-label="Sessions" data-collapsed="true" className="flex h-full min-h-0 flex-col items-center bg-sidebar">
        <PaneHeader className="w-full justify-center px-0">
          <PanelToggle side="left" name="sessions list" keyName="[" collapsed onToggle={onToggle} />
        </PaneHeader>
        <button
          type="button"
          onClick={onNew}
          title="New session"
          aria-label="New session"
          className="mt-3 flex size-8 items-center justify-center rounded-md border border-border bg-background transition-colors hover:bg-accent"
        >
          <PlusIcon aria-hidden className="size-4" />
        </button>
      </nav>
    );
  }
  return (
    <nav aria-label="Sessions" data-collapsed="false" className="flex h-full min-h-0 flex-col bg-sidebar">
      <PaneHeader className="px-3">
        <div role="tablist" aria-label="View" className="flex flex-1 gap-1">
          {MODES.map((mode) => {
            const available = mode.available && modes.includes(mode.id);
            return (
              <button
                key={mode.id}
                type="button"
                role="tab"
                aria-selected={mode.id === view}
                tabIndex={mode.id === view ? 0 : -1}
                data-view={mode.id}
                onKeyDown={onTabKey}
                disabled={!available}
                title={available ? undefined : "Coming soon"}
                onClick={() => onView(mode.id)}
                className={cn(
                  "flex-1 rounded-md border border-transparent px-2 py-1.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase transition-colors hover:bg-accent hover:text-foreground",
                  "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
                  mode.id === view && "border-border bg-background text-foreground",
                )}
              >
                {mode.view}
              </button>
            );
          })}
        </div>
        <PanelToggle side="left" name="sessions list" keyName="[" collapsed={false} onToggle={onToggle} />
      </PaneHeader>
      <div className="px-3 py-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-accent"
        >
          + New session
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-3">
        {sessions.map((row) => {
          const selected = row.id === selectedId;
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(row.id)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-accent/60",
                  selected && "bg-accent",
                )}
              >
                <span
                  aria-label={row.running ? "running" : row.waiting > 0 ? "waiting on you" : undefined}
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    row.running ? "bg-info animate-pulse" : row.waiting > 0 ? "bg-attention" : "bg-transparent",
                  )}
                />
                <span className="min-w-0">
                  <span className={cn("block truncate text-sm", selected && "font-medium")}>{row.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.running ? "running" : age(row.updatedAt, now)}
                    {row.waiting > 0 && <span className="text-foreground"> · {row.waiting} waiting on you</span>}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
