/**
 * Every Kitchen Sink flow defines under the scope-state merge, and the
 * coordinator reads the session defaults its blocks and capabilities declare.
 *
 * `defineFlow` merges the session, user and org state each flow's blocks and
 * capabilities declare, and refuses a field two of them disagree on. The
 * coordinator's `activeSkills` is declared by the skills capability, not by
 * the coordinator flow, so it reads `[]` on a fresh session only through that
 * merge.
 *
 * Red states seen before green: with the chat-agent assistant's
 * `thinkingStyle` typed `z.string()`, the config fails to load ("Flow
 * \"chat-agent\": session.state.thinkingStyle is declared twice with different
 * types"); before the merge, the coordinator's session schema has no
 * `activeSkills` at all.
 */
import { describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import { COORDINATOR_FLOW } from "@flow-state-dev/workforce";
import { serveWorkforce } from "./workforce-host";

vi.setConfig({ testTimeout: 30_000 });

describe("scope-state defaults across Kitchen Sink's flows", () => {
  it("the coordinator reads the skills capability's activeSkills default on a fresh session", async () => {
    // Every flow the kit serves registers on one server: the cross-flow user and org check passes too.
    const { flows, state } = await serveWorkforce();
    await state.dispose();
    const coordinator = flows.get(COORDINATOR_FLOW);
    expect(coordinator).toBeDefined();

    // The schema the engine fills this flow's session reads from (the engine's
    // own tests hold every read to it); a coordinator session is born bound to
    // its worker, so this reads the field's default off it directly.
    const session = coordinator!.scopeStateSchemas?.session as z.AnyZodObject | undefined;
    expect(session?.shape.activeSkills?.safeParse(undefined).data).toEqual([]);
  });
});
