/**
 * The run-lab's fsdev config: what Shift Manager's start script loads.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start --config goals/shift-manager/it-shows-and-stops-a-task-run/lab/fsdev.config.mts
 *
 * Boots with its rows filed and its board drained, so held runs are working
 * when the page opens. See `lab.mts`.
 */
import { openRunLab } from "./lab.mts";

const opened = await openRunLab();

export default opened.flowState;
