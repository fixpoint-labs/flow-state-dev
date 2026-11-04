/**
 * The run-lab's fsdev config: what Shift Manager's command loads.
 *
 *     pnpm --filter @flow-state-dev/shift-manager start --config packages/shift-manager/test/fixtures/run-lab/fsdev.config.mts
 *
 * Boots with its tasks filed on the lead's conversation, so running tasks are working
 * when the page opens. `RUN_LAB_TASK_ACTIONS=1` also files the held, cancellable
 * and failing tasks a task's action row acts on. See `lab.mts`.
 */
import { openRunLab } from "./lab.mts";

const opened = await openRunLab({ taskActions: process.env.RUN_LAB_TASK_ACTIONS === "1" });

export default opened.flowState;
