import { useState } from "react";
import type { SessionRow } from "../adapter";
import { cn } from "../lib/utils";
import { age, useNow } from "../lib/use-watch";
import { MODES, modeOfWorker, type ModeId } from "../modes";

/**
 * The left pane: *New session* on top, then every session, newest first. Each
 * row is a title, its age, its mode, and a dot while its turn runs.
 */
export function SessionsList({
  sessions,
  selectedId,
  onSelect,
  onNew,
}: {
  sessions: SessionRow[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onNew: (mode: ModeId) => void;
}) {
  const now = useNow(true, 30_000);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <nav aria-label="Sessions" className="flex h-full min-h-0 flex-col bg-sidebar">
      <div className="px-4 pt-4 pb-2 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Sessions</div>
      <div className="relative px-3 pb-3">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
          className="w-full border border-border bg-background px-3 py-2 text-left text-sm font-semibold hover:bg-accent"
        >
          + New session
        </button>
        {menuOpen ? (
          <div role="menu" className="absolute inset-x-3 top-full z-10 border border-border bg-popover shadow-sm">
            {MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                role="menuitem"
                disabled={!mode.available}
                onClick={() => {
                  setMenuOpen(false);
                  onNew(mode.id);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
              >
                <span className="block text-sm font-semibold">{mode.label}</span>
                <span className="block text-xs text-muted-foreground">{mode.blurb}</span>
              </button>
            ))}
          </div>
        ) : null}
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
                    {row.running ? "running" : age(row.updatedAt, now)} · {modeOfWorker(row.worker)?.label ?? row.worker}
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
