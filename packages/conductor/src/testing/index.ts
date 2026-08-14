/**
 * Test scaffolding: a recording stand-in for the vendor harness, and the replay
 * harness that drives a scripted lifecycle through the driver.
 *
 * Kept out of `./dispatch` on purpose. The two are written against the same
 * `Dispatcher` seam, but a consumer wiring up the real dispatcher should not
 * pull a fake and a lifecycle runner into their bundle to get it.
 *
 * ```
 * ReplayScript ──replay()──▶ ReplayResult   (dispatches through fakeDispatcher)
 * ```
 */

export * from "./fake";
export * from "./replay";
