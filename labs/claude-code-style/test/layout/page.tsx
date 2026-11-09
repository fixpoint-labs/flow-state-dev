/**
 * The tasks pane at a set width, drawn by the lab's own stylesheet, for the
 * layout tests in a real browser (`done-row.test.ts`). The width is the
 * page's `?width=`, the pane's sizes as `pane-width.ts` bounds them. The
 * finished tasks carry what a real run leaves on a row: a long title, a
 * worker, a model with tokens and a charge, and an age.
 */
import { createRoot } from "react-dom/client";
import { taskView } from "@flow-state-dev/orchestration/inbox";
import type { LabAdapter, LabTask } from "../../src/adapter";
import { TasksPane } from "../../src/components/TasksPane";
import "../../src/styles.css";

const width = Number(new URLSearchParams(location.search).get("width") ?? "304");
const ended = Date.now() - 12 * 60_000;

function done(id: string, title: string, model: string, costUsd: number | null): LabTask {
  return {
    id,
    title,
    goal: title,
    status: "completed",
    assignee: "coder",
    updatedAt: ended,
    spend: { harness: "claude-code", model, inputTokens: 184_200, outputTokens: 9_400, costUsd, unreported: false, live: false },
    view: taskView({ id, title, goal: title, status: "completed", board: "s1", updatedAt: ended }),
  };
}

const tasks = [
  done("t1", "Fix the flaky retry test in the orchestration package", "claude-sonnet-4-5", 1.84),
  done("t2", "Draft release notes", "gpt-5.4", null),
];

const adapter = { watchPins: () => () => {} } as unknown as LabAdapter;

createRoot(document.getElementById("root")!).render(
  <div style={{ width, height: 600, display: "flex" }} data-testid="pane-box">
    <div style={{ width: "100%", minWidth: 0 }}>
      <TasksPane adapter={adapter} sessionId="s1" tasks={tasks} openId={undefined} onOpen={() => {}} onMissing={() => {}} />
    </div>
  </div>,
);
