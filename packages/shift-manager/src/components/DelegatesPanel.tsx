/**
 * DELEGATES, at Shift Coordinator: who the coordinator hands this
 * conversation's work to. Lists the conversation's delegates, adds one from
 * the user's roster, and removes one, through the coordinator's own actions
 * on the conversation's session (`lib/delegates.ts`). What it shows is what
 * the coordinator answered, never a guess: a refused add shows its reason and
 * leaves the list as it was.
 *
 * The delegates belong to a conversation, so until the user has one there
 * is nothing to list: the panel says so.
 */
import { useEffect, useState } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { addDelegate, readDelegates, removeDelegate, type DelegateList } from "../lib/delegates";
import { workerLabel } from "../lib/derive";
import { useLab } from "../lib/lab-data";
import { describeFailure, type Worker } from "../lib/reads";
import { useWorkforce } from "../lib/workforce";

type Read = { list: DelegateList } | { failure: string } | undefined;

export function DelegatesPanel({ worker, sessionId }: { worker: Worker; sessionId: string | null }) {
  const { client } = useLab();
  const workforce = useWorkforce();
  const [read, setRead] = useState<Read>(undefined);
  const [roster, setRoster] = useState<readonly RosterEntry[]>([]);
  const [picked, setPicked] = useState("");
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sessionId === null || worker.kind === null) return;
    let closed = false;
    setRead(undefined);
    readDelegates(client, worker.kind, sessionId)
      .then((list) => !closed && setRead({ list }))
      .catch((error: unknown) => !closed && setRead({ failure: describeFailure(error).message }));
    workforce
      .roster()
      .then((entries) => !closed && setRoster(entries))
      .catch(() => !closed && setRoster([]));
    return () => {
      closed = true;
    };
  }, [client, workforce, worker.kind, sessionId]);

  if (sessionId === null || worker.kind === null) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-delegates-none">
        Delegates belong to a conversation. Say something to start one.
      </p>
    );
  }
  if (read === undefined) {
    return (
      <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-delegates-reading">
        Reading the delegates…
      </p>
    );
  }
  if ("failure" in read) {
    return (
      <p className="px-1 text-xs text-destructive" data-testid="shift-coordinator-delegates-failure">
        The delegates didn't load: {read.failure}
      </p>
    );
  }

  const flow = worker.kind;
  const listed = new Set(read.list.delegates.map((d) => d.worker));
  const candidates = roster.filter((entry) => entry.id !== worker.id && !listed.has(entry.id));
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
    <div data-testid="shift-coordinator-delegates">
      {read.list.delegates.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground" data-testid="shift-coordinator-delegates-empty">
          No delegates in this conversation.
        </p>
      ) : (
        <ul className="space-y-0.5">
          {read.list.delegates.map((delegate) => (
            <li key={delegate.worker} className="flex items-center justify-between gap-2 px-1 py-1 text-sm" data-testid="shift-coordinator-delegate" data-worker={delegate.worker}>
              <span className="min-w-0 truncate" title={delegate.note}>
                {workerLabel(roster.find((entry) => entry.id === delegate.worker)?.name ?? delegate.worker)}
              </span>
              <button
                type="button"
                className="shrink-0 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                disabled={busy}
                onClick={() => void change(() => removeDelegate(client, flow, sessionId, delegate.worker))}
                data-testid="shift-coordinator-delegate-remove"
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
            if (picked !== "") void change(() => addDelegate(client, flow, sessionId, picked));
          }}
        >
          <select
            className="min-w-0 flex-1 border bg-background px-1 py-0.5 text-xs"
            value={picked}
            onChange={(event) => setPicked(event.target.value)}
            aria-label="A worker from your roster"
            data-testid="shift-coordinator-delegate-pick"
          >
            <option value="">Add from your roster…</option>
            {candidates.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {/* Two workers may share a display name; the id tells them apart. */}
                {entry.name == null
                  ? workerLabel(entry.id)
                  : candidates.some((other) => other.id !== entry.id && other.name === entry.name)
                    ? `${entry.name} (${entry.id})`
                    : entry.name}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="border px-2 text-xs disabled:opacity-50"
            disabled={busy || picked === ""}
            data-testid="shift-coordinator-delegate-add"
          >
            add
          </button>
        </form>
      ) : null}
      {refusal === null ? null : (
        <p className="mt-1 px-1 text-xs text-destructive" data-testid="shift-coordinator-delegate-refused">
          {refusal}
        </p>
      )}
    </div>
  );
}
