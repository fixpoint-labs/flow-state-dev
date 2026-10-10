// Stand-in for the FSD host. A socket is the real transport; this POC uses a
// file rendezvous because the authoring sandbox forbids listen(2). What is
// under test is whether the spawned run BLOCKS, not how the bytes travel.
import {
  readdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";

const DIR = new URL("./mailbox/", import.meta.url).pathname;
mkdirSync(DIR, { recursive: true });
console.error("[host] watching mailbox");

setInterval(() => {
  for (const f of readdirSync(DIR)) {
    if (!f.endsWith(".req")) continue;
    const id = f.slice(0, -4);
    const msg = JSON.parse(readFileSync(DIR + f, "utf8"));
    unlinkSync(DIR + f);
    console.error(
      `[host] <- ${msg.kind}: ${JSON.stringify(msg.payload).slice(0, 120)}`,
    );
    // The operator "thinks" for 2s. The run must still be blocked after this.
    setTimeout(() => {
      const answer =
        msg.kind === "approval"
          ? {
              decision: "deny",
              message: "Denied by the operator via the FSD host.",
            }
          : { answer: "Use the staging database, never prod." };
      writeFileSync(DIR + id + ".res", JSON.stringify(answer));
      console.error(`[host] -> ${JSON.stringify(answer)}`);
    }, 2000);
  }
}, 100);
