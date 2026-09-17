/**
 * The positive half of the org-door premise — FIX-1355.
 *
 * This file **must compile**. It asserts the thing round 2 corrected: the real
 * client API *does* have an org door. `CreateSessionOptions` declares
 * `orgId?: string`, so a caller holding a `SessionClient` can bind an org.
 *
 * Both halves together are the honest claim, and neither alone is:
 *   - this file compiling  → the client CAN carry an org;
 *   - `no-org-door.probe.ts` failing → `openChannels` cannot pass one.
 *
 * Which is exactly why wrapping the client works, and why ER-14 is a narrow
 * "thread the org through `openChannels`" rather than "add an org door".
 *
 * Driven by `check-no-org-door.sh`.
 */

import type { CreateSessionOptions } from "../../packages/client/src/session-client/sessions";

// Must compile: the public create-session payload carries an org.
const withOrg: CreateSessionOptions = {
  flowKind: "channel",
  userId: "u",
  sessionId: "pentest.findings",
  orgId: "org_pentest_lab",
};

void withOrg;
