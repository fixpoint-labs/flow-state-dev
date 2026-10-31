/**
 * How a board's task tools are named: `<tool>_<suffix>`, where the suffix is
 * the board's collection id made safe for a tool name. A leaf, with no
 * imports, so the browser-safe `./inbox` entry names a board's actions the
 * way the task tools register them without loading the task board's runtime.
 */

/**
 * The qualifier that makes one board's task tools distinct from
 * another's: the board's collection id with every character a provider does
 * not allow in a tool name (`[a-zA-Z0-9_-]`) turned into `_`. So
 * `eng.feature.work`'s tools are `updateTask_eng_feature_work`.
 *
 * **Pinned.** It is the name a model is told about on a dotted board and the
 * name an action carries under `taskToolActions`, and the DevTool scopes
 * a row's actions to its board by it.
 */
export function taskToolSuffix(collectionId: string): string {
  return collectionId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * A board's task tool by name, as an action on the session that holds the
 * board: `taskActionName("updateTask", "tasks")` is `"updateTask_tasks"`.
 * The one place an app gets a board's action name.
 */
export function taskActionName(tool: string, collectionId: string): string {
  return `${tool}_${taskToolSuffix(collectionId)}`;
}
