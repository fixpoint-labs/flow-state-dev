/**
 * What a tool call says in a thread: plain words for what happened, never the
 * tool's name or its output (a task id, `null`), which mean nothing to the
 * person reading. A tool this list doesn't name reads "Used a tool".
 */

/** The tools the lab's workers call, by what each one does. */
const SAID: Record<string, string> = {
  createTask: "Started a task",
  getTask: "Checked on a task",
  updateTask: "Updated a task",
  listTasks: "Looked over the tasks",
  holdTaskForUser: "Waiting for your answer",
  suspendForUser: "Sent for review",
  sendMessage: "Sent a message",
  reportProgress: "Noted its progress",
  consultSessionHistory: "Read a conversation",
  globProjectSource: "Listed the project's files",
  readProjectSource: "Read a project file",
  grepProjectSource: "Searched the project",
};

/** The line for a call to `name`. */
export function toolLine(name: string): string {
  return SAID[name] ?? "Used a tool";
}
