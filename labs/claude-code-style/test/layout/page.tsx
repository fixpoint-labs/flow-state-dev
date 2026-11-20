/**
 * The tasks pane at a set width, drawn by the lab's own stylesheet, for the
 * layout tests in a real browser (`done-task.test.ts`). The width is the
 * page's `?width=`, the pane's sizes as `pane-width.ts` bounds them. The
 * finished tasks carry what a real run leaves on a task: a long title, a
 * worker (one with a long id), a model with tokens and a charge or no spend
 * at all, and an age.
 */
import { createRoot } from "react-dom/client";
import type { CodingBoardTask } from "../../src/app";
import { codingBoardTask } from "../coding-board-task";
import { TasksPane } from "../../src/components/TasksPane";
import "../../src/styles.css";

const width = Number(new URLSearchParams(location.search).get("width") ?? "304");
const ended = Date.now() - 12 * 60_000;

function done(id: string, title: string, assignee: string, spend: { model: string; costUsd: number | null } | null): CodingBoardTask {
  return codingBoardTask({
    id,
    title,
    goal: title,
    status: "completed",
    assignee,
    updatedAt: ended,
    ...(spend === null ? {} : { spend: { harness: "claude-code", model: spend.model, inputTokens: 184_200, outputTokens: 9_400, costUsd: spend.costUsd, unreported: false, live: false } }),
  });
}

const tasks = [
  done("t1", "Fix the flaky retry test in the orchestration package", "coder", { model: "claude-sonnet-4-5", costUsd: 1.84 }),
  done("t2", "Draft release notes", "coder", { model: "gpt-5.4", costUsd: null }),
  // A long worker id and no spend: the worker has to give way too.
  done("t3", "Rename the settings field", "desk.coder-cursor", null),
];

createRoot(document.getElementById("root")!).render(
  <div style={{ width, height: 600, display: "flex" }} data-testid="pane-box">
    <div style={{ width: "100%", minWidth: 0 }}>
      <TasksPane sessionId="s1" tasks={tasks} openId={undefined} onOpen={() => {}} onMissing={() => {}} />
    </div>
  </div>,
);
