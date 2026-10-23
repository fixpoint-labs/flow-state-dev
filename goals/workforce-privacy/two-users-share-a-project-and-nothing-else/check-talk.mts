/**
 * Model-free check of `talk` (people.mts): a turn on a coordinator that
 * routes the person's post is graded on the delegate's answer, which lands
 * in the session in a request of its own after the `respond` request has
 * completed. `pnpm tsx goals/workforce-privacy/two-users-share-a-project-and-nothing-else/check-talk.mts`.
 *
 * The milestone forks a standard worker picked at run time. One of them,
 * `eng.triage`, is a coordinator with `routing: everyone`: its `respond`
 * request completes once the post is delivered to `eng.em`, and `eng.em`'s
 * answer reaches the session a few seconds later, through the routed task's
 * notice (the coordinator contract, apps/docs/docs/workforce/coordinators.md).
 * Read off the `respond` request alone, the turn had no answer (m3), and the
 * answer that landed afterwards grew Alice's session while Bob posted (m2).
 *
 * Each case runs `talk` against a scripted session (a fake action client and
 * fake routes, no server, no model) and grades what it returned and whether
 * the session was quiet when it did.
 */
import { RunRecord, type Turn } from "./record.mts";
import { talk, type Connected } from "./people.mts";

type Item = Record<string, unknown>;
type Req = { id: string; status: string };

/** A session the case scripts: every poll of its items advances it one tick. */
class ScriptedSession {
  tick = 0;
  readonly items: Item[] = [];
  readonly requests: Req[] = [];
  constructor(private readonly script: (s: ScriptedSession, tick: number) => void) {}
  advance(): void {
    this.script(this, this.tick++);
  }
  running(): boolean {
    return this.requests.some((r) => r.status === "in_progress");
  }
}

const POST = "req_post";
const user = (requestId: string): Item => ({ id: `msg_${requestId}`, type: "message", role: "user", requestId, content: [{ type: "output_text", text: "the post" }] });
const said = (requestId: string, text: string, agentName?: string): Item => ({
  id: `answer_${requestId}`,
  type: "message",
  role: "assistant",
  requestId,
  ...(agentName === undefined ? {} : { agentName }),
  content: [{ type: "output_text", text }],
});
const routedTo = (worker: string): Item => ({
  id: "route_record",
  type: "component",
  component: "coordinator-route",
  requestId: POST,
  data: { postId: POST, round: 0, policy: "everyone", by: "everyone", delegates: [{ worker, outcome: "delivered" }] },
});

/** A person connected to `session`, through fakes of the two surfaces `talk` reads. */
function connectedTo(session: ScriptedSession): Connected {
  const flow = {
    sendAction: async () => {
      session.advance();
      return { request: { id: POST } };
    },
    getRequestStatus: async (id: string) => {
      session.advance();
      return { status: session.requests.find((r) => r.id === id)?.status ?? "in_progress" };
    },
  };
  const routes = {
    items: async (_sessionId: string, types: string) => {
      session.advance();
      return session.items.filter((i) => types === "" || types.split(",").includes(String(i.type)));
    },
    requests: async () => session.requests.map((r) => ({ ...r })),
  };
  return { person: { label: "Alice", userId: "alice", bearer: "" }, flow: () => flow, routes } as unknown as Connected;
}

/** A coordinator post routed to `eng.em`, whose answer lands after the post's request completed, then a dispatch runs. */
const routed = new ScriptedSession((s, tick) => {
  if (tick === 0) {
    s.items.push(user(POST), routedTo("eng.em"));
    s.requests.push({ id: POST, status: "completed" });
  }
  if (tick === 4) s.requests.push({ id: "req_notice", status: "in_progress" });
  if (tick === 7) {
    s.items.push(said("req_notice", "noted", "eng.em"));
    s.requests.find((r) => r.id === "req_notice")!.status = "completed";
    s.requests.push({ id: "req_dispatch", status: "in_progress" });
  }
  if (tick === 9) {
    s.items.push({ id: "dispatch_change", type: "component", component: "task-change", requestId: "req_dispatch" });
    s.requests.find((r) => r.id === "req_dispatch")!.status = "completed";
  }
});

/** A worker that answers in its own turn. */
const direct = new ScriptedSession((s, tick) => {
  if (tick === 0) {
    s.items.push(user(POST), said(POST, "noted"));
    s.requests.push({ id: POST, status: "completed" });
  }
});

const failures: string[] = [];
const check = (name: string, ok: boolean, saw: string) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${saw}`);
  if (!ok) failures.push(name);
};

{
  const turn: Turn = await talk(new RunRecord("check", ""), "m1", connectedTo(routed), { id: "wks_alice", flowKind: "coordinator" }, "respond", "the post");
  check("a routed post is graded on the delegate's answer", turn.reply === "noted" && turn.answeredBy === "eng.em", `reply "${turn.reply}", answered by ${turn.answeredBy ?? "the turn itself"}`);
  check("talk returns once the session is quiet", !routed.running() && routed.items.some((i) => i.id === "dispatch_change"), `${routed.items.length} items, ${routed.running() ? "a request still running" : "nothing running"}`);
}
{
  const turn: Turn = await talk(new RunRecord("check", ""), "m1", connectedTo(direct), { id: "wks_alice", flowKind: "agent" }, "respond", "the post");
  check("a worker's own answer is read off its request", turn.reply === "noted" && turn.answeredBy === undefined && turn.replyItemId === `answer_${POST}`, `reply "${turn.reply}" (item ${turn.replyItemId})`);
}

if (failures.length > 0) {
  console.log(`FAIL — ${failures.join("; ")}`);
  process.exit(1);
}
console.log("PASS — talk grades a routed post on its delegate's answer");
