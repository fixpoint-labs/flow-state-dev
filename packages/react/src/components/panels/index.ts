/**
 * The two standing right-panel regions (FIX-1477 S5, S6).
 *
 * `Roster` lists an organization's seats; `BoardColumns` groups one board's
 * rows by status. They share a read (`reads.ts`) and a theming contract
 * (`chrome.ts`), neither of which leaves the package: a shared read exported
 * would let a host mount it twice and pay for it twice.
 */
export {
  Roster,
  rosterPropNames,
  type RosterProps,
  type RosterSeat,
  type RosterSeatRow,
  type RosterSlots
} from "./Roster";

export {
  BoardColumns,
  boardColumnsPropNames,
  groupIntoColumns,
  BOARD_STATUS_COLUMNS,
  type BoardCard,
  type BoardCardRow,
  type BoardColumn,
  type BoardColumnsProps,
  type BoardColumnsSlots,
  type BoardStatus
} from "./BoardColumns";

export type { PanelRowSource } from "./reads";
