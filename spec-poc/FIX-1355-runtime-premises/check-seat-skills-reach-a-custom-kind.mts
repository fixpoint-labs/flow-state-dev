/**
 * Characterization check — FIX-1355, DECISIONS → Settled.
 *
 * Premise: **a seat's skills reach a custom kind that declares the key.**
 * `hireWorkforce` imposes `seatSkills` on any kind whose probed config declares
 * it — which is what lets the lab's own `probe` kind receive the org ∪ team ∪
 * own skill union (BR-3) without waiting on FIX-1367.
 *
 * Run:  node_modules/.bin/tsx spec-poc/FIX-1355-runtime-premises/check-seat-skills-reach-a-custom-kind.mts
 *
 * The claim is CONDITIONAL, so it needs both sides or it proves nothing:
 *   - a kind that DOES declare `seatSkills` receives the union;
 *   - a kind that does NOT is left exactly as it was — not refused, not
 *     force-fed a setting its author never declared.
 * A check that only asserted the first would stay green if `hireWorkforce`
 * started imposing the key unconditionally, which is the specific regression
 * the conditional exists to prevent.
 */

import { defineFlow } from "../../packages/core/dist/index.js";
import { hireWorkforce } from "../../packages/workforce/dist/index.js";
import { z } from "zod";

const SKILLS = ["report-format", "port-scan", "sweep"];

let failures = 0;
const check = (label: string, ok: boolean, saw: string) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n        seen: ${saw}`);
  if (!ok) failures += 1;
};

/** A kind shaped like the lab's `probe`: declares instructions + seatSkills. */
const declaresKey = defineFlow({
  kind: "probe",
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    seatSkills: z.array(z.string()).optional().default([]),
  }),
  actions: {},
} as never);

/** The same kind minus the key — a kind written before `seatSkills` existed. */
const omitsKey = defineFlow({
  kind: "legacy",
  cardinality: "collection",
  configSchema: z.object({ instructions: z.string().optional() }),
  actions: {},
} as never);

const manifest = (id: string, kind: string) => ({
  id,
  declared: { flow: kind, description: "A seat." },
  body: "Sweep the target list and report what answered.",
  skills: SKILLS,
});

const configOf = (seat: any): Record<string, unknown> => (seat?.config ?? {}) as Record<string, unknown>;

// 1 — the claim.
const [probeSeat] = hireWorkforce([manifest("pentest.recon", "probe")] as never, {
  kinds: { probe: declaresKey },
} as never);
const probeConfig = configOf(probeSeat);

check(
  "a kind that DECLARES seatSkills receives the seat's skill union",
  Array.isArray(probeConfig.seatSkills) &&
    JSON.stringify(probeConfig.seatSkills) === JSON.stringify(SKILLS),
  `seatSkills = ${JSON.stringify(probeConfig.seatSkills)} (expected ${JSON.stringify(SKILLS)})`,
);

check(
  "the same hire also carried the worker's body through as instructions",
  typeof probeConfig.instructions === "string" && probeConfig.instructions.includes("Sweep"),
  `instructions = ${JSON.stringify(probeConfig.instructions)}`,
);

// 2 — the other half of the conditional. Without this the check cannot tell
// "imposed on a kind that declares it" from "imposed on everything".
const [legacySeat] = hireWorkforce([manifest("audit.scribe", "legacy")] as never, {
  kinds: { legacy: omitsKey },
} as never);
const legacyConfig = configOf(legacySeat);

check(
  "CONTROL · a kind that does NOT declare the key is left alone, not force-fed",
  legacySeat !== undefined && legacyConfig.seatSkills === undefined,
  legacySeat === undefined
    ? "the hire REFUSED — a shared skills folder would break every custom kind on the roster"
    : `seatSkills = ${JSON.stringify(legacyConfig.seatSkills)} (expected undefined); the seat still hired`,
);

console.log(`\n${failures === 0 ? "CONFIRMED" : "REFUTED"} — ${failures} failing assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
