/**
 * Shift Manager's goal page: its real `Conversation` and `TaskSession`, with
 * its stylesheet, on scripted reads (`shared.ts`, `fakes/`) in place of the
 * Lab. Copied to Shift Manager's scratch copy as `src/goal/shift-manager/main.tsx`.
 *
 *   ?surface=conversation   a worker's conversation and its composer
 *   ?surface=task-session   a task's Session tab. Its composer is the task
 *                           frame's, so a send is counted in the task's `sent`
 *                           as that composer does, and the line lands after.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Conversation } from "../../components/Conversation";
import { toWorker } from "../../lib/reads";
import { TaskSession } from "../../surfaces/TaskSession";
import "../../styles.css";
import { exposeGoal, script } from "../script";
import { sends } from "./shared";

const worker = toWorker({ id: "eng.coder", kind: "coder", door: "run" })!;
const surface = new URLSearchParams(location.search).get("surface");

function Page() {
  return (
    <div style={{ height: "100vh" }} className="flex flex-col bg-background text-foreground">
      {surface === "task-session" ? (
        <TaskSession />
      ) : (
        <Conversation worker={worker} sessions={[]} gaps={{} as never} name="Coder" testId="conversation" startAtEnd />
      )}
    </div>
  );
}

exposeGoal({
  send(text) {
    sends.add();
    void script.send(script.open, text);
  },
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
);
