import { useState } from "react";

/**
 * *Load earlier*, above a thread or a task's work that holds older items than
 * it shows: each press adds the page before the first entry. Nothing is drawn
 * once the whole history is there. A failed read says so and can be pressed
 * again.
 */
export function LoadEarlier({ load }: { load: (() => Promise<void>) | undefined }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (load === undefined) return null;
  const press = () => {
    setBusy(true);
    setFailed(false);
    load()
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground">
      <button type="button" disabled={busy} onClick={press} className="border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40">
        {busy ? "Loading…" : "Load earlier"}
      </button>
      {failed ? <span role="alert">Couldn't load earlier messages.</span> : null}
    </div>
  );
}
