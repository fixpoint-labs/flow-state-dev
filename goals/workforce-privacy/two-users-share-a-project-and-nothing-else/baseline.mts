/**
 * The pre-epic baseline as a control (PLAN → The pre-epic baseline): its own
 * checkout, build and fresh store, driven the way that commit's app allows.
 * It must fail leg a at a1 or a2, leg b at b1 or b2, each naming what the
 * baseline lacks, and leg c at c2 on its merits: Alice hires a worker through
 * the chief of staff's screen, and Bob's Roster draws it.
 *
 * Every attempt goes through the app as that person, with their own bearer;
 * a refusal or a missing surface is recorded as the failure it is.
 */
import { randomBytes } from "node:crypto";
import type { Browser } from "playwright";
import { openShiftManager, personPage } from "../../lib/shift-manager.mts";
import type { Install } from "./install.mts";
import { act, refusal, type Person } from "./people.mts";
import { messageOf, type RunRecord } from "./record.mts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface BaselineOptions {
  install: Install;
  browser: Browser;
  record: RunRecord;
  people: { alice: Person; bob: Person };
  config: string;
  say(line: string): void;
}

/** A session on `flowKind` for `who`, or why the baseline has none. */
async function sessionFor(o: BaselineOptions, who: Person, flowKind: string): Promise<{ id?: string; why?: string }> {
  const c = o.install.as(who);
  const made = await refusal(() => c.flow(flowKind).createSession());
  if (made.status !== undefined) return { why: `no \`${flowKind}\` session opens (${made.status}: ${made.error})` };
  return { id: (made.value as { id: string }).id };
}

/** Run `action` on a fresh `flowKind` session; the reason it didn't complete, or `undefined` when it did. */
async function attempt(o: BaselineOptions, who: Person, flowKind: string, action: string, input: unknown): Promise<string | undefined> {
  const s = await sessionFor(o, who, flowKind);
  if (s.id === undefined) return s.why;
  const done = await act(o.install.as(who), flowKind, s.id, action, input);
  return done.status === "completed" && (done.output as { ok?: boolean } | undefined)?.ok !== false ? undefined : `\`${flowKind}.${action}\` ${done.status}: ${done.error ?? JSON.stringify(done.output)?.slice(0, 200)}`;
}

export async function baselineLegs(o: BaselineOptions): Promise<void> {
  const r = o.record;
  const { alice: A, bob: B } = o.people;
  await o.install.boot("baseline", o.config);
  try {
    // ---- leg a ----
    r.via("a1", "action");
    const roster = await refusal(() => o.install.as(A).workforce.roster());
    if (roster.status !== undefined) r.fail("a1", `the baseline has no per-user roster: ${roster.error}`);
    else r.saw("a1", `Alice's roster read answered: ${JSON.stringify(roster.value).slice(0, 300)}`);
    r.via("a2", "action");
    const fork = await attempt(o, A, "workforce-roster", "fork", { from: "eng.em", id: `fork-${randomBytes(2).toString("hex")}` });
    if (fork !== undefined) r.fail("a2", `the baseline has no fork: ${fork}`);
    else r.saw("a2", "a fork completed");

    // ---- leg b ----
    r.via("b1", "action");
    const priv = await attempt(o, A, "projects", "createProject", { id: `p-${randomBytes(2).toString("hex")}`, title: "Private", visibility: "private" });
    if (priv !== undefined) r.fail("b1", `the baseline has no private project: ${priv}`);
    else r.saw("b1", "a private project was created");
    r.via("b2", "action");
    const ws = await attempt(o, A, "projects", "openWorkstream", { project: { visibility: "shared", id: "storefront" }, id: `w-${randomBytes(2).toString("hex")}`, title: "Mine", lead: "eng.em", objectives: ["Keep it"] });
    if (ws !== undefined) r.fail("b2", `the baseline has no workstream an owner holds: ${ws}`);
    else r.saw("b2", "a workstream was opened");

    // ---- leg c: the org-locked hire every member reaches ----
    r.via("c2", "screen");
    const name = `baseline-${randomBytes(3).toString("hex")}`;
    o.say(`baseline c2: Alice hires \`${name}\` through the chief of staff's screen`);
    const alicePage = await personPage(o.browser, o.install.origin, { userId: A.userId, bearer: A.bearer }, true);
    try {
      await openShiftManager(alicePage.page, o.install.origin, "/");
      const input = alicePage.page.getByTestId("cos-composer-input");
      await input.waitFor({ timeout: 30_000 });
      await input.fill(`Please hire a coder seat with the id "${name}". Just hire it.`);
      await alicePage.page.getByTestId("cos-composer-send").click();
      await r.shot(alicePage.page, "baseline-c2-alice-asked");
    } catch (error) {
      r.fail("c-setup", `Alice couldn't ask the chief of staff on the baseline: ${messageOf(error)}`);
    } finally {
      await alicePage.context.close().catch(() => undefined);
    }
    let aliceSees = false;
    let bobSees = false;
    for (const until = Date.now() + 240_000; Date.now() < until && !(aliceSees && bobSees); await sleep(5_000)) {
      aliceSees = (await o.install.screen("baseline-c2", A, true, "/roster", "alice-roster")).text.includes(name);
      if (aliceSees) bobSees = (await o.install.screen("baseline-c2", B, false, "/roster", "bob-roster")).text.includes(name);
    }
    if (!aliceSees) r.fail("c-setup", `Alice's hire \`${name}\` never reached her own Roster, so c2 shows nothing on the baseline`);
    else if (bobSees) r.fail("c2", `Bob reads Alice's worker: his Roster draws \`${name}\`, the hire Alice made through the chief of staff`);
    else r.saw("c2", `Bob's Roster doesn't draw Alice's hire \`${name}\``);
  } finally {
    await o.install.stop();
  }
}
