// FIX-2773 spec evidence (D1). Throwaway: not production code, not in any default test run.
/**
 * Measures a real coding board as harness-manager's coding board view answers it:
 * claude-code-style's own host, only the model scripted (`vendorScripts`), two
 * research tasks filed by a session-mode turn and both settled. Prints each
 * row's serialized size and the whole board's, today, before D1 adds any field.
 *
 * To run: copy it into `labs/claude-code-style/test/`, then
 *   pnpm --filter @flow-state-dev/claude-code-style exec vitest run test/board-size.test.ts
 * and delete the copy.
 */
import { afterEach, expect, it } from "vitest";
import { codingBoardViewRef } from "@flow-state-dev/harness-manager/browser";
import { closeApps, openTestApp, readUntil, vendorScripts } from "./app-host";

afterEach(closeApps);

it("measures a settled coding board", async () => {
  const { scripts, control } = vendorScripts();
  const lab = await openTestApp({ scripts });
  const session = (await lab.calls.openSession("session", lab.project!.id)).id;
  await lab.calls.send(session, "Compare Acme and Globex for us.");
  const read = async () => (await lab.client.view(codingBoardViewRef(), { sessionId: session })).value;
  await readUntil(read, (rows) => rows.length === 2, 30_000);
  control.releaseGlobex();
  const rows = await readUntil(read, (rows) => rows.length === 2 && rows.every((row) => row.status === "completed"), 30_000);
  const sizes = rows.map((row) => ({ title: row.title, bytes: Buffer.byteLength(JSON.stringify(row)) }));
  const board = Buffer.byteLength(JSON.stringify(rows));
  console.log(JSON.stringify({ rows: sizes, board, perRow: Math.round(board / rows.length) }));
  console.log(JSON.stringify(rows[0], null, 1));
  expect(rows.length).toBe(2);
}, 90_000);
