import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { goalTmpDir, readCapture, REPO_ROOT, runGoal } from "../../lib/index.mts";

const here = fileURLToPath(new URL(".", import.meta.url));
const capture = join(goalTmpDir("research-returns-a-cited-report"), "run.json");
const fsdev = join(REPO_ROOT, "packages/fsdev/bin/fsdev.ts");
const tsx = join(REPO_ROOT, "packages/fsdev/node_modules/.bin/tsx");
const config = join(here, "fixture/fsdev.config.mts");

await runGoal((failures, tell) => {
  const ran = spawnSync(tsx, [fsdev, "run", "research", "run", "--input", JSON.stringify({ question: "What does the fixture document?" }), "--config", config, "--capture", capture], {
    cwd: join(here, "fixture"), env: process.env, encoding: "utf8",
  });
  if (ran.status !== 0) {
    failures.push(`run: research app failed (exit ${ran.status}): ${`${ran.stderr}${ran.stdout}`.slice(-800)}`);
    return { failures, evidence: "the running app did not return a report" };
  }
  const output = readCapture(capture).result.output as {
    summary?: string; findings?: Array<{ claim: string; citations: string[] }>; sources?: Array<{ url: string }>;
    retrieval?: { urls?: string[]; attempts?: Record<string, number> };
    tasks?: Array<{ status: string; result?: { summary?: string; sources?: Array<{ url: string }> }; error?: string }>; completedSteps?: number;
  };
  const findings = tell.over("report:findings", output.findings ?? []);
  const sources = tell.over("report:sources", output.sources ?? []);
  const tasks = tell.over("state:tasks", output.tasks ?? []);
  const citations = tell.over("report:citations", findings.flatMap((finding) => finding.citations));
  const retrieved = tell.over("retrieval:urls", output.retrieval?.urls ?? []);
  if (!citations.every((citation) => sources.some((source) => source.url === citation))) failures.push(`report:citations · citations are not all retrieved sources: ${JSON.stringify(citations)}`);
  if (!citations.every((citation) => retrieved.includes(citation))) failures.push(`retrieval:urls · citation was not observed in a tool result: ${JSON.stringify({ citations, retrieved })}`);
  const task = tasks[0];
  if (output.completedSteps !== 1 || task?.status !== "completed" || task.result?.summary !== output.summary || task.result?.sources?.[0]?.url !== citations[0]) {
    failures.push(`state:tasks · typed task evidence did not feed the report: ${JSON.stringify(output)}`);
  }
  const attempts = output.retrieval?.attempts ?? {};
  if (attempts.search !== 2 || attempts.fetch !== 2 || attempts.crawl !== 1 || task?.error !== "injected flaky fetch") {
    failures.push(`retry:attempts · expected search=2, fetch=2, crawl=1 and retained first error, got ${JSON.stringify({ attempts, error: task?.error })}`);
  }
  return { failures, evidence: `report ${JSON.stringify(findings)}\nretrieval ${JSON.stringify(output.retrieval)}\ntasks ${JSON.stringify(tasks)}` };
});
