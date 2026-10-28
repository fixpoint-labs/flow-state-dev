// Throwaway evidence for FIX-2142, not production code.
// Reads the Claude Code binary the pinned Agent SDK ships and prints, for each
// claim the spec rests on, the code that shows it. Exits 1 if any is missing.
//
//   node specs/issues/FIX-2142/poc/rate-limit-event/inspect.mjs [path/to/claude]
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

function findBinary() {
  const store = "node_modules/.pnpm";
  for (const dir of readdirSync(store)) {
    if (!dir.startsWith("@anthropic-ai+claude-agent-sdk-linux-x64@")) continue;
    const bin = join(store, dir, "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude");
    if (existsSync(bin)) return bin;
  }
  throw new Error("no pinned claude binary under node_modules/.pnpm; run pnpm install");
}

const bin = process.argv[2] ?? findBinary();
const text = readFileSync(bin).toString("latin1");

const claims = [
  {
    claim: "An event is built from the current limits and sent on every status change (print mode)",
    re: /function kjp\(e,t,r=\{\}\)\{let n=O_v\(e,r\);if\(!n\)return;return\{type:"rate_limit_event"/,
  },
  {
    claim: "A change is emitted only when the limits differ from the last ones (sparse)",
    re: /if\(!zy\(this\.currentLimits,a\)\)this\.emitStatusChange\(a\)/,
  },
  {
    claim: "Plain 'allowed' carries status, reset and the representative window, and no utilization",
    re: /return\{status:w,resetsAt:o,unifiedRateLimitFallbackAvailable:i,\.\.\.s&&\{rateLimitType:s\}/,
  },
  {
    claim: "Utilization is set only on a warning: a server threshold header, or the early-burn thresholds",
    re: /status:"allowed_warning",resetsAt:s\?Math\.round\(Number\(s\)\):void 0,rateLimitType:n,utilization:a/,
  },
  {
    claim: "Utilization is a fraction 0..1 (thresholds 0.9, 0.75, 0.5, 0.25)",
    re: /rateLimitType:"five_hour",claimAbbrev:"5h",windowSeconds:18000,thresholds:\[\{utilization:0\.9,timePct:0\.72\}\]/,
  },
  {
    claim: "The status line multiplies the same header value by 100 for its used_percentage",
    re: /used_percentage:T\.five_hour\.utilization\*100/,
  },
  {
    claim: "resetsAt is epoch seconds (compared as resetsAt*1000 with Date.now())",
    re: /e\.status==="rejected"&&e\.resetsAt!==void 0&&e\.resetsAt\*1000<=Date\.now\(\)/,
  },
  {
    claim: "Without a subscription the limits reset to bare 'allowed' with no window",
    re: /if\(!nNr\(i\)\)\{if\(this\.rawUtilization=\{\}/,
  },
];

let missing = 0;
for (const { claim, re } of claims) {
  const m = re.exec(text);
  if (m === null) {
    missing++;
    console.log(`MISSING  ${claim}`);
  } else {
    console.log(`FOUND    ${claim}\n         ${text.slice(m.index, m.index + 160).replace(/\s+/g, " ")}`);
  }
}
console.log(`\n${claims.length - missing}/${claims.length} found in ${bin}`);
process.exit(missing === 0 ? 0 : 1);
