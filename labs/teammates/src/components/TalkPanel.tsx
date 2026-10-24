import { useState } from "react";
import type { LabAdapter, WorkerRow } from "../adapter";
import { groupTalk } from "../lib/talk";
import { useWatch } from "../lib/use-watch";

/**
 * The right pane: the open worker's exchanges with the other workers,
 * grouped by the other worker, read from the message log. Read only: to steer
 * an exchange, talk to either worker.
 */
export function TalkPanel({ adapter, worker, nameOf, onClose }: { adapter: LabAdapter; worker: WorkerRow; nameOf: (id: string) => string; onClose: () => void }) {
  const rows = useWatch(adapter.watchTalk, worker.id) ?? [];
  const groups = groupTalk(worker.id, rows);
  // The most recent group starts open; a toggle overrides it.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (other: string, i: number) => toggled[`${worker.id}:${other}`] ?? i === 0;

  return (
    <aside aria-label="Talk" className="flex h-full min-h-0 flex-col border-l border-border bg-inspector">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <span className="font-mono text-[10px] tracking-widest text-muted-foreground uppercase">Talk · {worker.name}</span>
        <button type="button" aria-label="Close talk" onClick={onClose} className="px-1 text-sm text-muted-foreground hover:text-foreground">
          ×
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {groups.length === 0 ? <p className="mt-4 text-sm text-muted-foreground">{worker.name} hasn't messaged anyone yet.</p> : null}
        {groups.map((group, i) => {
          const open = isOpen(group.with, i);
          return (
            <section key={group.with} aria-label={`with ${nameOf(group.with)}`} className="border-b border-border py-3">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setToggled((t) => ({ ...t, [`${worker.id}:${group.with}`]: !open }))}
                className="flex w-full items-center justify-between text-left"
              >
                <span className="text-sm font-semibold">with {nameOf(group.with)}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  {group.rows.length} {open ? "▾" : "▸"}
                </span>
              </button>
              {open ? (
                <ol className="mt-2 flex flex-col gap-2">
                  {group.rows.map((m) => (
                    <li key={m.id}>
                      <div className="font-mono text-[11px] text-success">
                        {nameOf(m.from)} → {nameOf(m.to)}
                      </div>
                      <p className="text-sm text-muted-foreground">{m.text}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
            </section>
          );
        })}
      </div>
      <div className="px-4 py-3 font-mono text-[10px] text-muted-foreground">from the message log</div>
    </aside>
  );
}
