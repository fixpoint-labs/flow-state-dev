/**
 * Arranging a flow's sessions so a dispatch run reads under what started it
 * (FIX-1440).
 *
 * A dispatch run is an ordinary session of the flow that a dispatcher started
 * rather than a person. It carries `parentSessionId`, and that is the whole of
 * what is drawn here: the run is placed after the session that started it and
 * indented **one level**.
 *
 * ## One level, and it is a view
 *
 * A run started by another run indents **once**, beside its own parent — never
 * twice. There is no second level, no breadcrumb and nothing to open: the list
 * stays one flat session list that happens to show where a row came from. The
 * moment this recurses into levels it is a tree to navigate again, which is the
 * shape this replaced.
 *
 * ## Nothing here fetches
 *
 * The arrangement is computed from the rows the listing already returned. A run
 * whose parent is not among them renders at the left margin with its provenance
 * intact — the parent is not fetched to draw a line to it, because one page of a
 * session list is not a guarantee about what else exists.
 */
import type { SessionSummary } from "@flow-state-dev/client";

/** One row of the arranged list. */
export type SessionRow = {
  readonly session: SessionSummary;
  /** `0` for a session in its own right, `1` for a dispatch run shown under its parent. */
  readonly depth: 0 | 1;
  /**
   * The session that started this one, when this row is a dispatch run.
   * Present whether or not that session is in the listing — absence of the
   * parent changes where the row is drawn, never what it is.
   */
  readonly parentSessionId?: string;
};

/** How deep a dispatch run is drawn. One level, by rule — see the file header. */
const RUN_DEPTH = 1;

/**
 * Order a leaf's sessions for display, placing each dispatch run under the
 * session that started it.
 *
 * Rows the listing returned in an order stay in that order among themselves:
 * top-level sessions keep the server's ordering, and a parent's runs keep it
 * among each other. A run whose parent is absent from the listing is a top-level
 * row here — drawn where the server put it, and still labelled as a run.
 *
 * `== null` throughout, not a truthiness check: a store that nulls absent keys
 * hands back `null` where an older record reads `undefined`, and both mean
 * "nobody dispatched this" (BP-030).
 */
export function arrangeSessionRows(
  sessions: readonly SessionSummary[]
): readonly SessionRow[] {
  const present = new Set(sessions.map((session) => session.id));
  const runsByParent = new Map<string, SessionSummary[]>();
  const roots: SessionSummary[] = [];

  for (const session of sessions) {
    const parent = session.parentSessionId ?? undefined;
    // Its own parent is not a place to hang it, and neither is a parent the
    // listing does not hold. Both read as a row of its own.
    if (parent === undefined || parent === session.id || !present.has(parent)) {
      roots.push(session);
      continue;
    }
    const siblings = runsByParent.get(parent);
    if (siblings === undefined) runsByParent.set(parent, [session]);
    else siblings.push(session);
  }

  const rows: SessionRow[] = [];
  // Every row is emitted exactly once. A record whose parent chain loops has no
  // root to hang under, so without this it would either repeat forever or —
  // worse, because it is silent — vanish from the list. The engine cannot write
  // one, a run's id being derived from its parent, but this renders whatever
  // the store hands back.
  const emitted = new Set<string>();

  const emitRuns = (parentId: string): void => {
    for (const run of runsByParent.get(parentId) ?? []) {
      if (emitted.has(run.id)) continue;
      emitted.add(run.id);
      rows.push({
        session: run,
        depth: RUN_DEPTH,
        parentSessionId: parentId
      });
      // Flattened deliberately: a run started by a run follows its own parent
      // and sits at the SAME indent. This is the line between showing the
      // hierarchy and building one.
      emitRuns(run.id);
    }
  };

  const emitRoot = (session: SessionSummary): void => {
    emitted.add(session.id);
    const parent = session.parentSessionId ?? undefined;
    rows.push({
      session,
      depth: 0,
      ...(parent === undefined ? {} : { parentSessionId: parent })
    });
    emitRuns(session.id);
  };

  for (const session of roots) {
    if (!emitted.has(session.id)) emitRoot(session);
  }

  // Whatever the two passes above could not reach — a cycle's members, which
  // are nobody's root. Drawn at the left margin, in the order the server sent
  // them, so a corrupt edge costs the indent and never the row.
  for (const session of sessions) {
    if (!emitted.has(session.id)) emitRoot(session);
  }

  return rows;
}
