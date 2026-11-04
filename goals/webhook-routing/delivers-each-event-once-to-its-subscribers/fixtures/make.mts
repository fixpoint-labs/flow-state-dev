/**
 * Writes this goal's fixture: `subscriptions.json` (20 subscriptions, two
 * users) and `events.json` (300 normalized GitHub-shaped events, then 40
 * redeliveries), from a fixed seed. Run once and commit the output; the goal
 * reads the JSON, never this script. The subscriptions are frozen before the
 * first share is read (see `goal.md`).
 *
 *   pnpm tsx goals/webhook-routing/delivers-each-event-once-to-its-subscribers/fixtures/make.mts
 *
 * The events are synthetic and already normalized (no recorded GitHub
 * deliveries exist in this repo yet; mapping a real delivery is FIX-2535's).
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** A small seeded generator (mulberry32), so the fixture is the same on every machine. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(2534);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

/** One subscription as the fixture states it: whose, which session (by label), and the tool's input. */
const subscriptions = [
  { label: "a1", user: "alice", input: { thread: "github:acme/api#412", kinds: ["review", "check"], interest: "Reviews and CI on my PR." } },
  { label: "a2", user: "alice", input: { thread: "github:acme/api#412", interest: "Everything on #412, in my second conversation." } },
  { label: "a3", user: "alice", input: { thread: "github:acme/api", screens: [{ screen: "words", any: ["panic", "crash"] }], interest: "Crash reports on the API repo." } },
  { label: "a4", user: "alice", input: { thread: "github:acme/api", screens: [{ screen: "labels", any: ["security"] }], interest: "Security issues on the API." } },
  { label: "a5", user: "alice", input: { thread: "github:acme/private-api#7", interest: "My private PR." } },
  { label: "a6", user: "alice", input: { thread: "github:acme/web#9", kinds: ["review"], screens: [{ screen: "allow", ids: ["codex"] }], interest: "Codex's reviews on web#9." } },
  { label: "a7", user: "alice", input: { thread: "github:acme/web", kinds: ["check"], interest: "CI results on the web repo." } },
  { label: "a8", user: "alice", input: { thread: "github:acme/api#413", outsiders: true, interest: "Community feedback on #413, outsiders included." } },
  { label: "a9", user: "alice", input: { thread: "github:acme/api", screens: [{ screen: "words", any: ["deprecat"] }], interest: "Anything about deprecations." } },
  { label: "a10", user: "alice", input: { thread: "github:acme/api#413", kinds: ["comment"], screens: [{ screen: "words", any: ["benchmark"] }], interest: "Benchmark discussion on #413." } },
  { label: "a11", user: "alice", input: { thread: "github:acme/api#414", interest: "#414 until it closes." } },
  { label: "b1", user: "bob", input: { thread: "github:acme/api#412", interest: "#412, as its reviewer." } },
  { label: "b2", user: "bob", input: { thread: "github:acme/api", screens: [{ screen: "labels", any: ["bug"] }], interest: "Bugs in the API." } },
  { label: "b3", user: "bob", input: { thread: "github:acme/web#9", kinds: ["review"], interest: "Reviews on web#9." } },
  { label: "b4", user: "bob", input: { thread: "github:acme/web", screens: [{ screen: "words", any: ["flaky"] }], interest: "Flaky tests on web." } },
  { label: "b5", user: "bob", input: { thread: "github:acme/api#413", screens: [{ screen: "allow", ids: ["octocat"] }], interest: "What octocat says on #413." } },
  { label: "b6", user: "bob", input: { thread: "github:acme/api", kinds: ["check"], screens: [{ screen: "labels", any: ["release"] }], interest: "Release CI on the API." } },
  { label: "b7", user: "bob", input: { thread: "github:acme/api#412", interest: "#412 for a while; unsubscribed halfway." }, unsubscribeAt: 150 },
  { label: "b8", user: "bob", input: { thread: "github:acme/private-api#7", interest: "Alice's private PR, which bob can't read." } },
  { label: "b9", user: "bob", input: { thread: "github:acme/web", kinds: ["comment"], outsiders: true, interest: "Community comments on web." } }
];

const threadsOf: Record<string, string[]> = {
  "api#412": ["github:acme/api", "github:acme/api#412"],
  "api#413": ["github:acme/api", "github:acme/api#413"],
  "api#414": ["github:acme/api", "github:acme/api#414"],
  "api-issue": ["github:acme/api"],
  "web#9": ["github:acme/web", "github:acme/web#9"],
  "web-issue": ["github:acme/web"],
  "private#7": ["github:acme/private-api", "github:acme/private-api#7"]
};
const places = Object.keys(threadsOf);
const kinds = ["review", "check", "comment", "pull_request", "issue"];
const senders = [
  { id: "octocat", name: "The Octocat", role: "member" },
  { id: "hubot", name: "Hubot", role: "collaborator" },
  { id: "codex", name: "Codex", role: "bot" },
  { id: "spam-bot", name: "Spam Bot", role: "bot" },
  { id: "drive-by", name: "Drive By", role: "outsider" },
  { id: "who", name: "", role: "unknown" },
  { id: "alice-gh", name: "Alice", role: "member" },
  { id: "bob-gh", name: "Bob", role: "member" }
];
const phrases = [
  "Looks good to me.",
  "This will panic on a nil config.",
  "The worker can crash under load.",
  "This test is flaky on CI.",
  "The old endpoint is deprecated; please migrate.",
  "Ran the benchmark: 12% faster.",
  "Nit: rename the handler.",
  "CI passed.",
  "CI failed on lint."
];
const labelPool = ["bug", "security", "release", "docs"];

type Event = Record<string, unknown> & { object: { id: string; version: number } };
const events: Event[] = [];
const T0 = 1_762_272_000_000;
for (let i = 0; i < 300; i += 1) {
  // About one in eight edits an earlier object: a new version of it.
  const edit = i > 20 && rand() < 0.125 ? events[Math.floor(rand() * events.length)]! : undefined;
  const place = edit === undefined ? pick(places) : (edit.place as string);
  const kind = edit === undefined ? pick(kinds) : (edit.kind as string);
  const labels = labelPool.filter(() => rand() < 0.2);
  const event: Event = {
    place,
    provider: "github",
    threads: threadsOf[place]!,
    kind,
    object: edit === undefined ? { id: `${place}-${kind}-${i}`, version: 1 } : { id: edit.object.id, version: edit.object.version + 1 },
    sender: pick(senders),
    audience: place.startsWith("private") ? "private" : "public",
    title: `${kind} on ${place}`,
    text: pick(phrases),
    labels,
    url: `https://github.com/acme/${place}`,
    received: T0 + i * 1000,
    at: T0 + i * 1000 - 500,
    deliveryId: `delivery-${i}`
  };
  events.push(event);
}
// #414 closes at event 200: a merge, by a member.
events[200] = {
  ...events[200]!,
  place: "api#414",
  threads: threadsOf["api#414"]!,
  kind: "pull_request",
  object: { id: "api#414-merge", version: 1 },
  sender: senders[0]!,
  audience: "public",
  title: "#414 merged",
  text: "Merged into main.",
  labels: [],
  closes: true
};
// 40 redeliveries of events already sent: same object and version, a new delivery id.
const redeliveries = Array.from({ length: 40 }, (_, n) => {
  const original = events[Math.floor(rand() * events.length)]!;
  return { ...original, deliveryId: `redelivery-${n}` };
});

const strip = ({ place: _place, ...event }: Event) => event;
writeFileSync(join(HERE, "subscriptions.json"), `${JSON.stringify(subscriptions, null, 2)}\n`);
writeFileSync(join(HERE, "events.json"), `${JSON.stringify({ events: events.map(strip), redeliveries: redeliveries.map(strip) }, null, 1)}\n`);
console.log(`wrote ${subscriptions.length} subscriptions, ${events.length} events, ${redeliveries.length} redeliveries`);
