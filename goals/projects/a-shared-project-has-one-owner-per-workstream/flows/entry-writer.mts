/**
 * A flow the goal registers on the served DevTeam install (scratch patch
 * `entry-writer`, `controls/patches.mts`): flow code writing the workstream
 * entries directly, as any flow an app registers could. It is not a test
 * double: it runs on the install's engine and store, declares the entries
 * with Workforce's own declaration (`WORKSTREAM_RESOURCES`), and is reached
 * over HTTP as the caller, like every other flow there.
 *
 * Its action, `writeEntry`, runs in one of three modes and reports, per
 * write, `landed` or `refused: <message>`:
 *
 * - `plant`: the owner makes a sacrificial row, `<id>-planted`, under their
 *   own key, so a cross-owner delete has a real row to remove.
 * - `tamper`: each write a flow can make to another owner's rows: a status
 *   change and a report on the entry at `{ project, owner, id }`, a delete of
 *   the planted row, and a create of a second row under the owner's key that
 *   the same call then deletes. None touches the entry itself destructively,
 *   so a write the store lets through (as under `GOAL_CONTROL=no-owner-rule`)
 *   changes the owner's entry visibly and leaves the rest of the leg readable.
 * - `unplant`: the owner removes the planted row, so the project's count is
 *   back to its opened workstreams.
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
  mode: z.enum(["plant", "tamper", "unplant"]),
});

/** What each write came to, by name; only the mode's own writes are present. */
export type EntryWrites = Partial<Record<"plant" | "unplant" | "status" | "report" | "deletePlanted" | "createUnderOwner", string>>;

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
    const created = workstreamEntryKey(input.project.id, input.owner, `${input.id}-created`);
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
    const row = (title: string) => ({ title, lead: "nobody", sessionId: null, openedAt: at, updatedAt: at, ...signed }) as never;
    if (input.mode === "plant") return { plant: await attempt(() => entries.create(planted, row("planted"))) };
    if (input.mode === "unplant") return { unplant: await attempt(() => entries.delete(planted)) };
    const writes: EntryWrites = {
      status: await attempt(async () => (await entries.get(key)).updateState((s: any) => ({ ...s, status: input.status, ...signed }))),
      report: await attempt(async () => (await entries.get(key)).writeContent(input.report)),
      deletePlanted: await attempt(() => entries.delete(planted)),
      createUnderOwner: await attempt(() => entries.create(created, row("created"))),
    };
    // Whatever landed is taken back out, so the project's count stays the opened workstreams.
    if (writes.createUnderOwner === "landed") await attempt(() => entries.delete(created));
    return writes;
  },
});

/** The flows the scratch patch spreads into the install's flow record. */
export function goalFlows(): Record<string, unknown> {
  return {
    [ENTRY_WRITER_KIND]: defineFlow({ kind: ENTRY_WRITER_KIND, actions: { [ENTRY_WRITER_ACTION]: { block: writeEntry } } } as never)(),
  };
}
