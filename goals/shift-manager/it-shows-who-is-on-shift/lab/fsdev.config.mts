/**
 * The shift-lab's fsdev config: what Shift Manager's start script loads.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start --config goals/shift-manager/it-shows-who-is-on-shift/lab/fsdev.config.mts
 *
 * Boots with every worker in its spread's state (`SHIFT_LAB_SPREAD`, JSON, or
 * the default). See `lab.mts`.
 */
import { openShiftLab } from "./lab.mts";

const opened = await openShiftLab();

export default opened.flowState;
