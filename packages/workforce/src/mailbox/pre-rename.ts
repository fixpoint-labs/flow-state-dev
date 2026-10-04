/**
 * What a mailbox was called before it was a mailbox — the one place the old
 * names live, so a tree or a store from before the rename is refused by name
 * rather than misread.
 *
 * Mailboxes used to be called channels: the record file, its folder, the kind
 * folder, the built-in kind, the items a transcript holds, the inventory's
 * rows and the discovery domain all said so. Nothing reads these names as
 * current. They exist to recognise old files and old data and to say what to
 * do about them: move the file, or start from an empty store. Old data is
 * never migrated and never deleted here. Removed at 1.0.
 *
 * No `node:fs`: the loader and the code generator do their own reading and ask
 * this module only for the names and the words.
 */

/** Every name the rename retired, each beside the one that replaced it. */
export const PRE_RENAME_NAMES = Object.freeze({
  /** The record file, now `MAILBOX.md`. */
  recordFile: "CHANNEL.md",
  /** The folder records sat in under a team, now `mailboxes/`. */
  recordFolder: "channels",
  /** The folder custom kinds sat in, now `flows/mailboxes/`. */
  kindsFolder: "flows/channels",
  /** The built-in kind, now `mailbox`. */
  kind: "channel",
  /** The transcript line's item component, now `mailbox-post`. */
  postComponent: "channel-post",
  /** The route record's item component, now `mailbox-route`. */
  routeComponent: "channel-route",
  /** The inventory's mailbox rows, now under `inventory/mailboxes/`. */
  inventoryPrefix: "inventory/channels/",
  /** The discovery domain, now `mailboxes`. */
  discoveryDomain: "channels",
});

/** The clause every refusal carries, so each one names the rename the same way. */
const BEFORE_THE_RENAME = "before channels were renamed to mailboxes";

/**
 * The refusal for a record file under its old name, wherever it sits.
 *
 * @param oldPath The file as found, relative to the workforce root.
 * @param newPath Where it belongs now.
 */
export function preRenameRecordProblem(oldPath: string, newPath: string): string {
  return (
    `"${oldPath}" is a mailbox record under the name it had ${BEFORE_THE_RENAME}, and it is not ` +
    `read. Move it to "${newPath}".`
  );
}

/**
 * The refusal for an old records folder that holds no old record file.
 *
 * @param oldPath The folder as found, relative to the workforce root.
 * @param newPath The folder it is now.
 */
export function preRenameRecordFolderProblem(oldPath: string, newPath: string): string {
  return (
    `"${oldPath}" is the folder mailbox records sat in ${BEFORE_THE_RENAME}, and nothing in it is ` +
    `read. Rename it to "${newPath}/", and each ${PRE_RENAME_NAMES.recordFile} in it to MAILBOX.md.`
  );
}

/** The refusal `fsdev gen` gives for the old kinds folder. */
export function preRenameKindsFolderProblem(): string {
  return (
    `"${PRE_RENAME_NAMES.kindsFolder}" is the folder mailbox kinds sat in ${BEFORE_THE_RENAME}, ` +
    `and nothing in it is generated. Move its files to "flows/mailboxes".`
  );
}

/**
 * Why a mailbox id held by a session on the old built-in kind cannot open: the
 * store predates the rename, and nothing reads that kind any more.
 */
export function preRenameOccupantProblem(): string {
  return (
    `the id is held by a session on the "${PRE_RENAME_NAMES.kind}" kind, written ${BEFORE_THE_RENAME}. ` +
    `Nothing reads that kind any more and old data is not carried over, so this store has to be ` +
    `reset: start from an empty store.`
  );
}

/** What a pre-rename check reads from a store. Structural, so any store registry fits. */
export interface PreRenameStoreView {
  session: {
    list(options: { flowKind: string }): Promise<ReadonlyArray<{ id: string; flowKind: string }>>;
  };
  request: {
    list(options: {
      sessionId: string;
      withItems: true;
      limit: number;
    }): Promise<ReadonlyArray<{ items?: ReadonlyArray<unknown> }>>;
  };
  resourceState: {
    getByPrefix(scopeType: "org", scopeId: string, keyPrefix: string): Promise<Record<string, unknown>>;
  };
}

/** Where a store shows it was written before the rename. Both empty means it was not. */
export interface PreRenameMarks {
  /** Sessions written before the rename, each with what gave it away. */
  sessions: Array<{ id: string; why: string }>;
  /** Organizations holding inventory rows filed under the old key. */
  organizations: string[];
}

/**
 * How many of a mailbox's latest requests are read for old items. A store from
 * before the rename holds nothing else, so its latest requests carry them as
 * surely as its first ones.
 */
const RECENT_REQUESTS = 50;

const OLD_COMPONENTS = new Set<string>([PRE_RENAME_NAMES.postComponent, PRE_RENAME_NAMES.routeComponent]);

/**
 * Find what marks a store as written before the rename. Reads only.
 *
 * Keyed on the store, not on the kind: a custom kind kept its name through the
 * rename, so a session on one says nothing by its kind. Three marks:
 *
 * - any session on the old built-in kind, whatever its id;
 * - a mailbox in `scope.mailboxIds` whose transcript holds an old item;
 * - an organization in `scope.orgIds` holding an inventory row under the old key.
 *
 * @param store The store to read, typically a host's store registry.
 * @param scope The mailboxes the host declares, and the organizations it runs as.
 */
export async function findPreRenameMarks(
  store: PreRenameStoreView,
  scope: { mailboxIds: readonly string[]; orgIds: readonly string[] }
): Promise<PreRenameMarks> {
  const sessions: PreRenameMarks["sessions"] = [];
  for (const session of await store.session.list({ flowKind: PRE_RENAME_NAMES.kind })) {
    sessions.push({ id: session.id, why: `it is a session on the "${PRE_RENAME_NAMES.kind}" kind` });
  }

  const marked = new Set(sessions.map((session) => session.id));
  for (const id of scope.mailboxIds) {
    if (marked.has(id)) continue;
    const requests = await store.request.list({ sessionId: id, withItems: true, limit: RECENT_REQUESTS });
    const old = requests
      .flatMap((request) => request.items ?? [])
      .map((item) => (item as { component?: unknown }).component)
      .find((component): component is string => typeof component === "string" && OLD_COMPONENTS.has(component));
    if (old !== undefined) sessions.push({ id, why: `its transcript holds "${old}" items` });
  }

  const organizations: string[] = [];
  for (const orgId of scope.orgIds) {
    const rows = await store.resourceState.getByPrefix("org", orgId, PRE_RENAME_NAMES.inventoryPrefix);
    if (Object.keys(rows).length > 0) organizations.push(orgId);
  }

  return { sessions, organizations };
}

/**
 * Name every mark, for a host's boot message: which mailboxes and which
 * organizations, and what gave each away. The host adds what to do, which
 * depends on where its store lives.
 *
 * @returns A clause that completes "this store was …".
 */
export function describePreRenameMarks(marks: PreRenameMarks): string {
  const named = [
    ...marks.sessions.map((session) => `mailbox "${session.id}" (${session.why})`),
    ...marks.organizations.map(
      (orgId) => `organization "${orgId}" (its inventory holds rows under "${PRE_RENAME_NAMES.inventoryPrefix}")`
    ),
  ];
  return `written ${BEFORE_THE_RENAME}, and nothing reads it any more: ${named.join(", ")}`;
}
