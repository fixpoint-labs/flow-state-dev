/**
 * POC CODE ON A NEVER-MERGED BRANCH (`epic/relay`, epic FIX-1197, PR #1357).
 * Throwaway. Not to be reviewed as code, never merged, dies with the PR.
 *
 * Q1 — can a request running INSIDE a block re-enter `host.dispatch` and land a
 * new request on a different, already-existing session, in-process?
 *
 * Not under test (already true by inspection): that the seam accepts a session
 * id. Every HTTP action call passes one. What is under test is the inside-out
 * direction, what identity the second request ends up with, and what the block
 * had to reach for that `ctx` does not give it.
 *
 * Three cases, because the first run showed the interesting axis is not
 * inside-vs-outside but same-user-vs-cross-user:
 *   A → C   same owner, different session
 *   A → B   different owner, sender's honest principal
 *   A → B   different owner, sender names the RECIPIENT's owner
 *
 *   pnpm tsx spec-poc/epic-relay/q1-inside-out-dispatch.ts
 */
import { boot, fromOutside, received, show } from "./harness";

const SESSION_A = "sess_sender"; // user_a
const SESSION_C = "sess_peer_same_user"; // user_a
const SESSION_B = "sess_peer_other_user"; // user_b

async function main(): Promise<void> {
  const { host, stores } = boot("allow");

  // Both recipients exist first, with history of their own, so a send lands on a
  // LIVE session rather than creating one.
  await fromOutside(host, "seed", { note: "C is already running" }, SESSION_C, "user_a");
  await fromOutside(host, "seed", { note: "B is already running" }, SESSION_B, "user_b");

  // --- Case 1: same owner, different session. The epic's tracer bullet. ---
  const sameUser = await fromOutside(
    host,
    "send",
    { to: SESSION_C, text: "ping A→C", asUserId: "user_a", wait: true },
    SESSION_A,
    "user_a"
  );
  show("1. A → C  (same owner, honest principal)", sameUser.result.output);

  // --- Case 2: different owner, honest principal. ---
  const crossUser = await fromOutside(
    host,
    "send",
    { to: SESSION_B, text: "ping A→B as myself", asUserId: "user_a", wait: true },
    SESSION_A,
    "user_a"
  );
  show("2. A → B  (different owner, honest principal)", crossUser.result.output);

  // --- Case 3: different owner, sender names the recipient's owner.
  //     BP-031: is the principal on the envelope checked against anything the
  //     sender actually holds? ---
  const impersonating = await fromOutside(
    host,
    "send",
    { to: SESSION_B, text: "ping A→B as user_b", asUserId: "user_b", wait: true },
    SESSION_A,
    "user_a"
  );
  show("3. A → B  (different owner, sender names user_b)", impersonating.result.output);

  // --- Did the second sessions' requests actually run and become discoverable
  //     on the RECIPIENT rather than on the sender? ---
  for (const [label, sessionId] of [
    ["C (same owner)", SESSION_C],
    ["B (other owner)", SESSION_B]
  ] as const) {
    const records = await stores.request.list({ sessionId, withItems: true });
    show(
      `4. request records on session ${label}`,
      records.map((r) => ({
        requestId: r.id,
        action: r.actionName,
        status: r.status,
        userId: r.userId,
        source: r.source,
        items: (r.items ?? []).map((i) => i.type)
      }))
    );
  }

  // --- What identity did the recipient block actually SEE? ---
  show("5. identity observed INSIDE each recipient run", received);

  // --- Item history, read through the framework's own session view. ---
  for (const [label, sessionId, userId] of [
    ["C (same owner)", SESSION_C, "user_a"],
    ["B (other owner)", SESSION_B, "user_b"],
    ["A (the sender)", SESSION_A, "user_a"]
  ] as const) {
    const inspect = await fromOutside(host, "inspect", {}, sessionId, userId);
    show(
      `6. ctx.session.items.all() on session ${label}`,
      (inspect.result.output as { items: string[] }).items.filter((i) => i.startsWith("message"))
    );
  }

  await host.close?.();
}

main().catch((error) => {
  console.error("POC FAILED", error);
  process.exitCode = 1;
});
