/**
 * A Lab's boot, as a Workforce app writes one: read the tree, refuse a tree
 * that did not load, refuse a store from before the rename, then open the
 * mailboxes. Published packages only.
 *
 * Two kinds: the built-in, and `digest`, a kind of the app's own (the one the
 * mailbox-boards goal's tree ships), because a custom kind kept its name
 * through the rename and only the store can say it is old.
 *
 * `checkStore` is the goal check's control seam and nothing else: `false`
 * boots without the store check, the way an app that never added one would.
 */
import { createSessionClient } from "@flow-state-dev/client";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFlowState, filesystemStores, type FlowState } from "@flow-state-dev/engine";
import {
  defineMailboxFlow,
  describePreRenameMarks,
  findPreRenameMarks,
  mailboxInstances,
  openMailboxes,
} from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import digest from "../../mailbox-boards/it-runs-a-row-a-file-declared-board-holds/fixtures/workforce/flows/mailboxes/digest.ts";

/** Who the Lab opens its mailboxes as. */
export const LAB_USER = "u_pre_rename";

/**
 * Boot the Lab over `tree` and a filesystem store at `storeDir`.
 *
 * @returns the running state, for the caller to dispose.
 * @throws with the message a person reads when the tree or the store is refused.
 */
export async function bootLab(options: { tree: string; storeDir: string; checkStore?: boolean }): Promise<FlowState> {
  const roster = await readDeclaredRoster(options.tree);
  if (roster.problems.length > 0) {
    throw new Error(`the tree did not load:\n  - ${roster.problems.map((p) => p.error.message).join("\n  - ")}`);
  }

  const flows = mailboxInstances(roster.mailboxes, { kinds: { mailbox: defineMailboxFlow(), digest: digest as never } });
  const state = createFlowState({
    flows: Object.fromEntries(flows.map((flow) => [flow.kind, flow])),
    stores: { default: { primary: filesystemStores({ rootDir: options.storeDir }) } },
  } as never);

  try {
    const runtime = await state.getRuntime();
    if (options.checkStore !== false) {
      const marks = await findPreRenameMarks(runtime.stores, {
        mailboxIds: roster.mailboxes.map((mailbox) => mailbox.id),
        orgIds: [DEFAULT_ORG_ID],
      });
      if (marks.sessions.length > 0 || marks.organizations.length > 0) {
        throw new Error(`this store was ${describePreRenameMarks(marks)}. Start from an empty store.`);
      }
    }

    const router = await state.getRouter();
    const sessions = createSessionClient({
      fetcher: async (input, init) => {
        const url = new URL(String(input), "http://pre-rename-lab.local");
        const path = url.pathname
          .replace(/^\/api\/flows\/?/, "")
          .split("/")
          .filter((segment) => segment.length > 0)
          .map(decodeURIComponent);
        const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
        return await router[method](new Request(url, init), { params: { path } });
      },
    });
    await openMailboxes(roster.mailboxes, { client: sessions, userId: LAB_USER });
    return state;
  } catch (error) {
    await state.dispose();
    throw error;
  }
}
