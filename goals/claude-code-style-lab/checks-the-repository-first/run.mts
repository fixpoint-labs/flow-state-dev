/**
 * Goal check: the Claude Code-style lab checks a project's repository when the
 * project is made. A folder that is not a git repository, and a repository that
 * doesn't ignore `.fsdev/`, are refused `repository-unusable` by the server,
 * and the picker shows each problem before Create is pressed, with Create off.
 * A repository the lab lists is made, and the picker says its runs work in
 * worktrees.
 *
 * One lab on `fsdev dev --app`, a fresh data folder, every coding task on the
 * scripted coder (nothing here calls a model). The server is graded through the
 * public client (`createProject`, `listProjects`); the page is read only for
 * what it shows under the field and whether Create is on.
 *
 * Control (`GOAL_CONTROL=<name>`, same command):
 *   - `no-repository-check`: the lab's projects flow is built with no
 *     repository check (`fsdev.config.mts` reads it). Must FAIL refused: both
 *     projects are made.
 *
 * Run: pnpm tsx goals/claude-code-style-lab/checks-the-repository-first/run.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createClient } from "@flow-state-dev/client";
import { goalTmpDir, loadFixture, runGoal, stopProcessGroup } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { git, labCheckout, makeRepository, startLab } from "../lab.mts";

const fixture = loadFixture<{ plainProject: string; unignoredProject: string; goodProject: string }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "no-repository-check") throw new Error(`setup: no control named ${CONTROL}`);
const USER = "u_goal";
const PROJECTS_FLOW = "projects";

/** A project id the lab's picker would make from `name`, as `lib/new-project.ts` does. */
const idOf = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

await runGoal(async (failures, tell) => {
  const labBefore = labCheckout();
  const scratch = goalTmpDir("claude-code-style-repository-check");
  const notes: string[] = [];
  let lab: Awaited<ReturnType<typeof startLab>> | undefined;
  let browser: Awaited<ReturnType<typeof launchChromium>> | undefined;
  try {
    // Three folders the run makes, under names no lab file holds.
    const plain = join(scratch, "loose-files");
    mkdirSync(plain, { recursive: true });
    writeFileSync(join(plain, "notes.txt"), "not a repository\n");
    const unignored = join(scratch, "bare-checkout");
    mkdirSync(unignored, { recursive: true });
    git(unignored, "init", "-q", "-b", "main");
    writeFileSync(join(unignored, "README.md"), "# No ignore rule\n");
    git(unignored, "add", ".");
    git(unignored, "-c", "user.email=goal@example.com", "-c", "user.name=goal", "commit", "-q", "-m", "start");
    const good = makeRepository(join(scratch, "ready-repo"));

    lab = await startLab(join(scratch, "data"), USER, {
      CLAUDE_CODE_STYLE_HARNESS: "stub",
      CLAUDE_CODE_STYLE_REPOSITORIES: [unignored, good].join(":"),
      GOAL_CONTROL: CONTROL,
      AI_GATEWAY_API_KEY: "",
      OPENAI_API_KEY: "",
      ANTHROPIC_API_KEY: "",
      OPENROUTER_API_KEY: "",
    });
    const fsd = createClient({ userId: USER, baseUrl: lab.origin });
    const session = (await fsd.flow(PROJECTS_FLOW).createSession()).id;
    const act = async (action: string, input: unknown): Promise<{ status: string; output?: any; error?: string }> => {
      const sent = await fsd.flow(PROJECTS_FLOW).send(action, input, { sessionId: session });
      const { status } = await sent.wait();
      const found = (await fsd.sessions.requests(session, { includeResultOutput: true, limit: 50 })).find((r) => r.id === sent.id);
      return { status, output: found?.result?.output, error: found?.result?.error?.message };
    };
    const listed = async (): Promise<string[]> => ((await act("listProjects", {})).output?.projects ?? []).map((p: { id: string }) => p.id);

    // ── refused: the server refuses both unusable repositories, and lists neither.
    for (const [name, folder] of [[fixture.plainProject, plain], [fixture.unignoredProject, unignored]] as const) {
      const made = await act("createProject", { id: idOf(name), title: name, visibility: "private", repository: pathToFileURL(folder).href });
      const words = tell.over(`refused · ${name}: the refusal`, made.error === undefined ? [] : [made.error])[0] ?? "";
      if (made.status === "completed" || !words.includes("repository-unusable")) {
        failures.push(`refused: ${name} (${folder}) was ${made.status === "completed" ? "made" : `refused with ${JSON.stringify(words.slice(0, 160))}`}, not refused repository-unusable`);
      } else notes.push(`refused: ${name}: ${JSON.stringify(words.slice(0, 90))}`);
    }
    const afterRefusals = await listed();
    for (const name of [fixture.plainProject, fixture.unignoredProject]) {
      if (afterRefusals.includes(idOf(name))) failures.push(`refused: listProjects holds ${idOf(name)}`);
    }

    // ── same-words and made, in the page: the problem shows before Create; a listed repository is made.
    browser = await launchChromium();
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    page.setDefaultTimeout(30_000);
    const pageErrors: string[] = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto(lab.origin);
    const form = page.getByRole("form", { name: "New project" });
    const create = form.getByRole("button", { name: "Create project" });
    const typeIn = async (name: string, folder: string) => {
      await form.getByLabel("Project name").fill(name);
      await form.getByLabel("Repository").fill(pathToFileURL(folder).href);
      await form.getByLabel("Project name").focus(); // leaves the repository field
    };
    for (const [name, folder, expected] of [
      [fixture.plainProject, plain, "is not a git repository"],
      [fixture.unignoredProject, unignored, "**/.fsdev/"],
    ] as const) {
      await typeIn(name, folder);
      const problem = form.getByTestId("repository-problem");
      const shown = await problem.waitFor({ timeout: 15_000 }).then(async () => (await problem.textContent()) ?? "", () => "");
      if (!shown.includes(expected)) failures.push(`same-words: for ${name} the picker showed ${JSON.stringify(shown.slice(0, 160))}, not the server's problem naming ${expected}`);
      else if (!(await create.isDisabled())) failures.push(`same-words: Create was on for ${name}, whose repository the check refused`);
      else notes.push(`same-words: ${name}'s problem shown, Create off`);
    }
    await typeIn(fixture.goodProject, good);
    const disclosure = form.getByTestId("repository-disclosure");
    const said = await disclosure.waitFor({ timeout: 15_000 }).then(async () => (await disclosure.textContent()) ?? "", () => "");
    if (!said.includes("worktree")) failures.push(`made: the picker said ${JSON.stringify(said)} for a listed repository, not that runs work in worktrees`);
    await create.click();
    await page.getByRole("region", { name: "Choose a project" }).getByRole("button", { name: fixture.goodProject }).waitFor({ timeout: 15_000 }).catch(() => undefined);
    if (!(await listed()).includes(idOf(fixture.goodProject))) failures.push(`made: ${fixture.goodProject} on a listed repository with the rule was not made`);
    else notes.push(`made: ${fixture.goodProject}, and the picker said ${JSON.stringify(said.slice(0, 70))}`);

    if (pageErrors.length > 0) failures.push(`page errors: ${pageErrors.join(" | ")}`);
    return { failures, evidence: notes.join("; ") };
  } finally {
    await browser?.close();
    if (lab !== undefined) stopProcessGroup(lab.child);
    if (labCheckout() !== labBefore) failures.push("the lab's own checkout changed");
  }
});
