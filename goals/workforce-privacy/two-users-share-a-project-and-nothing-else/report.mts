/**
 * The report, in PLAN → The report's shape: the head, part 1's steps and
 * model turns, the controls with their patches in full, and the findings. A
 * milestone run has no J1 and no parts 3 and 4, and says so; the final run
 * fills those sections in.
 *
 * Written to the run's scratch directory. It quotes held-out names and the
 * word, never a key.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MilestoneFacts } from "./milestone.mts";
import type { RunRecord } from "./record.mts";

/** One run of steps: plain, or under a control. */
export interface StepsRun {
  label: string;
  record: RunRecord;
  facts?: MilestoneFacts;
  /** Each patch it ran on, in full. */
  patches: string[];
  stores: Array<{ file: string; steps: string }>;
  ms: number;
}

export interface Report {
  kind: "milestone" | "final";
  run: string;
  served: string;
  commit: string;
  merges: string[];
  model: string;
  provider: string;
  chromium: string;
  runs: StepsRun[];
  controls: Array<{ control: string; ok: boolean; line: string }>;
  setup: string[];
  cost: string[];
  failures: string[];
}

const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");

export function writeReport(scratch: string, r: Report): string {
  const out: string[] = [];
  out.push(`# FIX-1797 · ${r.kind === "milestone" ? "the milestone run (FIX-1805)" : "the final run"}`, "");
  out.push("## 1. Head", "");
  out.push(`- Run: ${r.kind}, \`${r.run}\``);
  out.push(`- Commit served: ${r.served}`);
  out.push(`- FIX-1788 merges on it (first parent): ${r.merges.length === 0 ? "none found" : r.merges.map((m) => `\`${m}\``).join("; ")}`);
  out.push(`- Model: \`${r.model}\` through ${r.provider} (the key is never printed)`);
  out.push(`- Chromium: ${r.chromium}`);
  out.push(`- Store files (QR-8; each fresh, all deleted when the run ends): ${r.runs.flatMap((x) => x.stores.map((s) => `\`${s.file}\` (${x.label}: ${s.steps})`)).join("; ")}`);
  for (const line of r.setup) out.push(`- ${line}`);
  out.push("", "## 2. Part 1 · the milestone's steps", "");
  for (const run of r.runs) {
    out.push(`### ${run.label}`, "");
    if (run.facts !== undefined) {
      const f = run.facts;
      out.push(`Held out: word \`${f.word}\`; standard worker ${f.standard === undefined ? "none picked" : `\`${f.standard.id}\` on \`${f.standard.flow}\``}; Alice's worker ${f.aliceWorker === undefined ? "none made" : `\`${f.aliceWorker}\``}; Bob's ${f.bobWorker === undefined ? "none made" : `\`${f.bobWorker}\``}; made through ${f.madeThrough ?? "no action"}.`, "");
    }
    for (const boot of run.record.boots) out.push(`- boot "${boot.label}": \`${boot.config}\`, ${Math.round(boot.ms / 1000)} s`);
    out.push("", "| Step | Verdict | Surface | What it showed |", "|---|---|---|---|");
    for (const [id, e] of run.record.steps) out.push(`| ${id} | ${e.verdict} | ${[...e.surfaces].join(", ")} | ${cell(e.notes.join(" · ")).slice(0, 4000)} |`);
    out.push("");
    for (const t of run.record.turns) {
      out.push(`- Model turn ${t.step}, as ${t.who}: "${t.words}" · session \`${t.sessionId}\` · request \`${t.requestId}\` · ${t.status}${t.providerRetry === undefined ? "" : ` · re-run once after a provider error: ${t.providerRetry}`}`);
      for (const tool of t.tools) out.push(`  - tool \`${tool.name}\` (item \`${tool.itemId}\`): ${tool.args} → ${tool.output}`);
      out.push(`  - answered (item \`${t.replyItemId}\`): "${t.reply.replace(/\s+/g, " ").slice(0, 400)}"`);
      if (t.items !== undefined) out.push(`  - no assistant message stored; the request's items: ${t.items.join(", ") || "none"}`);
    }
    if (run.record.screenshots.length > 0) out.push(`- screenshots: ${run.record.screenshots.map((s) => `\`${s.split("/").pop()}\``).join(", ")}`);
    out.push("");
  }
  out.push("## 3. Controls", "");
  if (r.controls.length === 0) out.push("None ran.");
  for (const c of r.controls) out.push(`- **${c.control}**: ${c.ok ? "failed as it must" : "DID NOT fail as it must"}. ${c.line}`);
  for (const run of r.runs.filter((x) => x.patches.length > 0)) {
    out.push("", `<details><summary>${run.label}: patches, in full</summary>`, "", "```diff", ...run.patches, "```", "", "</details>");
  }
  out.push("", "## 4. J1", "", r.kind === "milestone" ? "Not part of the milestone." : "");
  out.push("", "## 5. Parts 3 and 4", "", r.kind === "milestone" ? "Not part of the milestone." : "");
  out.push("", "## Cost of a rerun (QR-15)", "", ...r.cost.map((c) => `- ${c}`));
  out.push("", "## 6. Findings", "", ...(r.failures.length === 0 ? ["None."] : r.failures.map((f) => `- ${f.replaceAll("\n", " ").slice(0, 900)}`)));
  const path = join(scratch, "report.md");
  writeFileSync(path, out.join("\n") + "\n");
  return path;
}
