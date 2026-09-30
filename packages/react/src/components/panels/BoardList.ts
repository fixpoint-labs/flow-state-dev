/**
 * `BoardList` — one board's rows as a single list, newest first, each with
 * its status word (FIX-1622 S1).
 *
 * The same read as `BoardColumns` (`reads.ts`), the same card guard and
 * legacy-status mapping, the same chrome; only the drawing differs. It mints
 * no status vocabulary: the word shown is the task status as written, so a
 * status this version does not know still shows, as its own word, and no row
 * is hidden whatever its status.
 *
 * With `live`, the list follows the session it reads through and reads the
 * board again whenever that session keeps a change to it. A change kept in any
 * other session shows on the list's next read. The rows drawn are always the
 * read's, never a change's own payload.
 *
 * Loading, empty and a failed read are three different renders.
 */
import { createElement, useMemo, type ReactNode } from "react";
import { createResourceClient, type ClientFetch } from "@flow-state-dev/client";
import { useFlowContext } from "../../context/FlowContext";
import { cardRows, type BoardCard, type BoardCardRow } from "./cards";
import { usePanelRows, type PanelRowSource } from "./reads";
import { bareList, labelStyle, note, panelStyle, retryLine, rowStyle } from "./chrome";

/** The parts of a board list that belong to the host rather than to the component. */
export type BoardListSlots = {
  /**
   * A row's body, when a host wants its own.
   *
   * **The body, not the row.** The list renders the `<li>` and puts the task's
   * id on it; return what goes inside one.
   */
  readonly row?: (row: BoardCardRow) => ReactNode;
  /** What a board holding no rows at all says. */
  readonly empty?: () => ReactNode;
};

type BoardListCommonProps = {
  /** The session the read is addressed to, and, with `live`, the one the list follows. */
  readonly sessionId: string;
  /**
   * The key the session's flow declares this board's ledger under. One path
   * segment, so it carries no slash.
   */
  readonly boardRef: string;
  /**
   * Rows to request per page: the size of each fetch, not a cap on what
   * renders. The list follows the cursor for up to 1,000 pages; a collection
   * with pages left after that shows the error line and Retry, never the
   * rows read so far. See `usePanelRows`.
   */
  readonly limit?: number;
  readonly slots?: BoardListSlots;
};

/**
 * What reads the board, and what the live stream is sent with.
 *
 * - `resourceClient`: the host's own resource client, so the read carries the
 *   host's transport and its credential. Pass a STABLE reference.
 * - `fetcher`: the `fetch` the live stream is sent with, and the read too when
 *   no `resourceClient` is passed. Pass the one the `resourceClient` was built
 *   with, so the stream carries the same credential as the read. Stable, too.
 * - `baseUrl`: the origin the live stream is sent to, and the read too when no
 *   `resourceClient` is passed. Defaults to the nearest `FlowProvider`'s. A
 *   host whose `resourceClient` reads another origin passes that origin here,
 *   so the stream follows the session on the server the board is read from.
 * - `live`: read the board again whenever the session keeps a change to it.
 *
 * A host that passes its own `resourceClient` and asks for `live` has to pass
 * `fetcher` as well: a stream sent without the read's credential is refused,
 * and a refused stream leaves the list reading once, with no error. Passing
 * neither sends both with the plain `fetch`, to `baseUrl` when it is given and
 * the nearest `FlowProvider`'s otherwise. A `resourceClient` without `live`
 * reads through the client alone, so neither `fetcher` nor `baseUrl` has
 * anything to do there.
 */
type BoardListTransportProps =
  | {
      readonly resourceClient?: undefined;
      readonly fetcher?: ClientFetch;
      readonly baseUrl?: string;
      readonly live?: boolean;
    }
  | {
      readonly resourceClient: PanelRowSource;
      readonly fetcher: ClientFetch;
      readonly baseUrl?: string;
      readonly live?: boolean;
    }
  | {
      readonly resourceClient: PanelRowSource;
      readonly fetcher?: undefined;
      readonly baseUrl?: undefined;
      readonly live?: false;
    };

export type BoardListProps = BoardListCommonProps & BoardListTransportProps;

/**
 * The published prop names, as a value. Asserted against the type by the
 * type test beside it, so a new prop cannot go unlisted.
 */
export const boardListPropNames = [
  "baseUrl",
  "boardRef",
  "fetcher",
  "limit",
  "live",
  "resourceClient",
  "sessionId",
  "slots"
] as const;

/** When a card was created, if the board published it. */
function createdAtOf(card: BoardCard): number | undefined {
  const createdAt = (card as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : undefined;
}

/**
 * The cards newest first by `createdAt`; a row without one follows the dated
 * rows, in the order the read returned it.
 */
function newestFirst(rows: readonly BoardCardRow[]): BoardCardRow[] {
  const dated: Array<{ createdAt: number; row: BoardCardRow }> = [];
  const undated: BoardCardRow[] = [];
  for (const row of rows) {
    const createdAt = createdAtOf(row.card);
    if (createdAt === undefined) undated.push(row);
    else dated.push({ createdAt, row });
  }
  dated.sort((a, b) => b.createdAt - a.createdAt);
  return [...dated.map(({ row }) => row), ...undated];
}

const mutedStyle = { flexShrink: 0, color: "var(--fsd-panel-muted-fg, inherit)" } as const;

/** A row's default body: the columns' label, the status word, and the assignee when there is one. */
function defaultRowBody({ card }: BoardCardRow): ReactNode {
  return createElement(
    "div",
    { style: rowStyle },
    createElement("span", { style: labelStyle }, card.title ?? card.goal ?? card.id),
    createElement("span", { style: mutedStyle, "data-task-status": card.status }, card.status),
    card.assignee == null ? null : createElement("span", { style: mutedStyle }, card.assignee)
  );
}

export function BoardList(props: BoardListProps): ReactNode {
  const { sessionId, boardRef, resourceClient, fetcher, limit, live = false, slots = {} } = props;

  const providerBaseUrl = useFlowContext().baseUrl;
  const baseUrl = props.baseUrl ?? providerBaseUrl;
  const fallback = useMemo(() => createResourceClient({ baseUrl, fetcher }), [baseUrl, fetcher]);
  const source = resourceClient ?? fallback;

  const state = usePanelRows<unknown>(
    source,
    sessionId,
    boardRef,
    limit,
    "Failed to load this board",
    live ? { baseUrl, fetcher } : undefined
  );
  const rows = useMemo(() => newestFirst(cardRows(state.rows)), [state.rows]);

  if (state.error !== null) {
    return createElement(
      "div",
      { style: panelStyle, "data-panel": "board" },
      retryLine(state.error, state.refresh)
    );
  }
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
      slots.empty?.() ?? note("empty", "This board has no tasks.")
    );
  }

  return createElement(
    "div",
    { style: panelStyle, "data-panel": "board", "data-board-list": String(rows.length) },
    createElement(
      "ul",
      { style: bareList },
      // One `<li>` per row, whether the body is ours or the host's, with the
      // task's id on it either way.
      ...rows.map((row) =>
        createElement(
          "li",
          { key: row.topic, "data-task-id": row.card.id },
          slots.row === undefined ? defaultRowBody(row) : slots.row(row)
        )
      )
    )
  );
}
