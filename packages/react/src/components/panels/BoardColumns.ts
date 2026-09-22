/**
 * `BoardColumns` — one board's rows, grouped by status (FIX-1477 S6).
 *
 * **No status vocabulary is minted here** (BR-21). The columns are the task
 * statuses the substrate already has, in the order work moves through them,
 * and a row carrying a status this list does not know gets its own column at
 * the end rather than disappearing — a card that renders nowhere is the one
 * failure a column layout can have silently.
 *
 * **An empty board states the likely cause rather than spinning** (BR-22).
 * Board wiring is explicit per seat, so the ordinary reason a board is empty
 * is that nothing drains it — and a spinner in that spot reads as "still
 * loading", which is the wrong thing to tell somebody whose board is simply
 * not wired up. Loading and empty are therefore two different renders, and the
 * test beside this file holds them apart.
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
 * The statuses a board column is drawn for, in the order work moves through
 * them.
 *
 * These are the substrate's own — `@flow-state-dev/orchestration`'s
 * `taskStatusSchema` — listed rather than imported, because `react` takes only
 * `client`, `contracts` and `core` and a column layout is not worth a fourth
 * dependency. Listing them is safe in the one way that matters: an unknown
 * status still renders, in its own column, so this list going stale costs a
 * column's position and never a hidden row.
 */
export const BOARD_STATUS_COLUMNS = [
  "pending",
  "in_progress",
  "blocked",
  "parked",
  "completed",
  "errored",
  "cancelled"
] as const;

export type BoardStatus = (typeof BOARD_STATUS_COLUMNS)[number];

/**
 * One row as a board publishes it.
 *
 * The stored envelope carries far more — the claim, the lease, the retry
 * ledger, the write log — and the collection's `expose` withholds all of it,
 * so this is the whole of what arrives. Every field but `id` and `status` is
 * optional, because a task that has not been titled, assigned or failed simply
 * has not got one (BP-030): read each through a `== null` guard.
 */
export type BoardCard = {
  readonly id: string;
  readonly status: string;
  readonly title?: string;
  readonly goal?: string;
  readonly assignee?: string;
  readonly error?: string;
};

/** A card, plus the topic it was stored under. */
export type BoardCardRow = {
  readonly topic: string;
  readonly card: BoardCard;
};

/** One column, as a slot is handed it. */
export type BoardColumn = {
  readonly status: string;
  /** True when the status is not one this version knows — see the file header. */
  readonly isUnknown: boolean;
  readonly rows: readonly BoardCardRow[];
};

/** The parts of a board that belong to the host rather than to the component. */
export type BoardColumnsSlots = {
  /**
   * A card's body, when a host wants its own.
   *
   * **The body, not the row.** The column renders the `<li>` and puts the
   * task's id on it; return what goes inside one. Returning an `<li>` of your
   * own nests a list item inside a list item, which is invalid markup that
   * keyboard and assistive-technology traversal cannot represent.
   */
  readonly card?: (row: BoardCardRow) => ReactNode;
  /** Beside a column's heading. */
  readonly columnHeader?: (column: BoardColumn) => ReactNode;
  /** What a board holding no rows at all says. */
  readonly empty?: () => ReactNode;
};

export type BoardColumnsProps = {
  /** The session the read is addressed to. Its organization is the one read. */
  readonly sessionId: string;
  /**
   * The key the session's flow declares this board's ledger under — the minted
   * `<channelId>.<boardName>`. One path segment, so it carries no slash.
   */
  readonly boardRef: string;
  /**
   * The host's own resource client, so the read carries the host's transport
   * and its credential (BR-29). Pass a STABLE reference — see `Roster`.
   */
  readonly resourceClient?: PanelRowSource;
  /** Most rows to read in one page. */
  readonly limit?: number;
  readonly slots?: BoardColumnsSlots;
};

/**
 * The published prop names, as a value.
 *
 * Asserted rather than described, by the type test beside it — so an `orgId`,
 * or any other spelling of a filter the stack cannot honour, fails whether or
 * not whoever added it remembered this array (BR-24, V5).
 */
export const boardColumnsPropNames = [
  "boardRef",
  "limit",
  "resourceClient",
  "sessionId",
  "slots"
] as const;

const KNOWN = new Set<string>(BOARD_STATUS_COLUMNS);

function isCard(value: unknown): value is BoardCard {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.status === "string";
}

/**
 * Group rows into columns: every known status in order, then any status the
 * rows carried that this version does not know.
 *
 * Exported for its test — the grouping is where a row can be lost, and that is
 * cheaper to assert directly than through a rendered DOM.
 */
export function groupIntoColumns(rows: readonly BoardCardRow[]): BoardColumn[] {
  const byStatus = new Map<string, BoardCardRow[]>();
  for (const row of rows) {
    const bucket = byStatus.get(row.card.status);
    if (bucket === undefined) byStatus.set(row.card.status, [row]);
    else bucket.push(row);
  }

  const columns: BoardColumn[] = BOARD_STATUS_COLUMNS.map((status) => ({
    status,
    isUnknown: false,
    rows: byStatus.get(status) ?? []
  }));
  for (const [status, bucket] of byStatus) {
    if (KNOWN.has(status)) continue;
    columns.push({ status, isUnknown: true, rows: bucket });
  }
  return columns;
}

/**
 * A card's default body — the contents of its row, never the row itself.
 *
 * The `<li>` belongs to the column, for both this and a host's `slots.card`,
 * so the two paths cannot disagree about who owns it. See
 * {@link BoardColumnsSlots.card}.
 */
function defaultCardBody(row: BoardCardRow): ReactNode {
  const { card } = row;
  return createElement(
    "div",
    { style: rowStyle },
    createElement("span", { style: labelStyle }, card.title ?? card.goal ?? card.id),
    card.assignee == null
      ? null
      : createElement(
          "span",
          { style: { flexShrink: 0, color: "var(--fsd-panel-muted-fg, inherit)" } },
          card.assignee
        )
  );
}

export function BoardColumns(props: BoardColumnsProps): ReactNode {
  const { sessionId, boardRef, resourceClient, limit, slots = {} } = props;

  const context = useFlowContext();
  const baseUrl = context.baseUrl;
  const fallback = useMemo(() => createResourceClient({ baseUrl }), [baseUrl]);
  const source = resourceClient ?? fallback;

  const state = usePanelRows<unknown>(
    source,
    sessionId,
    boardRef,
    limit,
    "Failed to load this board"
  );

  const rows = useMemo(
    () =>
      state.rows
        .filter((row): row is { topic: string; clientData: BoardCard } => isCard(row.clientData))
        .map((row) => ({ topic: row.topic, card: row.clientData })),
    [state.rows]
  );
  const columns = useMemo(() => groupIntoColumns(rows), [rows]);

  if (state.error !== null) {
    return createElement(
      "div",
      { style: panelStyle, "data-panel": "board" },
      retryLine(state.error, state.refresh)
    );
  }

  // Loading and empty are two different renders, and this is the branch that
  // keeps them apart. A board with nothing on it is the ordinary state of a
  // board nothing drains, so it says that rather than spinning at somebody.
  if (state.isLoading && state.rows.length === 0) {
    return createElement(
      "div",
      { style: panelStyle, "data-panel": "board" },
      note("loading", "Loading this board…")
    );
  }
  if (rows.length === 0) {
    return createElement(
      "div",
      { style: panelStyle, "data-panel": "board" },
      slots.empty?.() ??
        note(
          "empty",
          "This board has no rows. Boards are wired to a seat explicitly, so the likely reason is that nothing drains this one yet."
        )
    );
  }

  return createElement(
    "div",
    {
      style: { ...panelStyle, display: "flex", gap: 8, alignItems: "flex-start" },
      "data-panel": "board",
      "data-board-columns": String(columns.length)
    },
    ...columns.map((column) =>
      createElement(
        "section",
        {
          key: column.status,
          "data-column": column.status,
          ...(column.isUnknown ? { "data-column-unknown": "true" } : {}),
          style: { flex: 1, minWidth: 0 }
        },
        createElement(
          "div",
          { style: { display: "flex", alignItems: "center" } },
          createElement("h4", { style: headingStyle }, `${column.status} (${column.rows.length})`),
          slots.columnHeader?.(column) ?? null
        ),
        column.rows.length === 0
          ? createElement("p", { style: noteStyle, "data-column-empty": "true" }, "Nothing here")
          : createElement(
              "ul",
              { style: bareList },
              // One `<li>` per row, written once, whether the body is ours or
              // the host's — so a custom card cannot end up nested inside a
              // row it also rendered, and `data-task-id` is on the row either
              // way rather than only when the default body drew it.
              ...column.rows.map((row) =>
                createElement(
                  "li",
                  { key: row.topic, "data-task-id": row.card.id },
                  slots.card === undefined ? defaultCardBody(row) : slots.card(row)
                )
              )
            )
      )
    )
  );
}
