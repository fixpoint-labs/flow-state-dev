/**
 * Characterization POC for FIX-1774: replay Jake's dogfood ask against the
 * DevTeam Lab's chief of staff on a real model and record what it did.
 *
 * Throwaway evidence, not a goal check. It reads, through the Lab's own
 * routes: the tool calls the turn made, the organization's hired roster, the
 * rows on every collection the feature mailbox's session declares, and the
 * reply. Nothing is graded; the output is the record.
 *
 *   pnpm tsx specs/issues/FIX-1774/poc/the-dogfood-turn/run.mts
 *
 * Needs AI_GATEWAY_API_KEY, OPENAI_API_KEY or OPENROUTER_API_KEY.
 * LINES overrides the lines said, separated by "||".
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { goalTmpDir, REPO_ROOT } from "../../../../../goals/lib/index.mts";
import { labApi, startShiftManager } from "../../../../../goals/lib/shift-manager.mts";

const COS = "chief-of-staff";
const LINES = (process.env.LINES ??
  "Build a simple React hello-world app with Claude Code. Hire a worker if you need to.||Just do it, I don't care how.")
  .split("||");

const scratch = goalTmpDir("fix-1774-dogfood");
mkdirSync(scratch, { recursive: true });
const pages = mkdtempSync(join(scratch, "pages-"));
writeFileSync(join(pages, "index.html"), "<!doctype html><html><head></head><body>routes only</body></html>");
const store = join(mkdtempSync(join(scratch, "store-")), "devteam.sqlite");
const served = await startShiftManager({
  scratch,
  label: "devteam",
  config: join(REPO_ROOT, "labs", "shift-manager", "teams", "devteam", "fsdev.config.mts"),
  pages,
  env: { DEVTEAM_STORE: store },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
try {
  const html = await (await fetch(`${served.origin}/`)).text();
  const { userId, bearerToken } = JSON.parse(/window\.__FSD_DEVTOOL_CONFIG__ = (\{.*?\});<\/script>/.exec(html)![1]!);
  const api = labApi(served.origin, bearerToken);
  const opened = await api.call("POST", `/${COS}/sessions`, { userId });
  const session = opened.body.session.id as string;
  for (const line of LINES) {
    const posted = await api.call("POST", `/${COS}/${session}/actions/run`, { userId, input: { message: line } });
    const requestId = posted.body.request.id as string;
    let status = "";
    for (const until = Date.now() + 240_000; Date.now() < until; await sleep(500)) {
      status = (await api.call("GET", `/${COS}/requests/${requestId}/status`)).body?.status;
      if (!["pending", "queued", "in_progress", "running"].includes(status)) break;
    }
    console.log(`\n=== SAID: ${line}\n--- turn: ${status}`);
  }
  // Give detached deliveries a moment to land.
  await sleep(5000);
  const items = await api.items(session);
  for (const item of items) {
    if (item.type === "message") console.log(`[${item.role}] ${JSON.stringify(item.content).slice(0, 1500)}`);
    else if (String(item.type).includes("tool")) console.log(`[${item.type}] ${JSON.stringify({ name: item.toolName ?? item.name, input: item.input ?? item.args, output: item.output ?? item.result }).slice(0, 800)}`);
  }
  const manifest = await api.get(`/sessions/${session}/manifest`);
  for (const r of manifest.resources as Array<{ kind: string; pattern?: string; ref: string }>) {
    if (r.kind !== "collection") continue;
    if (!/roster|seats/.test(r.pattern ?? "")) continue;
    console.log(`\n--- ${r.pattern}`);
    for (const row of await api.collection(session, r.ref)) console.log(JSON.stringify(row).slice(0, 300));
  }
  const mailbox = await api.get(`/sessions/eng.feature/manifest`).catch((e) => ({ error: String(e) }));
  for (const r of (mailbox.resources ?? []) as Array<{ kind: string; pattern?: string; ref: string }>) {
    if (r.kind !== "collection") continue;
    console.log(`\n--- eng.feature ${r.pattern}`);
    for (const row of await api.collection("eng.feature", r.ref)) console.log(JSON.stringify(row).slice(0, 300));
  }
  if ("error" in mailbox) console.log(mailbox.error);
  console.log("\n--- eng.feature items");
  for (const item of await api.items("eng.feature")) console.log(JSON.stringify(item).slice(0, 400));
  console.log("\n--- server log (notify / errors)");
  writeFileSync(join(scratch, "server.log"), served.log());
  console.log(`server log: ${join(scratch, "server.log")}`);
} finally {
  await served.stop();
}
