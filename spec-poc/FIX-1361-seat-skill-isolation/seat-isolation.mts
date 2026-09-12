/**
 * POC — does the resource layer already give one seat its own skills storage?
 *
 * Throwaway. Lives on the never-merged spec branch for FIX-1361 and ships nowhere.
 *
 * The claim decision 3 rests on: a seat is a flow **instance**, and an org-scoped
 * resource marked `flowIsolation: true` keys per instance — so two seats in one org
 * do NOT share a skills collection, and no new storage primitive is needed.
 *
 * The counter-claim (epic theme 7, drift note 3a): today's skills library leaves
 * `flowIsolation` unset, so both seats land in one org-wide bucket.
 *
 * SCOPE — this file answers the STORAGE KEY question only. Whether each seat's
 * drawer is then filled with that seat's OWN skills is a separate question, and
 * the answer is no: see `seat-population.test.ts` beside this file.
 *
 * Run:  node --experimental-strip-types spec-poc/FIX-1361-seat-skill-isolation/seat-isolation.mts
 * (No install needed — `scope-keys.ts` has a single type-only import.)
 */

import {
  resourceScopeIds,
  type IsolationFlow,
} from "../../packages/engine/src/stores/scope-keys.ts";

const ORG = "acme";

/** One seat, as `hireWorkforce` mints it: instance id = the worker's id. */
const seat = (id: string, flowIsolation: boolean | undefined): IsolationFlow => ({
  id,
  isolateUserState: false,
  isolateOrgState: false,
  resources: { skills: { scope: "org", flowIsolation } },
});

const check = (label: string, expected: boolean, actual: boolean, detail: string): void => {
  console.log(`${actual === expected ? "PASS" : "FAIL"}  ${label}\n      ${detail}`);
  if (actual !== expected) process.exitCode = 1;
};

// --- A. Today's shape: the library leaves flowIsolation unset ----------------
const sharedLead = resourceScopeIds(ORG, seat("engineering.lead", undefined), "org");
const sharedQa = resourceScopeIds(ORG, seat("engineering.qa", undefined), "org");
check(
  "unset flowIsolation — two seats SHARE one skills bucket (the gap)",
  true,
  sharedLead[0] === sharedQa[0],
  `engineering.lead -> ${JSON.stringify(sharedLead)} | engineering.qa -> ${JSON.stringify(sharedQa)}`,
);

// --- B. The proposed shape: the kind declares flowIsolation: true ------------
const isoLead = resourceScopeIds(ORG, seat("engineering.lead", true), "org");
const isoQa = resourceScopeIds(ORG, seat("engineering.qa", true), "org");
check(
  "flowIsolation: true — two seats get SEPARATE buckets, keyed by seat id",
  true,
  isoLead[0] !== isoQa[0],
  `engineering.lead -> ${JSON.stringify(isoLead)} | engineering.qa -> ${JSON.stringify(isoQa)}`,
);

// --- C. The coordinate is the seat id, not the flow kind --------------------
// Both seats above are copies of ONE kind. If the coordinate were the kind
// (pre-FIX-1323), B would have collapsed. Assert the seat id is recoverable.
check(
  "the isolated key carries the seat's own id",
  true,
  isoLead[0]!.includes("engineering.lead") && isoQa[0]!.includes("engineering.qa"),
  `${isoLead[0]} / ${isoQa[0]}`,
);

// --- D. Same seat id, different org: still separate --------------------------
const otherOrg = resourceScopeIds("globex", seat("engineering.lead", true), "org");
check(
  "org identity still separates seats with the same id",
  true,
  otherOrg[0] !== isoLead[0],
  `acme -> ${isoLead[0]} | globex -> ${otherOrg[0]}`,
);

console.log(
  process.exitCode
    ? "\nVERDICT: premise does NOT hold as stated — decision 3 needs rework."
    : "\nVERDICT: premise holds for KEYS. Separate per-seat buckets need one existing flag, not a\n" +
      "new primitive. Filling each bucket with that seat's own skills is NOT covered here —\n" +
      "run seat-population.test.ts for that half.",
);
