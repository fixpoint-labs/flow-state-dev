/**
 * `WorkerDetail` — one worker's kind and instructions (FIX-1500 S5).
 *
 * **Kind costs no read.** It is a prop from the row the host already holds —
 * the navigator's flow listing — so opening a worker never re-fetches what the
 * rail already knew before it was clicked (BR-5).
 *
 * **Instructions are one item read**, `getCollectionItemState(sessionId,
 * collectionRef, workerId)`, through the same `client` seam and the
 * same credential-less fallback `Roster` and `BoardColumns` ship with
 * (BR-27). It reuses their fence (`usePanelItem`, in `reads.ts`) rather than
 * hand-rolling a third read primitive, and `Roster`'s own `isWorker` /
 * `normalizeWorker` so the list and this detail agree on what a worker row is and
 * on how a missing `instructions` value is treated.
 *
 * **A worker with no public roster row gets no read at all** (BR-31): when the
 * host passes no `workerId` — a worker declared in a `WORKER.md`, or one a user
 * hired for themselves — the instructions read is never mounted: mounting is
 * the gate, so no `workerId` means no hook and no request. The host, not this component,
 * decides whether a `workerId` names a public roster row; a user-owned address
 * is never handed in as if it were one, and this component never derives a
 * roster topic from an address itself — see the file this issue's PLAN calls
 * out under "Reuse": hand-splitting `<org>.~<user>.<id>` can produce a short
 * id that happens to equal a DIFFERENT, org-visible worker's key, which is
 * exactly the silent-partial failure BR-31 exists to rule out.
 *
 * **Five states, kept apart by `data-state`:** the instructions text, *none
 * given* (a hired worker with no instructions, BR-30), *not published* (no
 * public roster row, BR-31), still reading, and could not be read. The last
 * two collapsing into the first pair is the failure V10 is written against.
 *
 * Nothing here publishes a class name and the package brings no CSS framework
 * or icon set; a host themes through the `--fsd-panel-*` custom properties,
 * the same contract `Roster` and `BoardColumns` theme under.
 */
import { createElement, type ReactNode } from "react";
import { usePanelItem, type PanelItemSource } from "./reads";
import { usePanelSource } from "./usePanelSource";
import { DEFAULT_ROSTER_REF, isWorker, normalizeWorker, type RosterWorker } from "./Roster";
import { note, noteStyle, panelStyle, retryLine } from "./chrome";

export type WorkerDetailProps = {
  /** The session the read is addressed to. Its organization is the one read. */
  readonly sessionId: string;
  /**
   * The worker's kind, from the row the host already holds (a navigator row).
   * Rendered as given; this component never reads it.
   */
  readonly kind: string;
  /**
   * The roster topic to read instructions from — pass this ONLY for a worker
   * with a public, org-visible roster row.
   *
   * Leave it out for a worker declared in a `WORKER.md`, or one hired as a
   * user's own: this component then shows "not published" and makes no read
   * (BR-31). Never pass a full address (`<org>.~<user>.<id>` or
   * `<org>.<workerId>`) here — this is a roster TOPIC, the same string
   * `Roster`'s rows carry as `workerId`.
   */
  readonly workerId?: string;
  /**
   * The key the session's flow declares the roster collection under. One
   * path segment, so it carries no slash — see `RosterProps.collectionRef`.
   */
  readonly collectionRef?: string;
  /**
   * The host's own client, so the read carries the host's transport
   * and its credential (BR-27). Pass a STABLE reference — see `Roster`.
   */
  readonly client?: PanelItemSource;
};

/**
 * The instructions region alone, mounted only while there is a topic to read.
 *
 * Mounting IS the gate: `WorkerDetail` renders this only when `workerId` is
 * given, so a worker with no public roster row never calls `usePanelItem` at
 * all — there is no "read, then ignore the result" step to get wrong.
 */
function Instructions(props: {
  readonly sessionId: string;
  readonly collectionRef: string;
  readonly workerId: string;
  readonly source: PanelItemSource;
}): ReactNode {
  const { sessionId, collectionRef, workerId, source } = props;
  const state = usePanelItem<RosterWorker>(
    source,
    sessionId,
    collectionRef,
    workerId,
    "Failed to load this worker's instructions"
  );

  if (state.error !== null) return retryLine(state.error, state.refresh);
  if (state.isLoading) return note("loading", "Loading this worker's instructions…");

  // A row this version cannot read is treated like a read that failed, not
  // like a worker with nothing to show — it DID answer, just not with a worker.
  if (state.item !== null && !isWorker(state.item)) {
    return note("error", "This worker's instructions could not be read.");
  }

  const worker = state.item === null ? null : normalizeWorker(state.item);
  if (worker === null) return note("not-published", "This worker's instructions are not published.");
  if (worker.instructions === null) return note("none", "No instructions were given.");
  return createElement("p", { style: noteStyle, "data-state": "text" }, worker.instructions);
}

export function WorkerDetail(props: WorkerDetailProps): ReactNode {
  const { sessionId, kind, workerId, collectionRef = DEFAULT_ROSTER_REF, client } = props;

  const source = usePanelSource(client);

  return createElement(
    "div",
    { style: panelStyle, "data-panel": "worker-detail" },
    createElement("p", { style: noteStyle, "data-worker-kind": kind }, kind),
    // An empty string is not a topic to read — treat it the same as no
    // `workerId` at all: not published, zero reads (Cursor nit).
    workerId === undefined || workerId === ""
      ? note("not-published", "This worker's instructions are not published.")
      : createElement(Instructions, { sessionId, collectionRef, workerId, source })
  );
}
