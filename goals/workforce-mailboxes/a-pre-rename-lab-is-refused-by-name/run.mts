/**
 * Goal check: a Lab whose tree or store predates the rename of channels to
 * mailboxes stops at boot and says so by name; a fresh one opens.
 *
 * No model. See goal.md for the contract. The Lab is `host.mts`, booted for
 * real over the fixture trees and a filesystem store per leg. Everything
 * graded is the message a person reads at boot, and the store afterwards.
 *
 *   tree     an old record file in an old folder: the boot stops, naming the
 *            file and where it belongs now.
 *   store    a session on the old built-in kind: the boot stops, naming the
 *            rename and the reset, and the old session is still there.
 *   custom   a mailbox on a kind of the app's own, whose kind never changed,
 *            with a line under the old item name: the boot stops, naming it.
 *   fresh    the same tree on an empty store: the boot opens both mailboxes.
 *
 * Run:      pnpm --dir goals exec tsx workforce-mailboxes/a-pre-rename-lab-is-refused-by-name/run.mts
 * Controls: GOAL_CONTROL=no-detector  (no store check at boot: must FAIL at custom, and nothing else)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import { createFilesystemStores } from "@flow-state-dev/engine";
import { MAILBOX_KIND, PRE_RENAME_NAMES } from "@flow-state-dev/workforce";
import { runGoal } from "../../lib/index.mts";
import { LAB_USER, bootLab } from "./host.mts";

const OLD_TREE = fileURLToPath(new URL("./fixtures/old-tree", import.meta.url));
const TREE = fileURLToPath(new URL("./fixtures/tree", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // Without the store check, only the binder is left, and a custom kind's
  // session looks open to it: the old store boots with its history unread.
  "no-detector": ["custom"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const RENAME_NAMED = /before channels were renamed to mailboxes/;
const now = Date.now();

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);
  const dirs: string[] = [];
  const storeDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "goal-pre-rename-"));
    dirs.push(dir);
    return dir;
  };
  const outOfBand = (dir: string) => createFilesystemStores({ rootDir: dir, developmentOnly: true });
  const checkStore = CONTROL !== "no-detector";

  /** Boot, and hand back the refusal a person reads, or `undefined` when it opened. */
  async function refusal(tree: string, dir: string): Promise<string | undefined> {
    try {
      const state = await bootLab({ tree, storeDir: dir, checkStore });
      await state.dispose();
      return undefined;
    } catch (error) {
      return (error as Error).message;
    }
  }

  async function seedSession(dir: string, id: string, flowKind: string) {
    await outOfBand(dir).session.set(
      id,
      {
        id, flowKind, flowId: flowKind, userId: LAB_USER, orgId: DEFAULT_ORG_ID, state: { members: [], instructions: "" },
        lineageId: `lin_${id}`, version: 0, createdAt: now, updatedAt: now, journal: [],
      } as never,
      "absent",
    );
  }

  try {
    // ---- tree: an old record file in an old folder ---------------------------
    {
      const message = await refusal(OLD_TREE, storeDir());
      const named =
        message !== undefined &&
        message.includes(`teams/desk/${PRE_RENAME_NAMES.recordFolder}/front/${PRE_RENAME_NAMES.recordFile}`) &&
        message.includes("teams/desk/mailboxes/front/MAILBOX.md") &&
        RENAME_NAMED.test(message);
      if (!named) fail("tree", `boot stopped with the rename named: want the old file and teams/desk/mailboxes/front/MAILBOX.md, got ${JSON.stringify(message ?? "it opened")}`);
      else evidence.push(`tree: ${message!.split("\n")[1]?.trim()}`);
    }

    // ---- store: a session on the old built-in kind ---------------------------
    {
      const dir = storeDir();
      await seedSession(dir, "desk.front", PRE_RENAME_NAMES.kind);
      const message = await refusal(TREE, dir);
      if (message === undefined || !RENAME_NAMED.test(message) || !/empty store/.test(message) || !message.includes("desk.front")) {
        fail("store", `boot stopped with the rename named: want desk.front, the rename and the reset, got ${JSON.stringify(message ?? "it opened")}`);
      } else {
        evidence.push(`store: ${message}`);
      }
      const kept = (await outOfBand(dir).session.get("desk.front"))?.flowKind;
      if (kept !== PRE_RENAME_NAMES.kind) fail("store", `the old session was not left as it was (kind now ${JSON.stringify(kept)})`);
    }

    // ---- custom: a custom-kind mailbox holding an old line -------------------
    {
      const dir = storeDir();
      await seedSession(dir, "desk.notices", "digest");
      await outOfBand(dir).request.set(
        "req_old_notice",
        {
          id: "req_old_notice", flowKind: "digest", flowId: "digest", actionName: "post", userId: LAB_USER, sessionId: "desk.notices", orgId: DEFAULT_ORG_ID,
          source: "http", status: "completed", startedAtMs: now, state: {}, lineageId: "lin_req_old_notice", version: 0,
          createdAt: now, updatedAt: now, journal: [],
          items: [{ id: "item_old_notice", type: "component", component: PRE_RENAME_NAMES.postComponent, data: { body: "old" }, status: "completed", createdAt: now }],
        } as never,
        "absent",
      );
      const message = await refusal(TREE, dir);
      if (message === undefined || !RENAME_NAMED.test(message) || !message.includes(`mailbox "desk.notices"`)) {
        fail("custom", `boot stopped with the rename named: want desk.notices named, got ${JSON.stringify(message ?? "it opened")}`);
      } else {
        evidence.push(`custom: ${message}`);
      }
    }

    // ---- fresh: the same tree on an empty store opens -------------------------
    {
      const dir = storeDir();
      const message = await refusal(TREE, dir);
      const store = outOfBand(dir);
      const front = (await store.session.get("desk.front"))?.flowKind;
      const notices = (await store.session.get("desk.notices"))?.flowKind;
      if (message !== undefined || front !== MAILBOX_KIND || notices !== "digest") {
        fail("fresh", `a fresh store must open both mailboxes: refusal ${JSON.stringify(message)}, desk.front on ${front}, desk.notices on ${notices}`);
      } else {
        evidence.push(`fresh: desk.front open on "${front}", desk.notices open on "${notices}"`);
      }
    }
  } finally {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
