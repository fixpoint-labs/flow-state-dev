/**
 * DELEGATES, at Shift Coordinator: who the coordinator hands this
 * conversation's work to. Lists the conversation's delegates, adds one from
 * the person's roster, and removes one, through the coordinator's own actions
 * on the conversation's session (`lib/delegates.ts`). What it shows is what
 * the coordinator answered, never a guess: a refused add shows its reason and
 * leaves the list as it was.
 *
 * The delegates belong to a conversation, so until the person has one there
 * is nothing to list: the panel says so.
 */
import { useEffect, useState } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { addDelegate, readDelegates, removeDelegate, type DelegateList } from "../lib/delegates";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Seat } from "../lib/reads";
import { useWorkforce } from "../lib/workforce";

type Read = { list: DelegateList } | { failure: string } | undefined;

export function DelegatesPanel({ seat, sessionId }: { seat: Seat; sessionId: string | null }) {
  const { clients } = useLab();
  const workforce = useWorkforce();
  const [read, setRead] = useState<Read>(undefined);
  const [roster, setRoster] = useState<readonly RosterEntry[]>([]);
  const [picked, setPicked] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionId === null || seat.kind === null) return;
    let closed = false;
    setRead(undefined);
    readDelegates(clients, seat.kind, sessionId)
      .then((list) => !closed && setRead({ list }))
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error).message }));
    workforce
      .roster()
      .then((entries) => !closed && setRoster(entries))
      .catch(() => !closed && setRoster([]));
    return () => {
      closed = true;
    };
  }, [clients, workforce, seat.kind, sessionId]);

  if (sessionId === null || seat.kind === null) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-delegates-none">
        Delegates belong to a conversation. Say something to start one.
      </p>
    );
  }
  if (read === undefined) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="cos-delegates-reading">
        Reading the delegates…
      </p>
    );
  }
  if ("failure" in read) {
    return (
      <p className="px-1 text-xs text-destructive" data-testid="cos-delegates-failure">
        The delegates didn't load: {read.failure}
      </p>
    );
  }

  const kind = seat.kind;
  const listed = new Set(read.list.delegates.map((d) => d.worker));
  const candidates = roster.filter((entry) => entry.id !== seat.id && !listed.has(entry.id));
  const change = async (run: () => Promise<DelegateList>) => {
    setBusy(true);
    setRefusal(null);
    try {
      setRead({ list: await run() });
      setPicked("");
    } catch (error) {
      setRefusal(describeFailure(error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="cos-delegates">
      {read.list.delegates.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground" data-testid="cos-delegates-empty">
          No delegates in this conversation.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {read.list.delegates.map((delegate) => (
            <li key={delegate.worker} className="flex items-center justify-between gap-2 px-1 py-1 text-sm" data-testid="cos-delegate" data-worker={delegate.worker}>
              <span className="min-w-0 truncate" title={delegate.note}>
                {delegate.worker}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void change(() => removeDelegate(clients, kind, sessionId, delegate.worker))}
                data-testid="cos-delegate-remove"
              >
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {read.list.delegates.length < read.list.max && candidates.length > 0 ? (
        <form
          className="mt-1 flex gap-1 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            if (picked !== "") void change(() => addDelegate(clients, kind, sessionId, picked));
          }}
        >
          <select
            className="min-w-0 flex-1 border bg-background px-1 py-0.5 text-xs"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            aria-label="A worker from your roster"
            data-testid="cos-delegate-pick"
          >
            <option value="">Add from your roster…</option>
            {candidates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.id}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="border px-2 text-xs disabled:opacity-50"
            disabled={busy || picked === ""}
            data-testid="cos-delegate-add"
          >
            add
          </button>
        </form>
      ) : null}
      {refusal === null ? null : (
        <p className="mt-1 px-1 text-xs text-destructive" data-testid="cos-delegate-refused">
          {refusal}
        </p>
      )}
    </div>
  );
}
