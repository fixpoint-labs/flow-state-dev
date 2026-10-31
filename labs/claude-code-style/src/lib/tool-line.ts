/**
 * What a tool call says in a thread: plain words for what happened, never the
 * tool's name or its output (a task id, `null`), which mean nothing to the
 * person reading. A tool this list doesn't name reads as its name in words.
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
  const said = SAID[name];
  if (said !== undefined) return said;
  // "someNewTool" reads "Some new tool".
  const words = name.replace(/_[a-z]+$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
