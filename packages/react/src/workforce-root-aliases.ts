/**
 * Deprecated root names for the workforce panels, which moved to
 * `@flow-state-dev/react/workforce`.
 *
 * Each is the same value as its new home, kept on the root only so code
 * written against 0.4.0 keeps compiling until the minor that removes every
 * alias. Deleting this file and its one export line in `index.ts` is the whole
 * removal.
 */
import {
  Roster as WorkforceRoster,
  BoardColumns as WorkforceBoardColumns,
  BoardList as WorkforceBoardList,
  WorkerDetail as WorkforceWorkerDetail,
  groupIntoColumns as workforceGroupIntoColumns,
  BOARD_STATUS_COLUMNS as WORKFORCE_BOARD_STATUS_COLUMNS,
  type BoardCard as WorkforceBoardCard,
  type BoardCardRow as WorkforceBoardCardRow,
  type BoardColumn as WorkforceBoardColumn,
  type BoardColumnsProps as WorkforceBoardColumnsProps,
  type BoardColumnsSlots as WorkforceBoardColumnsSlots,
  type BoardListProps as WorkforceBoardListProps,
  type BoardListSlots as WorkforceBoardListSlots,
  type BoardStatus as WorkforceBoardStatus,
  type PanelRowSource as WorkforcePanelRowSource,
  type PanelItemSource as WorkforcePanelItemSource,
  type PanelLiveSource as WorkforcePanelLiveSource,
  type RosterProps as WorkforceRosterProps,
  type RosterWorker as WorkforceRosterWorker,
  type RosterWorkerRow as WorkforceRosterWorkerRow,
  type RosterSlots as WorkforceRosterSlots,
  type WorkerDetailProps as WorkforceWorkerDetailProps
} from "./workforce";
import { rosterPropNames as internalRosterPropNames } from "./components/panels/Roster";
import { boardColumnsPropNames as internalBoardColumnsPropNames } from "./components/panels/BoardColumns";
import { boardListPropNames as internalBoardListPropNames } from "./components/panels/BoardList";

/** @deprecated Import `Roster` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export const Roster = WorkforceRoster;
/** @deprecated Import `BoardColumns` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export const BoardColumns = WorkforceBoardColumns;
/** @deprecated Import `BoardList` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export const BoardList = WorkforceBoardList;
/** @deprecated Import `WorkerDetail` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export const WorkerDetail = WorkforceWorkerDetail;
/** @deprecated Import `groupIntoColumns` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export const groupIntoColumns = workforceGroupIntoColumns;
/** @deprecated Import `BOARD_STATUS_COLUMNS` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export const BOARD_STATUS_COLUMNS = WORKFORCE_BOARD_STATUS_COLUMNS;

/** @deprecated Internal prop list with no replacement; it leaves the public API. Removed in a future minor. */
export const rosterPropNames = internalRosterPropNames;
/** @deprecated Internal prop list with no replacement; it leaves the public API. Removed in a future minor. */
export const boardColumnsPropNames = internalBoardColumnsPropNames;
/** @deprecated Internal prop list with no replacement; it leaves the public API. Removed in a future minor. */
export const boardListPropNames = internalBoardListPropNames;

/** @deprecated Import `BoardCard` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardCard = WorkforceBoardCard;
/** @deprecated Import `BoardCardRow` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardCardRow = WorkforceBoardCardRow;
/** @deprecated Import `BoardColumn` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardColumn = WorkforceBoardColumn;
/** @deprecated Import `BoardColumnsProps` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardColumnsProps = WorkforceBoardColumnsProps;
/** @deprecated Import `BoardColumnsSlots` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardColumnsSlots = WorkforceBoardColumnsSlots;
/** @deprecated Import `BoardListProps` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardListProps = WorkforceBoardListProps;
/** @deprecated Import `BoardListSlots` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardListSlots = WorkforceBoardListSlots;
/** @deprecated Import `BoardStatus` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type BoardStatus = WorkforceBoardStatus;
/** @deprecated Import `PanelRowSource` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type PanelRowSource = WorkforcePanelRowSource;
/** @deprecated Import `PanelItemSource` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type PanelItemSource = WorkforcePanelItemSource;
/** @deprecated Import `PanelLiveSource` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type PanelLiveSource = WorkforcePanelLiveSource;
/** @deprecated Import `RosterProps` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type RosterProps = WorkforceRosterProps;
/** @deprecated Import `RosterWorker` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type RosterWorker = WorkforceRosterWorker;
/** @deprecated Import `RosterWorkerRow` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type RosterWorkerRow = WorkforceRosterWorkerRow;
/** @deprecated Import `RosterSlots` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type RosterSlots = WorkforceRosterSlots;
/** @deprecated Import `WorkerDetailProps` from `@flow-state-dev/react/workforce`. Removed in a future minor. */
export type WorkerDetailProps = WorkforceWorkerDetailProps;
