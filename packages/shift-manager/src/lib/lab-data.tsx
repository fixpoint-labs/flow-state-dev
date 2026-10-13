/**
 * The one snapshot every surface draws from, and when it is read again.
 *
 * S3's contract: a refresh on boot, on an organization switch, after a
 * successful answer to an ask, again once that run stops, after each line
 * the chief of staff takes (its turn may have created a project or hired a
 * worker), and on Retry. Never on a route or tab change, so moving around
 * the app costs no reads. Inbox, the Stream's asks, the sidebar counts and
 * the Tasks list all come from the same snapshot.
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
  /**
   * The session of the latest ask answered here, with a count that moves once
   * the answer lands and again once the run it resumed stops running.
   * `undefined` before any answer.
   */
  answered: { sessionId: string; count: number } | undefined;
};

/** How often, and how many times, an answered request's status is read while it runs on. */
const SETTLE_POLL_MS = 1_000;
const SETTLE_POLLS = 130;
/** Polls a request may still read `suspended` right after its answer, before that counts as stopped again. */
const RESUME_GRACE_POLLS = 3;

/**
 * Wait until the request an answer resumed stops running. A read that fails
 * ends the wait: the snapshot read after it says what it can.
 */
async function settled(clients: LabClients, flowId: string, requestId: string): Promise<void> {
  for (let poll = 0; poll < SETTLE_POLLS; poll += 1) {
    let status: string;
    try {
      status = (await clients.actions(flowId).getRequestStatus(requestId)).status;
    } catch {
      return;
    }
    if (status !== "in_progress" && (status !== "suspended" || poll >= RESUME_GRACE_POLLS)) return;
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));
  }
}

const LabContext = createContext<LabData | null>(null);

/** Hold the snapshot for `clients`. */
export function LabProvider({ clients, children }: { clients: LabClients; children: ReactNode }) {
  const reader = useMemo(() => createLabReader(clients), [clients]);
  const [snapshot, setSnapshot] = useState<LabSnapshot | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [answered, setAnswered] = useState<LabData["answered"]>(undefined);
  const bump = useCallback((sessionId: string) => setAnswered((last) => ({ sessionId, count: (last?.count ?? 0) + 1 })), []);
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
      bump(ask.sessionId);
      await refresh();
      // The run goes on without this page: follow it, so what it did with the answer is drawn too.
      if (ask.flowId !== null) {
        void settled(clients, ask.flowId, ask.item.requestId).then(() => {
          bump(ask.sessionId);
          void refresh();
        });
      }
    },
    [clients, reader, refresh, bump],
  );

  const value = useMemo<LabData>(
    () => ({ clients, reader, snapshot, refreshing, refresh, answer, answered }),
    [clients, reader, snapshot, refreshing, refresh, answer, answered],
  );
  return <LabContext.Provider value={value}>{children}</LabContext.Provider>;
}

/** The Lab's data. Throws outside a {@link LabProvider}. */
export function useLab(): LabData {
  const value = useContext(LabContext);
  if (value === null) throw new Error("useLab: no LabProvider above this component");
  return value;
}
