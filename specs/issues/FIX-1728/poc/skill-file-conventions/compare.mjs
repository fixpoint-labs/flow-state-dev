import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const variants = [
  {
    title: "A · placement is scope (recommended)",
    directory: "variant-a-placement",
    required: [
      "workforce/org/skills/house-style/SKILL.md",
      "workforce/teams/pentest/skills/port-scan/SKILL.md",
      "workforce/teams/pentest/workers/recon/WORKER.md",
      "workforce/teams/pentest/workers/recon/skills/sweep/SKILL.md",
    ],
  },
  {
    title: "B · selectors are scope",
    directory: "variant-b-selectors",
    required: [
      "workforce/skills/house-style/SKILL.md",
      "workforce/skills/port-scan/SKILL.md",
      "workforce/skills/sweep/SKILL.md",
      "workforce/teams/pentest/workers/recon/WORKER.md",
    ],
  },
  {
    title: "C · workers import skills",
    directory: "variant-c-imports",
    required: [
      "workforce/skills/house-style/SKILL.md",
      "workforce/skills/port-scan/SKILL.md",
      "workforce/skills/sweep/SKILL.md",
      "workforce/teams/pentest/workers/recon/WORKER.md",
    ],
  },
];

for (const variant of variants) {
  for (const relative of [...variant.required, "consumer.ts"]) {
    await access(path.join(here, variant.directory, relative));
  }
  const consumer = await readFile(
    path.join(here, variant.directory, "consumer.ts"),
    "utf8",
  );
  console.log(
    `\n${"═".repeat(72)}\n${variant.title}\n${"─".repeat(72)}\n${consumer.trim()}\n`,
  );
}

console.log("PASS · all three convention sketches are complete");
