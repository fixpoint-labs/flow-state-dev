/**
 * The report's second renderer — the prose a developer reads while the assistant works.
 *
 * One shape, two renderers: JSON is the skill's contract, this is the transcript. Both are
 * projections of the same report, so the prose can never say something the JSON does not carry.
 *
 * **No secret value reaches either renderer**, because none reaches the report. Every credential
 * line here prints a status and a path.
 */
import { displayPath } from "./fs-util.mjs";

/**
 * One `label: value` line, aligned. The column is wide enough for the longest label this report
 * can produce — `GOOGLE_GENERATIVE_AI_API_KEY:` — because a label that overruns its column runs
 * straight into its value and the line becomes unreadable exactly where a credential is named.
 */
function row(label, value) {
  return `        ${label.padEnd(30)}${value}`;
}

/** The prose form. Returns the whole block, refusals included, ready to print. */
export function renderReport(report) {
  const root = report.roots.writeRoot;
  const lines = ["      ▸ running FSD detection …"];

  const hostLine =
    report.host.value === "next"
      ? `next ${report.host.nextRange ?? "?"} (app router)`
      : report.host.value === "next-unsupported"
        ? `next ${report.host.nextRange ?? "?"} — ${report.host.router ?? "no"} router, unsupported`
        : report.host.value;
  lines.push(row("host:", hostLine));

  if (report.appRoot.path !== null) lines.push(row("app root:", `./${report.appRoot.path}`));
  lines.push(
    row(
      "package manager:",
      report.packageManager.value === "ambiguous" || report.packageManager.value === "undeclared"
        ? `${report.packageManager.value.toUpperCase()} — ${report.packageManager.lockfiles.map((l) => displayPath(l.path, root)).join(", ") || "no lockfile, no declaration"}`
        : `${report.packageManager.value} (${displayPath(report.packageManager.source ?? "", root)})`,
    ),
  );
  lines.push(row("module:", report.moduleSystem));

  if (report.roots.workspaceRoot !== root) {
    lines.push(row("workspace root:", displayPath(report.roots.workspaceRoot, root)));
  }

  if (report.routeExtension.value !== null) {
    lines.push(
      row(
        "route extension:",
        `.${report.routeExtension.value} (${report.routeExtension.source === "Next's default" ? "pageExtensions not set — Next's default" : `from ${displayPath(String(report.routeExtension.source), root)}`})`,
      ),
    );
  }
  if (report.mount.path !== null) lines.push(row("mount answers on:", report.mount.path));

  if (report.host.topology === "mounted-route") {
    lines.push(
      row(
        "dev command:",
        report.devCommand.script === null
          ? "none found"
          : `${report.devCommand.script}  (${report.devCommand.command})`,
      ),
    );
  }

  lines.push(
    row(
      "fsdev.config:",
      report.fsdevConfig.winner === null
        ? "absent"
        : `${displayPath(report.fsdevConfig.winner, root)}${report.fsdevConfig.winnerIsOurs ? " (mine)" : " (yours)"}` +
          (report.fsdevConfig.shadowed.length > 0
            ? ` — ignoring ${report.fsdevConfig.shadowed.map((p) => displayPath(p, root)).join(", ")}`
            : ""),
    ),
  );
  lines.push(
    row(
      "AGENTS.md:",
      report.instructionsFile.present
        ? `present, ${report.instructionsFile.verdict === "absent" ? "no FSD section" : report.instructionsFile.verdict}`
        : "absent",
    ),
  );

  // Credentials: a status and a path per variable, per runtime. Never a value, never a prefix.
  for (const [key, resolution] of Object.entries(report.secrets)) {
    const where = resolution.cli.path === null ? (resolution.cli.from ?? "nowhere") : displayPath(resolution.cli.path, root);
    const divergence = resolution.divergent
      ? `  (next dev sees: ${resolution.next.status}${resolution.next.path === null ? "" : ` at ${displayPath(resolution.next.path, root)}`})`
      : "";
    lines.push(row(`${key}:`, `${resolution.cli.status} — ${where}${divergence}`));
  }

  for (const slot of report.routeSlots) {
    if (slot.occupants.length === 0) continue;
    lines.push(
      row(
        "route slot:",
        `${displayPath(slot.slot, root)} holds ${slot.occupants.map((o) => `${o.path.split("/").pop()}${o.ours ? " (mine)" : ""}`).join(", ")}`,
      ),
    );
  }

  if (report.refusals.length > 0) {
    lines.push("");
    lines.push("      I haven't written anything, and I'm not going to until this is sorted:");
    for (const item of report.refusals) {
      lines.push("");
      lines.push(`      · ${item.message}`);
      lines.push(`          ${item.remediation}`);
    }
    return lines.join("\n");
  }

  lines.push("");
  lines.push(
    report.host.topology === "mounted-route"
      ? "      FSD will answer inside the server you already run, as a mounted route."
      : "      Your project has no convention that tells me where an FSD route would go, so FSD\n      will run as its own process alongside your server rather than inside it.",
  );
  return lines.join("\n");
}
