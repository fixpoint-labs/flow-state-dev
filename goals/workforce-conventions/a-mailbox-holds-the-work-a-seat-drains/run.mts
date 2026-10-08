/**
 * Goal check — the reference app's own tree declares a mailbox holding a
 * board, the boot says out loud that nobody drains it, and a mailbox's seats
 * are never told about their own posts. The shapes the app no longer carries —
 * a mailbox on a kind of its own, a seat draining one board of two, a member
 * whose seat cannot hear a post — are checked on a fixture host.
 *
 * Two subjects, one run:
 *
 *   **The app** (`apps/kitchen-sink` itself, not a fixture). The claim is
 *   about what somebody who clones the app finds, so the harness imports the
 *   app's real `fsdev.config`. That is a heavy boot, and `goal:all` should
 *   expect it. Legs V2, V5, V6, V9 (the warning), V10 to V13, and V14's writer
 *   half.
 *
 *   **The fixture host**: the tree `goals/mailbox-boards/
 *   it-runs-a-row-a-file-declared-board-holds/` runs, which carries a board
 *   the seat drains, a board nobody does, a member whose seat hears posts,
 *   and a mailbox on a kind of its own. Run in process here. Legs V1, V3, V4,
 *   V8, V9's attended half and V14's non-hearing half. V7 — a row claimed,
 *   run and settled on the minted ledger, with an effect outside the board —
 *   is that check's own legs c to e, on the same tree, and is not re-graded.
 *
 * Model-free. The harness owns the app's real path and reports raw
 * observations; every assertion lives here.
 *
 * Run: pnpm tsx goals/workforce-conventions/a-mailbox-holds-the-work-a-seat-drains/run.mts
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { z } from "zod";
import { createSessionClient } from "@flow-state-dev/client";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createFlowState, ensureSessionRecord, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { taskBoard, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { Task, TaskWorkerInput } from "@flow-state-dev/orchestration/tasks";
import {
  mailboxBoard,
  mailboxBoardIds,
  mailboxInstances,
  mailboxNotifyInputSchema,
  defineMailboxFlow,
  createWorkerInstallation,
  hireWorkforce,
  openMailboxes,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxManifest,
} from "@flow-state-dev/workforce";
import { readMailboxesDirectory, readWorkforce } from "@flow-state-dev/workforce/loader";
import { KITCHEN_SINK, REPO_ROOT, repoPath, runGoal, runHarness, workerDoor } from "../../lib/index.mts";

const WORKFORCE = join(KITCHEN_SINK, "workforce");
const GEN_MODULE = join(WORKFORCE, "workforce.gen.ts");
const HIRE = join(WORKFORCE, "hire.ts");
const CONFIG = join(KITCHEN_SINK, "fsdev.config.ts");
const MAILBOXES = join(WORKFORCE, "teams", "support", "mailboxes");
const PUBLISHED = repoPath("apps", "docs", "docs", "workforce", "mailboxes.md");
/** The fixture host's tree, which `mailbox-boards/it-runs-a-row-a-file-declared-board-holds` also runs. */
const FIXTURE = repoPath("goals", "mailbox-boards", "it-runs-a-row-a-file-declared-board-holds", "fixtures", "workforce");

/**
 * The words the vocabulary table refuses — the "is not" column of
 * `specs/issues/FIX-1476/BUSINESS-RULES.md` → The words.
 *
 * Checked only against the strings the app's tree ships: `description:`
 * values, mailbox charters, board names and mailbox ids under `workforce/`. It
 * does not reach a component label and does not claim to.
 */
const REFUSED_WORDS = [
  "worker", "bot", "team member", "agent",
  "type", "template", "role", "flow",
  "room", "thread", "conversation", "group",
  "queue", "backlog", "list", "todo",
  "org", "squad", "workspace",
];

/**
 * Proper nouns the vocabulary check reads past, each for a stated reason.
 *
 * `flow-state-dev` is the framework's name. `support.fsd`'s description names
 * it because the specialist answers questions about building with it, and that
 * wording is fixed by FIX-1611 D1. The table refuses "flow" as a word for a
 * seat's kind; a product name that contains it is not that word. Nothing else
 * is exempt: "flow" anywhere else in a shipped string still fails.
 */
const PROPER_NOUNS = ["flow-state-dev"];

/** The two sentences the published page owes a reader who writes a kind. */
const PUBLISHED_CLAIMS: Array<{ what: string; needle: RegExp }> = [
  {
    what: "a custom kind cannot hold a board",
    needle: /cannot hold a board/i,
  },
  {
    what: "re-opening is not a migration",
    needle: /re-?opening is not a migration/i,
  },
];

interface Observation {
  ok: boolean;
  warnings: string[];
  openAtImport: string[];
  holderRead: { requestStatus?: string; output?: any; error?: unknown };
  sessions: Record<string, any>;
  /** Mailbox ids a caller using the APP's own user id can list. */
  visibleToAppUser: string[];
  /**
   * Per mailbox id, one post's fan-out: how many declared members it ADDRESSED
   * (the framework's half) and who it actually DELIVERED to (the app's half).
   */
  notified: Record<string, { reached: number; delivered: string[]; problem?: string }>;
  /** Declared members whose registered seat declares `onMailboxPost` — the ones a post can wake. */
  hearsPosts: string[];
}

/** Every file under a directory, recursively. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

/** Split a Markdown file into its frontmatter block and its body. */
function splitManifest(text: string): { frontmatter: string; body: string } {
  const parts = text.split(/^---\s*$/m);
  return parts.length >= 3
    ? { frontmatter: parts[1]!, body: parts.slice(2).join("---") }
    : { frontmatter: "", body: text };
}

/** A bracketed list one frontmatter key declares, read off the file. */
function declaredList(frontmatter: string, key: string): string[] {
  const line = frontmatter.match(new RegExp(`^${key}:\\s*\\[(.*)\\]\\s*$`, "m"));
  if (line === null) return [];
  return line[1]!
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** The `description:` one manifest declared, or null. */
function declaredDescription(frontmatter: string): string | null {
  const line = frontmatter.match(/^description:\s*(.+)$/m);
  return line === null ? null : line[1]!.trim();
}

/**
 * How `openMailboxes(...)` is called at the top level of a module — the shape of
 * the statement, read off the source.
 *
 * **V11b is a STRUCTURAL check, and here that is the right instrument rather
 * than a fallback.** What the leg protects is that no importer of the config
 * can be served before the mailboxes exist, and that guarantee comes from ESM
 * itself: an importer of a module with a top-level await is blocked until that
 * module finishes evaluating. Which means no importer can ever *observe* the
 * pre-await state. The only thing a test can observe is whether the open
 * happened to finish before it looked — a race, not the property.
 *
 * What this therefore CANNOT catch, said here rather than left to be found:
 *
 *   - **A promise that resolves too early.** If `openMailboxes` itself returned
 *     before the mailboxes were open, the `await` would still be right here.
 *     V11 is the leg that covers that, by reading the sessions.
 *   - **The open moving out of this file.** It reads `fsdev.config.ts` alone.
 *   - **Ordering.** It does not check the statement sits after
 *     `createFlowState` — only that it is awaited at module scope.
 *
 * @returns `"awaited"` for `await openMailboxes(…)`, `"loose"` for a call whose
 *   promise is dropped, and `"absent"` when no module-scope statement calls it.
 */
function moduleScopeCall(
  source: string,
  path: string,
  callee: string,
): "awaited" | "loose" | "absent" {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true);
  let seen: "awaited" | "loose" | "absent" = "absent";
  for (const statement of file.statements) {
    if (!ts.isExpressionStatement(statement)) continue;
    const outer = statement.expression;
    const awaited = ts.isAwaitExpression(outer);
    const inner = awaited || ts.isVoidExpression(outer) ? outer.expression : outer;
    if (!ts.isCallExpression(inner)) continue;
    if (!ts.isIdentifier(inner.expression) || inner.expression.text !== callee) continue;
    if (awaited) return "awaited";
    seen = "loose";
  }
  return seen;
}

/**
 * V14's grading, shared by both subjects: the fan-out addressed the whole
 * roster (the framework's half), and delivered to exactly the members who are
 * neither the writer nor able to hear a post (the delivery rule's half).
 *
 * Asserted as a SET, not a count. A count would be green on a fan-out that
 * notified the wrong people, and "fewer than everybody" would be green on one
 * that notified nobody.
 */
function gradeFanOut(
  where: string,
  mailboxId: string,
  members: string[],
  seen: { reached: number; delivered: string[]; problem?: string } | undefined,
  hearsPosts: string[],
  failures: string[],
): void {
  if (seen === undefined || seen.problem !== undefined) {
    failures.push(`V14 (${where}): posting to ${mailboxId} did not settle — ${seen?.problem ?? "not probed"}`);
    return;
  }
  const author = members[0];
  const wanted = members.filter((name) => name !== author && !hearsPosts.includes(name)).sort();
  const got = [...seen.delivered].sort();
  if (JSON.stringify(got) !== JSON.stringify(wanted)) {
    failures.push(
      `V14 (${where}): ${mailboxId} was written by ${JSON.stringify(author)} and the fan-out delivered to ` +
        `${JSON.stringify(got)} — every other declared member whose seat can't hear a post, ` +
        `and nobody else, should have been told, which is ${JSON.stringify(wanted)}`,
    );
  }
  if (seen.reached !== members.length) {
    failures.push(
      `V14 (${where}): ${mailboxId}'s fan-out addressed ${seen.reached} of ${members.length} declared ` +
        `member(s); a seat's post is never routed, so the fan-out walks the whole roster`,
    );
  }
}

// ===========================================================================
// The app
// ===========================================================================

function appLegs(failures: string[], evidence: string[]): void {
  // Everything the tree says, read off the tree. Nothing below types a mailbox
  // id, a board name or a ledger id.
  const manifests = readdirSync(MAILBOXES)
    .sort()
    .map((folder) => {
      const { frontmatter, body } = splitManifest(readFileSync(join(MAILBOXES, folder, "MAILBOX.md"), "utf8"));
      return {
        id: `support.${folder}`,
        folder,
        frontmatter,
        body,
        boards: declaredList(frontmatter, "boards"),
        members: declaredList(frontmatter, "members"),
        description: declaredDescription(frontmatter),
        declaredKind: frontmatter.match(/^flow:\s*(.+)$/m)?.[1]?.trim() ?? null,
      };
    });
  const genSource = readFileSync(GEN_MODULE, "utf8");
  const hireSource = readFileSync(HIRE, "utf8");
  const configSource = readFileSync(CONFIG, "utf8");

  const withBoards = manifests.filter((m) => m.boards.length > 0);
  if (withBoards.length !== 1) {
    failures.push(
      `app: expected exactly one mailbox to declare \`boards:\`, found ${withBoards.length} ` +
        `(${withBoards.map((m) => m.id).join(", ") || "none"})`,
    );
    return;
  }
  const boardHolder = withBoards[0]!;
  /** `<mailboxId>.<boardName>` — computed the way the framework mints it, never typed. */
  const mintedIds = boardHolder.boards.map((name) => `${boardHolder.id}.${name}`);
  const before = failures.length;

  // ---- V10: the vocabulary, over the strings the tree ships -----------------
  {
    const subjects: Array<{ where: string; text: string }> = [];
    for (const m of manifests) {
      subjects.push({ where: `${m.folder}/MAILBOX.md charter`, text: m.body });
      if (m.description !== null) {
        subjects.push({ where: `${m.folder}/MAILBOX.md description`, text: m.description });
      }
      for (const board of m.boards) {
        subjects.push({ where: `${m.id} board name`, text: board });
      }
      subjects.push({ where: "mailbox id", text: m.id });
    }
    // Every seat's `description:` under this tree too — they are the other
    // strings this app publishes in the vocabulary's own register.
    for (const path of filesUnder(join(WORKFORCE, "teams"))) {
      if (!path.endsWith("WORKER.md")) continue;
      const described = declaredDescription(splitManifest(readFileSync(path, "utf8")).frontmatter);
      if (described !== null) subjects.push({ where: `${path} description`, text: described });
    }

    let exempted = 0;
    for (const subject of subjects) {
      let text = subject.text;
      for (const noun of PROPER_NOUNS) {
        if (text.includes(noun)) exempted += 1;
        text = text.split(noun).join(" ");
      }
      for (const word of REFUSED_WORDS) {
        // Whole words only — `list` must not fire inside `listen`.
        if (new RegExp(`\\b${word}\\b`, "i").test(text)) {
          failures.push(
            `V10: ${subject.where} uses "${word}", which the vocabulary table refuses: ` +
              JSON.stringify(subject.text.slice(0, 120)),
          );
        }
      }
    }
    if (failures.length === before) {
      evidence.push(
        `V10: ${subjects.length} shipped strings carry none of the refused words ` +
          `(${exempted} name ${PROPER_NOUNS.join(", ")}, read past as a proper noun)`,
      );
    }
  }

  // ---- V2: no hand-written kind name in the wiring -------------------------
  // The app carries no mailbox kind of its own today; the spread is what makes
  // one it adds reach the binder with no edit here.
  const kindsDir = join(WORKFORCE, "flows", "mailboxes");
  const expectedKinds = existsSync(kindsDir)
    ? readdirSync(kindsDir).sort().map((f) => f.replace(/\.ts$/, ""))
    : [];
  {
    if (!/\.\.\.mailboxKinds/.test(hireSource)) {
      failures.push("V2: hire.ts does not spread `mailboxKinds` from the generated module");
    }
    for (const kind of expectedKinds) {
      for (const [name, source] of [["hire.ts", hireSource], ["fsdev.config.ts", configSource]] as const) {
        if (new RegExp(`["'\`]${kind}["'\`]`).test(source)) {
          failures.push(`V2: ${name} names mailbox kind "${kind}" by hand`);
        }
      }
    }
    if (!genSource.includes("export const mailboxKinds")) {
      failures.push("V2: the generated module exports no `mailboxKinds` map for hire.ts to spread");
    }
  }

  // ---- V6: the minted id appears in no file under workforce/ ---------------
  for (const path of filesUnder(WORKFORCE)) {
    const text = readFileSync(path, "utf8");
    for (const minted of mintedIds) {
      if (text.includes(minted)) {
        failures.push(`V6: ${path} writes the minted ledger id "${minted}"; a file declares a name`);
      }
    }
  }

  // ---- V12: the published page states both costs ---------------------------
  {
    const page = readFileSync(PUBLISHED, "utf8");
    for (const claim of PUBLISHED_CLAIMS) {
      if (!claim.needle.test(page)) {
        failures.push(`V12: the published mailboxes page never says ${claim.what}`);
      }
    }
  }

  // ---- V11b: the open is an awaited module-scope statement -----------------
  {
    const shape = moduleScopeCall(configSource, CONFIG, "openMailboxes");
    if (shape !== "awaited") {
      failures.push(
        `V11b: fsdev.config.ts calls openMailboxes ${
          shape === "loose"
            ? "at module scope without awaiting it"
            : "in no module-scope statement this recognises"
        } — an importer is then served while the open is still in flight. ` +
          `This is a structural check: it reads the statement, not the run`,
      );
    }
  }

  if (failures.length > before) {
    evidence.push("app: stopped before the boot — the tree does not agree with itself");
    return;
  }
  evidence.push(
    `V2/V6/V11b/V12: the tree declares ${manifests.map((m) => m.id).join(", ")}; ` +
      `"${boardHolder.id}" holds ${JSON.stringify(boardHolder.boards)}; the framework mints ` +
      `${JSON.stringify(mintedIds)}, which appears in no file; hire.ts spreads the generated mailboxKinds`,
  );

  // ---- the boot ------------------------------------------------------------
  // The app names one user and one organization for every caller, in
  // `lib/kitchen-sink-principal.ts`. The config opens the mailboxes as that user
  // and the page calls as it; each is read only if it still names the constant.
  const principalSource = readFileSync(join(KITCHEN_SINK, "lib", "kitchen-sink-principal.ts"), "utf8");
  const appUser = principalSource.match(/KITCHEN_SINK_USER_ID\s*=\s*"([^"]+)"/)?.[1];
  const mailboxOwner = /MAILBOX_OWNER\s*=\s*KITCHEN_SINK_USER_ID\b/.test(configSource)
    ? appUser
    : configSource.match(/MAILBOX_OWNER\s*=\s*"([^"]+)"/)?.[1];
  const appUserId = /userId=\{KITCHEN_SINK_USER_ID\}/.test(
    readFileSync(join(KITCHEN_SINK, "app", "page.tsx"), "utf8"),
  )
    ? appUser
    : undefined;
  if (mailboxOwner === undefined || appUserId === undefined) {
    failures.push(
      mailboxOwner === undefined
        ? "app: fsdev.config.ts declares no MAILBOX_OWNER this check can read"
        : "app: app/page.tsx passes no userId this check can read",
    );
    return;
  }

  // No worker kind of the app's own declares a board, so every board the tree
  // declares is one nobody drains. Derived, never typed.
  const workerKindsDir = join(WORKFORCE, "flows", "workers");
  const draining = existsSync(workerKindsDir)
    ? readdirSync(workerKindsDir).map((f) => readFileSync(join(workerKindsDir, f), "utf8"))
    : [];
  const unwiredBoards = boardHolder.boards.filter(
    (name) => !draining.some((source) => source.includes("mailboxBoard(") && source.includes(`"${name}"`)),
  );

  const o = runHarness<Observation>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: {
      FSD_ENV: "dev",
      // Model-free: nothing the probes do should wake a seat. Test mode keeps
      // it keyless if something does, and lets the app's goal controls reach
      // the boot when a red state is being taken.
      KITCHEN_SINK_TEST_MODE: "1",
      GOAL_TREE: JSON.stringify({
        mailboxes: manifests.map((m) => ({ id: m.id, address: m.declaredKind ?? "mailbox" })),
        boardHolder: { id: boardHolder.id, address: boardHolder.declaredKind ?? "mailbox" },
        membersByMailbox: Object.fromEntries(manifests.map((m) => [m.id, m.members])),
        // The flow each member's worker runs on, off its own WORKER.md: the
        // copy of that flow is the seat a post to the member reaches.
        flowByMember: Object.fromEntries(
          [...new Set(manifests.flatMap((m) => m.members))].map((member) => {
            const [team, name] = member.split(".");
            const file = join(WORKFORCE, "teams", team!, "workers", name!, "WORKER.md");
            const { frontmatter } = existsSync(file) ? splitManifest(readFileSync(file, "utf8")) : { frontmatter: "" };
            return [member, frontmatter.match(/^flow:\s*(.+)$/m)?.[1]?.trim() ?? "agent"];
          }),
        ),
        mailboxOwner,
        appUserId,
      }),
    },
  });
  if (o.ok !== true) {
    failures.push("app: the harness did not complete");
    return;
  }

  // ---- V11: the boot opened them, and the check opened nothing -------------
  {
    const wanted = manifests.map((m) => m.id).sort();
    const got = [...o.openAtImport].sort();
    if (JSON.stringify(got) !== JSON.stringify(wanted)) {
      failures.push(
        `V11: ${got.length} of ${wanted.length} mailboxes were open when the config module's ` +
          `import resolved (${JSON.stringify(got)}) — the boot does not open the tree's ` +
          `mailboxes, so the first caller of one meets an empty session`,
      );
    }
  }
  if (o.holderRead.requestStatus !== "completed") {
    failures.push(
      `V11: the first read after importing the config ended "${o.holderRead.requestStatus}" ` +
        `(${JSON.stringify(o.holderRead.error)}) — the mailboxes were not open`,
    );
  }

  // ---- V5: the mailbox says what it holds, by name -------------------------
  {
    // Sorted on both sides: the framework sorts the minted ids a kind is built
    // with, so declaration order is not preserved.
    const held = o.holderRead.output?.boards;
    const wanted = [...boardHolder.boards].sort();
    if (JSON.stringify(held) !== JSON.stringify(wanted)) {
      failures.push(
        `V5: ${boardHolder.id}'s read listed ${JSON.stringify(held)}, and its file declares ` +
          `${JSON.stringify(wanted)}`,
      );
    }
  }

  // ---- V9: one unattended-board warning per board nobody drains ------------
  {
    const unattended = o.warnings.filter((w) => w.startsWith("[workforce] mailbox "));
    if (unattended.length !== unwiredBoards.length) {
      failures.push(
        `V9: the boot emitted ${unattended.length} unattended-board warning(s), and ` +
          `${unwiredBoards.length} board(s) are unwired: ${JSON.stringify(unattended)}`,
      );
    }
    for (const name of unwiredBoards) {
      if (!unattended.some((w) => w.includes(`"${name}"`))) {
        failures.push(`V9: no warning names the unwired board "${name}"`);
      }
    }
  }

  // ---- V14, the writer half: nobody is told about their own post ----------
  // Every member of the app's mailbox is a seat that hears posts, so a post a
  // member writes is delivered to nobody: not the writer, and not the others.
  for (const m of manifests) {
    gradeFanOut("app", m.id, m.members, o.notified[m.id], o.hearsPosts, failures);
  }

  // ---- V13: a caller using the app's own user id can reach the mailboxes ---
  {
    const wanted = manifests.map((m) => m.id).sort();
    const seen = [...o.visibleToAppUser].filter((id) => wanted.includes(id)).sort();
    if (JSON.stringify(seen) !== JSON.stringify(wanted)) {
      failures.push(
        `V13: a caller using the app's own user id ("${appUserId}") lists ${seen.length} of ` +
          `${wanted.length} mailboxes (${JSON.stringify(seen)}) — the config opens them as ` +
          `"${mailboxOwner}", who the app's pages never call as`,
      );
    }
  }

  evidence.push(
    `app boot: the config opened ${manifests.map((m) => `${m.id}→${o.sessions[m.id]?.flowKind}`).join(", ")} ` +
      `before any call; ${boardHolder.id}'s read lists ${JSON.stringify(o.holderRead.output?.boards)}; the boot ` +
      `warned once per unwired board (${JSON.stringify(unwiredBoards)}); a member's post reached ` +
      `${manifests.map((m) => `${o.notified[m.id]?.reached} of ${m.members.length}`).join(", ")} members and was ` +
      `delivered to ${JSON.stringify(manifests.flatMap((m) => o.notified[m.id]?.delivered ?? []))}; the app's user lists ` +
      `${JSON.stringify(o.visibleToAppUser.filter((id) => manifests.some((m) => m.id === id)))}`,
  );
}

// ===========================================================================
// The fixture host
// ===========================================================================

const FIXTURE_USER = "u_mailbox_holds";

/**
 * The delivery rule the fixture's mailboxes are built with, for a member whose
 * seat cannot hear a post: a name-only line, reported by name, and never to
 * the member who wrote the post. Compared on `author`, the only field that
 * names the same thing a member id does.
 */
const nameOnlyLine = handler({
  name: "fixture-notify-member",
  inputSchema: mailboxNotifyInputSchema,
  outputSchema: z.object({ notified: z.string().optional() }),
  execute: (input: { member: string; author?: string }) =>
    input.author !== undefined && input.member === input.author ? {} : { notified: input.member },
});

async function fixtureLegs(failures: string[], evidence: string[]): Promise<void> {
  // ---- V1: the generated map names the kind file ---------------------------
  // Content, and currency: the committed module is what `fsdev gen` renders
  // from this tree, which `--check` decides and the content half does not.
  const kindFiles = readdirSync(join(FIXTURE, "flows", "mailboxes")).sort();
  const expectedKinds = kindFiles.map((f) => f.replace(/\.ts$/, ""));
  const genSource = readFileSync(join(FIXTURE, "workforce.gen.ts"), "utf8");
  const before = failures.length;
  {
    const named = genSource.match(/export const mailboxKinds = \{([^}]*)\}/s)?.[1] ?? "";
    const keys = [...named.matchAll(/"([^"]+)":/g)].map((m) => m[1]!).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKinds)) {
      failures.push(
        `V1: the fixture's committed mailboxKinds map names ${JSON.stringify(keys)}, and ` +
          `flows/mailboxes/ holds ${JSON.stringify(expectedKinds)}`,
      );
    }
    for (const kind of expectedKinds) {
      if (!genSource.includes(`./flows/mailboxes/${kind}`)) {
        failures.push(`V1: the fixture's generated module does not import ./flows/mailboxes/${kind}`);
      }
    }
    try {
      execFileSync("pnpm", ["fsdev", "gen", "--check", "--root", FIXTURE], { cwd: REPO_ROOT, stdio: "pipe" });
    } catch (err) {
      const e = err as { stderr?: Buffer; stdout?: Buffer };
      failures.push(`V1: fsdev gen --check says the fixture's module is not what its tree renders: ${String(e.stderr ?? e.stdout ?? "")}`);
    }
  }
  // A map that disagrees with the tree cannot build the mailboxes below: the
  // kind a file selects would not be there. Stop, so the reason is V1's.
  if (failures.length > before) return;

  // ---- the tree alone produces the roster -----------------------------------
  const roster = await readWorkforce(FIXTURE);
  const read = await readMailboxesDirectory(FIXTURE);
  if (roster.errors.length > 0 || read.errors.length > 0) {
    failures.push(`fixture: the tree did not load cleanly (${[...roster.errors, ...read.errors].map((e) => e.path).join(", ")})`);
    return;
  }
  const mailboxes: MailboxManifest[] = read.mailboxes;
  const holder = mailboxes.find((c) => ((c.declared.boards as string[] | undefined) ?? []).length > 0);
  if (holder === undefined) {
    failures.push("fixture: no mailbox in the tree declares a board");
    return;
  }
  const boardNames = holder.declared.boards as string[];
  // The first board the file declares is the one the seat drains; the rest
  // nobody drains. Read off the file.
  const attended = boardNames[0]!;
  const unwired = boardNames.slice(1);
  const attendedBoard = mailboxBoard(holder.id, attended);

  // ---- the kinds: one files, one drains the attended board, and the built-in
  // agent hears posts. None writes a ledger id. Each is one copy for its
  // workers, built on the installation.
  let workerFlows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: roster.workers,
    workerFlows: () => workerFlows as never,
  });
  const noteRan = handler({
    name: "fixture-run-row",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ did: z.string() }),
    execute: (input: TaskWorkerInput) => ({ did: input.goal }),
  });
  const board = taskBoard({
    name: "fixture-triage",
    boardId: "fixture-triage",
    collection: attendedBoard,
    concurrency: 1,
    workers: { coder: noteRan },
  });
  const emKind = defineFlow({
    kind: "em",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: { ...workerDoor,
      idle: {
        block: handler({
          name: "fixture-em-idle",
          inputSchema: z.object({}),
          outputSchema: z.object({}),
          execute: () => ({}),
        }),
      },
    },
  } as never);
  const coderKind = defineFlow({
    kind: "coder",
    cardinality: "collection",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { [attendedBoard.id]: attendedBoard, ...installation.resources },
    actions: { ...workerDoor, drain: { block: board.drain } },
  } as never);

  // ---- V9's attended half: warned about the board nobody drains, only -----
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((a) => String(a)).join(" "));
  };
  let seats;
  try {
    workerFlows = { em: emKind, coder: coderKind };
    seats = hireWorkforce(installation, { mailboxBoards: mailboxBoardIds(mailboxes) });
  } finally {
    console.warn = realWarn;
  }
  {
    const unattended = warnings.filter((w) => w.startsWith("[workforce] mailbox "));
    if (unattended.length !== unwired.length) {
      failures.push(
        `V9: the fixture's hire emitted ${unattended.length} unattended-board warning(s), and ` +
          `${unwired.length} board(s) are unwired: ${JSON.stringify(unattended)}`,
      );
    }
    for (const name of unwired) {
      if (!unattended.some((w) => w.includes(`"${name}"`))) failures.push(`V9: no warning names the unwired board "${name}"`);
    }
    if (unattended.some((w) => w.includes(`"${attended}"`))) {
      failures.push(`V9: a warning names "${attended}", which the coder seat does declare`);
    }
  }

  // ---- the mailboxes, on the kinds their files select ------------------------
  const generated = (await import(pathToFileURL(join(FIXTURE, "workforce.gen.ts")).href)) as {
    mailboxKinds: Record<string, never>;
  };
  const instances = mailboxInstances(mailboxes, {
    kinds: {
      ...generated.mailboxKinds,
      mailbox: defineMailboxFlow({ notify: wakeMemberSeats(seats, { installation, fallback: nameOnlyLine }) }) as never,
    },
  });
  const state = createFlowState({
    flows: {
      ...Object.fromEntries(instances.map((instance) => [instance.kind, instance])),
      ...Object.fromEntries(seats.map((seat) => [seat.id, seat])),
    },
    stores: { default: { primary: inMemoryStores() } },
  } as never);

  try {
    const runtime = await state.getRuntime();
    // The session client over the host's own router, as the app opens its
    // mailboxes. Load-bearing for V4: a session created through the route is
    // parsed against the kind's `stateSchema`, and a client that wrote the
    // store directly would keep a key the schema strips, so V4 could not fail.
    const router = await state.getRouter();
    const sessionClient = createSessionClient({
      fetcher: async (input, init) => {
        const url = new URL(String(input), "http://fixture-host.local");
        const path = url.pathname
          .replace(/^\/api\/flows\/?/, "")
          .split("/")
          .filter((segment) => segment.length > 0)
          .map(decodeURIComponent);
        const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
        return await router[method](new Request(url, init), { params: { path } } as never);
      },
    });
    await openMailboxes(mailboxes, { client: sessionClient, userId: FIXTURE_USER });
    // The organization the route opened them in, which every action below runs in.
    const orgId = ((await runtime.stores.session.get(holder.id)) as { orgId?: string } | undefined)?.orgId;

    const act = async (flow: unknown, sessionId: string, actionName: string, input: unknown) =>
      (await runAction({
        flow,
        actionName,
        input,
        userId: FIXTURE_USER,
        orgId,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig },
      } as never)) as { output?: unknown; error?: unknown };

    // ---- V3: each mailbox opened on the kind its file selected -------------
    // The first clause is not decoration: without it the leg reads its
    // expectation off the same `flow:` line it is testing, so deleting that
    // line moves both sides together.
    const naming = mailboxes.filter((c) => typeof c.declared.flow === "string" && expectedKinds.includes(c.declared.flow as string));
    if (naming.length !== 1) {
      failures.push(`V3: ${naming.length} fixture mailboxes select a generated kind with \`flow:\`, wanted exactly one`);
    }
    if (!mailboxes.some((c) => c.declared.flow === undefined)) {
      failures.push("V3: no fixture mailbox omits `flow:`, so nothing shows the built-in being the default");
    }
    const sessions: Record<string, { flowKind?: string; state?: Record<string, unknown> } | undefined> = {};
    for (const c of mailboxes) {
      sessions[c.id] = (await runtime.stores.session.get(c.id)) as never;
      const wanted = (c.declared.flow as string | undefined) ?? "mailbox";
      if (sessions[c.id]?.flowKind !== wanted) {
        failures.push(`V3: ${c.id} opened on kind "${sessions[c.id]?.flowKind}", and its file selects "${wanted}"`);
      }
    }

    // ---- V4: the custom kind's state schema admits what the binder writes --
    const custom = naming[0];
    if (custom !== undefined) {
      const opened = sessions[custom.id]?.state ?? {};
      for (const key of ["members", "instructions", "transcript"]) {
        if (!Object.hasOwn(opened, key)) {
          failures.push(
            `V4: ${custom.id}'s open session carries no "${key}" — the kind's stateSchema does not ` +
              `declare it, so the binder's value was silently stripped (state keys: ${Object.keys(opened).join(", ")})`,
          );
        }
      }
    }

    // ---- V14, the non-hearing half -----------------------------------------
    // One post on the board-holding mailbox, written by its first member. The
    // fan-out walks the roster; the member whose seat hears posts is silent on
    // a seat's post, the writer is told nothing, and every other member gets
    // the name-only line.
    const mailboxInstance = instances.find((instance) => instance.kind === "mailbox")!;
    const members = (holder.declared.members as string[] | undefined) ?? [];
    /** The copy a member's worker runs on: the flow its file names, or the built-in agent. */
    const copyOf = (member: string) => {
      const flow = roster.workers.find((w) => w.id === member)?.declared.flow ?? "agent";
      return seats.find((s) => s.kind === flow);
    };
    const hearsPosts = members.filter((member) => {
      const seat = copyOf(member) as { internal?: { actions?: object } } | undefined;
      return Object.prototype.hasOwnProperty.call(seat?.internal?.actions ?? {}, "onMailboxPost");
    });
    if (hearsPosts.length === 0) {
      failures.push(`V14 (fixture): no member of ${holder.id} has a seat that hears posts, so the silent half is untested`);
    }
    const posted = await act(mailboxInstance, holder.id, "post", { body: `probe ${Date.now()}`, author: members[0] });
    let notified: { reached: number; delivered: string[]; problem?: string };
    if (posted.error !== undefined) {
      notified = { reached: 0, delivered: [], problem: `the post failed: ${String(posted.error)}` };
    } else {
      const readTraces = async () => {
        const requests = (await runtime.stores.request.list({ sessionId: holder.id })) as any[];
        const traces = requests.flatMap((r) => (r.items ?? []).filter((item: any) => item.type === "block_trace"));
        const fanOut = traces.filter((t: any) => t.blockName === "mailbox-fan-out");
        return {
          sawFanOut: fanOut.length > 0,
          reached: fanOut.reduce((n: number, t: any) => n + (t.output?.shape?.entries?.length ?? 0), 0),
          delivered: [
            ...members.filter((member) => traces.some((t: any) => t.blockName === `wake-${copyOf(member)?.id}-${member}`)),
            ...traces
              .filter((t: any) => t.blockName === "fixture-notify-member")
              .map((t: any) => String(t.output?.value?.notified ?? ""))
              .filter((who: string) => who.length > 0),
          ],
        };
      };
      let seen = await readTraces();
      const deadline = Date.now() + 15_000;
      while (!seen.sawFanOut && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
        seen = await readTraces();
      }
      if (seen.sawFanOut) {
        await new Promise((r) => setTimeout(r, 500));
        seen = await readTraces();
      }
      notified = seen.sawFanOut
        ? { reached: seen.reached, delivered: [...new Set(seen.delivered)] }
        : { reached: 0, delivered: [], problem: "no fan-out ran within 15s" };
    }
    gradeFanOut("fixture", holder.id, members, notified, hearsPosts, failures);

    // ---- V8: the drain is a subset, not an ambient sweep ---------------------
    const parkedGoals: string[] = [];
    for (const name of unwired) {
      const goal = `leave this on ${name} ${Date.now()}`;
      parkedGoals.push(goal);
      const filed = await act(mailboxInstance, holder.id, "fileTask", { board: name, goal, assignee: "coder", author: members[0] });
      if (filed.error !== undefined) failures.push(`V8: filing onto ${name} failed: ${String(filed.error)}`);
    }
    const coder = seats.find((seat) => seat.kind === "coder");
    if (coder === undefined) {
      failures.push("V8: the fixture hired no seat on the draining kind");
    } else {
      // The coder worker's session on its flow's copy, created naming it.
      const worker = roster.workers.find((w) => w.declared.flow === coder.kind)!.id;
      const sessionId = `s_${worker}`;
      const now = Date.now();
      await ensureSessionRecord(
        runtime.stores,
        sessionId,
        {
          flow: coder as never,
          sessionId,
          principal: { userId: FIXTURE_USER, orgId: orgId! },
          state: { workerId: worker },
          fromCaller: true,
          via: "create",
        },
        () =>
          ({
            id: sessionId,
            flowKind: coder.kind,
            flowId: coder.id,
            userId: FIXTURE_USER,
            orgId,
            version: 0,
            createdAt: now,
            updatedAt: now,
            journal: [],
          }) as never,
      );
      const drained = await act(coder, sessionId, "drain", {});
      if (drained.error !== undefined) failures.push(`V8: the coder's drain failed: ${String(drained.error)}`);
    }
    for (const [i, name] of unwired.entries()) {
      const view = await act(mailboxInstance, holder.id, "readBoard", { board: name });
      const rows = ((view.output as { tasks?: Task[] } | undefined)?.tasks ?? []) as Task[];
      const row = rows.find((t) => t.goal === parkedGoals[i]);
      if (row === undefined) {
        failures.push(`V8: ${name} holds no row for ${JSON.stringify(parkedGoals[i])}`);
      } else if (row.status !== "pending") {
        failures.push(`V8: the row on ${name} is "${row.status}" — the drain claimed a board its kind never declared`);
      }
    }

    evidence.push(
      `fixture ${basename(FIXTURE)} tree: ${mailboxes.map((c) => `${c.id}→${sessions[c.id]?.flowKind}`).join(", ")}; ` +
        `the hire warned only about ${JSON.stringify(unwired)}; ${members[0]}'s post reached ${notified.reached} of ` +
        `${members.length} members and was delivered to ${JSON.stringify(notified.delivered)}, ${JSON.stringify(hearsPosts)} ` +
        `hearing it silently; the drain left ${JSON.stringify(unwired)}'s row pending`,
    );
  } finally {
    await state.dispose();
  }
}

// ---------------------------------------------------------------------------

await runGoal(async (failures) => {
  const evidence: string[] = [];
  await fixtureLegs(failures, evidence);
  appLegs(failures, evidence);
  return { failures, evidence: evidence.join("; ") };
});
