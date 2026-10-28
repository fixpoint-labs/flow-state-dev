import type { SessionRow } from "../adapter";
import { cn } from "../lib/utils";
import { age, useNow } from "../lib/use-watch";
import { MODES, type ModeId } from "../modes";

/**
 * The left pane: the view switch (Sessions or Projects) on top, then
 * *New session*, then the view's sessions, newest first. The view sets the
 * mode, so *New session* opens one in the view's mode. Each row is a title,
 * its age, and a dot while its turn runs.
 */
export function SessionsList({
  view,
  sessions,
  selectedId,
  onView,
  onSelect,
  onNew,
  modes,
}: {
  view: ModeId;
  sessions: SessionRow[];
  selectedId: string | undefined;
  onView: (view: ModeId) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  /** The modes the adapter serves; a view whose mode it doesn't serve shows disabled. */
  modes: readonly ModeId[];
}) {
  const now = useNow(true, 30_000);
  return (
    <nav aria-label="Sessions" className="flex h-full min-h-0 flex-col bg-sidebar">
      <div role="tablist" aria-label="View" className="flex gap-1 px-3 pt-4 pb-3">
        {MODES.map((mode) => {
          const available = mode.available && modes.includes(mode.id);
          return (
          <button
            key={mode.id}
            type="button"
            role="tab"
            aria-selected={mode.id === view}
            disabled={!available}
            title={available ? undefined : "Coming soon"}
            onClick={() => onView(mode.id)}
            className={cn(
              "flex-1 border border-transparent px-2 py-1 font-mono text-[10px] tracking-widest text-muted-foreground uppercase hover:bg-accent",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent",
              mode.id === view && "border-border bg-background text-foreground",
            )}
          >
            {mode.view}
          </button>
          );
        })}
      </div>
      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={onNew}
          className="w-full border border-border bg-background px-3 py-2 text-left text-sm font-semibold hover:bg-accent"
        >
          + New session
        </button>
      </div>
      <ul className="flex-1 overflow-y-auto px-2 pb-4">
        {sessions.map((row) => {
          const selected = row.id === selectedId;
          return (
            <li key={row.id}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => onSelect(row.id)}
                className={cn(
                  "flex w-full items-start gap-2 border border-transparent px-2 py-2 text-left hover:bg-accent",
                  selected && "border-primary bg-accent",
                )}
              >
                <span
                  aria-label={row.running ? "running" : undefined}
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", row.running ? "bg-info animate-pulse" : "bg-transparent")}
                />
                <span className="min-w-0">
                  <span className={cn("block truncate text-sm", selected && "font-semibold")}>{row.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.running ? "running" : age(row.updatedAt, now)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-4 py-3 text-xs text-muted-foreground">One main worker, many sessions</div>
    </nav>
  );
}
