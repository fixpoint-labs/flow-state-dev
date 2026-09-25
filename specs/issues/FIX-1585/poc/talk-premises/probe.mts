/**
 * FIX-1585 spec POC — the premises the design rests on, checked on the real
 * kitchen-sink wiring (its `fsdev.config.ts`, its roster, its channel boot),
 * over the same HTTP routes the page calls, in-process.
 *
 * Throwaway and retained as evidence only. Lives under `specs/`, which no
 * build, test runner or `fsdev gen` walks.
 *
 * Run from the app directory, so the config's own relative imports resolve:
 *
 *   cd apps/kitchen-sink && pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/probe.mts
 *
 * Exits non-zero on the first premise that does not hold. `NEGATIVE=1` plants
 * a wrong expectation into P2 to show the probe can go red.
 */
import { createClient, createSessionClient } from "../../../../../packages/client/src/index.ts";
import flowstate from "../../../../../apps/kitchen-sink/fsdev.config.ts";

const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const router = await flowstate.getRouter();
  const url = new URL(String(input), "http://kitchen-sink.local");
  const path = url.pathname
    .replace(/^\/api\/flows\/?/, "")
    .split("/")
    .filter((s) => s.length > 0)
    .map(decodeURIComponent);
  const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST" | "PATCH" | "DELETE";
  return await router[method](new Request(url, init), { params: { path } });
};

const USER = "devuser";
const sessions = createSessionClient({ fetcher });
const channel = createClient({ flowKind: "channel", userId: USER, fetcher });
const ada = createClient({ flowKind: "support.ada", userId: USER, fetcher });

let failed = false;
function check(id: string, ok: boolean, detail: string) {
  console.log(`${ok ? "PASS" : "FAIL"} ${id} — ${detail}`);
  if (!ok) failed = true;
}

const text = (item: unknown) => JSON.stringify(item) ?? "undefined";
const marker = `fix-1585-probe-${Date.now()}`;

// P1 — a post with no author is accepted; its line's principal is the app's one user.
const posted = await channel.sendAction("post", { body: marker }, { sessionId: "support.desk" });
check("P1", posted !== undefined, `post accepted: ${text(posted).slice(0, 160)}`);

// Give the hand-off request a moment; nothing below depends on it finishing.
await new Promise((r) => setTimeout(r, 300));

// P2 — the line is in the session record the panel already loads (`detail.state.transcript`).
const detail = await sessions.getSession("support.desk");
const transcript = ((detail.state as { transcript?: unknown[] } | undefined)?.transcript ?? []) as Array<{
  body: string;
  principal?: string;
  author?: string;
}>;
const line = transcript.find((l) => l.body === marker);
const expectedPrincipal = process.env.NEGATIVE === "1" ? "someone-else" : USER;
check(
  "P2",
  line !== undefined && line.principal === expectedPrincipal && line.author === undefined,
  `transcript line: ${text(line)}`,
);

// P3 — the post leaves NO client-visible, history-kept item carrying the body.
const snapshot = await sessions.getSessionState("support.desk", { includeItems: true });
const items = ((snapshot as { items?: unknown[] }).items ?? []) as Array<{ type: string }>;
const visibleWithBody = items.filter(
  (i) => text(i).includes(marker) && i.type !== "block_trace" && i.type !== "state_change",
);
check(
  "P3",
  visibleWithBody.length === 0,
  `items carrying the body (excluding trace/state_change): ${visibleWithBody.length}; item types: ${[
    ...new Set(items.map((i) => i.type)),
  ].join(",")}`,
);

// P4 — naming the app's user as `author` is refused: devuser is not a declared member.
let refusal = "";
let refusedRequestId: string | undefined;
try {
  const res = await channel.sendAction("post", { body: `${marker}-as-author`, author: USER }, { sessionId: "support.desk" });
  refusedRequestId = (res as { request?: { id: string } }).request?.id;
} catch (e) {
  refusal = String(e);
}
// Let the refused run settle before reading, so "not appended" is not a race.
let refusedStatus = "unknown";
for (let attempt = 0; attempt < 25 && refusedRequestId !== undefined; attempt++) {
  const requests = await sessions.listSessionRequests("support.desk");
  const found = (requests as unknown as Array<{ id: string; status: string; error?: unknown }>).find(
    (r) => r.id === refusedRequestId,
  );
  refusedStatus = found?.status ?? "unlisted";
  if (found !== undefined && found.status !== "in_progress") {
    refusal = refusal || text(found.error ?? found);
    break;
  }
  await new Promise((r) => setTimeout(r, 200));
}
const refusedDetail = await sessions.getSession("support.desk");
const leaked = ((refusedDetail.state as { transcript?: Array<{ body: string }> }).transcript ?? []).some(
  (l) => l.body === `${marker}-as-author`,
);
check("P4", !leaked && refusedStatus === "failed" && refusal.includes("author-not-a-member"), `author "devuser" not appended; request ${refusedStatus}; ${refusal.slice(0, 200)}`);

// P5 — a desk-clerk seat's `answer` leaves a durable assistant message in the seat's own session.
const seat = await sessions.createSession({ flowKind: "support.ada", userId: USER });
await ada.sendAction("answer", { note: `${marker}-ask` }, { sessionId: seat.id });
// The action route may answer before the run settles; poll the durable record briefly.
let reply: unknown;
let seatTypes: string[] = [];
for (let attempt = 0; attempt < 25 && reply === undefined; attempt++) {
  const seatSnap = await sessions.getSessionState(seat.id, { includeItems: true });
  const seatItems = (seatSnap.items ?? []) as Array<{ type: string }>;
  seatTypes = [...new Set(seatItems.map((i) => i.type))];
  reply = seatItems.find((i) => i.type === "message" && text(i).includes(`${marker}-ask`));
  if (reply === undefined) await new Promise((r) => setTimeout(r, 200));
}
check("P5", reply !== undefined, `seat reply item: ${text(reply).slice(0, 200)}; item types: ${seatTypes.join(",")}`);

// P6 — the served flow list names each seat kind's actions and their input fields, and each
// kind has exactly the one-string-field action D3 writes down for it (none for followup-runner).
// Red if a kind gains a second one-string action, which is the ambiguity D3 guards against.
const expectedAnswer: Record<string, { action: string; field: string } | null> = {
  agent: { action: "run", field: "message" },
  "desk-clerk": { action: "answer", field: "note" },
  "followup-runner": null,
};
type ServedSchema = { type: string; fields?: Record<string, { type: string; required?: boolean }> };
const flows = await channel.listFlows();
for (const [kind, expected] of Object.entries(expectedAnswer)) {
  const entry = flows.find((f) => f.kind === kind);
  if (entry === undefined) {
    check(`P6:${kind}`, false, "no instance listed");
    continue;
  }
  const schemas = (entry.actionSchemas ?? {}) as Record<string, ServedSchema>;
  const oneString = Object.entries(schemas)
    .filter(([, schema]) => {
      const fields = Object.entries(schema.fields ?? {});
      return fields.length === 1 && fields[0][1].type === "string" && fields[0][1].required === true;
    })
    .map(([action, schema]) => `${action}{${Object.keys(schema.fields ?? {})[0]}}`);
  const want = expected === null ? [] : [`${expected.action}{${expected.field}}`];
  check(
    `P6:${kind}`,
    oneString.join(",") === want.join(","),
    `one-string actions=[${oneString.join(",")}] expected=[${want.join(",")}]; actions=${entry.actions.join(",")} schemas=${text(entry.actionSchemas)}`,
  );
}

await flowstate.dispose();
process.exit(failed ? 1 : 0);
