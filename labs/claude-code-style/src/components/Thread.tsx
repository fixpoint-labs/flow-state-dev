import { useEffect, useRef } from "react";
import type { LabAdapter, SessionRow } from "../adapter";
import { elapsed, useNow, useWatch } from "../lib/use-watch";
import { modeOfWorker } from "../modes";
import { Composer } from "./Composer";
import { Entry } from "./Entry";

/** The center: the open session's thread, its working indicator, and the composer. */
export function Thread({ adapter, session }: { adapter: LabAdapter; session: SessionRow }) {
  const view = useWatch((emit: Parameters<LabAdapter["watchThread"]>[1]) => adapter.watchThread(session.id, emit), [adapter, session.id]);
  const running = view?.running ?? false;
  const now = useNow(running);
  const end = useRef<HTMLDivElement>(null);
  const count = view?.entries.length ?? 0;
  useEffect(() => {
    end.current?.scrollIntoView?.({ block: "end" });
  }, [count, running]);

  const mode = modeOfWorker(session.worker);
  return (
    <main aria-label="Main thread" className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-3">
        <h1 className="truncate text-sm font-semibold">{session.title}</h1>
        <span className="border border-border px-2 py-0.5 font-mono text-[10px] tracking-widest text-muted-foreground uppercase">
          {mode?.label ?? session.worker}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {count === 0 ? (
          <div className="mx-auto mt-24 max-w-sm text-center text-sm text-muted-foreground">
            Ask the main session for something. It does what it can itself and starts background tasks for the long pieces.
          </div>
        ) : (
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {view?.entries.map((entry) => <Entry key={entry.id} entry={entry} />)}
            {running && view?.turnStartedAt !== undefined ? (
              <div role="status" className="flex items-center gap-2 text-xs text-info">
                <span className="size-2 animate-pulse rounded-full bg-info" />
                working · {elapsed(view.turnStartedAt, now)}
              </div>
            ) : null}
            <div ref={end} />
          </div>
        )}
      </div>
      <Composer
        running={running}
        onSend={(text) => void adapter.send(session.id, text)}
        onStop={() => void adapter.interrupt(session.id)}
      />
    </main>
  );
}
