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

/**
 * Loader-shaped skills. `WorkerManifest.skills` is `InitialSkill[]` — records
 * of `{ name, skillMd, files? }` (`core/src/types/skill.ts`), NOT bare names.
 * An earlier draft of this file declared `z.array(z.string())` and passed
 * names, which made the probe green against a schema no real kind would have;
 * review caught it. Each token below is what BR-3 would hold out per folder.
 */
const SKILLS = [
  { name: "report-format", skillMd: "---\ndescription: Org format.\n---\nTOKEN-ORG-FMT" },
  { name: "port-scan", skillMd: "---\ndescription: Team scan.\n---\nTOKEN-PENTEST-SCAN" },
  { name: "sweep", skillMd: "---\ndescription: Own sweep.\n---\nTOKEN-RECON-SWEEP" },
];

const SKILL_NAMES = SKILLS.map((s) => s.name);

/**
 * The same shape the built-in kind declares (`seatSkillSchema` in
 * `agent-worker-flow.ts`): an object schema, `.strict()`. A custom kind that
 * wants the union declares this, and that is what the claim is about.
 */
const seatSkillSchema = z
  .object({
    name: z.string().min(1),
    skillMd: z.string(),
    files: z
      .array(z.object({ path: z.string().min(1), content: z.string() }).strict())
      .optional(),
  })
  .strict();

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
    seatSkills: z.array(seatSkillSchema).default([]),
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

const received = Array.isArray(probeConfig.seatSkills)
  ? (probeConfig.seatSkills as Array<{ name?: string; skillMd?: string }>)
  : [];

check(
  "a kind that DECLARES seatSkills receives the seat's skill union, as records",
  received.length === SKILLS.length &&
    received.map((s) => s.name).join(",") === SKILL_NAMES.join(","),
  `names = ${JSON.stringify(received.map((s) => s.name))} (expected ${JSON.stringify(SKILL_NAMES)})`,
);

// The bodies, not just the names — BR-3 asserts each seat holds its OWN team's
// folder, and two `port-scan` folders in different teams differ only in body.
check(
  "each record arrived with its folder's body intact, not just its name",
  received.length === SKILLS.length &&
    received.every((s, i) => s.skillMd === SKILLS[i].skillMd),
  received.map((s) => `${s.name}: ${JSON.stringify((s.skillMd ?? "").slice(-16))}`).join(" | "),
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

// 3 — the shape itself is load-bearing. A kind that declares `seatSkills` as
// bare NAMES cannot take the loader's union: `hireWorkforce` hands over the
// records and the hire refuses. This is the control that would have caught this
// file's own earlier draft, which declared exactly that and passed.
const namesOnly = defineFlow({
  kind: "names-only",
  cardinality: "collection",
  configSchema: z.object({
    instructions: z.string().optional(),
    seatSkills: z.array(z.string()).default([]),
  }),
  actions: {},
} as never);

let nameOnlyRefusal = "";
try {
  const [seat] = hireWorkforce([manifest("pentest.recon", "names-only")] as never, {
    kinds: { "names-only": namesOnly },
  } as never);
  nameOnlyRefusal = seat === undefined ? "(hire returned no seat)" : "";
} catch (error) {
  nameOnlyRefusal = error instanceof Error ? error.message : String(error);
}

check(
  "CONTROL · a kind declaring seatSkills as bare NAMES is refused the real union",
  nameOnlyRefusal.length > 0,
  nameOnlyRefusal.length > 0
    ? `refused: ${nameOnlyRefusal.slice(0, 180)}`
    : "the hire SUCCEEDED — the record shape is not load-bearing and this check proves nothing",
);

console.log(`\n${failures === 0 ? "CONFIRMED" : "REFUTED"} — ${failures} failing assertion(s)`);
process.exit(failures === 0 ? 0 : 1);
