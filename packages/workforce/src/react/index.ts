/**
 * `@flow-state-dev/workforce/react`: the components that draw workforce's
 * records, for a workforce screen.
 *
 * `Roster` lists a user's workers, reading the roster flow's `roster` view by
 * default; `BoardColumns` and `BoardList` draw one task board's tasks, and
 * `WorkerDetail` shows one worker. React is an optional peer: only this entry
 * imports it, so a server-only app that imports the package root doesn't pull
 * it in.
 */
export {
  Roster,
  type RosterProps,
  type RosterWorkerRow,
  type RosterSlots,
  WorkerDetail,
  type WorkerDetailProps,
  BoardColumns,
  groupIntoColumns,
  BOARD_STATUS_COLUMNS,
  type BoardColumn,
  type BoardColumnsProps,
  type BoardColumnsSlots,
  type BoardStatus,
  type BoardCard,
  type BoardCardRow,
  BoardList,
  type BoardListProps,
  type BoardListSlots,
  type PanelRowSource,
  type PanelItemSource,
  type PanelLiveSource,
} from "./components";
