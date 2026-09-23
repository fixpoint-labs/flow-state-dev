/**
 * `Roster` — the organization's seats, as the panel draws them (FIX-1477 S5).
 *
 * It reads the standing roster collection and lists what is in it. **Nothing
 * here filters by organization, and there is no prop to do it with** (BR-24):
 * the collection is organization-scoped at the store, so the read already
 * resolves against the session's own organization. A filter prop would be a
 * second opinion about a boundary the server already holds, and a filter that
 * silently does nothing is worse than none.
 *
 * **Skipped seats are shown, not only logged** (BR-20). A boot reload hands
 * back `{ seats, problems }` — the rows it could not turn into seats, named —
 * and that is a server-side return value with no path to a browser, so the
 * host passes it in. "The roster" and "what answers" are two numbers, and a
 * warning in a log is not a report.
 *
 * Nothing here publishes a class name and the package brings no CSS framework
 * or icon set; a host themes through the `--fsd-panel-*` custom properties and
 * fills its own affordances through slots.
 */
import { createElement, useMemo, type ReactNode } from "react";
import { createResourceClient } from "@flow-state-dev/client";
import { useFlowContext } from "../../context/FlowContext";
import { usePanelRows, type PanelRowSource } from "./reads";
import {
  bareList,
  headingStyle,
  labelStyle,
  note,
  noteStyle,
  panelStyle,
  retryLine,
  rowStyle
} from "./chrome";

/**
 * One seat, as the roster collection publishes it.
 *
 * The stored row carries a `settings` bag too; the collection's `expose`
 * deliberately withholds it, so this is the whole of what arrives.
 *
 * `instructions` is `string | null` and that is true of every row a consumer
 * is handed, including a row written before seats had instructions — those
 * arrive with the key absent and are normalised to `null` on the way in
 * (see `normalizeSeat`). So a slot may compare against `null` and trust it.
 */
export type RosterSeat = {
  readonly seatId: string;
  readonly flow: string;
  readonly instructions: string | null;
};

/** A seat row, plus the topic it was stored under. */
export type RosterSeatRow = {
  readonly topic: string;
  readonly seat: RosterSeat;
};

/** The parts of the roster that belong to the host rather than to the component. */
export type RosterSlots = {
  /** Beside a seat's name — the host's own affordances, never the component's. */
  readonly rowTrailing?: (row: RosterSeatRow) => ReactNode;
  /** What an empty roster says, when the host would rather say it itself. */
  readonly empty?: () => ReactNode;
};

export type RosterProps = {
  /** The session the read is addressed to. Its organization is the one read. */
  readonly sessionId: string;
  /**
   * The key the session's flow declares the roster collection under.
   *
   * One path segment, so it carries no slash — `roster`, never
   * `workforce/roster`, which is the collection's storage PATTERN and a
   * different thing.
   */
  readonly collectionRef?: string;
  /**
   * Seats a boot reload could not restore, in the dialect the reload returns
   * them (BR-20). Held by the host, because the reload is a server-side call
   * whose result never crosses to a browser on its own.
   */
  readonly problems?: readonly string[];
  /**
   * The host's own resource client, so the read carries the host's transport
   * and its credential (BR-29).
   *
   * Pass a STABLE reference — one held in a context or a `useMemo`, not an
   * object literal built during render. The read is fenced on the client it
   * was made through, which is what makes a rebuilt client discard the
   * previous backend's rows; a fresh object every render reads as a rebuilt
   * client every render.
   */
  readonly resourceClient?: PanelRowSource;
  /**
   * Seats to request per page. The panel reads every page regardless — this
   * sets the size of each fetch, not a cap on what renders (BR-19).
   */
  readonly limit?: number;
  readonly slots?: RosterSlots;
};

/**
 * The published prop names, as a value.
 *
 * Kept so the allow-list can be asserted rather than described. The type test
 * beside it proves this list and `keyof RosterProps` are the same set, so
 * adding an `orgId` — or any other spelling of "filter this for me" — fails
 * whether or not whoever added it remembered this array (BR-24, V5).
 */
export const rosterPropNames = [
  "collectionRef",
  "limit",
  "problems",
  "resourceClient",
  "sessionId",
  "slots"
] as const;

/** The conventional key a flow declares the roster under. */
const DEFAULT_ROSTER_REF = "roster";

function isSeat(value: unknown): value is RosterSeat {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.seatId === "string" && typeof row.flow === "string";
}

/**
 * Make a stored row match the declared shape, which for now means one field.
 *
 * `instructions` is declared `string | null`, and a row written before seats
 * had instructions does not carry the key at all — the projection copies only
 * the keys a row has, so it arrives ABSENT rather than null (BP-030, and
 * BP-035's null boundary). A slot consumer trusting the declared type would
 * write `if (seat.instructions !== null) seat.instructions.trim()` and throw
 * on the oldest rows in the store. Normalising here means the type is true of
 * every row a consumer can be handed, rather than true of recent ones.
 */
function normalizeSeat(row: RosterSeat): RosterSeat {
  return row.instructions === undefined ? { ...row, instructions: null } : row;
}

export function Roster(props: RosterProps): ReactNode {
  const {
    sessionId,
    collectionRef = DEFAULT_ROSTER_REF,
    problems,
    resourceClient,
    limit,
    slots = {}
  } = props;

  const context = useFlowContext();
  const baseUrl = context.baseUrl;
  // Only built when the host supplied none. A host with an authenticating
  // deployment passes its own; this default is the unauthenticated case.
  const fallback = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);
  const source = resourceClient ?? fallback;

  const state = usePanelRows<unknown>(
    source,
    sessionId,
    collectionRef,
    limit,
    "Failed to load the roster"
  );

  // A row whose shape the component cannot read is dropped rather than
  // rendered blank, and the count below says so — the same rule the boot
  // reload applies to a row it cannot turn into a seat.
  const seats = useMemo(
    () =>
      state.rows
        .filter((row): row is { topic: string; clientData: RosterSeat } => isSeat(row.clientData))
        .map((row) => ({ topic: row.topic, seat: normalizeSeat(row.clientData) })),
    [state.rows]
  );
  const unreadable = state.rows.length - seats.length;

  const body =
    state.error !== null
      ? retryLine(state.error, state.refresh)
      : state.isLoading && state.rows.length === 0
        ? note("loading", "Loading the roster…")
        : seats.length === 0
          ? (slots.empty?.() ?? note("empty", "No seats have been hired in this organization yet."))
          : createElement(
              "ul",
              { style: bareList, "data-roster-seats": String(seats.length) },
              ...seats.map((row) =>
                createElement(
                  "li",
                  { key: row.topic, style: rowStyle, "data-seat-id": row.seat.seatId },
                  createElement("span", { style: labelStyle }, row.seat.seatId),
                  createElement(
                    "span",
                    { style: { flexShrink: 0, color: "var(--fsd-panel-muted-fg, inherit)" } },
                    row.seat.flow
                  ),
                  slots.rowTrailing?.(row) ?? null
                )
              )
            );

  // Two numbers, side by side and never merged: what answers, and what was
  // skipped. A roster that reported only the first would look complete.
  const skipped = problems ?? [];
  const problemBlock =
    skipped.length === 0 && unreadable === 0
      ? null
      : createElement(
          "section",
          { "data-roster-problems": String(skipped.length + unreadable), style: { marginTop: 8 } },
          createElement(
            "h4",
            { style: headingStyle },
            `${skipped.length + unreadable} seat${skipped.length + unreadable === 1 ? "" : "s"} could not be loaded`
          ),
          createElement(
            "ul",
            { style: bareList },
            ...skipped.map((problem, index) =>
              createElement("li", { key: `problem-${index}`, style: noteStyle }, problem)
            ),
            unreadable > 0
              ? createElement(
                  "li",
                  { key: "unreadable", style: noteStyle },
                  `${unreadable} stored row${unreadable === 1 ? "" : "s"} did not match the seat shape this version reads.`
                )
              : null
          )
        );

  return createElement("div", { style: panelStyle, "data-panel": "roster" }, body, problemBlock);
}
