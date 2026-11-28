// FIX-2725; FIX-2796.
/**
 * The client's handles on the coding board, recorded work and run changes views: each
 * flow's address and view name, typed by the view through a type import.
 * Hold no block, so they are safe in a browser bundle.
 */
import { viewRef } from "@flow-state-dev/client";
import { CODER_FLOW } from "./coder-flow-name";
import type { CodingBoardView } from "./kit/coding-board";
import type { RecordedWorkView } from "./recorded-work-view";
import type { harnessRunChangesView } from "./run-changes";

/** The flow the harness kit serves its views on. */
export const HARNESSES_FLOW = "harnesses";
/** The coding board view's name on {@link HARNESSES_FLOW}. */
export const CODING_BOARD_VIEW = "codingBoard";
/** The recorded work view's name on the coding worker flow. */
export const RECORDED_WORK_VIEW = "recordedWork";
/** The run changes view's name on the coding worker flow. */
export const RUN_CHANGES_VIEW = "changes";

/** A conversation's coding board: `useView(codingBoardViewRef(), { sessionId })`, at user scope. */
export const codingBoardViewRef = () => viewRef<CodingBoardView>(HARNESSES_FLOW, CODING_BOARD_VIEW);

/** A run's plan and pull requests, a session view on the coding worker flow: `useView(recordedWorkViewRef(), { requestId }, { sessionId })`. */
export const recordedWorkViewRef = (flow: string = CODER_FLOW) => viewRef<RecordedWorkView>(flow, RECORDED_WORK_VIEW);

/**
 * What a run changed, a session view on the coding worker flow (harness-manager's `harnessRunChangesView`):
 * `client.view(runChangesViewRef(), { path }, { sessionId })` answers one file's patch.
 */
export const runChangesViewRef = (flow: string = CODER_FLOW) => viewRef<ReturnType<typeof harnessRunChangesView>>(flow, RUN_CHANGES_VIEW);
