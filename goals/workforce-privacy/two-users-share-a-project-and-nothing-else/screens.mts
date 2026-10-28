/**
 * What Shift Manager's screens draw for one person, read in their own browser
 * context with their own bearer, and the one screen the final run types into
 * (a project's Stream). Every read here is compared by the caller, by id, with
 * what the store returns through the install's routes; nothing here grades.
 */
import type { Browser, Page } from "playwright";
import { openShiftManager, personPage } from "../../lib/shift-manager.mts";
import type { Person } from "./people.mts";
import { messageOf, type RunRecord } from "./record.mts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const OWN_WORKERS_READ = /\/sessions\/[^/]+\/resources\/workforceWorkers$/;

/** A project's address, as a path segment pair. */
export type ProjectAt = { visibility: "shared" | "private"; id: string };
export const projectPath = (p: ProjectAt, tab: string) => `/p/${p.visibility === "private" ? "private/" : ""}${encodeURIComponent(p.id)}/${tab}`;

/** Open a page as `person`, run `read` on it, screenshot it, and close it. */
export async function onPage<T>(browser: Browser, origin: string, person: Person, owner: boolean, record: RunRecord, shot: string, read: (page: Page) => Promise<T>): Promise<{ value?: T; errors: string[] }> {
  const opened = await personPage(browser, origin, { userId: person.userId, bearer: person.bearer }, owner);
  try {
    const value = await read(opened.page);
    await record.shot(opened.page, shot);
    return { value, errors: opened.errors };
  } catch (error) {
    await record.shot(opened.page, `${shot}-failed`);
    return { errors: [...opened.errors, messageOf(error)] };
  } finally {
    await opened.context.close().catch(() => undefined);
  }
}

/** The Roster's rows, read once the person's own-worker read has landed and every worker it returned is drawn. */
export async function rosterRows(browser: Browser, origin: string, person: Person, owner: boolean, record: RunRecord, shot: string) {
  return onPage(browser, origin, person, owner, record, shot, async (page) => {
    const ownRead = page
      .waitForResponse((res) => res.request().method() === "GET" && OWN_WORKERS_READ.test(new URL(res.url()).pathname), { timeout: 45_000 })
      .then(async (res) => (res.ok() ? ((await res.json()) as { items: Array<{ topic: string }> }).items.map((i) => i.topic.slice(i.topic.lastIndexOf("/") + 1)) : `answered ${res.status()}`))
      .catch((error: unknown) => `failed (${messageOf(error)})`);
    await openShiftManager(page, origin, "/roster");
    await page.locator("[data-testid=roster-worker]").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    const read = await ownRead;
    const rows = async () =>
      page.locator("[data-testid=roster-worker]").evaluateAll((els) => els.map((e) => ({ id: e.getAttribute("data-worker-id") ?? "", own: e.getAttribute("data-own") === "true", kind: e.querySelector("p + p")?.textContent?.split("·")[0]?.trim() ?? "" })));
    let drawn = await rows();
    const undrawn = () => (typeof read === "string" ? [] : read.filter((id) => !drawn.some((r) => r.id === id)));
    for (const until = Date.now() + 15_000; undrawn().length > 0 && Date.now() < until; await sleep(250)) drawn = await rows();
    const ownUnread = typeof read === "string" ? `their own-worker read ${read}` : undrawn().length > 0 ? `their own-worker read returned ${undrawn().join(", ")}, which the screen never drew` : undefined;
    return { rows: drawn, ownUnread };
  });
}

/** PROJECTS in the sidebar: each group's `visibility:id`. */
export async function projectGroups(browser: Browser, origin: string, person: Person, owner: boolean, record: RunRecord, shot: string) {
  return onPage(browser, origin, person, owner, record, shot, async (page) => {
    await openShiftManager(page, origin, "/inbox");
    await page.getByTestId("project-group").first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await sleep(1_000);
    return page.getByTestId("project-group").evaluateAll((els) => els.map((g) => `${g.getAttribute("data-visibility") ?? ""}:${g.getAttribute("data-project-id") ?? ""}`));
  });
}

/** A project's Workstreams tab: the progress count, and each entry drawn by owner and id, with its status text. */
export async function projectWorkstreams(browser: Browser, origin: string, person: Person, owner: boolean, record: RunRecord, shot: string, project: ProjectAt) {
  return onPage(browser, origin, person, owner, record, shot, async (page) => {
    await openShiftManager(page, origin, projectPath(project, "workstreams"));
    await page.getByTestId("project-progress").waitFor({ timeout: 15_000 });
    await page.getByTestId("project-entry").first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    const count = Number(await page.getByTestId("project-progress").getAttribute("data-workstreams"));
    const objectives = ((await page.getByTestId("project-objectives").textContent().catch(() => "")) ?? "").trim();
    const entries = await page.locator("[data-testid=project-entry]").evaluateAll((els) =>
      els.map((e) => ({ owner: e.getAttribute("data-owner") ?? "", id: e.getAttribute("data-workstream-id") ?? "", text: (e.textContent ?? "").replace(/\s+/g, " ").trim() })),
    );
    return { count, objectives, entries };
  });
}

/**
 * Ask in a project's Stream, as a person does: type in its composer and send.
 * Returns the conversation session the Stream draws, read off the page.
 */
export async function askInStream(browser: Browser, origin: string, person: Person, owner: boolean, record: RunRecord, shot: string, project: ProjectAt, words: string) {
  return onPage(browser, origin, person, owner, record, shot, async (page) => {
    await openShiftManager(page, origin, projectPath(project, "stream"));
    const sessionId = await page
      .waitForFunction(() => document.querySelector("[data-testid=project-stream-conversation]")?.getAttribute("data-session-id") || null, undefined, { timeout: 30_000 })
      .then((h) => h.jsonValue() as Promise<string>);
    const input = page.getByTestId("project-stream-composer-input");
    await input.waitFor({ timeout: 15_000 });
    await input.fill(words);
    await page.getByTestId("project-stream-composer-send").click();
    // The composer clears once the post is sent; the turn runs on the server.
    await page.waitForFunction(() => ((document.querySelector("[data-testid=project-stream-composer-input]") as HTMLTextAreaElement | null)?.value ?? "x") === "", undefined, { timeout: 30_000 });
    await sleep(2_000);
    return { sessionId };
  });
}

/** The delegates panel on the Shift Coordinator's view: the delegates drawn and the workers its picker offers. */
export async function delegatesPanel(browser: Browser, origin: string, person: Person, owner: boolean, record: RunRecord, shot: string) {
  return onPage(browser, origin, person, owner, record, shot, async (page) => {
    await openShiftManager(page, origin, "/");
    await page.getByTestId("shift-coordinator-delegates").waitFor({ timeout: 30_000 });
    const delegates = await page.locator("[data-testid=shift-coordinator-delegate]").evaluateAll((els) => els.map((e) => e.getAttribute("data-worker") ?? ""));
    const offered = await page
      .locator("[data-testid=shift-coordinator-delegate-pick] option")
      .evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value).filter((v) => v !== ""))
      .catch(() => [] as string[]);
    return { delegates, offered };
  });
}
