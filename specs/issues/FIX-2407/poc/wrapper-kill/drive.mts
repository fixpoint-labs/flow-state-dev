import { spawn } from "node:child_process";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
for (const detached of [false, true]) {
  const port = 47_000 + (detached ? 1 : 0);
  const child = spawn(process.argv[2]!, [process.argv[3]!], { env: { ...process.env, PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"], detached });
  child.stdout!.on("data", () => {});
  await sleep(3000);
  const before = await fetch(`http://127.0.0.1:${port}`).then((r) => r.text(), () => "down");
  if (detached) process.kill(-child.pid!, "SIGKILL"); else child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));
  await sleep(1000);
  const after = await fetch(`http://127.0.0.1:${port}`).then((r) => r.text(), () => "down");
  console.log(detached ? "group SIGKILL" : "child.kill SIGKILL", "wrapper pid", child.pid, "| before:", before, "| after:", after);
  if (after !== "down") { const pid = Number(after.split(" ")[1]); process.kill(pid, "SIGKILL"); }
}
