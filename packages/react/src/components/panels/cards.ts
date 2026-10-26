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

/** Whether a row read off a board has the fields every card has. */
export function isCard(value: unknown): value is BoardCard {
  if (value === null || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" && typeof row.status === "string";
}

/** Every row a read returned that is a card, in read order. */
export function cardRows(rows: readonly PanelRow[]): BoardCardRow[] {
  const cards: BoardCardRow[] = [];
  for (const { topic, clientData } of rows) {
    if (isCard(clientData)) cards.push({ topic, card: clientData });
  }
  return cards;
}
