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
import { isCard, migrateCardStatus, type BoardCardRow } from "./BoardColumns";
import { usePanelRows, type PanelRow, type PanelRowSource } from "./reads";
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
  /** Rows to request per page. The list reads every page regardless. */
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
 * - `live`: read the board again whenever the session keeps a change to it.
 *
 * A host that passes its own `resourceClient` and asks for `live` has to pass
 * `fetcher` as well: a stream sent without the read's credential is refused,
 * and a refused stream leaves the list reading once, with no error. Passing
 * neither sends both through the nearest `FlowProvider`'s `baseUrl` with the
 * plain `fetch`.
 */
type BoardListTransportProps =
  | {
      readonly resourceClient?: undefined;
      readonly fetcher?: ClientFetch;
      readonly live?: boolean;
    }
  | {
      readonly resourceClient: PanelRowSource;
      readonly fetcher: ClientFetch;
      readonly live?: boolean;
    }
  | {
      readonly resourceClient: PanelRowSource;
      readonly fetcher?: undefined;
      readonly live?: false;
    };

export type BoardListProps = BoardListCommonProps & BoardListTransportProps;

/**
 * The published prop names, as a value. Asserted against the type by the
 * type test beside it, so a new prop cannot go unlisted.
 */
export const boardListPropNames = [
  "boardRef",
  "fetcher",
  "limit",
  "live",
  "resourceClient",
  "sessionId",
  "slots"
] as const;

/** When a row was created, if the board published it. */
function createdAtOf(clientData: unknown): number | undefined {
  const createdAt = (clientData as { createdAt?: unknown }).createdAt;
  return typeof createdAt === "number" && Number.isFinite(createdAt) ? createdAt : undefined;
}

/**
 * Every card the read returned, newest first by `createdAt`; a row without
 * one follows the dated rows, in the order the read returned it.
 */
function newestFirst(rows: readonly PanelRow[]): BoardCardRow[] {
  const dated: Array<{ createdAt: number; row: BoardCardRow }> = [];
  const undated: BoardCardRow[] = [];
  for (const { topic, clientData } of rows) {
    if (!isCard(clientData)) continue;
    const row = { topic, card: migrateCardStatus(clientData) };
    const createdAt = createdAtOf(clientData);
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

  const baseUrl = useFlowContext().baseUrl;
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
  const rows = useMemo(() => newestFirst(state.rows), [state.rows]);

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
