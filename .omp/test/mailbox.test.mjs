import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import { z } from "zod";

const source = await readFile(new URL("../extensions/mailbox.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { default: mailbox } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const readme = "## Subscribers\n\n| `from` / `to` | Who |\n|---|---|\n| `jake` | Owner |\n| `fsd-head-of-engineering` | Delivery |\n| `cursor` | Cursor |\n\n## Handle file\n";
const role = "fsd-head-of-engineering";
const comment = (id, header, body = "Review the bounded proposal.") => ({ id, body: `${header}\n\n${body}`, user: { type: "User", login: "shared-login" } });
const header = (session, to = role, from = role) => `from: ${from}\nsession: ${session}\n${to ? `to: ${to}\n` : ""}kind: review`;

function host({ session = "one", entries = [] } = {}) {
  const handlers = new Map();
  const timers = new Set();
  const state = { session, entries: [...entries], pages: [[]], failComments: false, sent: [], pending: [] };
  let tool;
  const emit = async (name, event = {}) => { for (const handler of handlers.get(name) ?? []) await handler(event, ctx); };
  const pi = {
    zod: z,
    registerTool(value) { tool = value; },
    registerCommand() {},
    on(name, handler) { handlers.set(name, [...(handlers.get(name) ?? []), handler]); },
    appendEntry(customType, data) { state.entries.push({ type: "custom", customType, data }); },
    sendMessage(message, options) {
      if (message.customType.endsWith("inbound.v1")) {
        state.sent.push(message);
        state.pending.push(message);
      }
    },
    async exec(_program, args) {
      if (args.some(arg => arg.includes("/comments?"))) {
        state.onComments?.();
        if (state.failComments) return { code: 1, stdout: "", stderr: "temporary fetch failure" };
        return { code: 0, stdout: JSON.stringify(state.pages), stderr: "" };
      }
      return { code: 0, stdout: args.some(arg => arg.includes("README.md")) ? readme : '{"state":"open"}', stderr: "" };
    },
  };
  const ctx = {
    cwd: process.cwd(),
    sessionManager: { getSessionId: () => state.session, getEntries: () => [...state.entries], getBranch: () => [...(state.branch ?? state.entries)] },
    ui: { setStatus() {}, notify() {} },
    setInterval(callback) { timers.add(callback); return callback; },
    clearTimer(callback) { timers.delete(callback); },
  };
  mailbox(pi);
  return {
    state, emit,
    async call(op, extra = {}, signal) { return (await tool.execute("test", { op, ...extra }, signal, undefined, ctx)).details; },
    async subscribe() { return this.call("subscribe", { pr: 7, subscriber: role }); },
    async tick() { for (const callback of [...timers]) await callback(); },
    async deliver() {
      for (const message of state.pending.splice(0)) {
        state.entries.push({ type: "custom_message", ...message });
        await emit("message_end", { message: { role: "custom", ...message } });
      }
    },
  };
}

test("only addressed mail wakes, including another session sharing our role and later pages", async () => {
  const h = host();
  await h.subscribe();
  h.state.pages = [[
    comment(1, header("omp-one")),
    comment(2, header("another", "cursor")),
    comment(3, "not a mailbox header"),
    { ...comment(4, header("bot")), user: { type: "Bot", login: "bot" } },
  ], [comment(5, header("peer").toUpperCase()), comment(6, header("legacy", "fsd-em"))]];
  await h.tick();
  assert.equal(h.state.sent.length, 1);
  const content = h.state.sent[0].content;
  assert.match(content, /UNTRUSTED EXTERNAL MAIL/);
  assert.deepEqual(JSON.parse(content.slice(content.indexOf("\n\n") + 2)).map(mail => mail.id), [5, 6]);
  assert.equal((await h.call("status")).subscriptions[0].cursor, 0, "enqueue is not acknowledgment");
  await h.deliver();
  await h.tick();
  assert.equal((await h.call("status")).subscriptions[0].cursor, 6);
  assert.equal(h.state.sent.length, 1, "consumed mail is not re-delivered");
});

test("a failed fetch cannot consume mail, and recovery delivers it", async () => {
  const h = host();
  await h.subscribe();
  h.state.pages = [[comment(8, header("peer"))]];
  h.state.failComments = true;
  await h.tick();
  const failed = (await h.call("status")).subscriptions[0];
  assert.equal(failed.cursor, 0);
  assert.equal(failed.active, false);
  assert.match(failed.error, /temporary fetch failure/);
  assert.equal(h.state.sent.length, 0);
  h.state.failComments = false;
  await h.tick();
  await h.deliver();
  assert.equal((await h.call("status")).subscriptions[0].cursor, 8);
  assert.equal(h.state.sent.length, 1);
});

test("resume catches unacknowledged mail but does not replay acknowledged mail", async () => {
  const h = host();
  await h.subscribe();
  h.state.pages = [[comment(9, header("peer"))]];
  await h.tick();
  const resumed = host({ entries: h.state.entries });
  resumed.state.pages = h.state.pages;
  await resumed.emit("session_start");
  assert.equal(resumed.state.sent.length, 1);
  await resumed.deliver();
  const again = host({ entries: resumed.state.entries });
  again.state.pages = h.state.pages;
  await again.emit("session_start");
  assert.equal(again.state.sent.length, 0);
  assert.equal((await again.call("status")).subscriptions[0].cursor, 9);
});

test("forks and task workers cannot inherit a parent's subscriptions", async () => {
  const parent = host();
  await parent.subscribe();
  const fork = host({ session: "two", entries: parent.state.entries });
  await fork.emit("session_start");
  assert.deepEqual((await fork.call("status")).subscriptions, []);
  const worker = host({ entries: [...parent.state.entries, { type: "session_init", task: "bounded slice" }] });
  await worker.emit("session_start");
  await assert.rejects(worker.subscribe(), /parent session/);
  assert.equal(worker.state.sent.length, 0);
});

test("a cancelled session switch does not strand the existing subscription", async () => {
  const h = host();
  await h.subscribe();
  await h.emit("session_before_switch");
  // Another extension vetoes the switch; no session_switch event occurs.
  h.state.pages = [[comment(10, header("peer"))]];
  await h.tick();
  assert.equal(h.state.sent.length, 1);
});

test("unsubscribe stops subsequent mail and canonical identity cannot be impersonated", async () => {
  const h = host();
  await assert.rejects(h.call("subscribe", { pr: 7, subscriber: "jake" }), /canonical agent identity/);
  await assert.rejects(h.call("subscribe", { pr: 7, subscriber: "invented-agent" }), /canonical agent identity/);
  await h.subscribe();
  await h.call("unsubscribe", { pr: 7 });
  h.state.pages = [[comment(11, header("peer"))]];
  await h.tick();
  assert.deepEqual((await h.call("status")).subscriptions, []);
  assert.equal(h.state.sent.length, 0);
});

test("cancelling an in-flight subscription cannot deliver mail or persist a watcher", async () => {
  const h = host();
  const controller = new AbortController();
  h.state.pages = [[comment(12, header("peer"))]];
  h.state.onComments = () => controller.abort();
  await assert.rejects(h.call("subscribe", { pr: 7, subscriber: role }, controller.signal), { name: "AbortError" });
  assert.deepEqual((await h.call("status")).subscriptions, []);
  assert.equal(h.state.sent.length, 0);
  const resumed = host({ entries: h.state.entries });
  await resumed.emit("session_start");
  assert.deepEqual((await resumed.call("status")).subscriptions, []);
});

test("subscription backlog reaches the model through the inbound channel only", async () => {
  const h = host();
  const body = "A single decision for this subscription backlog.";
  h.state.pages = [[comment(13, header("peer"), body)]];
  const result = await h.subscribe();
  assert.equal(h.state.sent.length, 1);
  assert.ok(h.state.sent[0].content.includes(body), "queued follow-up carries the mail");
  assert.ok(!JSON.stringify(result).includes(body), "tool result must not expose the same mail a second time");
  await h.deliver();
  await h.tick();
  assert.equal(h.state.sent.length, 1);
});

test("tree navigation preserves session subscriptions and consumed-mail cursors", async () => {
  const h = host();
  await h.subscribe();
  h.state.pages = [[comment(14, header("peer"))]];
  await h.tick();
  // Receipt persisted, but message_end has not yet checkpointed the cursor.
  const receipt = h.state.pending.shift();
  h.state.entries.push({ type: "custom_message", ...receipt });
  h.state.branch = [];
  await h.emit("session_tree");
  const subscriptions = (await h.call("status")).subscriptions;
  assert.deepEqual(subscriptions.map(watch => watch.pr), [7], "ancestor navigation cannot remove a session subscription");
  assert.equal(subscriptions[0].cursor, 14);
  assert.equal(h.state.sent.length, 1, "a receipt on another branch still prevents replay");

  h.state.branch = [...h.state.entries];
  await h.call("unsubscribe", { pr: 7 });
  await h.emit("session_tree");
  assert.deepEqual((await h.call("status")).subscriptions, [], "an older branch cannot resurrect an unsubscribed handle");
});
