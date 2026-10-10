/**
 * The run-lab's fsdev config: what Shift Manager's command loads.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start --config packages/shift-manager/test/fixtures/run-lab/fsdev.config.mts
 *
 * Boots with its tasks filed on the lead's conversation, so held runs are working
 * when the page opens. See `lab.mts`.
 */
import { openRunLab } from "./lab.mts";

const opened = await openRunLab();

export default opened.flowState;
