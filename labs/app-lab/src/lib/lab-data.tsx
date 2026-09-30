/**
 * The one snapshot every surface draws from, and when it is read again.
 *
 * S3's contract: a refresh on boot, on an organization switch, after a
 * successful answer to an ask, and on Retry. Never on a route or tab change,
 * so moving around the app costs no reads. Inbox, the Stream's asks, the
 * sidebar counts and the Tasks list all come from the same snapshot.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ResumeAction } from "@flow-state-dev/core/types";
import type { LabClients } from "./connection";
import { createLabReader, type Ask, type LabReader, type LabSnapshot } from "./reads";

/** What a surface reads from the provider. */
export type LabData = {
  clients: LabClients;
  reader: LabReader;
  /** `undefined` until the first refresh lands. */
  snapshot: LabSnapshot | undefined;
  refreshing: boolean;
  /** Read everything again. */
  refresh(): Promise<void>;
  /** Answer an ask; on success, refresh so it leaves every surface together. */
  answer(ask: Ask, answer: { action: ResumeAction; data?: unknown }): Promise<void>;
};

const LabContext = createContext<LabData | null>(null);

/** Hold the snapshot for `clients`. */
export function LabProvider({ clients, children }: { clients: LabClients; children: ReactNode }) {
  const reader = useMemo(() => createLabReader(clients), [clients]);
  const [snapshot, setSnapshot] = useState<LabSnapshot | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  // Only the latest refresh may land: an older one finishing late would draw
  // a Lab that has moved on.
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++generation.current;
    setRefreshing(true);
    try {
      const next = await reader.read();
      if (mine === generation.current) setSnapshot(next);
    } finally {
      if (mine === generation.current) setRefreshing(false);
    }
  }, [reader]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const answer = useCallback<LabData["answer"]>(
    async (ask, value) => {
      await reader.resume(ask, value);
      await refresh();
    },
    [reader, refresh],
  );

  const value = useMemo<LabData>(
    () => ({ clients, reader, snapshot, refreshing, refresh, answer }),
    [clients, reader, snapshot, refreshing, refresh, answer],
  );
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

/** The Lab's data. Throws outside a {@link LabProvider}. */
export function useLab(): LabData {
  const value = useContext(LabContext);
  if (value === null) throw new Error("useLab: no LabProvider above this component");
  return value;
}
