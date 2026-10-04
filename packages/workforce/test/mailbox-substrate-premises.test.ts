/**
 * Characterization specs for two substrate premises this floor rests on and
 * cannot itself enforce.
 *
 * Neither is a behaviour of the mailbox kind. They are pinned here because the
 * mailbox's public contract is written against them: if either changes, the
 * docs and the API's own wording become wrong, and a silent change is exactly
 * what a characterization spec exists to catch.
 *
 * 1. A session is bound to ONE user. That is why the `principal` on every line
 *    of a given transcript is the same value, and why the unverified `author`
 *    label carries all the real attribution (decision 2's ceiling).
 * 2. A `{ key }` dispatch derives a per-poster child session. That is why a key
 *    cannot name a shared mailbox, and so why posting addresses `{ id }`.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { defineFlow, dispatcher } from "@flow-state-dev/core";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver } from "@flow-state-dev/testing";
import { z } from "zod";
import { mailboxFlow, MAILBOX_KIND } from "../src/index";

const OWNER = "u_owner";
const INTRUDER = "u_intruder";
const POSTER = "keyed-poster";

/** A poster that addresses `{ key }` — the shape decision 3 rejected. */
const keyedPosterFlow = defineFlow({
  kind: POSTER,
  actions: {
    say: {
      block: dispatcher({
        name: "post-by-key",
        flowKind: MAILBOX_KIND,
        action: "post",
        inputSchema: z.object({ mailboxId: z.string(), body: z.string() }),
        session: { key: (input: { mailboxId: string }) => input.mailboxId },
        payload: (input: { body: string }) => ({ body: input.body })
      })
    }
  }
});

function host() {
  const mailbox = mailboxFlow();
  const poster = keyedPosterFlow();
  const state = createFlowState({
    flows: { [MAILBOX_KIND]: mailbox, [POSTER]: poster },
    stores: { default: { primary: inMemoryStores() } },
    modelResolver: createMockModelResolver({})
  });
  return { mailbox, poster, state };
}

async function bind(stores: StoreRegistry, sessionId: string): Promise<void> {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: MAILBOX_KIND,
      flowId: MAILBOX_KIND,
      userId: OWNER,
      state: { members: ["engineering.lead"], instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`,
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: []
    } as never,
    "any"
  );
}

async function transcriptLength(stores: StoreRegistry, sessionId: string): Promise<number> {
  const record = await stores.session.get(sessionId);
  return ((record?.state as { transcript?: unknown[] } | undefined)?.transcript ?? []).length;
}

describe("substrate premises the mailbox floor rests on", () => {
  it("refuses a second user's post into a mailbox session bound to someone else", async () => {
    const { mailbox, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup");

      // Refused by the substrate before any mailbox code runs, and as a THROW
      // rather than an execution result: the request never becomes a run.
      await expect(
        runAction({
    orgId: DEFAULT_ORG_ID,
          flow: mailbox,
          actionName: "post",
          input: { body: "not my mailbox" },
          userId: INTRUDER,
          sessionId: "engineering.standup",
          stores: runtime.stores,
          runtimeConfig: { ...runtime.runtimeConfig }
        })
      ).rejects.toThrow(/belongs to another user/);

      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(0);
    } finally {
      await state.dispose();
    }
  });

  it("sends a `{ key }`-addressed post to a derived child session, never to the mailbox", async () => {
    const { poster, state } = host();
    try {
      const runtime = await state.getRuntime();
      await bind(runtime.stores, "engineering.standup");

      await runAction({
    orgId: DEFAULT_ORG_ID,
        flow: poster,
        actionName: "say",
        input: { mailboxId: "engineering.standup", body: "lost" },
        userId: OWNER,
        sessionId: "s_poster",
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig }
      });

      // Give the detached child a moment to run and fail on its own terms.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // The mailbox never sees it. The framework cannot detect the mistake —
      // the docs say to address `{ id }`, and this is what happens when they
      // are not followed.
      expect(await transcriptLength(runtime.stores, "engineering.standup")).toBe(0);

      const children = await runtime.stores.session.list({
        userId: OWNER,
        parentage: { parentOf: "s_poster" }
      });
      expect(children.length).toBeGreaterThan(0);
      expect(children.every((child) => child.id !== "engineering.standup")).toBe(true);
    } finally {
      await state.dispose();
    }
  });
});
