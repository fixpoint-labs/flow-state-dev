/**
 * FIX-1639 · poc/page-facts/names.mts — retained as evidence. A one-time pre-merge check:
 * the implementer runs it once, on the final page, in the implementation PR. It is not an
 * ongoing gate, and nothing maintains its manifest after that PR merges.
 *
 * Re-derives the page's factual base from `main` instead of trusting the draft: every name a
 * reader could type from the proposed prose in ../../DOCS.md resolves to something that ships.
 *
 *  1. Every named import in a quoted code fence is exported by the package it names.
 *  2. Every inline code span in the quoted prose and tables is classified below, and its
 *     classification is checked against the TypeScript program, a source file, or the
 *     reference page that already publishes it.
 *  3. TOTALITY: a span with no classification fails the run. A new name added to the page
 *     without a check here is a failure, not a pass.
 *  4. ROUTE: a concrete `/api/flows/<segment>/…` route on the page names the id of a flow the
 *     page's code registers. The segment is the registered instance's id: for a singleton its
 *     `kind`, for a collection member the id its factory was called with, never the `flows`
 *     map key. Proved at runtime, once per run, on one host:
 *       singleton  `kind: "billing"` registered as `flows: { payments: billing() }` answers a
 *                  webhook at `/api/flows/billing/…` (202) and 404s at `/api/flows/payments/…`;
 *       collection `kind: "tenant-billing"`, `cardinality: "collection"`, registered as
 *                  `flows: { acme: tenantBilling({ id: "acme-billing" }) }` answers at
 *                  `/api/flows/acme-billing/…` (202) and 404s at `/api/flows/tenant-billing/…`
 *                  and at `/api/flows/acme/…`.
 *
 * Controls, each must FAIL:
 *   CONTROL=planted       the page gains `notifyTopic`, classified as a core export
 *   CONTROL=unclassified  the page gains `madeUpOption` with no classification
 *   CONTROL=false-option  the page gains `dispatcher({ delay })`, classified as a dispatcher
 *                         option: proves the type walk rejects an option that doesn't exist
 *   CONTROL=wrong-segment the page's host registers the flow as `flows: { payments: billing() }`
 *                         and gains a webhook route addressed by that map key (`payments`),
 *                         which is not the flow's id
 *
 * Run from the repo root:  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts
 * After publishing:         PAGE=apps/docs/guides/keeping-a-flow-running.md pnpm exec tsx …
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../../../../..");
const DOCS = join(HERE, "../../DOCS.md");
const CONTROL = process.env.CONTROL ?? "";

// ── the page's quoted material ────────────────────────────────────────────────
// PAGE=<path> reads a published page whole; by default, the quoted draft in DOCS.md.
const PAGE = process.env.PAGE;
let quoted = PAGE
  ? readFileSync(resolve(ROOT, PAGE), "utf8").split("\n")
  : readFileSync(DOCS, "utf8")
      .split("\n")
      .filter((l) => l.startsWith(">"))
      .map((l) => l.replace(/^> ?/, ""));
if (CONTROL === "planted") quoted.push("Subscribe other flows with `notifyTopic`.");
if (CONTROL === "unclassified") quoted.push("Set `madeUpOption` on the host.");
if (CONTROL === "false-option") quoted.push("Send it later with `dispatcher({ delay })`.");
if (CONTROL === "wrong-segment") {
  quoted = quoted.map((l) => l.replace("flows: { billing: billing() }", "flows: { payments: billing() }"));
  quoted.push("Point Stripe at `POST /api/flows/payments/webhooks/stripe`.");
}

const fences: string[] = [];
const prose: string[] = [];
{
  let open: string[] | null = null;
  for (const line of quoted) {
    if (line.trim().startsWith("```")) {
      if (open === null) open = [];
      else { fences.push(open.join("\n")); open = null; }
      continue;
    }
    (open ?? prose).push(line);
  }
}
const spans = [...new Set(prose.flatMap((l) => [...l.matchAll(/`([^`]+)`/g)].map((m) => m[1]!)))];

// ── the TypeScript program over every package the page names ──────────────────
const pkgDir = (spec: string) => join(ROOT, "packages", spec.replace(/^@flow-state-dev\//, "").split("/")[0]!);
function entryOf(spec: string): string {
  const dir = pkgDir(spec);
  const pj = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const sub = "." + spec.replace(/^@flow-state-dev\/[^/]+/, "");
  const exp = pj.exports?.[sub];
  const target = typeof exp === "string" ? exp : exp?.default;
  if (typeof target !== "string") throw new Error(`${spec}: no export "${sub}"`);
  return join(dir, target);
}
const PKGS = ["@flow-state-dev/core", "@flow-state-dev/engine", "@flow-state-dev/scheduled",
  "@flow-state-dev/bullmq", "@flow-state-dev/bullmq/schedules", "@flow-state-dev/client"];
const program = ts.createProgram(PKGS.map(entryOf), {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler, allowImportingTsExtensions: true,
  noEmit: true, skipLibCheck: true, strict: true, jsx: ts.JsxEmit.ReactJSX
});
const checker = program.getTypeChecker();
const exportsCache = new Map<string, Map<string, ts.Symbol>>();
function exportsOf(spec: string): Map<string, ts.Symbol> {
  if (!exportsCache.has(spec)) {
    const sf = program.getSourceFile(entryOf(spec));
    const mod = sf && checker.getSymbolAtLocation(sf);
    const m = new Map<string, ts.Symbol>();
    for (const s of mod ? checker.getExportsOfModule(mod) : []) m.set(s.name, s);
    exportsCache.set(spec, m);
  }
  return exportsCache.get(spec)!;
}
const unalias = (s: ts.Symbol) => (s.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(s) : s);
function typeOfExport(spec: string, name: string): ts.Type | undefined {
  const sym = exportsOf(spec).get(name);
  if (!sym) return undefined;
  const real = unalias(sym);
  return real.flags & (ts.SymbolFlags.TypeAlias | ts.SymbolFlags.Interface)
    ? checker.getDeclaredTypeOfSymbol(real)
    : checker.getTypeOfSymbol(real);
}
/** Walk a path: a property name, `<*>` (a record's value), `(0)` (first parameter), `()` (return). */
function walk(type: ts.Type | undefined, path: string[]): ts.Type | undefined {
  let t = type;
  for (const seg of path) {
    if (t === undefined) return undefined;
    t = checker.getNonNullableType(t);
    const members = t.isUnion() ? t.types : [t];
    const next: ts.Type[] = [];
    for (const m of members) {
      if (seg === "<*>") {
        const info = checker.getIndexInfosOfType(m)[0];
        if (info) next.push(info.type);
      } else if (seg === "(0)" || seg === "()") {
        for (const sig of m.getCallSignatures()) {
          if (seg === "()") next.push(sig.getReturnType());
          else if (sig.parameters[0]) next.push(checker.getTypeOfSymbol(sig.parameters[0]));
        }
      } else {
        const p = checker.getPropertyOfType(checker.getApparentType(m), seg);
        if (p) next.push(checker.getTypeOfSymbol(p));
      }
    }
    if (next.length === 0) return undefined;
    t = next.length === 1 ? next[0] : checker.getUnionType(next);
  }
  return t;
}

// ── verifiers ────────────────────────────────────────────────────────────────
type Check = () => string | null; // null = ok, string = why it failed
const E = (spec: string, name: string): Check => () =>
  exportsOf(spec).has(name) ? null : `${name} is not exported by ${spec}`;
const P = (spec: string, root: string, ...path: string[]): Check => () =>
  walk(typeOfExport(spec, root), path) ? null : `${spec} ${root}.${path.join(".")} does not resolve`;
const S = (file: string, text: string): Check => () => {
  const p = join(ROOT, file);
  return existsSync(p) && readFileSync(p, "utf8").includes(text) ? null : `"${text}" not in ${file}`;
};
/**
 * What addresses `/api/flows/<segment>/…` on the shipped runtime. One host registers a
 * singleton (`kind: "billing"` under the map key `payments`) and a collection member
 * (`kind: "tenant-billing"`, id `acme-billing`, under the map key `acme`), then POSTs one
 * webhook to each candidate segment.
 */
type RouteProbe = {
  singleton: { kind: number; mapKey: number };
  collection: { id: number; kind: number; mapKey: number };
};
async function probeRouteAddress(): Promise<RouteProbe> {
  const { z } = await import("zod");
  const core = await import("../../../../../packages/core/src/index.ts");
  const engine = await import("../../../../../packages/engine/src/index.ts");
  const quiet = { log: console.log, info: console.info, warn: console.warn, debug: console.debug };
  console.log = console.info = console.warn = console.debug = () => {};
  try {
    const work = core.handler({ name: "work", inputSchema: z.object({}), outputSchema: z.object({}),
      execute: async () => ({}) });
    const billing = core.defineFlow({
      kind: "billing", actions: {},
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: { stripe: { on: { "invoice.paid": core.defineWebhookBinding({ block: work, input: () => ({}) }) } } }
    });
    const tenantBilling = core.defineFlow({
      kind: "tenant-billing", cardinality: "collection", actions: {},
      authentication: { defaultUserId: "system", requireUser: false },
      webhooks: { stripe: { on: { "invoice.paid": core.defineWebhookBinding({ block: work, input: () => ({}) }) } } }
    });
    const state = engine.createFlowState({
      flows: { payments: billing(), acme: tenantBilling({ id: "acme-billing" }) },
      stores: { default: { primary: engine.inMemoryStores() } },
      adapters: [engine.createWebhookTransportAdapter({
        providers: { stripe: { verify: () => true, eventType: (p) => (p as { type: string }).type } }
      })]
    });
    const router = await state.getRouter();
    const post = async (seg: string) => (await router.POST(
      new Request(`http://localhost/api/flows/${seg}/webhooks/stripe`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "invoice.paid" })
      }),
      { params: { path: [seg, "webhooks", "stripe"] } }
    )).status;
    const result: RouteProbe = {
      singleton: { kind: await post("billing"), mapKey: await post("payments") },
      collection: { id: await post("acme-billing"), kind: await post("tenant-billing"), mapKey: await post("acme") }
    };
    await new Promise((r) => setTimeout(r, 20));
    await state.dispose();
    return result;
  } finally {
    Object.assign(console, quiet);
  }
}
const ROUTE_PROBE = await probeRouteAddress();

/** What the probe must show for "the segment is the flow's id" to hold, on both shapes. */
const PROBE_HOLDS =
  ROUTE_PROBE.singleton.kind === 202 && ROUTE_PROBE.singleton.mapKey === 404 &&
  ROUTE_PROBE.collection.id === 202 && ROUTE_PROBE.collection.kind === 404 &&
  ROUTE_PROBE.collection.mapKey === 404;

/**
 * The route's flow segment is the id of a flow the page's code registers: a singleton's
 * `kind`, or the `id` a collection member's factory was called with.
 */
const ROUTE = (span: string): Check => () => {
  const seg = /\/api\/flows\/([^/]+)\//.exec(span)?.[1];
  if (seg === undefined) return `no flow segment in ${span}`;
  if (!PROBE_HOLDS) {
    return `the runtime no longer addresses the route by the flow's id (${JSON.stringify(ROUTE_PROBE)})`;
  }
  const ids = new Set<string>();
  const collectionKinds = new Set<string>();
  for (const f of fences) {
    const kinds = [...f.matchAll(/kind:\s*"([^"]+)"/g)].map((m) => m[1]!);
    for (const k of kinds) (/cardinality:\s*"collection"/.test(f) ? collectionKinds : ids).add(k);
    for (const m of f.matchAll(/\w+\(\{\s*id:\s*"([^"]+)"/g)) ids.add(m[1]!);
  }
  const mapKeys = new Set(fences.flatMap((f) => [...f.matchAll(/flows:\s*\{\s*(\w+):/g)].map((m) => m[1]!)));
  if (!ids.has(seg)) {
    return `segment "${seg}" is not the id of a flow the page registers (${[...ids].join(", ")})` +
      (collectionKinds.has(seg) ? `; it is a collection's kind, which the route ignores` : "") +
      (mapKeys.has(seg) ? `; it is the \`flows\` map key, which the route ignores` : "");
  }
  return null;
};
const PKG = (spec: string): Check => () => (existsSync(join(pkgDir(spec), "package.json")) ? null : `${spec} missing`);

const WEBHOOKS_REF = "apps/docs/docs/server/webhooks.md";
const SCHEDULED_REF = "apps/docs/docs/server/scheduled.md";
const DISPATCH_TYPES = "packages/core/src/types/dispatch.ts";
const bind = (k: string) => P("@flow-state-dev/core", "defineWebhookBinding", "(0)", k);
const sched = (...k: string[]) => P("@flow-state-dev/core", "FlowDefinition", "schedules", ...k);
const dispatcherOpt = (...k: string[]) => P("@flow-state-dev/core", "dispatcher", "(0)", ...k);

/** Every span the page may contain, and what makes it true. */
const MANIFEST: Record<string, Check[]> = {
  ".sideChain()": [P("@flow-state-dev/core", "sequencer", "()", "sideChain")],
  "202": [S(WEBHOOKS_REF, "202"), S(SCHEDULED_REF, "| 202  |")],
  "@flow-state-dev/bullmq": [PKG("@flow-state-dev/bullmq")],
  "@flow-state-dev/scheduled": [PKG("@flow-state-dev/scheduled")],
  "Authorization: Bearer <the same secret>": [S(SCHEDULED_REF, "Authorization: Bearer ${FSDEV_SCHEDULER_SECRET}")],
  DispatchRefusedError: [E("@flow-state-dev/core", "DispatchRefusedError")],
  "POST /api/flows/:flowKind/schedules/:scheduleId/dispatch": [S(SCHEDULED_REF, "POST /api/flows/:flowKind/schedules/:scheduleId/dispatch")],
  "POST /api/flows/:flowKind/webhooks/:provider": [S(WEBHOOKS_REF, "POST /api/flows/:flowKind/webhooks/:provider")],
  "POST /api/flows/billing/schedules/monthly-invoices/dispatch": [S(SCHEDULED_REF, "/api/flows/billing/schedules/monthly-invoices/dispatch"),
    ROUTE("POST /api/flows/billing/schedules/monthly-invoices/dispatch")],
  "POST /api/flows/billing/webhooks/stripe": [S(WEBHOOKS_REF, "POST /api/flows/billing/webhooks/stripe"),
    ROUTE("POST /api/flows/billing/webhooks/stripe")],
  "onBackgroundWork: (p) => after(() => p)": [P("@flow-state-dev/engine", "CreateFlowStateOptions", "onBackgroundWork"),
    S("apps/docs/docs/server/setup.md", "onBackgroundWork: (p) => after(() => p)")],
  after: [S("apps/docs/guides/deploying-to-vercel.md", 'import { after } from "next/server"')],
  "next/server": [S("apps/docs/guides/deploying-to-vercel.md", 'import { after } from "next/server"')],
  dispatchLocal: [P("@flow-state-dev/engine", "InProcessDispatcher", "dispatchLocal"),
    S("packages/engine/src/transports/host/createInboundTransportHost.ts", '"dispatchLocal" in effectiveDispatcher')],
  adapters: [P("@flow-state-dev/engine", "CreateFlowStateOptions", "adapters")],
  flows: [P("@flow-state-dev/engine", "CreateFlowStateOptions", "flows")],
  kind: [P("@flow-state-dev/core", "FlowDefinition", "kind"), ROUTE("POST /api/flows/billing/webhooks/stripe")],
  "authentication.resolvePrincipal": [P("@flow-state-dev/core", "FlowDefinition", "authentication", "resolvePrincipal")],
  resolvePrincipal: [P("@flow-state-dev/core", "FlowDefinition", "authentication", "resolvePrincipal")],
  "ctx.source": [P("@flow-state-dev/core", "FlowDefinition", "authentication", "resolvePrincipal", "(0)", "source")],
  block: [bind("block"), P("@flow-state-dev/core", "ScheduleConfig", "block")],
  cron: [P("@flow-state-dev/core", "ScheduleConfig", "cron")],
  input: [bind("input")],
  sessionId: [bind("sessionId")],
  when: [bind("when")],
  // `when` returning `false` runs nothing: the predicate's return is boolean, and the
  // reference page publishes "A falsy result skips".
  false: [bind("when", "()"), S(WEBHOOKS_REF, "A falsy result skips")],
  authentication: [P("@flow-state-dev/core", "FlowDefinition", "authentication")],
  // the page's one flow: its id, which the page's code registers and its routes name
  billing: [ROUTE("POST /api/flows/billing/webhooks/stripe"), S(WEBHOOKS_REF, 'kind: "billing"')],
  // the webhook sample's `defaultUserId: "system"`, the user every event runs as
  system: [P("@flow-state-dev/core", "FlowDefinition", "authentication", "defaultUserId"),
    S(WEBHOOKS_REF, 'defaultUserId: "system"')],
  DEFAULT_ORG_ID: [E("@flow-state-dev/core", "DEFAULT_ORG_ID")],
  // a configured resolver returning null is refused 401; the signature is checked before it runs
  "401": [S("apps/docs/docs/server/authentication.md", "refused with 401"),
    S("packages/engine/src/transports/webhook/routes.ts", "flow + provider lookup → raw body → verify")],
  '"webhook"': [S("packages/engine/src/transports/webhook/createWebhookTransportAdapter.ts",
    'WEBHOOK_TRANSPORT_SOURCE = "webhook"'),
    P("@flow-state-dev/core", "FlowDefinition", "authentication", "resolvePrincipal", "(0)", "source")],
  bullmqWorker: [E("@flow-state-dev/bullmq", "bullmqWorker")],
  mode: [P("@flow-state-dev/bullmq", "bullmqWorker", "(0)", "mode")],
  "worker: bullmqWorker({ connection })": [P("@flow-state-dev/engine", "CreateFlowStateOptions", "worker"),
    P("@flow-state-dev/bullmq", "bullmqWorker", "(0)", "connection")],
  colocated: [S("packages/engine/src/flowstate/types.ts", '"colocated"'), E("@flow-state-dev/engine", "WorkerMode")],
  "dispatch-only": [S("packages/engine/src/flowstate/types.ts", '"dispatch-only"')],
  "worker-only": [S("packages/engine/src/flowstate/types.ts", '"worker-only"')],
  createBearerSecretPrincipalResolver: [E("@flow-state-dev/engine", "createBearerSecretPrincipalResolver")],
  createFlowState: [E("@flow-state-dev/engine", "createFlowState")],
  "createScheduledTransportAdapter()": [E("@flow-state-dev/scheduled", "createScheduledTransportAdapter")],
  "createWebhookTransportAdapter({ providers })": [P("@flow-state-dev/engine", "createWebhookTransportAdapter", "(0)", "providers")],
  verify: [P("@flow-state-dev/engine", "createWebhookTransportAdapter", "(0)", "providers", "<*>", "verify")],
  defineScheduleBinding: [E("@flow-state-dev/core", "defineScheduleBinding")],
  defineWebhookBinding: [E("@flow-state-dev/core", "defineWebhookBinding")],
  "dispatcher()": [E("@flow-state-dev/core", "dispatcher")],
  "dispatcher({ flowKind, action, session })": [dispatcherOpt("flowKind"), dispatcherOpt("action"), dispatcherOpt("session")],
  flowKind: [dispatcherOpt("flowKind")],
  session: [dispatcherOpt("session")],
  "{ key }": [dispatcherOpt("session", "key")],
  "{ key: (input) => string }": [dispatcherOpt("session", "key")],
  "{ id: (input) => string }": [dispatcherOpt("session", "id")],
  "{ from: true }": [dispatcherOpt("session", "from")],
  key: [dispatcherOpt("session", "key")],
  id: [dispatcherOpt("session", "id")],
  "external-dispatcher": [S(DISPATCH_TYPES, '| "external-dispatcher"')],
  'refused: "external-dispatcher"': [S(DISPATCH_TYPES, '| "external-dispatcher"'),
    P("@flow-state-dev/core", "DispatchRefusedError", "prototype", "refused")],
  "internal.actions": [P("@flow-state-dev/core", "FlowDefinition", "internal", "actions")],
  "internal.actions.<action>": [P("@flow-state-dev/core", "FlowDefinition", "internal", "actions", "<*>", "block")],
  listChildSessions: [P("@flow-state-dev/client", "createSessionClient", "()", "listChildSessions")],
  "schedules.resolve": [sched("resolve")],
  "schedules.static": [sched("static")],
  "schedules.static.<id>": [sched("static", "<*>", "cron")],
  "webhooks.<provider>.on.<event>": [P("@flow-state-dev/core", "FlowDefinition", "webhooks", "<*>", "on", "<*>")],
  notification: [S("packages/core/src/types/auth.ts", "`scheduled`, `notification`"),
    S("packages/devtool/src/react/components/workspace/request-separator.tsx", 'notification: { label: "Notification"')],
  userId: [S("apps/docs/docs/server/authentication.md", "the framework reads `body.userId`")],
  "epic-wake": [S("docs/contributing/orchestration.md", "`epic-wake` — one epic-lifecycle wake")]
};
if (CONTROL === "planted") MANIFEST.notifyTopic = [E("@flow-state-dev/core", "notifyTopic")];
if (CONTROL === "false-option") MANIFEST["dispatcher({ delay })"] = [dispatcherOpt("delay")];
if (CONTROL === "wrong-segment") MANIFEST["POST /api/flows/payments/webhooks/stripe"] = [ROUTE("POST /api/flows/payments/webhooks/stripe")];

// ── run ──────────────────────────────────────────────────────────────────────
const failures: string[] = [];
let passed = 0;

for (const code of fences) {
  const sf = ts.createSourceFile("fence.ts", code, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const named = st.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const name = (el.propertyName ?? el.name).text;
      if (!spec.startsWith("@flow-state-dev/")) { passed += 1; continue; } // zod: a dependency, not ours
      const why = E(spec, name)();
      if (why) failures.push(`import  ${name} from "${spec}": ${why}`); else passed += 1;
    }
  }
}
for (const span of spans) {
  const checks = MANIFEST[span];
  if (!checks) { failures.push(`TOTALITY  \`${span}\` is on the page and nothing checks it`); continue; }
  for (const c of checks) {
    const why = c();
    if (why) failures.push(`span  \`${span}\`: ${why}`); else passed += 1;
  }
}
const unused = Object.keys(MANIFEST).filter((k) => !spans.includes(k));

console.log(`${CONTROL ? `CONTROL=${CONTROL} (must FAIL)` : "page names vs main"}`);
console.log(`fences=${fences.length} spans=${spans.length} checks passed=${passed} failed=${failures.length}`);
console.log(`route probe: singleton billing→${ROUTE_PROBE.singleton.kind} payments(map key)→${ROUTE_PROBE.singleton.mapKey}` +
  ` · collection acme-billing(id)→${ROUTE_PROBE.collection.id} tenant-billing(kind)→${ROUTE_PROBE.collection.kind}` +
  ` acme(map key)→${ROUTE_PROBE.collection.mapKey}`);
for (const f of failures) console.log(`FAIL  ${f}`);
if (unused.length) console.log(`note: classified but no longer on the page: ${unused.join(", ")}`);
process.exit(failures.length === 0 ? 0 : 1);
