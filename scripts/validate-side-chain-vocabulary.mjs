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
 * ## The allowlists, and why they are concept rules rather than name lists
 *
 * Some names legitimately keep a `work` or `background` token. An earlier
 * version of this rule set hard-coded six `RequestWork*` names and reported
 * green while `WorkConfig` survived — a name list cannot express *why* a name
 * is allowed, so it silently rots. These are predicates instead:
 *
 *   - **`background` + `work` together is the UMBRELLA**, which is exactly what
 *     this rename frees the word to mean. `onBackgroundWork` (the serverless
 *     keep-alive hook, which covers all three tiers) and the kitchen-sink
 *     Workstream panel are correct as they stand.
 *   - **`prior` + `work` is a task's previously-completed output** in
 *     `orchestration`. Unrelated concept, same substring.
 *   - **CSS properties** carry `background` and are not tiers.
 *   - **A small set of generic "is there anything to do" predicates**, listed
 *     by name because there is no shape that distinguishes them.
 *
 * ## This file obeys its own rule
 *
 * The exported predicates are `carriesRetiredTierToken` /
 * `carriesRetiredUmbrellaToken`, not `…WorkToken` / `…BackgroundToken`. The
 * obvious names would make this check and its test the last two files in the
 * repo carrying the vocabulary it retires, and a check that has to exempt
 * itself teaches the next person that exemptions are routine. It cost two
 * words to avoid.
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
 * Split an identifier on camel/Pascal/underscore boundaries and lowercase it.
 *
 * Tokenising rather than substring-matching is what keeps `framework`,
 * `network`, `teamwork` and `Workstream` out: each tokenises to a single word
 * that is not `work`. A substring rule flags all four, and a check that
 * red-lights correct code gets deleted by the first person it blocks.
 */
export function identTokens(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/** CSS longhand/shorthand properties that carry the `background` token. */
const CSS_BACKGROUND_PROPERTIES = new Set([
  "background",
  "backgroundColor",
  "backgroundImage",
  "backgroundPosition",
  "backgroundSize",
  "backgroundRepeat",
  "backgroundClip",
  "backgroundBlendMode",
  "backgroundAttachment",
  "backgroundOrigin",
]);

/**
 * Generic "is there anything left to do" predicates. Listed by name because
 * nothing in their shape separates them from a tier name — they are simply
 * about a queue being non-empty, in three unrelated packages.
 */
const GENERIC_WORK_PREDICATES = new Set([
  "hasEdgeWork",
  "hasInlineWork",
  "hasExecutableWork",
]);

/**
 * Does this name mean the umbrella over all three tiers, rather than tier 2?
 *
 * `background` + `work` adjacent is the umbrella by construction: it is the
 * phrase the guides already use for all three tiers at once, and freeing it to
 * mean that again is the point of this rename. `backgroundWorker` is included —
 * a detached worker is tier 3.
 */
function isUmbrellaName(tokens) {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] === "background" && tokens[i + 1].startsWith("work")) return true;
  }
  return false;
}

/** Is this the `orchestration` "previously-completed output" concept? */
function isPriorWorkName(tokens) {
  for (let i = 0; i < tokens.length - 1; i += 1) {
    if (tokens[i] === "prior" && tokens[i + 1] === "work") return true;
  }
  return false;
}

/** E1: an identifier carrying the retired tier-2 `work` token. */
export function carriesRetiredTierToken(id) {
  if (GENERIC_WORK_PREDICATES.has(id)) return false;
  const tokens = identTokens(id);
  if (!tokens.includes("work")) return false;
  if (isUmbrellaName(tokens)) return false;
  if (isPriorWorkName(tokens)) return false;
  return true;
}

/** E3: an identifier using `background` for tier 2. */
export function carriesRetiredUmbrellaToken(id) {
  if (CSS_BACKGROUND_PROPERTIES.has(id)) return false;
  const tokens = identTokens(id);
  if (!tokens.includes("background")) return false;
  if (isUmbrellaName(tokens)) return false;
  return true;
}

/**
 * The single audited exception: the test whose SUBJECT is the retired spelling.
 *
 * FIX-766 shipped no BP-030 shim for the persisted `phase` value, on the claim
 * that nothing reads it to decide anything. `legacy-phase-record.test.ts` is
 * what holds that claim honest — it feeds a pre-rename record through the one
 * reader there is and asserts it degrades rather than breaks. It necessarily
 * contains `phase: "work"`, and a check that forbade it would delete the proof.
 *
 * Asserted to hold exactly one entry so it cannot be quietly broadened into a
 * general escape hatch — the same guard `validate-updater-purity.mjs` puts on
 * its own exemption.
 */
const EXEMPT_FILES = ["packages/devtool/test/legacy-phase-record.test.ts"];

if (EXEMPT_FILES.length !== 1) {
  console.error(
    `[side-chain-vocabulary] The exemption list must hold exactly one entry (the legacy-record test); found ${EXEMPT_FILES.length}.`
  );
  process.exit(1);
}

/** Exported so a test can assert the exemption stays at one entry. */
export const exemptFiles = EXEMPT_FILES;

/** Op literals that become block-path segments or default block names. */
const PATH_OP_LITERALS = new Set(["work", "workIf", "forEachBackground"]);
/** Functions whose operation argument becomes a path segment. */
const PATH_BUILDERS = new Set(["childBlockPath", "blockPathSegment"]);
/** Zero-based position of the `op` argument in those builders. */
const PATH_OP_ARG_INDEX = 2;
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
  return parent;
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
  const parent = effectiveParent(literal);
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
  if (Node.isCallExpression(parent) && parent.getArguments().includes(literal)) {
    if (/phase|provenance/i.test(parent.getExpression().getText())) return true;
  }

  // `phase: "main" | "work"` / `FlowErrorScope = … | "work" | …`
  if (Node.isLiteralTypeNode(parent)) return true;

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
      // E1 / E3 — identifiers.
      if (Node.isIdentifier(node)) {
        const text = node.getText();
        if (carriesRetiredTierToken(text)) record(node, "E1", text);
        if (carriesRetiredUmbrellaToken(text)) record(node, "E3", text);
        return;
      }

      if (Node.isStringLiteral(node)) {
        // E2 — the tier as a string-literal union member or value.
        if (isRetiredTierLiteral(node)) record(node, "E2", node.getLiteralValue());

        // E4 — runtime literals that become block-path segments.
        if (PATH_OP_LITERALS.has(node.getLiteralValue())) {
          const parent = node.getParent();
          if (
            Node.isCallExpression(parent) &&
            PATH_BUILDERS.has(parent.getExpression().getText()) &&
            parent.getArguments().indexOf(node) === PATH_OP_ARG_INDEX
          ) {
            record(node, "E4", `${parent.getExpression().getText()}(…, "${node.getLiteralValue()}")`);
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
export function analyzeRepository() {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    compilerOptions: { allowJs: false, jsx: 4 },
  });

  const exempt = new Set(EXEMPT_FILES.map((p) => path.normalize(path.join(rootDir, p))));

  for (const filePath of trackedSources()) {
    if (exempt.has(path.normalize(filePath))) continue;
    if (!fs.existsSync(filePath)) continue;
    try {
      project.addSourceFileAtPath(filePath);
    } catch {
      /* unparseable, skip — typecheck is the gate for that */
    }
  }

  return collectFindings(project, (sf) => path.relative(rootDir, sf.getFilePath()));
}

const ENCODING_LABEL = {
  E1: "identifier carrying the retired `work` token",
  E2: "`\"work\"` standing for the tier in a union or value position",
  E3: "`background` naming tier 2",
  E4: "runtime literal that becomes a block-path segment",
};

function main() {
  const wantJson = process.argv.includes("--json");
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
