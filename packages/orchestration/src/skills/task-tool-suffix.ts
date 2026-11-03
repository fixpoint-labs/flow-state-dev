/**
 * The qualifier on one board's task tool and action names, in a module of its
 * own: it imports nothing, so the browser-safe `./inbox` entry can name a
 * board's actions without reaching the task tools' runtime. Re-exported from
 * `task-tools-capability`, where it has always been exported.
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
