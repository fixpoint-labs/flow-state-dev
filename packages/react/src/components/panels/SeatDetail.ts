/**
 * `SeatDetail` — one seat's kind and instructions (FIX-1500 S5).
 *
 * **Kind costs no read.** It is a prop from the row the host already holds —
 * the navigator's flow listing — so opening a seat never re-fetches what the
 * rail already knew before it was clicked (BR-5).
 *
 * **Instructions are one item read**, `getCollectionItemState(sessionId,
 * collectionRef, seatId)`, through the same `resourceClient` seam and the
 * same credential-less fallback `Roster` and `BoardColumns` ship with
 * (BR-27). It reuses their fence (`usePanelItem`, in `reads.ts`) rather than
 * hand-rolling a third read primitive, and `Roster`'s own `isSeat` /
 * `normalizeSeat` so the list and this detail agree on what a seat row is and
 * on how a missing `instructions` value is treated.
 *
 * **A seat with no public roster row gets no read at all** (BR-31): when the
 * host passes no `seatId` — a seat declared in a `WORKER.md`, or one a user
 * hired for themselves — the instructions read is never mounted. "Mounting is
 * the gate" is the same rule `FlowNavigator`'s `LeafSessionList` already
 * uses: no open leaf, no hook, no request. The host, not this component,
 * decides whether a `seatId` names a public roster row; a user-owned address
 * is never handed in as if it were one, and this component never derives a
 * roster topic from an address itself — see the file this issue's PLAN calls
 * out under "Reuse": hand-splitting `<org>.~<user>.<id>` can produce a short
 * id that happens to equal a DIFFERENT, org-visible seat's key, which is
 * exactly the silent-partial failure BR-31 exists to rule out.
 *
 * **Five states, kept apart by `data-state`:** the instructions text, *none
 * given* (a hired seat with no instructions, BR-30), *not published* (no
 * public roster row, BR-31), still reading, and could not be read. The last
 * two collapsing into the first pair is the failure V10 is written against.
 *
 * Nothing here publishes a class name and the package brings no CSS framework
 * or icon set; a host themes through the `--fsd-panel-*` custom properties,
 * the same contract `Roster` and `BoardColumns` theme under.
 */
import { createElement, useMemo, type ReactNode } from "react";
import { createResourceClient } from "@flow-state-dev/client";
import { useFlowContext } from "../../context/FlowContext";
import { usePanelItem, type PanelItemSource } from "./reads";
import { isSeat, normalizeSeat, type RosterSeat } from "./Roster";
import { note, noteStyle, panelStyle, retryLine } from "./chrome";

export type SeatDetailProps = {
  /** The session the read is addressed to. Its organization is the one read. */
  readonly sessionId: string;
  /**
   * The seat's kind, from the row the host already holds (a navigator row).
   * Rendered as given; this component never reads it.
   */
  readonly kind: string;
  /**
   * The roster topic to read instructions from — pass this ONLY for a seat
   * with a public, org-visible roster row.
   *
   * Leave it out for a seat declared in a `WORKER.md`, or one hired as a
   * user's own: this component then shows "not published" and makes no read
   * (BR-31). Never pass a full address (`<org>.~<user>.<id>` or
   * `<org>.<seatId>`) here — this is a roster TOPIC, the same string
   * `Roster`'s rows carry as `seatId`.
   */
  readonly seatId?: string;
  /**
   * The key the session's flow declares the roster collection under. One
   * path segment, so it carries no slash — see `RosterProps.collectionRef`.
   */
  readonly collectionRef?: string;
  /**
   * The host's own resource client, so the read carries the host's transport
   * and its credential (BR-27). Pass a STABLE reference — see `Roster`.
   */
  readonly resourceClient?: PanelItemSource;
};

/** The conventional key a flow declares the roster under — matches `Roster`'s default. */
const DEFAULT_ROSTER_REF = "roster";

/**
 * The instructions region alone, mounted only while there is a topic to read.
 *
 * Mounting IS the gate: `SeatDetail` renders this only when `seatId` is
 * given, so a seat with no public roster row never calls `usePanelItem` at
 * all — there is no "read, then ignore the result" step to get wrong.
 */
function Instructions(props: {
  readonly sessionId: string;
  readonly collectionRef: string;
  readonly seatId: string;
  readonly source: PanelItemSource;
}): ReactNode {
  const { sessionId, collectionRef, seatId, source } = props;
  const state = usePanelItem<unknown>(
    source,
    sessionId,
    collectionRef,
    seatId,
    "Failed to load this seat's instructions"
  );

  if (state.error !== null) return retryLine(state.error, state.refresh);
  if (state.isLoading) return note("loading", "Loading this seat's instructions…");

  // A row this version cannot read is treated like a read that failed, not
  // like a seat with nothing to show — it DID answer, just not with a seat.
  if (state.item !== null && !isSeat(state.item)) {
    return note("error", "This seat's instructions could not be read.");
  }

  const seat = state.item === null ? null : normalizeSeat(state.item as RosterSeat);
  if (seat === null) return note("not-published", "This seat's instructions are not published.");
  if (seat.instructions === null) return note("none", "No instructions were given.");
  return createElement("p", { style: noteStyle, "data-state": "text" }, seat.instructions);
}

export function SeatDetail(props: SeatDetailProps): ReactNode {
  const { sessionId, kind, seatId, collectionRef = DEFAULT_ROSTER_REF, resourceClient } = props;

  const context = useFlowContext();
  const baseUrl = context.baseUrl;
  // Only built when the host supplied none — the unauthenticated case, same
  // as `Roster` and `BoardColumns`.
  const fallback = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);
  const source = resourceClient ?? fallback;

  return createElement(
    "div",
    { style: panelStyle, "data-panel": "seat-detail" },
    createElement("p", { style: noteStyle, "data-seat-kind": kind }, kind),
    seatId === undefined
      ? note("not-published", "This seat's instructions are not published.")
      : createElement(Instructions, { sessionId, collectionRef, seatId, source })
  );
}
