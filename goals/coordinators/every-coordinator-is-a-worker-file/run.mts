/**
 * Goal check: every coordinator is a worker file, and nothing of the mailbox
 * is left (FIX-1792). See goal.md for the contract.
 *
 *   a  the converted desk: a coordinator `WORKER.md` on `routing: everyone`
 *      over two agent workers, served from the published packages on SQLite
 *      with a scripted model. One post from a person gets one answer line per
 *      delegate, under its name, and none by anyone else; the tree holds no
 *      `MAILBOX.md`.
 *   b  the repo: `check.mjs --after` passes; every goal the checker marks
 *      CONVERT or REWRITE has a PASS verdict line on the tagged commit; the
 *      three retired goals are named under "Retired by FIX-1792" in
 *      goals/README.md and their folders are gone.
 *
 * The team, coordinator and delegate ids are read off the tree, so a renamed
 * tree grades the same way.
 *
 * Run:      pnpm --dir goals exec tsx coordinators/every-coordinator-is-a-worker-file/run.mts
 * Legs:     GOAL_LEGS=a | GOAL_LEGS=b (default both)
 * Tag:      GOAL_VERDICT_TAG (default "FIX-1792 P4"), the string a verdict line's Commit cell must carry
 * Controls: GOAL_CONTROL=mailbox-left  the desk's old MAILBOX.md and one removed export planted in the
 *                                      tree: must FAIL at a:no-mailbox-file and b:after, and nothing else
 */
import { createInProcessFetch } from "@flow-state-dev/engine";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, goalTmpDir, repoPath, runGoal } from "../../lib/index.mts";

const TREE = fileURLToPath(new URL("./fixtures/workforce", import.meta.url));
const CHECK = repoPath("specs", "issues", "FIX-1792", "poc", "inventory", "check.mjs");
const README = repoPath("goals", "README.md");
const CONTROL = process.env.GOAL_CONTROL ?? "";
const LEGS = new Set((process.env.GOAL_LEGS ?? "a,b").split(",").map((l) => l.trim()).filter(Boolean));
const TAG = process.env.GOAL_VERDICT_TAG ?? "FIX-1792 P4";

/** The goals FIX-1792 retires; each must be named in the README and gone from the tree. */
const RETIRED = [
  "workforce-conventions/a-mailbox-holds-the-work-a-seat-drains",
  "kitchen-sink-talk/lists-a-filed-case-without-a-reload",
  "workforce-mailboxes/a-pre-rename-lab-is-refused-by-name",
];

/** The assertions each control must redden, and only those (among the legs run). */
const EXPECTED: Record<string, string[]> = {
  "mailbox-left": ["a:no-mailbox-file", "b:after"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}
for (const leg of LEGS) if (leg !== "a" && leg !== "b") throw new Error(`unknown leg "${leg}" in GOAL_LEGS`);

// ---- the tree: the coordinator and its delegates, read at run time ----------
const { workers, errors: treeErrors } = await readWorkforce(TREE);
const coordinators = workers.filter((w) => w.declared.flow === "coordinator");
const coordinator = coordinators[0];
if (coordinators.length !== 1 || coordinator === undefined) {
  throw new Error(`the fixture needs one coordinator; read ${coordinators.map((w) => w.id).join(", ") || "none"}`);
}
const team = coordinator.id.split(".")[0]!;
const coordinatorName = coordinator.id.slice(team.length + 1);
const delegates = (coordinator.declared.delegates ?? []) as string[];

// ---- the control's plants ---------------------------------------------------
// The removed export is spelled in two halves so this file does not itself name it.
const REMOVED_EXPORT = ["open", "Mailboxes"].join("");
const PLANTS: Array<[string, string]> =
  CONTROL === "mailbox-left"
    ? [
        [
          join(TREE, "teams", team, "mailboxes", coordinatorName, "MAILBOX.md"),
          `---\ndescription: ${String(coordinator.declared.description ?? "")}\nmembers: [${delegates.join(", ")}]\n---\n\n${coordinator.body ?? ""}\n`,
        ],
        [repoPath("packages", "workforce", "src", "__mailbox_left_control__.ts"), `export { ${REMOVED_EXPORT} } from "./mailbox";\n`],
      ]
    : [];
/** Remove every plant, and the folders made for them. Safe to call twice. */
const unplant = () => {
  for (const [path] of PLANTS) rmSync(path, { force: true });
  if (PLANTS.length > 0) rmSync(join(TREE, "teams", team, "mailboxes"), { recursive: true, force: true });
};
if (PLANTS.length > 0) {
  process.on("exit", unplant);
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => {
      unplant();
      process.exit(130);
    });
  }
}

/** Every file under `dir`, as absolute paths. */
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** The cells of each row of the first table after `heading`, header row first. */
function table(markdown: string, heading: RegExp): string[][] {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => heading.test(l));
  if (at < 0) return [];
  const rows: string[][] = [];
  for (const line of lines.slice(at + 1)) {
    if (/^#{1,6}\s/.test(line)) break;
    if (!line.trim().startsWith("|")) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (tag: string, line: string) => failures.push(`[${tag}] ${line}`);
  try {
    for (const [path, text] of PLANTS) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text);
    }

    // ==== leg a: the converted desk =========================================
    if (LEGS.has("a")) {
      // a:no-mailbox-file — the tree under test is a converted desk.
      const left = walk(TREE).filter((f) => f.endsWith("/MAILBOX.md"));
      if (left.length > 0) fail("a:no-mailbox-file", `the tree holds ${left.map((f) => relative(TREE, f)).join(", ")}`);
      else evidence.push(`a: the tree holds no MAILBOX.md`);

      // a:loads — the tree loads as files, with the delegates the coordinator names.
      const agents = delegates.filter((id) => {
        const w = workers.find((x) => x.id === id);
        return w !== undefined && !Object.hasOwn(w.declared, "flow");
      });
      if (treeErrors.length > 0) fail("a:loads", `the tree did not load: ${treeErrors.map((e) => `${e.path}: ${String(e.error)}`).join(", ")}`);
      if (agents.length < 2 || agents.length !== delegates.length) {
        fail("a:loads", `${coordinator.id} names ${delegates.join(", ") || "no delegates"}; want two or more, every one an agent worker in the tree`);
      }

      const { startConvertedDesk, OWNER, REPLY_MARKER } = await import("./host.mts");
      const dbFile = join(goalTmpDir("every-coordinator-is-a-worker-file"), "desk.sqlite");
      const app = await startConvertedDesk(TREE, dbFile);
      const call = async (method: "GET" | "POST", segments: string[], body?: unknown, query = "") => {
        const res = await createInProcessFetch(app.router)(`http://converted-desk.local/api/flows/${segments.map(encodeURIComponent).join("/")}${query}`, {
            method,
            headers: { "content-type": "application/json", accept: "text/event-stream" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        return { status: res.status, text: await res.text() };
      };
      /** Until no request is running, three reads in a row. Not graded. */
      const settle = async (ms: number) => {
        const runtime = await app.state.getRuntime();
        const busy = async () => {
          for (const session of await runtime.stores.session.list({ parentage: "all" })) {
            const requests = await runtime.stores.request.list({ sessionId: session.id });
            if (requests.some((r) => r.status === "in_progress")) return true;
          }
          return false;
        };
        const until = Date.now() + ms;
        for (let calm = 0; calm < 3 && Date.now() < until; ) {
          calm = (await busy()) ? 0 : calm + 1;
          await new Promise((r) => setTimeout(r, 50));
        }
      };

      try {
        // The person opens a conversation with the coordinator, as a page does, and posts once.
        const opened = await call("POST", ["coordinator", "sessions"], { userId: OWNER, state: { workerId: coordinator.id } });
        if (opened.status !== 201) throw new Error(`the conversation was not opened: ${opened.status} ${opened.text.slice(0, 300)}`);
        const conversation = (JSON.parse(opened.text) as { session: { id: string } }).session.id;
        const token = `desk-token-${randomUUID().replace(/-/g, "").slice(0, 10)}`;
        const posted = await call("POST", ["coordinator", "actions", "respond"], {
          userId: OWNER,
          sessionId: conversation,
          input: { message: `${token} can someone look at the refund queue?` },
        });
        if (posted.status !== 200) throw new Error(`the post was refused: ${posted.status} ${posted.text.slice(0, 300)}`);
        await settle(8_000);
        // Give a wrongly woken worker time to answer twice, so its absence is not a race.
        await new Promise((r) => setTimeout(r, 1_500));
        await settle(8_000);

        // a:answers — what the person reads in their conversation.
        const state = await call("GET", ["sessions", conversation, "state"], undefined, "?include_items=true&item_types=message&limit=1000");
        type Item = { role?: string; agentName?: string; transient?: boolean; content?: Array<{ text?: string }> };
        const items = ((JSON.parse(state.text) as { items?: Item[] }).items ?? [])
          .filter((i) => i.transient !== true)
          .map((i) => ({ role: i.role ?? "", author: i.agentName, text: (i.content ?? []).map((c) => c.text ?? "").join("") }));
        const postAt = items.map((m, i) => (m.role === "user" && m.author === undefined && m.text.includes(token) ? i : -1)).filter((i) => i >= 0);
        if (postAt.length !== 1) {
          fail("a:answers", `${conversation} shows the person's post ${postAt.length} times (want 1)`);
        } else {
          const after = items.slice(postAt[0]! + 1).filter((m) => m.author !== undefined);
          let ok = true;
          for (const id of agents) {
            const by = after.filter((m) => m.author === id && m.text.includes(REPLY_MARKER));
            if (by.length !== 1) {
              ok = false;
              fail("a:answers", `${conversation} holds ${by.length} answer line(s) by ${id} to the post (want 1)`);
            }
          }
          const strangers = [...new Set(after.filter((m) => !agents.includes(m.author!)).map((m) => m.author!))];
          if (strangers.length > 0) {
            ok = false;
            fail("a:answers", `${conversation} holds answer lines by ${strangers.join(", ")}, which are not ${coordinator.id}'s delegates`);
          }
          if (ok) {
            evidence.push(
              `a: ${coordinator.id} (team ${team}) on SQLite; one post (${token}) got one answer line each from ${agents.join(", ")} and none from anyone else`,
            );
          }
        }
      } finally {
        await app.state.dispose();
      }
    }

    // ==== leg b: nothing of the mailbox is left =============================
    if (LEGS.has("b")) {
      // b:after — the checker's end state.
      const after = spawnSync(process.execPath, [CHECK, "--after"], { cwd: REPO_ROOT, encoding: "utf8" });
      const out = `${after.stdout ?? ""}${after.stderr ?? ""}`;
      if (after.status !== 0) {
        const problems = out.split("\n").filter((l) => l.startsWith("FAIL"));
        fail("b:after", `check.mjs --after exited ${String(after.status)}:\n      ${problems.slice(0, 15).join("\n      ")}${problems.length > 15 ? `\n      … and ${problems.length - 15} more` : ""}`);
      } else {
        evidence.push("b: check.mjs --after PASS");
      }
      // Under the control, b:after must be red for the plants, not only for whatever else is left.
      for (const [path] of PLANTS) {
        const rel = relative(REPO_ROOT, path);
        if (!out.split("\n").some((l) => l.startsWith("FAIL") && l.includes(rel))) {
          failures.push(`[control] check.mjs --after did not name the plant ${rel}`);
        }
      }

      // b:verdicts — every CONVERT and REWRITE unit has a PASS line on the tagged commit.
      // The GOALS table is not exported, and importing check.mjs runs it, so it is parsed.
      const source = readFileSync(CHECK, "utf8");
      const block = /const GOALS = \{([\s\S]*?)\n\};/.exec(source)?.[1];
      if (block === undefined) {
        fail("b:verdicts", "check.mjs has no GOALS table to read");
      } else {
        const units = [...block.matchAll(/^\s*"([^"]+)":\s*"([A-Z0-9-]+)\b/gm)]
          .map((m) => ({ unit: m[1]!, disposition: m[2]! }))
          .filter((u) => u.disposition === "CONVERT" || u.disposition === "REWRITE");
        const missing: string[] = [];
        const noGoal: string[] = [];
        for (const { unit } of units) {
          const goalMd = repoPath(unit, "goal.md");
          if (!existsSync(goalMd)) {
            noGoal.push(unit);
            continue;
          }
          const rows = table(readFileSync(goalMd, "utf8"), /^##\s+Verdict log/);
          const header = rows[0]?.map((c) => c.toLowerCase()) ?? [];
          const v = header.indexOf("verdict");
          const c = header.indexOf("commit");
          const hit = v >= 0 && c >= 0 && rows.slice(1).some((r) => /PASS/.test(r[v] ?? "") && !/FAIL/.test(r[v] ?? "") && (r[c] ?? "").includes(TAG));
          if (!hit) missing.push(unit);
        }
        // A unit with no goal.md is graded only when it should have one. Support code a lab's goals
        // import (`pentest-lab/lab`, a scenario module) is proven by those goals' own lines; a unit
        // gone from the tree passes only when goals/README.md names it retired.
        const readmeText = readFileSync(README, "utf8");
        const support: string[] = [];
        const unproven: string[] = [];
        for (const unit of noGoal) {
          if (existsSync(repoPath(unit))) {
            if (existsSync(repoPath(unit, "run.mts"))) unproven.push(`${unit} (a run.mts and no goal.md)`);
            else support.push(unit);
          } else if (readmeText.includes(`\`${unit.replace(/^goals\//, "")}\``)) {
            support.push(`${unit} (retired)`);
          } else {
            unproven.push(`${unit} (gone, and goals/README.md names it retired nowhere)`);
          }
        }
        if (unproven.length > 0) fail("b:verdicts", `${unproven.length} CONVERT/REWRITE unit(s) carry no verdict line: ${unproven.join(", ")}`);
        if (support.length > 0) evidence.push(`b: ${support.length} unit(s) with no goal.md of their own: ${support.join(", ")}`);
        if (missing.length > 0) fail("b:verdicts", `${missing.length} of ${units.length} CONVERT/REWRITE goal(s) have no PASS line on "${TAG}": ${missing.join(", ")}`);
        if (missing.length === 0) evidence.push(`b: all ${units.length} CONVERT/REWRITE goals have a PASS line on "${TAG}"`);
      }

      // b:retired — named in the README, gone from the tree.
      const readme = readFileSync(README, "utf8");
      const at = readme.indexOf("Retired by FIX-1792");
      const section = at < 0 ? "" : readme.slice(at).split(/\n(?=Retired by |#{1,6}\s)/)[0]!;
      if (at < 0) fail("b:retired", 'goals/README.md has no "Retired by FIX-1792" line');
      for (const name of RETIRED) {
        if (at >= 0 && !section.includes(`\`${name}\``)) fail("b:retired", `goals/README.md does not name ${name} under "Retired by FIX-1792"`);
        if (existsSync(repoPath("goals", name))) fail("b:retired", `goals/${name} still exists`);
      }
      if (!failures.some((f) => f.startsWith("[b:retired]"))) evidence.push(`b: ${RETIRED.length} retired goals named and gone`);
    }
  } finally {
    unplant();
  }

  // A control must redden each assertion it names (in the legs run), and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!.filter((t) => LEGS.has(t.split(":")[0]!));
    const tags = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const t of want) if (!tags.has(t)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left ${t} green, so it cannot fail`);
    for (const t of tags) if (!want.includes(t) && t !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened ${t}`);
  }
  return { failures, evidence: evidence.join("; ") };
});
