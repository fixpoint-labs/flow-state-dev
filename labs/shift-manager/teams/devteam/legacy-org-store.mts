/**
 * Set aside a DevTeam store written under the lab's old org id.
 *
 * The lab's org id was `org_devforce_lab`. It is `devforce-lab` now, because a
 * hired seat's address starts with the org and an address segment must be
 * lowercase and hyphenated. A default store from before the change holds the
 * channel's and the ask's sessions, the requests and suspensions run in them,
 * and the org's rows, all under the old id, and a boot that reuses those
 * sessions fails on the org binding.
 *
 * Reset, not migrate. The old id is carried by sessions, requests,
 * suspensions, checkpoints and the org's resource rows, each in its own store
 * with its own keying, and there is no store-level way to re-home all of them
 * at once. What would be lost is small and rebuilt at boot: the old id could
 * never hold a hired seat (no address could be built for one), and the
 * declared seats, channels and the waiting ask are written again by the next
 * boot. So the file is moved aside, never deleted, and the boot says where.
 */
import { existsSync, renameSync } from "node:fs";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";

/** The org id the lab used before its id became a legal address segment. */
export const LEGACY_LAB_ORG_ID = "org_devforce_lab";

/**
 * When `file` holds anything under {@link LEGACY_LAB_ORG_ID}, move it (and
 * SQLite's side files) aside and log where.
 *
 * @param file The DevTeam SQLite store.
 * @returns where the old store went, or `undefined` when nothing was moved.
 */
export async function setAsideLegacyOrgStore(file: string): Promise<string | undefined> {
  if (!existsSync(file)) return undefined;
  const stores = createSQLiteStores({ filename: file });
  let legacy: boolean;
  try {
    const sessions = await stores.session.list();
    legacy =
      sessions.some((session) => (session as { orgId?: string }).orgId === LEGACY_LAB_ORG_ID) ||
      Object.keys(await stores.resourceState.getByPrefix("org", LEGACY_LAB_ORG_ID, "")).length > 0;
  } finally {
    stores.close();
  }
  if (!legacy) return undefined;

  const aside = `${file}.${LEGACY_LAB_ORG_ID}-${Date.now()}`;
  renameSync(file, aside);
  for (const side of ["-wal", "-shm"]) {
    if (existsSync(`${file}${side}`)) renameSync(`${file}${side}`, `${aside}${side}`);
  }
  console.error(
    `[devteam] ${file} was written under the lab's old org id "${LEGACY_LAB_ORG_ID}", which this version ` +
      `no longer uses, so its sessions can't be reopened. It was moved to ${aside}, and DevTeam starts ` +
      `with a fresh store. Delete the old file once you don't need it.`,
  );
  return aside;
}
