// FIX-2141 POC: read Codex's subscription usage the documented way, with no run.
// Throwaway design evidence, not production code. Usage:
//   node specs/issues/FIX-2141/poc/app-server-read/read.mjs <path-to-codex-binary>
// It starts `codex app-server`, sends initialize, account/read and
// account/rateLimits/read over stdio JSON-RPC, prints the two answers, and exits.
import { spawn } from "node:child_process";

const bin = process.argv[2] ?? "codex";
const child = spawn(bin, ["app-server"], { stdio: ["pipe", "pipe", "ignore"] });
const answers = new Map();
let buffer = "";
child.stdout.on("data", (chunk) => {
  buffer += chunk;
  let nl;
  while ((nl = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, nl);
    buffer = buffer.slice(nl + 1);
    const msg = JSON.parse(line);
    if (msg.id !== undefined) answers.set(msg.id, msg);
    if (answers.has(2) && answers.has(3)) {
      console.log(JSON.stringify({ account: answers.get(2), rateLimits: answers.get(3) }, null, 2));
      child.kill();
    }
  }
});
const send = (msg) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n");
send({ id: 1, method: "initialize", params: { clientInfo: { name: "fix-2141-poc", version: "0" } } });
send({ method: "initialized" });
send({ id: 2, method: "account/read", params: {} });
send({ id: 3, method: "account/rateLimits/read" });
setTimeout(() => {
  console.error("no answer within 15 s");
  child.kill();
  process.exit(1);
}, 15_000).unref();
