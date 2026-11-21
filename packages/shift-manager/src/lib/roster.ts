/**
 * The user's roster: their own workers and the standard ones, followed
 * through Workforce's client (`watchRoster`), so a hire, fork, edit or fire,
 * from any tab or by any worker's turn, redraws it.
 *
 * A worker the user hired is theirs alone, so the organization's worker
 * inventory never names it: the directory (`directory.tsx`) joins the two,
 * and holds the page's one roster watch.
 */
import { useEffect, useRef, useState } from "react";
import type { RosterEntry } from "@flow-state-dev/workforce/browser";
import { describeFailure, type Failure } from "./failure";
import { useLab } from "./lab-data";
import { useWorkforce } from "./workforce";

/** The roster read: its entries, its failure, or `undefined` until the first read lands. */
export type RosterRead = { entries: RosterEntry[] } | { failure: Failure } | undefined;

/**
 * The user's roster, followed through Workforce's client. `undefined` until
 * the first read lands. A failed re-read keeps the roster already drawn; the
 * next read that lands replaces it. Each call is one watch: the directory
 * makes the page's one call.
 */
export function useRoster(): RosterRead {
  const { client } = useLab();
  const workforce = useWorkforce();
  // The connection decides the watch; its workforce client is the one built over it.
  const workforceRef = useRef(workforce);
  workforceRef.current = workforce;
  const [read, setRead] = useState<{ client: unknown; read: RosterRead }>({ client, read: undefined });
  useEffect(() => {
    let last: RosterRead;
    const tell = (next: RosterRead) => {
      last = next;
      setRead({ client, read: next });
    };
    setRead({ client, read: undefined });
    return workforceRef.current.watchRoster((entries) => tell({ entries }), {
      onError: (error) => {
        if (last === undefined || "failure" in last) tell({ failure: describeFailure(error) });
      },
    });
  }, [client]);
  return read.client === client ? read.read : undefined;
}
