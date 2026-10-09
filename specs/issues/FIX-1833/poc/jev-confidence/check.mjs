// Throwaway evidence for the FIX-1833 spec, not production code.
//
// Asks `typesafe-ai/jev`, through Vercel's AI Gateway, best fit's one choice question
// ("Which delegate should answer the post?") over the DevTeam chief of staff's delegates,
// for plain asks and for asks meant for the chief of staff, and prints each choice with
// the confidence Jev reports. It calls the AI SDK the way
// packages/core/src/models/evaluate.ts does: one call, no retries, confidence read from
// providerMetadata.typesafe.confidence.
//
// Run from the repo root with AI_GATEWAY_API_KEY set (never printed):
//   node specs/issues/FIX-1833/poc/jev-confidence/check.mjs > results.jsonl
// REPS (default 2) sets how many times each ask is asked under each choice set.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const fromCore = createRequire(path.join(root, "packages/core/package.json"));
const aiPath = fromCore.resolve("ai");
const gatewayPath = createRequire(aiPath).resolve("@ai-sdk/gateway");
const { experimental_evaluate } = await import(pathToFileURL(aiPath).href);
const { gateway } = await import(pathToFileURL(gatewayPath).href);

if (!process.env.AI_GATEWAY_API_KEY) throw new Error("set AI_GATEWAY_API_KEY");
const model = gateway.evaluationModel("typesafe-ai/jev");

// The DevTeam workers' `description:` lines on main (6d0e8b915).
const EM = "Files each feature on the team's board; never does the work itself.";
const CODER = "Does the work a filed row names, in a checkout of its own.";
const COS = "The person's one point of contact, and the one seat that hires workers of their own.";
// A description that names the chief of staff's four jobs (PLAN.md S6).
const COS_JOBS =
  "The chief of staff itself: hires and fires workers, starts projects, and answers questions about the team, its workers and its delegates.";

// The description PLAN.md S6 ships.
const COS_SHIPPED =
  "The person's one point of contact. Hires and fires workers, starts projects, and answers questions about the team, its workers and its delegates.";

// Best fit's question on main, and #2955's (FIX-1828), and a wording that names the coordinator.
const Q_MAIN = "Which delegate should answer the post?";
const Q_2955 =
  "Which delegate should answer the post? Read it with the recent lines before it: a post that follows up on a delegate's answer goes to that delegate.";
const Q_SELF =
  "Who should take the post: one of the delegates, or the coordinator itself? Read it with the recent lines before it: a post that follows up on a delegate's answer goes to that delegate.";

// The kitchen-sink support desk as FIX-1792 P1 (#2938) converts it.
const DESK = {
  "support.accounts": "Sign-in, passwords, billing, refunds and subscriptions.",
  "support.devices": "Printers, laptops, phones, wifi and anything else with a power button.",
  "support.fsd": "Questions about building apps with the flow-state-dev framework.",
  "support.general": "Anything that fits none of the other specialists."
};

const devteamAsks = [
  ["plain-1", "Please get this feature filed for the engineering team:\ncart-71: show a copper badge on the cart icon when it holds an item"],
  ["plain-2", "File a feature for the storefront.\ncheckout-12: let shoppers save their card for next time"],
  ["plain-3", "Can engineering pick this up?\nsearch-4: show recent searches under the search box"],
  ["cos-hire", "Hire someone to audit our dependencies' licenses."],
  ["cos-fire", "Fire license-auditor, we don't need it anymore."],
  ["cos-project", "Start a project called Storefront Refresh, with bob as a member."],
  ["cos-who", "Who works here?"],
  ["cos-leg-c", "Audit our dependencies' licenses. If none of your delegates does that, go ahead and hire someone for it."]
];
const deskAsks = [
  ["desk-wifi", "My laptop won't join the office wifi."],
  ["desk-refund", "I was charged twice this month, can I get a refund?"],
  ["desk-fsd", "How do I add a tool to a generator in flow-state-dev?"],
  ["desk-other", "Where is the nearest coffee machine?"]
];

// Asks the goal's legs d and f make, added for the shipped-description sets.
const moreAsks = [
  ["cos-delegates", "Who are your delegates?"],
  ["cos-add", "Add bob-copper as one of your delegates."],
  ["cos-hire-2", "Bring someone on to review our open-source licenses."]
];

const runs = [
  // What best fit offers the chief of staff today: eng.coder takes tasks, not posts, so it is skipped.
  ["B · eng.em only (today's offer)", { "eng.em": EM }, devteamAsks],
  ["A · eng.em + eng.coder", { "eng.em": EM, "eng.coder": CODER }, devteamAsks],
  ["E · eng.em + chief of staff (description as is)", { "eng.em": EM, "chief-of-staff": COS }, devteamAsks],
  ["F · eng.em + eng.coder + chief of staff (as is)", { "eng.em": EM, "eng.coder": CODER, "chief-of-staff": COS }, devteamAsks],
  ["D · eng.em + chief of staff (jobs named)", { "eng.em": EM, "chief-of-staff": COS_JOBS }, devteamAsks],
  ["C · eng.em + eng.coder + chief of staff (jobs named)", { "eng.em": EM, "eng.coder": CODER, "chief-of-staff": COS_JOBS }, devteamAsks],
  ["K · support desk", DESK, deskAsks],
  ["L · support desk + support.help", { ...DESK, "support.help": "Ask the support team anything." }, deskAsks],
  ["S1 · eng.em + chief of staff (shipped description), #2955's question", { "eng.em": EM, "chief-of-staff": COS_SHIPPED }, [...devteamAsks, ...moreAsks], Q_2955],
  ["S2 · eng.em + chief of staff (shipped description), question naming the coordinator", { "eng.em": EM, "chief-of-staff": COS_SHIPPED }, [...devteamAsks, ...moreAsks], Q_SELF]
];
// ONLY=S runs only the sets whose name starts with S.
const only = process.env.ONLY;

const reps = Number(process.env.REPS ?? 2);
for (const [set, options, asks, question = Q_MAIN] of runs) {
  if (only && !set.startsWith(only)) continue;
  for (const [ask, text] of asks) {
    for (let rep = 0; rep < reps; rep++) {
      let row;
      try {
        const result = await experimental_evaluate({
          model,
          state: { recent: [], post: { from: "alice", text } },
          questions: { member: { type: "choice", instructions: question, criteria: options } },
          maxRetries: 0
        });
        row = {
          set,
          ask,
          rep,
          choice: result.answers.member.choice,
          confidence: result.providerMetadata?.typesafe?.confidence?.member ?? null,
          probabilities: result.answers.member.probabilities ?? null,
          model: result.response.modelId
        };
      } catch (error) {
        row = { set, ask, rep, error: String(error?.message ?? error).slice(0, 200) };
      }
      console.log(JSON.stringify(row));
    }
  }
}
