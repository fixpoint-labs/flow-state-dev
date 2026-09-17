/**
 * Type-level probe — FIX-1355, DECISIONS → Settled.
 *
 * Premise, as round 2 narrowed it: **`openChannels` itself has nowhere to put
 * an `orgId`.** Its options are `{ client, userId }`, and the `createSession`
 * signature it declares for that client carries no `orgId` — so `openChannels`
 * cannot pass one through, whatever the underlying client supports.
 *
 * It does NOT claim the client API has no org door. It has one:
 * `CreateSessionOptions` in `packages/client/src/session-client/sessions.ts`
 * declares `orgId?: string`. An earlier draft of this probe redeclared a local
 * input type and reported "refused at both doors", which was an artefact of the
 * redeclaration rather than a fact about the surface. Review caught it.
 *
 * That distinction is the whole reason the lab's wrap WORKS: the client can
 * carry an org, `openChannels` just won't thread one — so a wrapper that
 * injects `orgId` into `createSession` is all that's needed.
 *
 * Derived from `OpenChannelsOptions` rather than redeclared, so the probe
 * reacts if that surface ever gains the door.
 *
 * Driven by `check-no-org-door.sh`, which inverts the exit code.
 */

import { openChannels } from "../../packages/workforce/src/channel/channel-binder";
import type { OpenChannelsOptions } from "../../packages/workforce/src/channel/channel-binder";

// Derived, not redeclared: this is exactly the client `openChannels` accepts.
type BinderClient = OpenChannelsOptions["client"];
type BinderCreateSession = Parameters<BinderClient["createSession"]>[0];

const client: BinderClient = {
  createSession: async () => undefined,
  getSession: async (_id: string) => ({ flowKind: "k", userId: "u" }),
  deleteSession: async () => undefined,
};

// EXPECTED TO NOT COMPILE: `orgId` is not a key of OpenChannelsOptions, so
// there is no way to hand `openChannels` an org.
await openChannels([], { client, userId: "u", orgId: "lab-org" });

// EXPECTED TO NOT COMPILE: nor does the createSession signature the binder
// declares carry one — which is what stops it threading an org through.
// Derived from the binder's own type, so adding the field there flips this.
const attempted: BinderCreateSession = { flowKind: "k", userId: "u", orgId: "lab-org" };
void attempted;
