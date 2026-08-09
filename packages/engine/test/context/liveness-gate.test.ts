/**
 * The liveness enablement gate (FIX-999).
 *
 * The liveness verb answers "is this request still running?" from the active
 * request registry. Three supported configurations make that answer a lie, each
 * in a different direction, so the gate refuses to wire the verb at all rather
 * than shipping a boolean that is wrong under load. A refusal an operator can
 * see beats a signal they cannot audit.
 *
 * The three arms, and the lie each one prevents:
 *
 *  (i)  **Registry not shared.** Another process's healthy request is simply
 *       absent, so the read reports live work DEAD. A consumer that re-dispatches
 *       on that answer runs the work twice. This is the shipped default.
 *
 *  (ii) **Heartbeats off or too slow.** `heartbeatIntervalMs: 0` is supported and
 *       creates no timer, yet the sweeper still reaps the entry — so a perfectly
 *       healthy request reads DEAD. The sweeper deliberately never consults the
 *       per-flow interval, so nothing else relates the two.
 *
 * (iii) **Sweeping off.** `staleSweepIntervalMs: 0` makes the sweeper a no-op
 *       before it creates any timer, so on a shared registry a crashed worker's
 *       entry is never removed and the read reports it ALIVE forever. This arm's
 *       failure DEADLOCKS — reconciliation blocks and capacity is held by a dead
 *       request — rather than merely overspending, which is why it is a hard arm.
 *
 * The gate also hands back the stale threshold, because a nonzero cadence is
 * necessary but not sufficient: a cadence far larger than the threshold leaves a
 * crashed worker registered until the next tick. The read compares
 * `lastHeartbeatAt` against the threshold so it is correct regardless of how the
 * cadence is tuned.
 */
import { describe, it, expect } from "vitest";
import { evaluateLivenessGate } from "../../src/context/liveness-gate";
import type { ActiveRequestRegistry } from "../../src/stores/types";

const shared = { sharedAcrossProcesses: true } as ActiveRequestRegistry;
const notShared = { sharedAcrossProcesses: false } as ActiveRequestRegistry;
const undeclared = {} as ActiveRequestRegistry;

/** A configuration that satisfies all three arms. */
const healthy = {
  registry: shared,
  heartbeatIntervalMs: 10_000,
  staleThresholdMs: 60_000,
  staleSweepIntervalMs: 30_000
};

describe("liveness gate", () => {
  it("enables the verb when all three arms hold, and reports the threshold the read needs", () => {
    const verdict = evaluateLivenessGate(healthy);
    expect(verdict.enabled).toBe(true);
    if (verdict.enabled) expect(verdict.staleThresholdMs).toBe(60_000);
  });

  // ── Arm (i) ──────────────────────────────────────────────────────────────
  it("refuses by name on a registry that declares itself per-process", () => {
    const verdict = evaluateLivenessGate({ ...healthy, registry: notShared });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) expect(verdict.reason).toBe("registry-not-shared");
  });

  it("refuses on an undeclared registry — absent means not shared, never trusted", () => {
    const verdict = evaluateLivenessGate({ ...healthy, registry: undeclared });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) expect(verdict.reason).toBe("registry-not-shared");
  });

  // ── Arm (ii) ─────────────────────────────────────────────────────────────
  it("refuses when heartbeats are off, which creates no timer while the sweeper still reaps", () => {
    const verdict = evaluateLivenessGate({ ...healthy, heartbeatIntervalMs: 0 });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) expect(verdict.reason).toBe("heartbeat-too-slow");
  });

  it("refuses when the threshold is under 2x the heartbeat — the sweeper's own ratio, enforced not warned", () => {
    const verdict = evaluateLivenessGate({
      ...healthy,
      heartbeatIntervalMs: 10_000,
      staleThresholdMs: 15_000
    });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) expect(verdict.reason).toBe("heartbeat-too-slow");
  });

  it("accepts exactly 2x, the documented minimum", () => {
    expect(
      evaluateLivenessGate({ ...healthy, heartbeatIntervalMs: 10_000, staleThresholdMs: 20_000 })
        .enabled
    ).toBe(true);
  });

  // ── Arm (iii) ────────────────────────────────────────────────────────────
  it("refuses when sweeping is disabled — the arm whose failure deadlocks", () => {
    const verdict = evaluateLivenessGate({ ...healthy, staleSweepIntervalMs: 0 });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) expect(verdict.reason).toBe("sweeper-not-running");
  });

  it("refuses when the host cannot say whether it sweeps — unknown is fail-closed", () => {
    const verdict = evaluateLivenessGate({ ...healthy, staleSweepIntervalMs: undefined });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) expect(verdict.reason).toBe("sweeper-not-running");
  });

  // ── The default deployment ───────────────────────────────────────────────
  it("refuses on the shipped in-memory default, and says which arm refused", () => {
    const verdict = evaluateLivenessGate({
      registry: notShared,
      heartbeatIntervalMs: 10_000,
      staleThresholdMs: 60_000,
      staleSweepIntervalMs: 30_000
    });
    expect(verdict.enabled).toBe(false);
    if (!verdict.enabled) {
      expect(verdict.reason).toBe("registry-not-shared");
      // The refusal has to be legible to an operator who never wrote a
      // capability — an unexplained missing verb reads as a bug.
      expect(verdict.detail).toMatch(/shared/i);
    }
  });
});
