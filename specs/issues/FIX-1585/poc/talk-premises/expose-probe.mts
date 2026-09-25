/**
 * FIX-1585 spec POC — D1's premise: one `expose` declaration on the built-in
 * channel kind puts the transcript, and nothing else of the channel's state,
 * into `clientData.session` for the page's existing snapshot read.
 *
 * Needs the one-line declaration applied to
 * `packages/workforce/src/channel/channel-flow.ts` first (the probe does not
 * apply it); without it P7 goes red, which is the control.
 *
 *   cd apps/kitchen-sink && pnpm exec tsx ../../specs/issues/FIX-1585/poc/talk-premises/expose-probe.mts
 */
import { createClient, createSessionClient } from "../../../../../packages/client/src/index.ts";
import flowstate from "../../../../../apps/kitchen-sink/fsdev.config.ts";

const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
  const router = await flowstate.getRouter();
  const url = new URL(String(input), "http://kitchen-sink.local");
  const path = url.pathname.replace(/^\/api\/flows\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const method = (init?.method ?? "GET").toUpperCase() as "GET" | "POST";
  return await router[method](new Request(url, init), { params: { path } });
};
const sessions = createSessionClient({ fetcher });
const channel = createClient({ flowKind: "channel", userId: "devuser", fetcher });
const marker = `fix-1585-expose-${Date.now()}`;
await channel.sendAction("post", { body: marker }, { sessionId: "support.desk" });
let session: Record<string, unknown> | undefined;
for (let i = 0; i < 25; i++) {
  const snap = await sessions.getSessionState("support.desk");
  session = snap.clientData.session;
  const t = (session?.transcript ?? []) as Array<{ body: string }>;
  if (t.some((l) => l.body === marker)) break;
  await new Promise((r) => setTimeout(r, 200));
}
const lines = (session?.transcript ?? []) as Array<{ body: string; principal?: string }>;
const ok = lines.some((l) => l.body === marker && l.principal === "devuser");
const keys = Object.keys(session ?? {}).sort();
console.log(`${ok ? "PASS" : "FAIL"} P7 — clientData.session.transcript carries the post: ${ok}`);
const onlyTranscript = keys.length === 1 && keys[0] === "transcript";
console.log(`${onlyTranscript ? "PASS" : "FAIL"} P8 — clientData.session keys: [${keys.join(", ")}] (members and instructions stay private)`);
await flowstate.dispose();
process.exit(ok && onlyTranscript ? 0 : 1);
