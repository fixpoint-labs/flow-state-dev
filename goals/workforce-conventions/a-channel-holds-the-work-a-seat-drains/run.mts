/**
 * Goal check — the reference app's own tree declares three channels, one of
 * them holding two boards, and exactly one seat drains exactly one of them.
 *
 * **The subject is `apps/kitchen-sink` itself, not a fixture.** Every other
 * goal under `workforce-conventions/` points the loader at its own
 * `fixtures/workforce/`; this one imports the app's real `fsdev.config`,
 * because the claim is about what somebody who clones the app finds. That
 * makes it a heavy boot and this goal noticeably slower than a fixture goal —
 * `goal:all` should expect that.
 *
 * Board mechanics are NOT re-proved here. `channel-boards/
 * it-runs-a-row-a-file-declared-board-holds` already covers mint → file →
 * drain → completed and passes. What this adds is the two behaviours that goal
 * cannot reach — the unattended-board warning and the subset drain — plus the
 * structural legs that say this app's own tree is wired.
 *
 * Fifteen legs, model-free. The harness owns the real path and reports raw
 * observations; every assertion lives here.
 *
 * Run: pnpm tsx goals/workforce-conventions/a-channel-holds-the-work-a-seat-drains/run.mts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, sep } from "node:path";
import ts from "typescript";
import { KITCHEN_SINK, repoPath, runGoal, runHarness } from "../../lib/index.mts";

const WORKFORCE = join(KITCHEN_SINK, "workforce");
const GEN_MODULE = join(WORKFORCE, "workforce.gen.ts");
const HIRE = join(WORKFORCE, "hire.ts");
const CONFIG = join(KITCHEN_SINK, "fsdev.config.ts");
const CHANNELS = join(WORKFORCE, "teams", "support", "channels");
const PUBLISHED = repoPath("apps", "docs", "docs", "workforce", "channels.md");

/**
 * The words the vocabulary table refuses — the "is not" column of
 * `specs/issues/FIX-1476/BUSINESS-RULES.md` → The words.
 *
 * Checked only against the strings this issue ships: `description:` values,
 * channel charters, board names and channel ids under `workforce/`. It does
 * not reach a component label and does not claim to.
 */
const REFUSED_WORDS = [
  "worker", "bot", "team member", "agent",
  "type", "template", "role", "flow",
  "room", "thread", "conversation", "group",
  "queue", "backlog", "list", "todo",
  "org", "squad", "workspace",
];

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
  channelKindNames: string[];
  openAtImport: string[];
  deskRead: { requestStatus?: string; output?: any; error?: unknown };
  sessions: Record<string, any>;
  followupGoal: string;
  escalationGoal: string;
  filedFollowup: { requestStatus?: string; output?: any; error?: unknown };
  filedEscalation: { requestStatus?: string; output?: any; error?: unknown };
  drained: { requestStatus?: string; error?: unknown };
  board_followups: { requestStatus?: string; output?: any; error?: unknown };
  board_escalations: { requestStatus?: string; output?: any; error?: unknown };
  orgId: string;
  followupRowKey: string | null;
  /** The whole stored record, so V7 can assert its STATUS and not merely that a row exists. */
  followupRowInStorage: { state?: { status?: string; goal?: string } } | null;
  /** Channel ids a caller using the APP's own user id can list. */
  visibleToAppUser: string[];
  /**
   * Per channel id, one post's fan-out: how many declared members it ADDRESSED
   * (the framework's half, unchanged by any app rule) and who it actually
   * DELIVERED to (the app's half).
   */
  notified: Record<string, { reached: number; delivered: string[]; problem?: string }>;
  notes: any;
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

/** The `boards:` names one `CHANNEL.md` declared, read off the file. */
function declaredBoards(frontmatter: string): string[] {
  const line = frontmatter.match(/^boards:\s*\[(.*)\]\s*$/m);
  if (line === null) return [];
  return line[1]!
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/**
 * How `openChannels(...)` is called at the top level of a module — the shape of
 * the statement, read off the source.
 *
 * **V11b is a STRUCTURAL check, and here that is the right instrument rather
 * than a fallback.** What the leg protects is that no importer of the config
 * can be served before the channels exist, and that guarantee comes from ESM
 * itself: an importer of a module with a top-level await is blocked until that
 * module finishes evaluating. Which means no importer can ever *observe* the
 * pre-await state. The only thing a test can observe is whether the open
 * happened to finish before it looked — a race, not the property. Measured on
 * this app: with the open made fire-and-forget, one extra `setImmediate` before
 * the read is enough for all three channels to be there and a behavioural leg
 * to go green with the bug still in place. A check whose verdict turns on a
 * single event-loop turn is not evidence.
 *
 * What this therefore CANNOT catch, said here rather than left to be found:
 *
 *   - **A promise that resolves too early.** If `openChannels` itself returned
 *     before the channels were open, the `await` would still be right here.
 *     V11 is the leg that covers that, by reading the sessions.
 *   - **The open moving out of this file.** It reads `fsdev.config.ts` alone.
 *     An open relocated into a module this one imports without awaiting would
 *     lose the property with nothing here to say so.
 *   - **Ordering.** It does not check the statement sits after
 *     `createFlowState` — only that it is awaited at module scope.
 *
 * @returns `"awaited"` for `await openChannels(…)`, `"loose"` for a call whose
 *   promise is dropped (`void openChannels(…)`, or a bare call), and `"absent"`
 *   when no module-scope statement calls it — which includes the shapes that
 *   stash the promise (`const p = openChannels(…)`). Deliberately: this knows
 *   one correct shape and refuses every other rather than guessing at intent.
 */
function moduleScopeCall(
  source: string,
  path: string,
  callee: string,
): "awaited" | "loose" | "absent" {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true);
  let seen: "awaited" | "loose" | "absent" = "absent";
  // The file's OWN statements only. A call nested inside a function or a block
  // is not a module-scope statement, and being one is half of the property.
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

/** The `description:` one manifest declared, or null. */
function declaredDescription(frontmatter: string): string | null {
  const line = frontmatter.match(/^description:\s*(.+)$/m);
  return line === null ? null : line[1]!.trim();
}

await runGoal(() => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // Everything the tree says, read off the tree. Nothing below types a channel
  // id, a board name or a ledger id.
  const channelFolders = readdirSync(CHANNELS).sort();
  const manifests = channelFolders.map((folder) => {
    const text = readFileSync(join(CHANNELS, folder, "CHANNEL.md"), "utf8");
    const { frontmatter, body } = splitManifest(text);
    return {
      id: `support.${folder}`,
      folder,
      frontmatter,
      body,
      boards: declaredBoards(frontmatter),
      description: declaredDescription(frontmatter),
      declaredKind: frontmatter.match(/^flow:\s*(.+)$/m)?.[1]?.trim() ?? null,
    };
  });
  const genSource = readFileSync(GEN_MODULE, "utf8");
  const hireSource = readFileSync(HIRE, "utf8");
  const configSource = readFileSync(CONFIG, "utf8");

  const withBoards = manifests.filter((m) => m.boards.length > 0);
  if (withBoards.length !== 1) {
    return {
      failures: [
        `expected exactly one channel to declare \`boards:\`, found ${withBoards.length} ` +
          `(${withBoards.map((m) => m.id).join(", ") || "none"})`,
      ],
      evidence: "",
    };
  }
  const boardHolder = withBoards[0]!;
  /** `<channelId>.<boardName>` — computed the way the framework mints it, never typed. */
  const mintedIds = boardHolder.boards.map((name) => `${boardHolder.id}.${name}`);

  // ---- V10: the vocabulary, over the strings this issue ships --------------
  {
    const subjects: Array<{ where: string; text: string }> = [];
    for (const m of manifests) {
      subjects.push({ where: `${m.folder}/CHANNEL.md charter`, text: m.body });
      if (m.description !== null) {
        subjects.push({ where: `${m.folder}/CHANNEL.md description`, text: m.description });
      }
      for (const board of m.boards) {
        subjects.push({ where: `${m.id} board name`, text: board });
      }
      subjects.push({ where: "channel id", text: m.id });
    }
    // Every seat's `description:` under this tree too — they are the other
    // strings this app publishes in the vocabulary's own register.
    for (const path of filesUnder(join(WORKFORCE, "teams"))) {
      if (!path.endsWith("WORKER.md")) continue;
      const described = declaredDescription(splitManifest(readFileSync(path, "utf8")).frontmatter);
      if (described !== null) subjects.push({ where: `${path} description`, text: described });
    }

    for (const subject of subjects) {
      for (const word of REFUSED_WORDS) {
        // Whole words only — `workspace` must not fire on nothing, and
        // `list` must not fire inside `listen`.
        if (new RegExp(`\\b${word}\\b`, "i").test(subject.text)) {
          failures.push(
            `V10: ${subject.where} uses "${word}", which the vocabulary table refuses: ` +
              JSON.stringify(subject.text.slice(0, 120)),
          );
        }
      }
    }
    if (failures.length === 0) {
      evidence.push(`V10: ${subjects.length} shipped strings carry none of the refused words`);
    }
  }

  // ---- V1: the generated map names the kind file ---------------------------
  // Asserted on the map's CONTENT. Staleness — that the committed module
  // matches what the tree renders — is CI's own `fsdev gen --check` over this
  // same app, and `--check` never reads what the map contains.
  const kindFiles = readdirSync(join(WORKFORCE, "flows", "channels")).sort();
  const expectedKinds = kindFiles.map((f) => f.replace(/\.ts$/, ""));
  {
    const named = genSource.match(/export const channelKinds = \{([^}]*)\}/s)?.[1] ?? "";
    const keys = [...named.matchAll(/"([^"]+)":/g)].map((m) => m[1]!).sort();
    if (JSON.stringify(keys) !== JSON.stringify(expectedKinds)) {
      failures.push(
        `V1: the committed channelKinds map names ${JSON.stringify(keys)}, and ` +
          `flows/channels/ holds ${JSON.stringify(expectedKinds)}`,
      );
    }
    for (const kind of expectedKinds) {
      if (!genSource.includes(`./flows/channels/${kind}`)) {
        failures.push(`V1: the generated module does not import ./flows/channels/${kind}`);
      }
    }
  }

  // ---- V2: no hand-written kind name in the wiring -------------------------
  {
    if (!/\.\.\.channelKinds/.test(hireSource)) {
      failures.push("V2: hire.ts does not spread `channelKinds` from the generated module");
    }
    for (const kind of expectedKinds) {
      for (const [name, source] of [["hire.ts", hireSource], ["fsdev.config.ts", configSource]] as const) {
        if (new RegExp(`["'\`]${kind}["'\`]`).test(source)) {
          failures.push(`V2: ${name} names channel kind "${kind}" by hand`);
        }
      }
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
        failures.push(`V12: the published channels page never says ${claim.what}`);
      }
    }
  }

  if (failures.length > 0) {
    return { failures, evidence: "stopped before the boot — the tree does not agree with itself" };
  }
  evidence.push(
    `V1/V2/V6/V12: the tree declares ${manifests.map((m) => m.id).join(", ")}; ` +
      `"${boardHolder.id}" holds ${JSON.stringify(boardHolder.boards)}; the framework mints ` +
      `${JSON.stringify(mintedIds)}, which appears in no file`,
  );

  // ---- the boot ------------------------------------------------------------
  // Everything the harness probes is derived HERE and handed over, so the two
  // halves cannot drift: rename a channel folder or a board and the assertion
  // and the probe move together. The harness spells no address of its own.
  const runnerKindFile = readdirSync(join(WORKFORCE, "flows", "workers"))
    .map((f) => join(WORKFORCE, "flows", "workers", f))
    .find((path) => readFileSync(path, "utf8").includes("channelBoard("));
  if (runnerKindFile === undefined) {
    return { failures: ["no worker kind under flows/workers/ declares a channelBoard"], evidence: "" };
  }
  const runnerKind = basename(runnerKindFile, ".ts");
  const runnerSource = readFileSync(runnerKindFile, "utf8");
  const attendedBoard = boardHolder.boards.find((name) => runnerSource.includes(`"${name}"`));
  const unwiredBoards = boardHolder.boards.filter((name) => name !== attendedBoard);
  const seatFile = filesUnder(join(WORKFORCE, "teams")).find(
    (path) =>
      path.endsWith("WORKER.md") &&
      splitManifest(readFileSync(path, "utf8")).frontmatter.match(/^flow:\s*(.+)$/m)?.[1]?.trim() ===
        runnerKind,
  );
  // The app names one user and one organization for every caller, in
  // `lib/kitchen-sink-principal.ts`. The config opens the channels as that user
  // and the page calls as it; each is read only if it still names the constant.
  const principalSource = readFileSync(join(KITCHEN_SINK, "lib", "kitchen-sink-principal.ts"), "utf8");
  const appUser = principalSource.match(/KITCHEN_SINK_USER_ID\s*=\s*"([^"]+)"/)?.[1];
  const orgId = principalSource.match(/KITCHEN_SINK_ORG_ID\s*=\s*"([^"]+)"/)?.[1];
  const channelOwner = /CHANNEL_OWNER\s*=\s*KITCHEN_SINK_USER_ID\b/.test(configSource)
    ? appUser
    : configSource.match(/CHANNEL_OWNER\s*=\s*"([^"]+)"/)?.[1];
  const appUserId = /userId=\{KITCHEN_SINK_USER_ID\}/.test(
    readFileSync(join(KITCHEN_SINK, "app", "page.tsx"), "utf8"),
  )
    ? appUser
    : undefined;
  if (
    attendedBoard === undefined ||
    seatFile === undefined ||
    channelOwner === undefined ||
    appUserId === undefined ||
    orgId === undefined
  ) {
    return {
      failures: [
        attendedBoard === undefined
          ? `no board "${boardHolder.id}" declares is named in ${runnerKind}`
          : seatFile === undefined
            ? `no WORKER.md names \`flow: ${runnerKind}\``
            : channelOwner === undefined
              ? "fsdev.config.ts declares no CHANNEL_OWNER this check can read"
              : appUserId === undefined
                ? "app/page.tsx passes no userId this check can read"
                : "lib/kitchen-sink-principal.ts names no organization this check can read",
      ],
      evidence: "",
    };
  }
  // `<teamId>.<workerName>` — minted from the folders the way the loader does.
  const seatParts = seatFile.split(sep);
  const seatAddress = `${seatParts[seatParts.length - 4]}.${seatParts[seatParts.length - 2]}`;

  const o = runHarness<Observation>({
    app: KITCHEN_SINK,
    harness: new URL("./harness.mts", import.meta.url),
    env: {
      FSD_ENV: "dev",
      GOAL_TREE: JSON.stringify({
        channels: manifests.map((m) => ({ id: m.id, address: m.declaredKind ?? "channel" })),
        boardHolder: {
          id: boardHolder.id,
          address: boardHolder.declaredKind ?? "channel",
          boards: boardHolder.boards,
        },
        attendedBoard,
        unwiredBoard: unwiredBoards[0],
        seatAddress,
        seatKind: runnerKind,
        author: (boardHolder.frontmatter.match(/^members:\s*\[(.*)\]\s*$/m)?.[1] ?? "")
          .split(",")[0]
          ?.trim(),
        membersByChannel: Object.fromEntries(
          manifests.map((m) => [
            m.id,
            (m.frontmatter.match(/^members:\s*\[(.*)\]\s*$/m)?.[1] ?? "")
              .split(",")
              .map((name) => name.trim())
              .filter((name) => name.length > 0),
          ]),
        ),
        channelOwner,
        appUserId,
        orgId,
      }),
    },
  });
  if (o.ok !== true) {
    return { failures: ["the harness did not complete"], evidence: "" };
  }

  /** Did the runtime map agree with the committed one? */
  if (JSON.stringify([...o.channelKindNames].sort()) !== JSON.stringify(expectedKinds)) {
    failures.push(
      `V1: at run time channelKinds holds ${JSON.stringify(o.channelKindNames)}, ` +
        `wanted ${JSON.stringify(expectedKinds)}`,
    );
  }

  // ---- V11: the boot opened them, and the check opened nothing -------------
  //
  // What this leg grades is that the CONFIG opens the channels: by the time an
  // importer can do anything at all, every channel the tree declares is a real
  // session, and the harness called no open of its own. Its red state is the
  // call being gone.
  //
  // It is NOT the leg that grades the `await`. Read the note on
  // `moduleScopeCall` above before deciding this one covers a fire-and-forget
  // open: it catches one today only by winning a race with a one-turn margin,
  // which is why V11b exists and why nothing here claims otherwise.
  {
    const wanted = manifests.map((m) => m.id).sort();
    const got = [...o.openAtImport].sort();
    if (JSON.stringify(got) !== JSON.stringify(wanted)) {
      failures.push(
        `V11: ${got.length} of ${wanted.length} channels were open when the config module's ` +
          `import resolved (${JSON.stringify(got)}) — the boot does not open the tree's ` +
          `channels, so the first caller of one meets an empty session`,
      );
    }
  }
  if (o.deskRead.requestStatus !== "completed") {
    failures.push(
      `V11: the first read after importing the config ended "${o.deskRead.requestStatus}" ` +
        `(${JSON.stringify(o.deskRead.error)}) — the channels were not open`,
    );
  }

  // ---- V11b: the open is an awaited module-scope statement -----------------
  //
  // Structural on purpose, and `moduleScopeCall`'s note says what that costs.
  // The short version: ESM blocks every importer until module evaluation
  // finishes, so no importer can observe the difference between an awaited
  // open and a loose one except by racing it — and the race has a one-turn
  // margin. The shape of the statement IS the guarantee, so the shape is what
  // gets graded.
  {
    const shape = moduleScopeCall(configSource, CONFIG, "openChannels");
    if (shape !== "awaited") {
      failures.push(
        `V11b: fsdev.config.ts calls openChannels ${
          shape === "loose"
            ? "at module scope without awaiting it"
            : "in no module-scope statement this recognises"
        } — an importer is then served while the open is still in flight. ` +
          `This is a structural check: it reads the statement, not the run`,
      );
    }
  }

  // ---- V3: each channel opened on the kind its file selected ---------------
  //
  // The first clause is not decoration. Without it this leg reads its
  // expectation off the same `flow:` line it is testing, so deleting that line
  // moves both sides together and the leg goes green on a tree where no
  // channel runs a kind of its own — which is the state V3 exists to catch.
  {
    const naming = manifests.filter(
      (m) => m.declaredKind !== null && expectedKinds.includes(m.declaredKind),
    );
    const silent = manifests.filter((m) => m.declaredKind === null);
    if (naming.length !== 1) {
      failures.push(
        `V3: ${naming.length} channels select a generated kind with \`flow:\`, wanted exactly ` +
          `one — the custom-kind half of the reference is not in the tree`,
      );
    }
    if (silent.length === 0) {
      failures.push("V3: no channel omits `flow:`, so nothing shows the built-in being the default");
    }
    for (const m of manifests) {
      const session = o.sessions[m.id];
      const wanted = m.declaredKind ?? "channel";
      if (session?.flowKind !== wanted) {
        failures.push(
          `V3: ${m.id} opened on kind "${session?.flowKind}", and its file selects "${wanted}"`,
        );
      }
    }
  }

  // ---- V4: the custom kind's state schema admits what the binder writes ----
  {
    const custom = manifests.find((m) => m.declaredKind !== null);
    if (custom === undefined) {
      failures.push("V4: no channel in the tree names a kind of its own");
    } else {
      const state = o.sessions[custom.id]?.state ?? {};
      for (const key of ["members", "instructions", "transcript"]) {
        if (!Object.hasOwn(state, key)) {
          failures.push(
            `V4: ${custom.id}'s open session carries no "${key}" — the kind's stateSchema ` +
              `does not declare it, so the binder's value was silently stripped ` +
              `(state keys: ${Object.keys(state).join(", ")})`,
          );
        }
      }
    }
  }

  // ---- V5: the channel says what it holds, by name -------------------------
  {
    // Whole-array equality against the names read off the manifest. Sorted on
    // both sides because the framework sorts the minted ids it is built with,
    // so declaration order is not preserved and asserting it would be
    // asserting the sort.
    const held = o.deskRead.output?.boards;
    const wanted = [...boardHolder.boards].sort();
    if (JSON.stringify(held) !== JSON.stringify(wanted)) {
      failures.push(
        `V5: ${boardHolder.id}'s read listed ${JSON.stringify(held)}, and its file declares ` +
          `${JSON.stringify(wanted)}`,
      );
    }
  }

  // ---- V9: exactly one unattended-board warning, naming the unwired board --
  {
    const unattended = o.warnings.filter((w) => w.startsWith("[workforce] channel "));
    // `attendedBoard` / `unwiredBoards` are the ones derived above, off whichever
    // worker kind declares a channelBoard — never a filename typed here.
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
    if (unattended.some((w) => w.includes(`"${attendedBoard}"`))) {
      failures.push(`V9: a warning names "${attendedBoard}", which a seat does declare`);
    }
  }

  // ---- V7: the row the seat's board claimed, and the effect outside it -----
  {
    if (o.filedFollowup.requestStatus !== "completed") {
      failures.push(`V7: filing the followup row ended "${o.filedFollowup.requestStatus}"`);
    }
    if (o.drained.requestStatus !== "completed") {
      failures.push(
        `V7: the seat's drain ended "${o.drained.requestStatus}" ` +
          `(${JSON.stringify(o.drained.error)})`,
      );
    }

    const rows = o.board_followups.output?.tasks ?? [];
    const row = rows.find((t: any) => t.goal === o.followupGoal);
    if (row === undefined) {
      failures.push(
        `V7: the attended board holds no row for ${JSON.stringify(o.followupGoal)} ` +
          `(${rows.length} row(s) there)`,
      );
    } else if (row.status !== "completed") {
      failures.push(`V7: the row is "${row.status}", not completed`);
    }

    // The durable row, asserted on its STATUS. Existence alone is not the claim:
    // a row is written to the ledger the moment it is FILED, so `!== null` holds
    // even when nothing ever ran — it holds under V7's own by-name control,
    // where the drain claims nothing. What this leg advertises is persistence
    // proof independent of the board's own projection, and only the status
    // carries that.
    const stored = o.followupRowInStorage?.state;
    if (stored === undefined) {
      failures.push(
        `V7: the row is not on the minted ledger — nothing at ` +
          `resourceState("org", "${o.orgId}", "${o.followupRowKey}")`,
      );
    } else if (stored.goal !== o.followupGoal) {
      failures.push(
        `V7: the row on the minted ledger records ${JSON.stringify(stored.goal)}, and the desk ` +
          `filed ${JSON.stringify(o.followupGoal)}`,
      );
    } else if (stored.status !== "completed") {
      failures.push(
        `V7: the durable row under "${o.followupRowKey}" is "${stored.status}", not completed — ` +
          `the board's projection and the ledger disagree, or nothing ran`,
      );
    }

    // The effect OUTSIDE the board. The board's own report is generated on the
    // path under test, so it cannot be its own evidence.
    if (o.notes === null) {
      failures.push("V7: the seat left no note outside the board — nothing proves the work ran");
    } else if (o.notes?.state?.followup !== o.followupGoal) {
      failures.push(
        `V7: the note outside the board records ${JSON.stringify(o.notes?.state?.followup)}, ` +
          `and the row asked for ${JSON.stringify(o.followupGoal)}`,
      );
    }
  }

  // ---- V14: the writer is not told about their own post -------------------
  //
  // Behavioural, and it grades DELIVERY rather than dispatch. The fan-out is
  // declared once on the kind, so it still runs and still addresses every
  // declared member including the writer; what the app controls from its notify
  // slot is whether a delivery is made. The claim is "no notification goes back
  // to the author", not "the fan-out skipped them".
  //
  // Asserted as a SET, against the roster minus the author, and not as a count.
  // A count would be green on a fan-out that notified the wrong people, and
  // "fewer than everybody" would be green on one that notified nobody — which
  // is the shape a one-sided check invites. Every other member must still get
  // theirs, so a broken fan-out fails here rather than passing quietly.
  {
    for (const m of manifests) {
      const members = (m.frontmatter.match(/^members:\s*\[(.*)\]\s*$/m)?.[1] ?? "")
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      const seen = o.notified[m.id];
      if (seen === undefined || seen.problem !== undefined) {
        failures.push(`V14: posting to ${m.id} did not settle — ${seen?.problem ?? "not probed"}`);
        continue;
      }
      // A channel on a kind of its own declares no fan-out slot at all, so
      // there is no delivery rule of the app's to grade. Skipped by that fact
      // rather than by name.
      if (m.declaredKind !== null) {
        if (seen.reached !== 0) {
          failures.push(
            `V14: ${m.id} runs a kind of its own and a fan-out still reached ${seen.reached} ` +
              `member(s) — a hand-written kind declares no notify slot`,
          );
        }
        continue;
      }

      // The harness posts as the channel's first declared member.
      const author = members[0];
      const wanted = members.filter((name) => name !== author).sort();
      const got = [...seen.delivered].sort();
      if (JSON.stringify(got) !== JSON.stringify(wanted)) {
        failures.push(
          `V14: ${m.id} was written by ${JSON.stringify(author)} and the fan-out delivered to ` +
            `${JSON.stringify(got)} — every other declared member and nobody else should have ` +
            `been told, which is ${JSON.stringify(wanted)}`,
        );
      }
      // The framework's half, asserted separately: the fan-out still addresses
      // the whole roster. If this ever changed the leg above would go green for
      // the wrong reason — the author being skipped by the framework rather
      // than declined by the app.
      if (seen.reached !== members.length) {
        failures.push(
          `V14: ${m.id}'s fan-out addressed ${seen.reached} of ${members.length} declared ` +
            `member(s); the framework walks the whole roster and the app declines deliveries`,
        );
      }
    }
  }

  // ---- V13: a caller using the app's own user id can reach the channels ---
  //
  // Sessions are per-user, and the session listing filters on the caller's id.
  // The app's pages call as one id; the config opens the channels as another,
  // and when the two differ the app ships channels no user of it can list.
  //
  // The LISTING is the whole leg. Acting as the wrong id is deliberately not
  // asserted: measured on this app, a post as a non-owner is accepted (202)
  // because no `resolvePrincipal` is configured, so the route's owner check
  // never engages. An assertion on it could not fail here, and a leg that
  // cannot fail is worse than no leg.
  {
    const wanted = manifests.map((m) => m.id).sort();
    const seen = [...o.visibleToAppUser].filter((id) => wanted.includes(id)).sort();
    if (JSON.stringify(seen) !== JSON.stringify(wanted)) {
      failures.push(
        `V13: a caller using the app's own user id ("${appUserId}") lists ${seen.length} of ` +
          `${wanted.length} channels (${JSON.stringify(seen)}) — the config opens them as ` +
          `"${channelOwner}", who the app's pages never call as`,
      );
    }
  }

  // ---- V8: the drain is a subset, not an ambient sweep ---------------------
  {
    if (o.filedEscalation.requestStatus !== "completed") {
      failures.push(`V8: filing the escalation row ended "${o.filedEscalation.requestStatus}"`);
    }
    const rows = o.board_escalations.output?.tasks ?? [];
    const row = rows.find((t: any) => t.goal === o.escalationGoal);
    if (row === undefined) {
      failures.push(`V8: the unwired board holds no row for ${JSON.stringify(o.escalationGoal)}`);
    } else if (row.status !== "pending") {
      failures.push(
        `V8: the row on the unwired board is "${row.status}" — the drain is not a subset, it ` +
          `claimed a board its kind never declared`,
      );
    }
  }

  if (failures.length === 0) {
    evidence.push(
      `boot: the config opened ${manifests.length} channels and the first router call found ` +
        `them open; ${manifests.map((m) => `${m.id}→${o.sessions[m.id]?.flowKind}`).join(", ")}`,
      `V7: one row filed through the channel's own action was claimed and run by the app's ` +
        `seat — proved by a note under resourceState("org", "${o.orgId}", ` +
        `"support-followup-notes/…"), an effect the board could not have produced by reporting ` +
        `— and reads completed out of org-scoped storage under "${o.followupRowKey}"`,
      `V8/V9: the row on the unwired board is still pending, and the boot said so once`,
    );
  }

  return { failures, evidence: evidence.join("; ") };
});
