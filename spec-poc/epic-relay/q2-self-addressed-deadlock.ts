/**
 * POC CODE ON A NEVER-MERGED BRANCH (`epic/relay`, epic FIX-1197, PR #1357).
 * Throwaway. Not to be reviewed as code, never merged, dies with the PR.
 *
 * Q2 — reproduce the self-addressed deadlock theme 7 wants made unrepresentable.
 *
 * Under `request: { concurrency: "queue" }` one request per session key runs to
 * completion before the next starts. A request that dispatches onto its OWN
 * session and awaits the result therefore waits for a run that cannot start
 * until it finishes.
 *
 * What would falsify the "it fails safe" reading: the process hanging past the
 * 30s budget, or the timeout arriving with no identifiable error. Both are worse
 * findings than the deadlock and are reported as such.
 *
 * IN-PROCESS PATH ONLY. `arbiter.ts:22-27` and `createInboundTransportHost.ts:299-301`
 * skip arbitration entirely when an external dispatcher is configured, so nothing
 * here says anything about the durable path.
 *
 *   pnpm tsx spec-poc/epic-relay/q2-self-addressed-deadlock.ts     # ~35s
 */
import { boot, fromOutside, show } from "./harness";

const SELF = "sess_talks_to_itself";
/** Louder than the 30s budget, so a genuine hang is distinguishable. */
const WATCHDOG_MS = 75_000;

async function main(): Promise<void> {
  const { host, stores } = boot("queue");

  await fromOutside(host, "seed", { note: "one session, queue policy" }, SELF, "user_a");

  console.log(`\nstarting a self-addressed wait-for-response on "${SELF}" …`);
  console.log("budget under test: QUEUE_WAIT_TIMEOUT_MS = 30_000 (arbiter.ts:40)\n");

  const started = Date.now();
  const watchdog = setTimeout(() => {
    console.error(
      `\nHUNG — no resolution after ${WATCHDOG_MS}ms. The queue waiter did NOT give up. ` +
        `This is the loud finding, not the deadlock.`
    );
    process.exit(2);
  }, WATCHDOG_MS);
  watchdog.unref?.();

  const outcome = await fromOutside(
    host,
    "send",
    { to: SELF, text: "hello, me", asUserId: "user_a", wait: true },
    SELF,
    "user_a"
  );
  clearTimeout(watchdog);

  show("self-addressed send, wait-for-response", {
    wallClockMs: Date.now() - started,
    senderStatus: outcome.result.error === undefined ? "completed" : "failed",
    senderError: outcome.result.error?.message,
    blockOutput: outcome.result.output
  });

  const records = await stores.request.list({ sessionId: SELF });
  show(
    "request records on the session afterwards",
    records.map((r) => ({
      requestId: r.id,
      action: r.actionName,
      status: r.status,
      startedAtMs: r.startedAtMs,
      failedAtMs: r.failedAtMs
    }))
  );

  // The control: the SAME queue policy, fire-and-forget instead of wait. Theme 7
  // says this half is fine and is the mechanism behind "the same session as a new
  // request". It should queue behind the sender and run once the sender returns.
  const ff = await fromOutside(
    host,
    "send",
    { to: SELF, text: "fire and forget to self", asUserId: "user_a", wait: false },
    SELF,
    "user_a"
  );
  show("control — self-addressed FIRE-AND-FORGET", ff.result.output);
  await new Promise((r) => setTimeout(r, 1500));
  const after = await stores.request.list({ sessionId: SELF });
  show(
    "records after the fire-and-forget settled",
    after.map((r) => ({ requestId: r.id, action: r.actionName, status: r.status }))
  );

  await host.close?.();
}

main().catch((error) => {
  console.error("POC FAILED", error);
  process.exitCode = 1;
});
