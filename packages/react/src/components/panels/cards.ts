/**
 * A board's rows as cards: the shape a board publishes, the guard that tells a
 * card from anything else a read returns, and the one legacy status mapping.
 * Shared by `BoardColumns` and `BoardList`, so the two draw the same cards
 * from the same read.
 */
import type { PanelRow } from "./reads";

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

/**
 * The status `awaiting_review` shipped as `parked` (FIX-1245).
 *
 * The substrate maps it forward at its own read boundary, but a client read
 * does not pass through that boundary: the collection route projects the
 * stored row and the task collection's `withMigratedStatus` never runs. So a
 * row persisted before the rename arrives here still carrying the old word,
 * and without this it would be treated as a status this version does not
 * know — earning its own column beside `parked` rather than landing in it.
 *
 * `packages/ui/registry/components/task-plan-state.ts` carries the same
 * mapping for the other renderer, at the same kind of fold and for the same
 * reason. This matches it rather than inventing a second spelling. A row
 * written after the rename allocates nothing.
 */
const LEGACY_PARKED_STATUS = "awaiting_review";

/** Whether a row read off a board has the fields every card has. */
export function isCard(value: unknown): value is BoardCard {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.status === "string";
}

/** Map a stored row's status forward, so a panel only ever sees one vocabulary. */
export function migrateCardStatus(card: BoardCard): BoardCard {
  return card.status === LEGACY_PARKED_STATUS ? { ...card, status: "parked" } : card;
}

/** Every row a read returned that is a card, its status mapped forward, in read order. */
export function cardRows(rows: readonly PanelRow[]): BoardCardRow[] {
  const cards: BoardCardRow[] = [];
  for (const { topic, clientData } of rows) {
    if (isCard(clientData)) cards.push({ topic, card: migrateCardStatus(clientData) });
  }
  return cards;
}
