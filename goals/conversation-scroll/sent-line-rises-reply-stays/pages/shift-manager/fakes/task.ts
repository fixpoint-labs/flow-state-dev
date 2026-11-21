/** The open task, with the run the script's open conversation is. See `../shared.ts`. */
export * from "../../../lib/task";
import { useOpen } from "../../script";
import { sends } from "../shared";

const noop = () => undefined;
export function useTask() {
  const open = useOpen();
  const sent = sends.use();
  const run = { flowId: "coder", sessionId: open, requestId: `r-${open}` };
  return {
    row: { id: "t1", boardRef: "board", run },
    run: { kind: "open", run },
    sent,
    boardRef: "board",
    taskId: "t1",
    waiting: false,
    gaveUp: false,
    retryRow: noop,
    retryRun: noop,
  } as never;
}
