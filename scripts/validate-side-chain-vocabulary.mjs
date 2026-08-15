/**
 * Reject the retired tier-2 vocabulary — the `work` / `background` names that
 * used to mean "runs alongside the turn" (FIX-766).
 *
 * The framework has three places work can run: in the turn, alongside the turn,
 * and outliving the turn. The middle tier is **side chain**. It used to be
 * called `work` in the DSL, `background` in one of its own methods, and "side
 * chain" in the docs, and `background` simultaneously named the third tier and
 * the umbrella over all three. This check exists so the retired spellings
 * cannot come back one file at a time.
 *
 * ## What this check is, and is not
 *
 * **It is a completeness gate, not a style rule.** Its whole value is that it
 * fails while any encoding of the old vocabulary survives. Scope for this
 * rename was corrected seven times, and the instructive part is that most of
 * those corrections came *after* hand-listing was replaced by parsing: the
 * parser was green because a whole category of encoding sat outside its rules.
 * So the rules below are organised by ENCODING, not by name, and each one has a
 * fixture in `packages/core/test/side-chain-vocabulary-check.test.ts` proving it
 * fires.
 *
 * The four encodings, and why a rule keyed to one reports done while another is
 * still out of view:
 *
 *   E1  identifiers carrying the `work` token      `WorkConfig`, `WorkTrace`
 *   E2  `"work"` as a string-literal union member  `FlowErrorScope`, `phase`
 *   E3  `background` naming tier 2                 `composeBackgroundSignal`
 *   E4  runtime path/name literals                 `childBlockPath(…,"work",i)`
 *
 * E3 is unreachable from a `work`-token rule by construction. E4 is not an
 * identifier, not a union member and not a `background` name — and it is the
 * only one that changes a PERSISTED key, because the op name becomes a block
 * path segment and the path keys the replay log.
 *
 * **Known gaps — not caught, stated so nobody assumes coverage:**
 *   - prose. Comments, JSDoc and markdown are not scanned. Roughly half of this
 *     rename was prose, and it was swept by hand; a regression in a doc comment
 *     will not fail this check.
 *   - a name whose tokens do not include `work` or `background` but which still
 *     means tier 2 (`bgTask`, `sideTask`, `alongside`).
 *   - a retired name reached only through a computed member access
 *     (`pipeline["work"]`), which parses as a string literal in no rule's
 *     position.
 *   - string literals naming the DSL verbs outside the path-builder positions
 *     of E4 — a test title, an error message.
 *   - a tier passed positionally through a helper this rule set does not know
 *     by name (`makeItem(id, i, "work")`). E2 recognises builders whose callee
 *     mentions `phase`/`provenance`; anything else is invisible, because
 *     without type information "a `"work"` argument" and "the tier" are the
 *     same shape, and the wider rule flags correct code.
 *   - `.js` / `.jsx` sources. Every first-party source is TypeScript.
 *   - UNTRACKED files. The walk is `git ls-files`, so a new file is not checked
 *     until it is staged. Deliberate — it is what keeps `.claude/worktrees/**`
 *     copies from multiplying every count — but it means a local run can be
 *     greener than CI.
 *
 * **And one gap that runs the other way — over-reach, deliberate and unescapable:**
 * a `phase:` or `scope:` field valued `"work"` is denied REPOSITORY-WIDE,
 * whatever that field means locally. Nothing here consults the declaring type,
 * so an unrelated `{ scope: "work" }` in some future module would be refused
 * even though it has nothing to do with the execution tier.
 *
 * That is the intended trade, not an oversight. The rule has to fire inside
 * files the compiler never sees — several packages typecheck only `src/**`
 * (devtool's tsconfig is `include: ["src/**\/*"]`), so a test fixture's
 * `{ phase: "work" }` is invisible to `tsc` and this check is the only thing
 * standing between a renamed fixture and a stale one. Keying the rule to
 * declared carriers would need exactly the type information that is missing at
 * those positions, and would go green on precisely the files it exists for.
 *
 * The cost is worth stating plainly because there is no escape hatch:
 * `EXEMPT_FILES` is pinned by assertion to the two rename-boundary tests, so a
 * legitimate future `{ scope: "work" }` is a hard CI block. Resolving it means
 * renaming that value or editing this rule — a deliberate, visible act, which
 * is the point. No first-party site collides today: `phase` and `scope` are
 * dense framework field names (`session`, `request`, `main`, `block`, `user`,
 * `org`, …) and `"work"` is not a legitimate value of either under any current
 * meaning.
 *
 * ## Deny by name, allow by concept
 *
 * The rules are a CLOSED denylist of the retired names, not a token rule. The
 * first version banned any identifier whose camel-split contained `work`, which
 * taxed an ordinary English word forever inside `pnpm typecheck` — `scheduleWork`
 * and `workQueue` failed CI, and the only exits were to rename correct code or
 * grow an allowlist. See {@link RETIRED_NAMES} for why the asymmetry works: the
 * set of legitimate names containing these words grows, so it can only be judged
 * by concept; the set of RETIRED names is frozen, so it can safely be listed.
 *
 * Names that are also ordinary English (`work`, `backgroundTasks`) are refused
 * only in MEMBER position, where they are unambiguously the API rather than
 * somebody's variable.
 *
 * ## This file obeys its own rule
 *
 * `RETIRED_NAMES` holds the retired spellings as data, which is unavoidable —
 * they are the subject. Everything else here is named for the CONCEPT
 * (`isRetiredName`, `TIER_VALUE_HOLDERS`), so the check does not have to exempt
 * its own source to pass, and a reader is never taught the old word by the file
 * that retires it.
 *
 * Run: `node scripts/validate-side-chain-vocabulary.mjs [--json]`
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { Project, Node } from "ts-morph";

const rootDir = process.cwd();

/**
 * The retired names, in full. This is a DENYLIST, and it is closed.
 *
 * An earlier version of this check banned the *token* — any identifier whose
 * camel-split contained `work`, minus a few allowlisted concepts. That rule was
 * wrong in the direction this file spends its header warning about: it taxed an
 * ordinary English word forever. `scheduleWork`, `workQueue` and a `"idle" |
 * "work"` status union all failed CI, in a check wired into `pnpm typecheck`,
 * and the only ways out were to rename correct code misleadingly or to grow the
 * allowlist. The PR that introduced this check argued in its own description
 * that "a false positive tells someone to rename correct code to get green,
 * which is the dangerous direction for a gate" — and then shipped exactly that.
 *
 * Denying a closed set by name and allowing by concept is the resolution, and
 * the asymmetry is the point:
 *
 *   - The set of names that legitimately CONTAIN these words is open-ended and
 *     grows with the codebase, so it must be judged by concept, never listed.
 *   - The set of RETIRED names is finite and frozen. Nothing will ever be added
 *     to a vocabulary we have just retired, so a list of them cannot rot.
 *
 * The property to preserve, and the one the fixtures pin: adding `scheduleWork`
 * to this repo tomorrow must not fail CI, and reintroducing `.work()` must.
 */
const RETIRED_NAMES = new Set([
  // The three DSL verbs distinctive enough to ban in any position.
  "workIf",
  "waitForWork",
  "forEachBackground",
  // The request-scoped pool — published `core` and `engine` surface.
  "RequestWorkPool",
  "RequestWorkPoolResult",
  "RequestWorkPoolDrainOptions",
  "RequestWorkPoolDrainAllOptions",
  "RequestWorkPoolDrainToQuiescenceOptions",
  "RequestWorkPoolImpl",
  "RequestWorkTaskMeta",
  "getRequestWorkPool",
  "createRequestWorkPool",
  "drainRequestWorkPool",
  "_requestWorkPool",
  "requestWorkPool",
  // The tier-2 abort signal — a top-level `core` export.
  "composeBackgroundSignal",
  "_requestBackgroundSignal",
  "withBackgroundSignal",
  // The test harness — published `testing` surface.
  "WorkTrace",
  // The flow-level config this rename DELETED. Listed so it cannot return by
  // the back door under its old name.
  "WorkConfig",
  // Internal types that named the tier.
  "SequencerWorkTask",
  "WaitForWorkOptions",
  "BackgroundCallShape",
  "WorkOptions",
  "WorkResult",
  "RunBackgroundResult",
  // Internal helpers and constants that named the tier, all of which lived in
  // a `packages/*/src` tree before the rename.
  "dispatchWorkTask",
  "buildWorkTraces",
  "runBackground",
  "backgroundTaskCtx",
  "backgroundSignalOverride",
  "backgroundController",
  "DEFAULT_BACKGROUND_CONCURRENCY",
  // DevTool.
  "BackgroundBadge",
]);

/**
 * Where the denylist deliberately STOPS.
 *
 * The rename also touched perhaps forty test locals and fixture names —
 * `slowWork`, `bgWork`, `failingWork`, `backgroundProbe`, `workRan`. None of
 * them is here, and that is a decision rather than an omission: they are
 * ordinary local naming, nothing depends on them, and listing them would
 * re-create the over-reach this list exists to undo — just spelled out by hand
 * instead of computed by a token rule. Same for names that read as the umbrella
 * or as plain English (`isBackground`, `backgroundTask`, `backgroundFlow`).
 *
 * The line is: a name is refused when it named the tier AND lived in framework
 * source. If one of the excluded names comes back in a test tomorrow, nothing
 * breaks and nobody is taught the wrong word by an API.
 */

/**
 * Retired names that are also ordinary English. These need a discriminator, and
 * the discriminator has to be **what the name belongs to**, not what it is
 * called — a `work` member on a sequencer builder is the retired API; a `work`
 * field on somebody's `Job` interface is a word.
 *
 * The first attempt keyed on "is it in member position", which is not that
 * distinction at all: it red-lighted `interface Job { work: string }` and
 * `const dashboard = { backgroundTasks: 3 }`, taxing ordinary domain models
 * across the whole repo. Two shapes below recover the real distinction without
 * type information; the third is where this check deliberately under-reaches
 * rather than guess.
 */

/**
 * The DSL verb, which is always **called** or **declared as a method**.
 *
 * `pipeline.work(b)` and `work(b: B): Seq` are the retired API. `{ work: string }`
 * is a data field that happens to share the word, and no amount of it in someone
 * else's model is this check's business. Callability is the discriminator, and
 * it needs no type information to read.
 */
const RETIRED_CALLABLE_MEMBERS = new Set(["work"]);

/**
 * Contract fields, refused only where the contract is DECLARED.
 *
 * These are data, so callability cannot separate them, and telling
 * `StatusItem.backgroundTasks` from a dashboard's own `backgroundTasks` needs
 * the declaring type — which this check does not resolve. What it can do
 * reliably is refuse the field's **declaration** inside the packages that own
 * the contract, which is where a reintroduction would actually put the retired
 * name back on the wire.
 *
 * **Stated under-reach:** a *read* of one of these (`row.backgroundTasks`)
 * anywhere, and a declaration outside these packages, are not caught. In `src`
 * a read of a field that no longer exists fails `pnpm typecheck` already; in a
 * test directory that is not typechecked, it is not caught by anything, and
 * that gap is real. Under-reaching with the boundary written down beats taxing
 * every domain model in the repo.
 */
const RETIRED_CONTRACT_FIELDS = new Set(["workGroupId", "backgroundTasks", "workResults"]);

/** The packages whose `src` owns a persisted or published contract. */
const CONTRACT_PACKAGES = /packages[/\\](contracts|core|engine|testing)[/\\]src[/\\]/;

/** E1/E3: is this one of the retired names, in any position? */
export function isRetiredName(id) {
  return RETIRED_NAMES.has(id);
}

/** E1/E3: a retired name that only counts when called or declared as a method. */
export function isRetiredCallableMember(id) {
  return RETIRED_CALLABLE_MEMBERS.has(id);
}

/** E1/E3: a retired contract field, refused only where the contract is declared. */
export function isRetiredContractField(id) {
  return RETIRED_CONTRACT_FIELDS.has(id);
}

/**
 * Is this identifier the name of something being CALLED, or declared as a
 * method? That is the shape the retired DSL verb always has.
 *
 * `pipeline.work(b)` — a property access that is the callee of a call.
 * `work(b: B): Seq` — a method signature or declaration.
 *
 * Deliberately NOT matched: `{ work: string }` (a data field), `work.id` (an
 * object, not the member), `const work = 3` (a variable).
 */
function isCalledOrMethodDeclaration(node) {
  const parent = node.getParent();
  if (parent === undefined) return false;
  if (Node.isPropertyAccessExpression(parent) && parent.getNameNode() === node) {
    const grandparent = parent.getParent();
    return Node.isCallExpression(grandparent) && grandparent.getExpression() === parent;
  }
  if (Node.isMethodSignature(parent) || Node.isMethodDeclaration(parent)) {
    return parent.getNameNode() === node;
  }
  return false;
}

/**
 * Is this identifier DECLARING a field on a type, inside a package that owns a
 * contract? A reintroduced `backgroundTasks?: number` on `StatusItem` is the
 * regression worth catching; a dashboard's own field of the same name is not.
 */
function isContractFieldDeclaration(node, filePath) {
  if (!CONTRACT_PACKAGES.test(filePath)) return false;
  const parent = node.getParent();
  if (parent === undefined) return false;
  if (Node.isPropertySignature(parent) || Node.isPropertyDeclaration(parent)) {
    return parent.getNameNode() === node;
  }
  return false;
}

/** Every retired name, exported so a test can pin the closed set. */
export const retiredNames = [
  ...RETIRED_NAMES,
  ...RETIRED_CALLABLE_MEMBERS,
  ...RETIRED_CONTRACT_FIELDS,
];

/**
 * The audited exceptions: the tests whose SUBJECT is the retired spelling.
 *
 * FIX-766 left two behaviours that can only be characterised by writing the old
 * vocabulary down, one per persisted surface it crosses:
 *
 *   - `legacy-phase-record.test.ts` feeds a pre-rename `phase: "work"` record
 *     through the one reader there is and asserts it degrades rather than
 *     breaks. It holds decision 2's "nothing reads it" claim honest.
 *   - `side-chain-rename-continuation.test.ts` rewrites a durable log to the
 *     pre-rename path segment (`…/work[n]`) and asserts the completed child
 *     re-executes — the accepted cost, pinned rather than assumed.
 *
 * Both exist to prove behaviour ACROSS the rename boundary, which is a closed
 * category: it cannot grow without a new persisted surface, and a new persisted
 * surface is a decision someone has to make out loud. The list is asserted by
 * name in the fixtures so it cannot quietly become an escape hatch — the
 * invariant that matters is that it is closed and named, not that it is one.
 */
const EXEMPT_FILES = [
  "packages/devtool/test/legacy-phase-record.test.ts",
  "packages/engine/test/side-chain-rename-continuation.test.ts",
];

if (EXEMPT_FILES.length !== 2) {
  console.error(
    `[side-chain-vocabulary] The exemption list must hold exactly the two rename-boundary tests; found ${EXEMPT_FILES.length}.`
  );
  process.exit(1);
}

/** Exported so a test can pin the exemption by name. */
export const exemptFiles = EXEMPT_FILES;

/** Op literals that become block-path segments or default block names. */
const PATH_OP_LITERALS = new Set(["work", "workIf", "forEachBackground"]);
/**
 * Path builders, each mapped to the position of ITS OWN `op` argument.
 *
 * This was a single shared constant (`PATH_OP_ARG_INDEX = 2`), which is correct
 * for `childBlockPath(ctx, runtime, op, stepIndex)` and wrong for
 * `blockPathSegment(op, index)`, where the op is first. So a direct
 * `blockPathSegment("work", i)` produced no finding — while the builder was
 * named in this very list, which is what makes it the dangerous kind of bug:
 * **listing a builder as guarded is a claim; the index is what makes it true.**
 * A reader checking coverage sees the name and stops.
 *
 * It also lands on E4, the encoding that reaches the persisted block path and
 * therefore the replay-log key. A hole here does not merely miss a rename — it
 * lets the retired segment come back, and the consequence of that is the
 * silent re-execution decision 2 accepted *only* because it was bounded to the
 * pre-publish window.
 *
 * Indices are derived from the declarations, not from memory:
 *   childBlockPath(ctx, runtime, op, stepIndex, iteration?)  packages/core/src/blocks/sequencer.ts
 *   blockPathSegment(op, index)                              packages/contracts/src/block-instance-id.ts
 *
 * The other `blockPath*` helpers in that module (`blockPathIteration`,
 * `blockPathLoop`, `blockPathBranch`, `blockPathRescue`, `blockPathTool`) take
 * no tier op at all, so they are deliberately absent rather than mapped.
 */
const PATH_BUILDERS = new Map([
  ["childBlockPath", 2],
  ["blockPathSegment", 0],
]);
/**
 * Only the module that DEFINES sequencer ops turns a bare `name:` into a path
 * name. Scoping this is what keeps the rule from flagging every `name: "work"`
 * in a fixture — an earlier version accepted the literal in any argument of any
 * call and swept up `expect(error.scope).toBe("work")`, inflating E4 from 6
 * real sites to 23. In a gate, a false positive is the dangerous direction: it
 * tells people to rename correct code to get green.
 */
const SEQUENCER_SRC = /packages[/\\]core[/\\]src[/\\]blocks[/\\]sequencer\.ts$/;

/**
 * The declarations that carry a tier value, by name. Closed, for the same
 * reason `RETIRED_NAMES` is: these are the two public unions the rename moved
 * (`ItemProvenance.phase`, `FlowErrorScope`) plus the value positions feeding
 * them. Anything else that happens to union a `"work"` string is someone's
 * status enum, not this check's business.
 */
const TIER_VALUE_HOLDERS = new Set(["phase", "scope", "FlowErrorScope"]);

/**
 * Step out through type-only wrappers — `x as const`, `x as T`, `x satisfies T`,
 * `x!`, `(x)`. These change no value, and they are exactly what sits between a
 * literal and its property in fixture code (`phase: "work" as const`), so a rule
 * that reads `getParent()` directly walks straight past a real site.
 */
function effectiveParent(node) {
  let current = node;
  let parent = current.getParent();
  while (
    parent !== undefined &&
    (Node.isAsExpression(parent) ||
      Node.isSatisfiesExpression(parent) ||
      Node.isTypeAssertion(parent) ||
      Node.isNonNullExpression(parent) ||
      Node.isParenthesizedExpression(parent))
  ) {
    current = parent;
    parent = current.getParent();
  }
  // `node` is the outermost wrapper — the node the parent actually holds. A
  // caller matching against `parent.getArguments()` MUST compare against this
  // and not against the bare literal: for `makeProvenance(id, "work" as const)`
  // the argument list holds the AsExpression, so an identity check on the
  // literal silently misses. That bug shipped, in the rule written to close a
  // gap in exactly this situation — a wrapped literal inside a fixture the
  // compiler never typechecks.
  return { parent, node: current };
}

/**
 * Does this node carry a COMPLETE string literal value?
 *
 * TypeScript spells a complete string two ways, and the set is closed by the
 * language, not by whatever this check has been shown to miss:
 *
 *   StringLiteral                    "work"   'work'
 *   NoSubstitutionTemplateLiteral    `work`
 *
 * A backtick string with no `${}` is the SECOND kind — it is not a
 * `TemplateExpression`, which by definition has substitutions and gets its own
 * rule below. So a rule filtering on `Node.isStringLiteral` alone accepts
 * `` { phase: `work` } `` and `` blockPathSegment(`work`, i) `` while rejecting
 * their double-quoted equivalents, and `blockPathSegment` takes any string, so
 * the compiler does not catch it either.
 *
 * That hole shipped, and it is the third time in this change's history that the
 * guard CLAIMED coverage it did not have — after `PATH_OP_ARG_INDEX` assuming
 * one arity for two builders, and the member rule matching any property. The
 * pattern is what matters: a reader auditing coverage sees a literal branch and
 * stops, and the branch is only as wide as the node kinds it names.
 *
 * `getLiteralValue()` is defined on both kinds, so every downstream rule works
 * unchanged once the filter admits both.
 */
function isCompleteStringLiteral(node) {
  return Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node);
}

/**
 * E2: a `"work"` string literal standing for the tier.
 *
 * Five accepted positions, which between them cover both public unions that
 * carry the value — `ItemProvenance.phase` and `FlowErrorScope` — plus the
 * places that feed them. The count grew from three during implementation, and
 * every addition was a real site some OTHER check caught first:
 *
 *   1. a literal-type union member           `… | "work" | …`
 *   2. a `phase:` / `scope:` property value   `{ phase: "work" }`
 *   3. a comparison against the field         `x.phase === "work"`
 *   4. an assertion naming the field          `expect(x.phase).toBe("work")`
 *   5. a phase/provenance builder's argument   `makeProvenance(…, "work")`
 *
 * …plus, through {@link effectiveParent}, the same five behind `as const` and
 * friends. A rule that only accepted `"work"` when bound to `phase` let
 * `FlowErrorScope` ship the retired term, which is where this started.
 */
function isRetiredTierLiteral(literal) {
  if (literal.getLiteralValue() !== "work") return false;
  const { parent, node: held } = effectiveParent(literal);
  if (parent === undefined) return false;

  // An assertion naming the field: `expect(node.phase).toBe("work")`. The
  // literal sits in a matcher argument, so none of the positional rules below
  // can see it — and a fixture renamed without its assertion is a test that
  // now pins the retired spelling. Narrowed to the enclosing STATEMENT
  // mentioning the field, so an unrelated `"work"` in the same file is not
  // swept up.
  const statement = literal.getFirstAncestor((a) => Node.isExpressionStatement(a));
  if (statement !== undefined && /\.(phase|scope)\b/.test(statement.getText())) return true;

  // A tier passed positionally into a provenance/phase builder:
  // `makeProvenance(name, id, "work")`. Several packages typecheck only
  // `src/**` (devtool's tsconfig is `include: ["src/**/*"]`), so in a TEST
  // fixture the compiler never sees the argument at all and this check is the
  // only thing standing between a renamed fixture and a stale one. Keyed to the
  // callee name so an unrelated `"work"` argument elsewhere is not swept up.
  if (Node.isCallExpression(parent) && parent.getArguments().includes(held)) {
    if (/phase|provenance/i.test(parent.getExpression().getText())) return true;
  }

  // `phase: "main" | "work"` / `FlowErrorScope = … | "work" | …`
  //
  // Keyed to the DECLARATION the union belongs to, not to "any union with a
  // `\"work\"` member". The broad form banned an ordinary status union —
  // `type Status = "idle" | "work"` — which is the same over-reach the token
  // denylist had, one encoding along.
  if (Node.isLiteralTypeNode(parent)) {
    const holder = parent.getFirstAncestor(
      (a) =>
        Node.isPropertySignature(a) ||
        Node.isPropertyDeclaration(a) ||
        Node.isParameterDeclaration(a) ||
        Node.isTypeAliasDeclaration(a)
    );
    if (holder === undefined) return false;
    return typeof holder.getName === "function" && TIER_VALUE_HOLDERS.has(holder.getName());
  }

  // `{ phase: "work" }` / `{ scope: "work" }`
  if (Node.isPropertyAssignment(parent)) {
    const name = parent.getName();
    return name === "phase" || name === "scope";
  }

  // `x.phase === "work"` / `meta.scope === "work"`
  if (Node.isBinaryExpression(parent)) {
    const other = parent.getLeft() === literal ? parent.getRight() : parent.getLeft();
    return /(^|\.)(phase|scope)$/.test(other.getText());
  }

  // `phase: cond ? "work" : "main"` — the literal's immediate parent is the
  // conditional, not the property, so the three rules above all walk past it.
  //
  // This rule is here because the guard SHIPPED without it and went green while
  // `executeBlock.ts` still derived `phase: … ? "work" : "main"`. `pnpm
  // typecheck` caught it, the guard did not — the exact failure this whole
  // check exists to prevent, reproduced by the check itself. Nearest-ancestor,
  // so `{ phase: f({ other: "work" }) }` still resolves to `other`, not `phase`.
  const owningProperty = literal.getFirstAncestor((a) => Node.isPropertyAssignment(a));
  if (owningProperty !== undefined) {
    const name = owningProperty.getName();
    return name === "phase" || name === "scope";
  }

  return false;
}

/**
 * Scan already-parsed source files and return every surviving retired name.
 *
 * Exported separately from the repository walk so the fixtures can drive the
 * exact same rules over in-memory sources — a guard whose tests exercise a
 * different code path than CI is not tested.
 */
export function analyzeSources(sources) {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { allowJs: false, jsx: 4 },
  });
  for (const source of sources) {
    project.createSourceFile(source.path, source.text, { overwrite: true });
  }
  return collectFindings(project, (sf) => sf.getFilePath().replace(/^\//, ""));
}

/** Walk every parsed file and apply the four encoding rules. */
function collectFindings(project, relativePath) {
  const findings = [];
  const seen = new Set();

  const record = (node, encoding, detail) => {
    const sourceFile = node.getSourceFile();
    const file = relativePath(sourceFile);
    // Dedup on node POSITION, not line: `pipeline.work(a).work(b)` puts two
    // distinct calls on one line, and a file+line key cannot tell them apart.
    // That is how the tool built to end the under-counting under-counted.
    const key = `${file}:${node.getStart()}:${encoding}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      file,
      line: sourceFile.getLineAndColumnAtPos(node.getStart()).line,
      encoding,
      detail,
    });
  };

  for (const sourceFile of project.getSourceFiles()) {
    const inSequencerSrc = SEQUENCER_SRC.test(sourceFile.getFilePath());

    sourceFile.forEachDescendant((node) => {
      // E1 / E3 — identifiers, against the closed denylist.
      if (Node.isIdentifier(node)) {
        const text = node.getText();
        const encoding = text.toLowerCase().includes("background") ? "E3" : "E1";
        if (isRetiredName(text)) {
          record(node, encoding, text);
        } else if (isRetiredCallableMember(text) && isCalledOrMethodDeclaration(node)) {
          record(node, encoding, text);
        } else if (
          isRetiredContractField(text) &&
          isContractFieldDeclaration(node, sourceFile.getFilePath())
        ) {
          record(node, encoding, text);
        }
        return;
      }

      if (isCompleteStringLiteral(node)) {
        // E2 — the tier as a string-literal union member or value.
        if (isRetiredTierLiteral(node)) record(node, "E2", node.getLiteralValue());

        // E4 — runtime literals that become block-path segments.
        // E4 — an ALREADY-BUILT segment as a literal,
        // `extendBlockPath(p, "work[0]")`. The builders below cover the normal
        // construction route; this covers the one that skips them. `op[index]`
        // is the segment's exact shape, so a literal of that shape IS a
        // persisted path segment however it was written. Found while deriving
        // the builder arities: `extendBlockPath` takes an already-formatted
        // segment, so no op-argument rule can reach it.
        if (/^(work|workIf|forEachBackground)\[\d*\]?/.test(node.getLiteralValue())) {
          record(node, "E4", `segment literal "${node.getLiteralValue()}"`);
          return;
        }

        if (PATH_OP_LITERALS.has(node.getLiteralValue())) {
          const parent = node.getParent();
          const callee = Node.isCallExpression(parent)
            ? parent.getExpression().getText()
            : undefined;
          const opIndex = callee === undefined ? undefined : PATH_BUILDERS.get(callee);
          if (
            opIndex !== undefined &&
            parent.getArguments().indexOf(node) === opIndex
          ) {
            record(node, "E4", `${callee}(… "${node.getLiteralValue()}" at arg ${opIndex})`);
          } else if (
            Node.isPropertyAssignment(parent) &&
            parent.getName() === "name" &&
            inSequencerSrc
          ) {
            record(node, "E4", `name: "${node.getLiteralValue()}"`);
          }
        }
        return;
      }

      // E4 — template default names, `work:${block.name}`.
      if (Node.isTemplateExpression(node) && inSequencerSrc) {
        const head = node.getHead().getLiteralText();
        if (/^(work|workIf|forEachBackground):/.test(head)) {
          record(node, "E4", `\`${head}\${…}\``);
        }
        return;
      }

      // E4 — a block path asserted as a REGEX, `/\/work\[\d+\]$/`.
      //
      // Found by a failing test rather than by this check: renaming the op
      // literal moves the path, and a suite matching the old segment goes red
      // in a way that reads like a behaviour break. The path segment is the one
      // part of this rename with a runtime consequence, so the shapes that
      // encode it are worth over-covering — a regex is neither an identifier
      // nor a string literal, so every other rule here is blind to it.
      if (Node.isRegularExpressionLiteral(node)) {
        const source = node.getText();
        if (/(^|\/|\\\/)(work|workIf|forEachBackground)\\\[/.test(source)) {
          record(node, "E4", source.slice(0, 40));
        }
      }
    });
  }

  findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return findings;
}

/**
 * Cheap text pre-filter, DERIVED from the rule set rather than written beside it.
 *
 * Building a ts-morph project over all ~2,500 tracked sources costs seconds on
 * every `pnpm typecheck`, local and CI, forever — a one-time migration charging
 * rent on every run afterwards. Almost no file can produce a finding, and which
 * ones can is decidable from the rules themselves:
 *
 *   - E1/E3 fire on an identifier from the closed denylist. An identifier
 *     appears verbatim in source, so the file text must contain that exact
 *     substring.
 *   - E2 fires on the string literal `work`, which is written with quotes.
 *   - E4 fires on the op literals, the `work:`-style template heads, and the
 *     `work\[` regex form — all of which contain one of the above.
 *
 * The pattern is BUILT from the three name sets above instead of
 * being maintained alongside them. A hand-written filter is the dangerous shape
 * here: it drifts from the rules silently, and a pre-filter narrower than the
 * rule set deletes coverage without failing anything — which is the exact
 * failure mode this check has already had seven times. Deriving it means adding
 * a name to the denylist automatically widens the filter.
 *
 * `--parity` re-runs the scan with the filter off and diffs, so the claim is
 * checkable against the real tree rather than merely argued here.
 */
const PREFILTER = new RegExp(
  [
    // Every retired name is a whole identifier, and an identifier is never
    // preceded by a letter. The lookbehind is what keeps `framework`,
    // `network`, `teamwork` and `homework` out — they contain `work` but can
    // never BE the member `work`, so parsing them buys nothing.
    ...[...RETIRED_NAMES, ...RETIRED_CALLABLE_MEMBERS, ...RETIRED_CONTRACT_FIELDS].map(
      (n) => `(?<![A-Za-z])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
    ),
    // E2's literal, in any quote style JavaScript allows.
    //
    // Redundant TODAY, and deliberately kept: `work` is in
    // `RETIRED_MEMBER_NAMES`, and its alternative above already matches
    // `"work"` because a quote is not a letter. Mutation-testing showed this
    // line removable with no coverage loss. It stays because E2's rule does not
    // depend on that membership — if `work` ever leaves the member list (it is
    // the most ordinary word here, so that is a plausible future call), E2
    // would still fire on the literal while the filter stopped admitting its
    // file. Cheap insurance against a change made two files away.
    "[\"'`]work[\"'`]",
  ].join("|")
);

export function mayContainRetiredName(text) {
  return PREFILTER.test(text);
}

/**
 * Every tracked TypeScript source.
 *
 * `git ls-files`, not a filesystem glob, for two reasons that both bit the
 * derivation of this rename: a `*.ts`/`*.tsx` glob does not match `run.mts`, so
 * the runnable goal that calls the DSL was invisible; and a glob also picks up
 * untracked worktree copies under `.claude/worktrees/**`, which multiplies every
 * count by however many worktrees happen to exist.
 */
function trackedSources() {
  const out = execSync("git ls-files -z '*.ts' '*.tsx' '*.mts' '*.cts'", {
    cwd: rootDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter(Boolean)
    .filter((f) => !f.endsWith(".d.ts"))
    .map((f) => path.join(rootDir, f));
}

/** Analyze the repository's real tracked sources. */
export function analyzeRepository({ prefilter = true } = {}) {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, jsx: 4 },
  });

  const exempt = new Set(EXEMPT_FILES.map((p) => path.normalize(path.join(rootDir, p))));

  for (const filePath of trackedSources()) {
    if (exempt.has(path.normalize(filePath))) continue;
    if (!fs.existsSync(filePath)) continue;
    // Read once and decide before parsing: reading a file is far cheaper than
    // adding it to a ts-morph project, and almost every file is skipped here.
    if (prefilter) {
      let text;
      try {
        text = fs.readFileSync(filePath, "utf8");
      } catch {
        continue;
      }
      if (!mayContainRetiredName(text)) continue;
    }
    try {
      project.addSourceFileAtPath(filePath);
    } catch {
      /* unparseable, skip — typecheck is the gate for that */
    }
  }

  return collectFindings(project, (sf) => path.relative(rootDir, sf.getFilePath()));
}

const ENCODING_LABEL = {
  E1: "retired `work` name",
  E2: "`\"work\"` standing for the tier in a union or value position",
  E3: "retired `background` name for tier 2",
  E4: "runtime literal that becomes a block-path segment",
};

function main() {
  const wantJson = process.argv.includes("--json");

  // `--parity` re-runs the scan with the pre-filter OFF and diffs the two. The
  // filter's soundness is an argument in its docblock; this turns it into a
  // check anybody can run against the real tree.
  if (process.argv.includes("--parity")) {
    const filtered = JSON.stringify(analyzeRepository({ prefilter: true }));
    const full = JSON.stringify(analyzeRepository({ prefilter: false }));
    if (filtered === full) {
      console.log("[side-chain-vocabulary] parity OK — the pre-filter removes no findings.");
      return;
    }
    console.error("[side-chain-vocabulary] PARITY FAILURE — the pre-filter is hiding findings.");
    process.exit(1);
  }

  const findings = analyzeRepository();

  if (wantJson) {
    console.log(JSON.stringify(findings, null, 2));
  }

  if (findings.length === 0) {
    if (!wantJson) {
      console.log("[side-chain-vocabulary] OK — no retired tier-2 names survive.");
    }
    return;
  }

  if (!wantJson) {
    const byEncoding = new Map();
    for (const finding of findings) {
      byEncoding.set(finding.encoding, (byEncoding.get(finding.encoding) ?? 0) + 1);
    }
    const files = new Set(findings.map((f) => f.file));
    console.error(
      `[side-chain-vocabulary] ${findings.length} retired tier-2 name(s) across ${files.size} file(s).\n`
    );
    for (const [encoding, count] of [...byEncoding].sort()) {
      console.error(`  ${encoding}  ${String(count).padStart(4)}  ${ENCODING_LABEL[encoding]}`);
    }
    console.error("");
    for (const finding of findings.slice(0, 40)) {
      console.error(`${finding.file}:${finding.line}`);
      console.error(`  ${finding.encoding}: ${finding.detail}`);
    }
    if (findings.length > 40) {
      console.error(`\n  … and ${findings.length - 40} more. Re-run with --json for the full list.`);
    }
    console.error(
      `\nThe middle execution tier is called a SIDE CHAIN. Use \`sideChain\` in identifiers and\n` +
        `\`side-chain\` in prose. \`background\` is the umbrella over all three tiers — see\n` +
        `docs/architecture/sequencer-dsl.md.\n`
    );
  }

  process.exit(1);
}

// CLI only — importing this module for its analysis must not scan or exit.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
