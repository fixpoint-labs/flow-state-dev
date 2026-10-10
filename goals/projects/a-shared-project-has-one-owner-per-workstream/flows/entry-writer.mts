/**
 * A flow the goal registers on the served DevTeam install (scratch patch
 * `entry-writer`, `controls/patches.mts`): flow code writing the workstream
 * entries directly, as any flow an app registers could. It is not a test
 * double: it runs on the install's engine and store, declares the entries
 * with Workforce's own declaration (`WORKSTREAM_RESOURCES`), and is reached
 * over HTTP as the caller, like every other flow there.
 *
 * Its one action, `writeEntry`, tries each write a flow can make to the entry
 * at `{ project, owner, id }` and reports, per write, `landed` or
 * `refused: <message>`. None is destructive to an entry that already exists:
 * a status change, a report, and a create of a second entry under the same
 * owner's key that the same call then deletes. So a write the store lets
 * through (as under `GOAL_CONTROL=no-owner-rule`) changes the owner's entry
 * visibly and leaves the project's count as it was.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core/types";
import { PRIVATE_WORKSTREAMS_RESOURCE, WORKSTREAM_RESOURCES, WORKSTREAMS_RESOURCE, workstreamEntryKey } from "@flow-state-dev/workforce";
import { z } from "zod";

/** The kind the flow registers under. */
export const ENTRY_WRITER_KIND = "goal-entry-writer";

/** Its action. */
export const ENTRY_WRITER_ACTION = "writeEntry";

const inputSchema = z.object({
  project: z.object({ visibility: z.enum(["shared", "private"]), id: z.string().min(1) }),
  owner: z.string().min(1),
  id: z.string().min(1),
  status: z.string().min(1),
  report: z.string().min(1),
});

/** What each write came to, by name. */
export type EntryWrites = { status: string; report: string; createUnderOwner: string; deleteUnderOwner: string };

const writeEntry = handler({
  name: "goal-write-entry",
  inputSchema,
  outputSchema: z.record(z.string()),
  resources: WORKSTREAM_RESOURCES,
  execute: async (input, ctx): Promise<EntryWrites> => {
    const name = input.project.visibility === "private" ? PRIVATE_WORKSTREAMS_RESOURCE : WORKSTREAMS_RESOURCE;
    const entries = (ctx.resources as Record<string, unknown>)[name] as ResourceCollectionRef;
    const key = workstreamEntryKey(input.project.id, input.owner, input.id);
    const planted = workstreamEntryKey(input.project.id, input.owner, `${input.id}-planted`);
    const attempt = async (run: () => Promise<unknown>) => {
      try {
        await run();
        return "landed";
      } catch (error) {
        return `refused: ${error instanceof Error ? error.message : String(error)}`;
      }
    };
    const at = new Date().toISOString();
    const signed = { writtenBy: { userId: ctx.session.identity.userId ?? "" } };
    return {
      status: await attempt(async () => (await entries.get(key)).updateState((s: any) => ({ ...s, status: input.status, ...signed }))),
      report: await attempt(async () => (await entries.get(key)).writeContent(input.report)),
      createUnderOwner: await attempt(() =>
        entries.create(planted, { title: "planted", lead: "nobody", sessionId: null, openedAt: at, updatedAt: at, ...signed } as never),
      ),
      deleteUnderOwner: await attempt(() => entries.delete(planted)),
    };
  },
});

/** The flows the scratch patch spreads into the install's flow record. */
export function goalFlows(): Record<string, unknown> {
  return {
    [ENTRY_WRITER_KIND]: defineFlow({ kind: ENTRY_WRITER_KIND, actions: { [ENTRY_WRITER_ACTION]: { block: writeEntry } } } as never)(),
  };
}
