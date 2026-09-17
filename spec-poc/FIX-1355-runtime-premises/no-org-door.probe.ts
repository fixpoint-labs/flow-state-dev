/**
 * Type-level probe — FIX-1355, DECISIONS → Settled.
 *
 * Premise: **`openChannels` has nowhere to put an `orgId`**, which is why the
 * lab wraps its session client (S4) and why ER-14 is filed.
 *
 * This premise is about an ABSENT field, so no runtime assertion can see it —
 * the evidence path is a compile that must FAIL. Driven by
 * `check-no-org-door.sh`, which inverts the exit code.
 *
 * Goes red (i.e. compiles clean) the day `OpenChannelsOptions` or its
 * `createSession` gains an org door — at which point the wrap is cargo and the
 * decision is stale.
 */

import { openChannels } from "../../packages/workforce/src/channel/channel-binder";

const client = {
  createSession: async (_o: {
    flowKind: string;
    userId: string;
    sessionId?: string;
    description?: string;
    state?: Record<string, unknown>;
  }) => undefined,
  getSession: async (_id: string) => ({ flowKind: "k", userId: "u" }),
  deleteSession: async (_id: string) => undefined,
};

// EXPECTED TO NOT COMPILE: `orgId` is not a key of OpenChannelsOptions.
await openChannels([], { client, userId: "u", orgId: "lab-org" });

// EXPECTED TO NOT COMPILE: nor is there a door on `createSession` itself.
await client.createSession({ flowKind: "k", userId: "u", orgId: "lab-org" });
