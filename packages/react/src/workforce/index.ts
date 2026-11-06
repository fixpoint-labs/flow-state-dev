/**
 * `@flow-state-dev/react/workforce`: the components that draw workforce
 * records, for a workforce screen.
 *
 * `Roster` lists an organization's workers, `BoardColumns` and `BoardList`
 * draw one task board's rows, and `WorkerDetail` shows one worker. A chat app
 * needs none of them, so they live here rather than on the package root.
 */
export {
  Roster,
  type RosterProps,
  type RosterWorker,
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
  type PanelLiveSource
} from "../components/panels";
