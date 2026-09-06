/**
 * A collection that keys, merges and **races** the way the real registry does.
 *
 * Shared by the two suites that drive the inbox at its own seam, because the
 * CAS behaviour is the part under test and a second copy of it would be a
 * second definition of what "atomic" means here.
 *
 * - `upsert(key, update, createOnly)` writes `{...createOnly, ...update}` on the
 *   create branch and merges `update` alone on the patch branch, so a
 *   create-only call really is a read when the row exists.
 * - `updateState` reads the CURRENT row, awaits (the window), then commits only
 *   if nothing else committed in between — otherwise it re-runs the updater
 *   against the winner's state, exactly as `mutateResourceKey` does.
 * - An unchanged return is a no-op and commits nothing, which is what makes a
 *   refused transition write nothing and fire no change.
 */
import type { BlockContext } from "@flow-state-dev/core/types";
import { INBOX } from "../src/inbox";

/** Let every other pending continuation run — the CAS window, made explicit. */
const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export function fakeInbox() {
  const rows = new Map<string, Record<string, unknown>>();
  const versions = new Map<string, number>();
  const ref = (key: string) => ({
    path: `${INBOX}/${key}`,
    get state() {
      return rows.get(key);
    },
    async updateState(
      updater: (current: Record<string, unknown>) => Record<string, unknown>,
    ): Promise<void> {
      for (;;) {
        const before = rows.get(key) ?? {};
        const version = versions.get(key) ?? 0;
        const next = updater({ ...before });
        await tick();
        if ((versions.get(key) ?? 0) !== version) continue;
        if (JSON.stringify(next) === JSON.stringify(before)) return;
        rows.set(key, next);
        versions.set(key, version + 1);
        return;
      }
    },
  });
  return {
    rows,
    async getOptional(key: string) {
      return rows.has(key) ? ref(key) : undefined;
    },
    async upsert(
      key: string,
      update: Record<string, unknown>,
      createOnly?: Record<string, unknown>,
    ) {
      if (!rows.has(key)) {
        rows.set(key, { ...createOnly, ...update });
      } else {
        rows.set(key, { ...rows.get(key), ...update });
      }
      versions.set(key, (versions.get(key) ?? 0) + 1);
      return ref(key);
    },
    async list(prefix?: string) {
      return [...rows.keys()]
        .filter((key) => prefix === undefined || key.startsWith(prefix))
        .map(ref);
    },
  };
}

/** A block context carrying just the inbox. */
export function contextWithInbox(inbox: ReturnType<typeof fakeInbox>): BlockContext {
  return { resources: { [INBOX]: inbox } } as unknown as BlockContext;
}
