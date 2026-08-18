/**
 * The grader: the account meets the expectation, field by field.
 *
 * This is the first and only place the two touch. The reader derived the
 * account knowing nothing about what the run was asked to do; everything here
 * compares parsed fields against parsed fields. No `includes`, no `indexOf`
 * over a rendered blob, no locating a region in prose.
 *
 * `goal.md` is the contract. Three invariants live here because they are about
 * this code rather than about the check's outcome.
 *
 * ## 1. A per-run judgement is handed a {@link RunView}, never the account
 *
 * Five separate defects were one sentence: a pooled value consumed inside a
 * per-run judgement, so one run's evidence excused another run's absence. Each
 * was fixed with a `runId ===` filter and the next review found another. The
 * fix is structural — {@link gradeRun} receives one run's view and the other
 * runs are not in scope, so a pooled read is unreachable rather than filtered.
 * Only {@link gradeAccount} sees across runs, and it makes no per-run claim.
 *
 * ## 2. Every finding names the branch that produced it
 *
 * `Finding.because` is a stable branch tag and the goal's self-check asserts on
 * it. Without it a guard case can be satisfied by the WRONG branch and be
 * indistinguishable from a working guard — which happened: deleting A4's
 * missing-report condition left the ordering comparison to handle that case,
 * `null` coerced against `0`, and the resulting failure satisfied a status-only
 * assertion perfectly.
 *
 * ## 3. An absent value is never silently skipped
 *
 * Every `null` check below is one of two things, decided explicitly and said
 * out loud at the site: **correctly not applicable** (another assertion owns
 * it), or **unevaluable, therefore a failure**. A skipped comparison certifies,
 * and a check that certifies on an empty input is the exact defect this whole
 * epic exists to remove.
 *
 * ## The run's prose is out of reach, structurally
 *
 * {@link GradeableView} narrows `said` to positions only, so "grade whether the
 * run did a GOOD job" is a compile error rather than a rule to remember.
 */
import type { Account, DidEntry, RunView, StreamMutation } from "./reader.mts";
import { sameFile } from "./paths.mts";

/** What the run was asked to touch. Held out — the reader never sees it. */
export interface Expectation {
  /**
   * The paths the job named. Basenames must be distinct, enforced at setup:
   * trailing-segment matching cannot be ambiguous.
   */
  paths: string[];
}

/** One run's view, with the run's own words removed. See the header. */
export type GradeableView = Omit<RunView, "said"> & {
  said: Array<{ at: number | null }>;
};

/** The account, with every run's words removed. */
export type GradeableAccount = Omit<Account, "runs"> & { runs: GradeableView[] };

/** How one assertion resolved. `unmeasured` is reported, never counted as a pass. */
export type FindingStatus = "pass" | "fail" | "unmeasured";

/** One assertion's verdict, with the reason it reached it. */
export interface Finding {
  /** `A1`…`A7`. `A8` is graded over the deprived sources and added by the runner. */
  id: string;
  status: FindingStatus;
  /** Which branch produced this. Stable, and what the self-check asserts on. */
  because: string;
  message: string;
}

/** The eight assertions, in the order §10 states them. */
export const ASSERTIONS: Record<string, string> = {
  A0: "the account holds the one run this check grades",
  A1: "every held-out path is present with a recorded kind and a settled outcome",
  A2: "the two surfaces name the same mutations, or a gap row accounts for the difference",
  A3: "the stream's order is non-decreasing over itemIndex, across at least two positions",
  A4: "the run's last mutation precedes the report it wrote about that activity",
  A5: "the plan half resolves to rows or to UNMEASURED — never to LOST",
  A6: "every count an assertion reads is greater than zero",
  A7: "no collection page was left unfollowed",
  A8: "the deprived sources import nothing that could reach the transcript, tree or git",
};

/** An outcome that says how the mutation ended. `pending` and absent do not. */
const SETTLED = new Set(["applied", "failed"]);

/** Rows this run holds for one expected path, by trailing path segments. */
function entriesFor(view: GradeableView, path: string): DidEntry[] {
  return view.did.filter((d) => sameFile(d.topic, path));
}

/** What to call a row in a message: the path the run used, else its key. */
function nameOf(entry: DidEntry): string {
  return entry.path ?? entry.topic;
}

/**
 * A1 — every held-out path present, with a kind and a settled outcome.
 *
 * The split that matters: a missing path with no successful shell call in THIS
 * run is the graph having lost a mutation; a missing path with one is work that
 * went through a channel the record does not cover. `allowedTools` is a
 * permission allowlist rather than an availability filter, so the run reaching
 * for the shell is real and measured — and a call the harness REFUSED changed
 * nothing, so it must not soften the verdict.
 */
function gradePaths(view: GradeableView, expectation: Expectation): Finding[] {
  if (expectation.paths.length === 0) {
    return [
      {
        id: "A1",
        status: "fail",
        because: "a1-no-expectation",
        message: "the expectation names no path, so A1 read an empty set and could not be evaluated",
      },
    ];
  }

  const findings: Finding[] = [];
  let unmeasured = 0;
  for (const path of expectation.paths) {
    const entries = entriesFor(view, path);
    if (entries.length > 1) {
      // Two rows could be this path. Grading both would grade a file the job
      // never named; grading either would be a guess. Neither is evidence.
      findings.push({
        id: "A1",
        status: "fail",
        because: "a1-ambiguous",
        message:
          `"${path}" matches ${entries.length} rows in this run's file record ` +
          `(${entries.map((e) => e.topic).join(", ")}) — the record cannot be resolved to one ` +
          `file, so nothing can be said about whether this path was recorded`,
      });
      continue;
    }
    if (entries.length === 0) {
      if (view.shell.succeeded > 0) {
        unmeasured += 1;
        findings.push({
          id: "A1",
          status: "unmeasured",
          because: "a1-missing-with-shell",
          message:
            `"${path}" has no row in this run's file record, and the run ran ` +
            `${view.shell.succeeded} shell call(s) — shell-driven edits are invisible to the ` +
            `recorder by design, so this path is unmeasured rather than lost`,
        });
        continue;
      }
      if (view.shell.calls > 0) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-missing-shell-denied",
          message:
            `"${path}" has no row in this run's file record. The run made ${view.shell.calls} ` +
            `shell call(s) but none of them ran, so none could have made this change`,
        });
        continue;
      }
      findings.push({
        id: "A1",
        status: "fail",
        because: "a1-missing-no-shell",
        message:
          `"${path}" has no row in this run's file record and the run made no shell call — ` +
          `nothing else could have made the change, so the graph lost it`,
      });
      continue;
    }
    for (const entry of entries) {
      if (entry.kind === null) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-no-kind",
          message: `the row for "${nameOf(entry)}" records no kind — state does not say how the run touched it`,
        });
      }
      if (entry.outcome === null) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-no-outcome",
          message:
            `the row for "${nameOf(entry)}" carries no outcome field at all — it is exposed ` +
            `through clientData, so absence means it was projected away, not that it is false`,
        });
      } else if (!SETTLED.has(entry.outcome)) {
        findings.push({
          id: "A1",
          status: "fail",
          because: "a1-unsettled",
          message:
            `the row for "${nameOf(entry)}" is still "${entry.outcome}" after the run finished — ` +
            `the settle path did not run, and a finished run should have no unsettled write`,
        });
      }
    }
  }

  if (unmeasured === expectation.paths.length) {
    findings.push({
      id: "A1",
      status: "fail",
      because: "a1-all-unmeasured",
      message:
        `INCONCLUSIVE — all ${expectation.paths.length} expected path(s) were unmeasured because ` +
        `the run worked through the shell. This run proved nothing about whether state can say ` +
        `what a run did, which is not a pass`,
    });
  }
  if (findings.length === 0) {
    findings.push({
      id: "A1",
      status: "pass",
      because: "a1-ok",
      message: `${expectation.paths.length} of ${expectation.paths.length} held-out paths present, each with a kind and a settled outcome`,
    });
  }
  return findings;
}

/**
 * The record must be right about WHAT happened, not merely populated.
 *
 * A1 requires a kind and a settled outcome; neither says the record agrees with
 * the operation the stream shows. Both halves are defects the recorder has
 * actually shipped: `Write` classified as `created` whatever it did to an
 * existing file, and a settled outcome reusing the call-time value rather than
 * the harness's confirmed result.
 *
 * **Preference-shaped**: it only has teeth where the two sides disagree, so a
 * guard case built from a coherent record exercises none of it.
 */
/**
 * What absence means for one side of one comparison.
 *
 * There is no default, and that is the whole point. Every field compared across
 * the two surfaces has three outcomes, not one — the values differ, one side is
 * silent, the other side is silent — and choosing "skip" for a silent side is a
 * DECISION, not an omission. It kept being made by omission: null-outcome was
 * given a failure in round 5 and null-kind was left skipping, the same rule half
 * applied, and a reviewer found it a round later.
 *
 * `no-claim` requires a written `why`, so declining to compare costs a sentence
 * and appears in the diff. `fail` is the other option. There is no third.
 */
type AbsenceRule =
  | { kind: "fail"; because: string; message: string }
  | { kind: "no-claim"; why: string };

/**
 * Compare one field across the two surfaces, having been told what silence
 * means on each side.
 *
 * The signature is the guard: a caller cannot reach the comparison without
 * supplying both absence rules, so "the field was null and we moved on" is not
 * expressible. A source scan asserts that no raw cross-surface comparison
 * exists outside this function, because the type only binds the calls that go
 * through it.
 */
function compareField(spec: {
  stream: string | null;
  record: string | null;
  whenStreamAbsent: AbsenceRule;
  whenRecordAbsent: AbsenceRule;
  whenDiffer: { because: string; message: string };
}): Finding[] {
  const absent = (rule: AbsenceRule): Finding[] =>
    rule.kind === "fail"
      ? [{ id: "A2", status: "fail", because: rule.because, message: rule.message }]
      : [];
  if (spec.record === null) return absent(spec.whenRecordAbsent);
  if (spec.stream === null) return absent(spec.whenStreamAbsent);
  if (spec.record === spec.stream) return [];
  return [
    { id: "A2", status: "fail", because: spec.whenDiffer.because, message: spec.whenDiffer.message },
  ];
}

function compareSemantics(mutation: StreamMutation, entry: DidEntry): Finding[] {
  const name = nameOf(entry);
  return [
    ...compareField({
      stream: mutation.kind,
      record: entry.kind,
      // The TOOL NAME does not determine the kind: a `Write` over an existing
      // file is an edit, and the item stream carries no field that tells the
      // two apart. Inventing a claim here failed faithful state while passing a
      // recorder that mislabels an overwrite.
      whenStreamAbsent: {
        kind: "no-claim",
        why: "the tool name does not determine whether a write created or edited",
      },
      whenRecordAbsent: {
        kind: "fail",
        because: "a2-row-kind-missing",
        message:
          `the record holds a row for "${name}" with no kind at all, so state cannot say how ` +
          `that file was touched — and A1 only inspects the held-out paths`,
      },
      whenDiffer: {
        because: "a2-kind-disagrees",
        message:
          `the record says "${name}" was ${JSON.stringify(entry.kind)}, but the item stream ` +
          `shows a ${mutation.tool}, which is ${JSON.stringify(mutation.kind)} — the record is ` +
          `wrong about what the run did to this file`,
      },
    }),
    ...compareField({
      stream: mutation.outcome,
      record: entry.outcome,
      whenStreamAbsent: {
        kind: "fail",
        because: "a2-outcome-unevaluable",
        message:
          `the item stream shows "${mutation.path}" ending as ${JSON.stringify(mutation.status)}, ` +
          `which says nothing about how it settled — so the record's ` +
          `${JSON.stringify(entry.outcome)} is a claim nothing corroborates`,
      },
      whenRecordAbsent: {
        kind: "fail",
        because: "a2-row-outcome-missing",
        message:
          `the record holds a row for "${name}" with no outcome at all, so state cannot say how ` +
          `that mutation ended — and A1 only inspects the held-out paths`,
      },
      whenDiffer: {
        because: "a2-outcome-disagrees",
        message:
          `the record settled "${name}" as ${JSON.stringify(entry.outcome)}, but the item stream ` +
          `shows the call ${mutation.status}, which is ${JSON.stringify(mutation.outcome)} — the ` +
          `record is wrong about how it turned out`,
      },
    }),
  ];
}

/**
 * A2 — this run's item stream and this run's file record name the same mutations.
 *
 * A disagreement fails ONLY when no gap row accounts for it. The recorder is
 * allowed to skip — watching the work must never break the work — so what is
 * caught here is narrower and sharper than "the two surfaces differ": it is
 * *the graph lost something without admitting it*.
 *
 * Gaps are **consumed**, not matched. The recorder writes one row per
 * unrecordable mutation, so one gap excuses one loss; `.find()` would hand the
 * same row to two mutations sharing a path and certify a state that lost one.
 * And the pairing must be UNIQUE in both directions — many rows for one
 * mutation, many mutations for one gap, and many gaps for one mutation are the
 * same defect approached from three sides, each caught by its own branch here.
 * **Unique means DISTINGUISHABLE, not few.** Repairing the third direction by
 * failing on two-or-more candidates created a fifth: two attempts at one
 * unkeyable path leave two gaps carrying the same `rawPath`, which is one claim
 * twice rather than a choice. So every one of these branches counts distinct
 * SPELLINGS and consumes one-to-one; the count is the accounting, and a
 * shortfall still reports the loss.
 *
 * **A row is an AGGREGATE, and several mutations naming it is normal.** One row
 * per path, folding every call on that path, last settlement winning. So the
 * row's kind and outcome are compared against the LAST mutation naming it, once
 * per row — not against each of them, which asserted that one row described
 * every call and rejected a run that edited a file it had written.
 */
function gradeAgreement(view: GradeableView): Finding[] {
  const findings: Finding[] = [];

  if (view.streamMutations.length === 0 && view.did.length === 0) {
    return [
      {
        id: "A2",
        status: "fail",
        because: "a2-both-empty",
        message:
          "neither surface shows a mutation — the item stream carries no file-tool call and the " +
          "file record holds no row, so the agreement claim read an empty set on both sides",
      },
    ];
  }

  let accounted = 0;
  // A gap excuses a missing FILE row only if it says that is what it covers.
  // `kind` is a closed set on the row, so this is a field comparison rather
  // than a guess — a plan gap sitting in the same run is not evidence about a
  // mutation, and a gap that names no subject is not evidence about anything.
  const namedGaps = view.gaps.filter((g) => g.kind === "file" && g.rawPath !== null);

  // Mutations with no row are NOT resolved here. They are collected and
  // reconciled against the gaps GLOBALLY, below — see that block for why a
  // per-mutation decision cannot be right.
  const unrecorded: StreamMutation[] = [];
  for (const mutation of view.streamMutations) {
    const rows = view.did.filter((d) => sameFile(d.topic, mutation.path));
    if (rows.length > 1) {
      // Accepting any one would let a genuinely missing record hide behind a
      // different row sharing a tail — the exact failure this assertion exists
      // to catch.
      findings.push({
        id: "A2",
        status: "fail",
        because: "a2-ambiguous-mutation",
        message:
          `"${mutation.path}" could be ${rows.length} different rows ` +
          `(${rows.map((r) => r.topic).join(", ")}) — the two surfaces cannot be paired, so ` +
          `whether this mutation was recorded is unresolvable rather than fine`,
      });
      continue;
    }
    if (rows.length === 1) {
      // ORDER IS LOAD-BEARING. The gap exemption below must never be reached
      // while a row exists: a gap explains a mutation the collection is
      // MISSING, and does not license a row that is present and wrong.
      //
      // The row's SEMANTICS are compared in the per-row pass below, not here.
      // A row is an aggregate — one per path, last settlement wins — so a run
      // that writes a file and then edits it produces two mutations and one
      // row, and comparing every mutation against that row asserts the row
      // describes each of them. It describes the last one.
      continue;
    }
    unrecorded.push(mutation);
  }

  // ── Mutation ↔ gap reconciliation, done ONCE over the whole run ───────────
  //
  // The SAME ambiguity rule, and this is where four of its seven directions
  // live. Round 1 caught one mutation naming many rows; round 3, many mutations
  // consuming one gap; round 7, one mutation matched by many gaps — `findIndex`
  // took the first and called the loss excused. Round 10 caught the FIFTH,
  // which round 7's own repair created: rejecting "two or more candidates" did
  // not tell candidates that are INTERCHANGEABLE from candidates that are
  // DISTINGUISHABLE, and two attempts at one unkeyable path leave two gaps
  // carrying the SAME `rawPath` — one claim twice, not a choice. So the
  // discriminator became distinct SPELLINGS rather than row count.
  //
  // **AND THE SEVENTH, WHICH THAT REPAIR CREATED IN ITS TURN.** Counting
  // spellings PER MUTATION is locally true and globally wrong: one gap spelling
  // can be a candidate for several DIFFERENT mutation spellings, and whichever
  // mutation the loop reached first consumed it. Two lost mutations on
  // `alpha.txt` and `sub/alpha.txt`, beside two gaps both spelled
  // `/work/sub/alpha.txt`, each saw a single spelling, each consumed one, and
  // A2 reported `a2-ok` — while those two gaps evidence two attempts on
  // `sub/alpha.txt` and the lost `alpha.txt` mutation has no gap at all.
  // Before the interchangeable repair this world FAILED, correctly and by
  // accident (two candidates → ambiguous). The repair turned a correct-by-
  // accident reject into a false green.
  //
  // So reconciliation is GLOBAL. Both sides are reduced to distinct spellings
  // first, and an assignment is only made where nothing else could claim it:
  // a gap spelling answering to more than one mutation spelling cannot say
  // which loss it excuses, and a mutation spelling offered more than one gap
  // spelling cannot say which gap is its own. Only inside a forced 1:1 pair do
  // the COUNTS become the accounting.
  //
  // Deliberately NOT closed here: a gap spelling that answers to NO mutation is
  // a stored claim the stream never evidenced. That is the sixth direction, it
  // is named in `goal.md`, and folding it silently while touching this function
  // would make that entry false.
  const gapSpellings = [...new Set(namedGaps.map((g) => g.rawPath as string))];
  const mutationSpellings = [...new Set(unrecorded.map((m) => m.path))];
  const unresolvable = new Set<string>();

  // Pass 1 — the GAP side. One gap spelling, several mutation spellings.
  for (const gapSpelling of gapSpellings) {
    const claimants = mutationSpellings.filter((m) => sameFile(gapSpelling, m));
    if (claimants.length > 1) {
      for (const claimant of claimants) unresolvable.add(claimant);
      findings.push({
        id: "A2",
        status: "fail",
        because: "a2-ambiguous-gap",
        message:
          `the gap row(s) spelled "${gapSpelling}" could be covering ${claimants.length} ` +
          `different lost mutations (${claimants.join(", ")}) — consuming one for each would ` +
          `excuse every loss while the gaps may all belong to a single path`,
      });
    }
  }

  // Pass 2 — the MUTATION side, over the spellings pass 1 left resolvable.
  for (const spelling of mutationSpellings) {
    if (unresolvable.has(spelling)) continue;
    const calls = unrecorded.filter((m) => m.path === spelling);
    const candidates = gapSpellings.filter((g) => sameFile(g, spelling));
    if (candidates.length > 1) {
      findings.push({
        id: "A2",
        status: "fail",
        because: "a2-ambiguous-gap",
        message:
          `"${spelling}" has no row in the file record and ${candidates.length} different ` +
          `paths are offered as gaps covering it (${candidates.join(", ")}) — consuming either ` +
          `would excuse this loss with a row that may belong to a different one`,
      });
      continue;
    }
    // Interchangeable by construction: one spelling on each side and nothing
    // else can claim it, so which row is consumed cannot matter. Consumption
    // stays one-to-one, which is what turns the count into the accounting — a
    // third call on this path with only two gaps beside it finds none left and
    // is reported lost.
    const available =
      candidates.length === 1
        ? namedGaps.filter((g) => g.rawPath === candidates[0]).length
        : 0;
    accounted += Math.min(available, calls.length);
    for (const lost of calls.slice(available)) {
      findings.push({
        id: "A2",
        status: "fail",
        because: "a2-unaccounted",
        message:
          `"${lost.path}" appears in the item stream as a ${lost.tool}, has no row in the ` +
          `file record, and no UNCONSUMED gap row accounts for it: the graph lost a tool-driven ` +
          `mutation without admitting it`,
      });
    }
  }

  for (const entry of view.did) {
    // Recomputed from the arrays, not read off `entry.namedBy`: a count derived
    // beside the array it describes can drift from it.
    const naming = view.streamMutations.filter((m) => sameFile(m.path, entry.topic));
    if (naming.length > 1) {
      // TOUCHING A PATH TWICE IS ORDINARY, AND THIS USED TO FAIL IT. The
      // recorder keys one row per path and folds every call on it into that row
      // (`work-recorder.ts` — one entry per subject, last settlement wins), so
      // a plain write-then-edit or a retry produces several mutations and one
      // row. Reading that as an unresolvable pairing rejected faithful state,
      // and it only ever passed because no graded run happened to edit a file
      // it had written.
      //
      // What IS unresolvable is several DIFFERENT paths matching one row: the
      // spellings are short and this comparison is by trailing segments, so two
      // files can both be candidates for one row and nothing can say which it
      // records. Identical spellings inside one run are one file.
      const spellings = [...new Set(naming.map((m) => m.path))];
      if (spellings.length > 1) {
        findings.push({
          id: "A2",
          status: "fail",
          because: "a2-ambiguous-row",
          message:
            `the row keyed "${entry.topic}" is named by mutations on ${spellings.length} ` +
            `different paths (${spellings.join(", ")}) — which file it records is unresolvable, ` +
            `so it cannot corroborate any of them`,
        });
        continue;
      }
      // The row carries the LAST settlement, so the last mutation is the one it
      // describes. Which one that is has to be readable: an unreadable position
      // or a tie makes the terminal call unrecoverable, and grading the wrong
      // one would assert the row is wrong about a call it never described.
      // `itemIndex` carries duplicates, which is why the tie is a real state
      // and not a defensive branch — A4 fails on the same shape.
      const positions = naming.map((m) => m.at);
      if (positions.some((p) => p === null)) {
        findings.push({
          id: "A2",
          status: "fail",
          because: "a2-terminal-unreadable",
          message:
            `the row keyed "${entry.topic}" folds ${naming.length} mutations and at least one of ` +
            `them carries no readable stream position, so which call the row's kind and outcome ` +
            `describe cannot be determined`,
        });
        continue;
      }
      const highest = Math.max(...(positions as number[]));
      const terminal = naming.filter((m) => m.at === highest);
      if (terminal.length > 1) {
        findings.push({
          id: "A2",
          status: "fail",
          because: "a2-terminal-tied",
          message:
            `the row keyed "${entry.topic}" folds ${naming.length} mutations and ${terminal.length} ` +
            `of them share the last stream position ${highest} — itemIndex carries duplicates, so ` +
            `which one the row settled on is not recoverable`,
        });
        continue;
      }
      findings.push(...compareSemantics(terminal[0], entry));
      continue;
    }
    if (naming.length === 1) {
      findings.push(...compareSemantics(naming[0], entry));
      continue;
    }
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-row-without-stream",
      message:
        `the file record holds a row keyed "${entry.topic}" that this run's item stream does not ` +
        `show — the record claims an operation nothing else evidences`,
    });
  }

  // A mutation the recorder could not key leaves a `file` gap carrying NO path.
  // Disjoint from the named-path pool above by construction (`rawPath === null`
  // versus `!== null`), and narrowed to this run's file skips by `kind`.
  //
  // This was a counting bound until the gap row gained `kind`: a plan gap and
  // an unkeyable-file gap were indistinguishable without parsing prose, so any
  // pathless gap could stand in for any pathless skip. It now answers only to
  // gaps that say they cover a file.
  const pathlessGaps = view.gaps.filter((g) => g.kind === "file" && g.rawPath === null).length;
  if (pathlessGaps < view.mutationsWithNoPath) {
    findings.push({
      id: "A2",
      status: "fail",
      because: "a2-pathless-no-gap",
      message:
        `this run made ${view.mutationsWithNoPath} file-tool call(s) with no path to key them ` +
        `under and wrote ${pathlessGaps} pathless gap row(s) of kind "file" — a skip that leaves ` +
        `nothing behind is indistinguishable from a mutation that never happened`,
    });
  }

  if (findings.length === 0) {
    findings.push({
      id: "A2",
      status: "pass",
      because: "a2-ok",
      message:
        `${view.streamMutations.length} stream mutation(s) and ${view.did.length} recorded ` +
        `row(s) name the same files` +
        (accounted > 0 ? `; ${accounted} difference(s) accounted for by a gap row` : ""),
    });
  }
  return findings;
}

/**
 * A3 — the stream is in order, and there is enough of it to say so.
 *
 * Non-decreasing, never contiguous: the measured values carry a duplicate and a
 * gap, both legitimate. An unreadable index is a failure, not a skip — guarding
 * on "did we read any numbers" is what let the predecessor's ordering assertion
 * pass having measured nothing.
 *
 * Over EVERY item of the request, sub-agents included. The set is the reader's
 * to choose and it chose the top-level projection until a review caught the
 * mismatch: the claim said the request's stream was ordered, the check covered
 * the parent thread, and a nested pair arriving `3, 2` between two top-level
 * messages passed. A claim narrower than its own name is the same defect as a
 * rule applied to one case and not its twin — it just fails in prose first.
 */
function gradeOrder(view: GradeableView): Finding[] {
  const run = view.order;
  if (run.unreadable > 0) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-unreadable",
        message:
          `${run.unreadable} of ${run.unreadable + run.indices.length} items of this request carry no ` +
          `numeric itemIndex, so there is no evidence for the in-order claim`,
      },
    ];
  }
  const distinct = new Set(run.indices).size;
  if (distinct < 2) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-too-few-positions",
        message:
          `this run produced ${distinct} distinct stream position(s) — fewer than two, so ` +
          `ordering is unverifiable`,
      },
    ];
  }
  if (run.indices.some((v, i) => i > 0 && v < run.indices[i - 1])) {
    return [
      {
        id: "A3",
        status: "fail",
        because: "a3-out-of-order",
        message: `this run is not in order: itemIndex ${run.indices.join(",")}`,
      },
    ];
  }
  return [
    {
      id: "A3",
      status: "pass",
      because: "a3-ok",
      message: `non-decreasing across ${run.indices.length} item(s) of this request, sub-agents included, at ${distinct} distinct position(s)`,
    },
  ];
}

/**
 * A4 — the run reported on the acting, and nothing followed the report.
 *
 * Graded on the LAST mutation, not the first. `write@1, report@2, write@3` has
 * activity preceding a report and a report covering none of the work after it,
 * and a first-activity comparison certifies it. Mutations rather than every
 * tool call: a `Read` after the closing word changes nothing.
 *
 * A tie is unevaluable, not a pass — `itemIndex` carries duplicates, so equal
 * positions say nothing about which came first, and A4's claim is causal.
 */
function gradeCausality(view: GradeableView): Finding[] {
  const run = view.order;

  // UNEVALUABLE, therefore a FAILURE: `lastMutationAt` was computed from the
  // positions that could be read, so a dropped one means the comparison
  // describes a smaller set than it claims. A3's `unreadable` now covers the
  // same items, and this stays anyway: A4 must fail on its own evidence rather
  // than on a neighbour failing first.
  if (run.unreadableMutationPositions > 0) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-unreadable-mutation",
        message:
          `${run.unreadableMutationPositions} mutation(s) carry no readable stream position, so ` +
          `"nothing followed the report" would be asserted over a subset of the run's writes`,
      },
    ];
  }
  // NOT APPLICABLE, decided explicitly: a MESSAGE whose position cannot be read
  // would shrink `lastMessageAt` the same way, and A3's `unreadable` fails on
  // any item of this request without an index — messages included. The count
  // above is kept separate regardless, for the reason stated there.
  const last = run.lastMutationAt;
  const word = run.lastMessageAt;
  if (last === null || word === null) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-unevaluable",
        message:
          `this run carries ${last === null ? "no file mutation" : "no message"} at a readable ` +
          `position, so "activity preceded the report" could not be evaluated`,
      },
    ];
  }
  if (last === word) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-tied",
        message:
          `this run last changed a file at position ${last} and last spoke at the same position ` +
          `— itemIndex carries duplicates, so which came first is not recoverable`,
      },
    ];
  }
  if (last > word) {
    return [
      {
        id: "A4",
        status: "fail",
        because: "a4-activity-after-report",
        message:
          `this run last changed a file at position ${last}, AFTER its final message at ` +
          `${word} — the record holds a mutation the report never covered`,
      },
    ];
  }
  return [
    {
      id: "A4",
      status: "pass",
      because: "a4-ok",
      message: `mutations ${run.firstMutationAt}-${last}, last word at ${word}`,
    },
  ];
}

/**
 * A5 — the plan half: rows, or UNMEASURED with its reason named. Never LOST.
 *
 * UNMEASURED is the expected arm on this driver and does not fail the goal —
 * the kill line deliberately does not ride on it. It is still reported and
 * logged per run, so a drift toward never measuring anything stays visible.
 *
 * The ROWS branch has never executed against a real run and will not until the
 * driver changes (FIX-1185), which is why the self-check feeds it directly. A
 * branch no run reaches cannot be mutation-tested through a run.
 */
function gradePlan(view: GradeableView): Finding[] {
  const { rows, toolCalls } = view.plan;
  // NO PLAN CALL MEANS NOTHING WAS MEASURED, ROWS OR NO ROWS — and this gate
  // has to come first, because it is the condition on EVERY real run. Selecting
  // the ROWS arm on `rows.length > 0` alone certified a plan record that the
  // run's own stream shows no call behind: a false green one stray row away, on
  // the path every verdict this goal has ever produced takes. The predecessor
  // goal's truth table already read "no plan tools" as inconclusive regardless
  // of rows; this one now agrees with it.
  //
  // Rows without calls are REPORTED rather than failed, for the same reason a
  // missing file with a successful shell call is: the stream may be blind to
  // how they got there, and an input that cannot determine an answer must not
  // produce one — in either direction.
  if (toolCalls === 0) {
    return [
      {
        id: "A5",
        status: "unmeasured",
        because: "a5-unmeasured",
        message:
          `this run invoked no plan tool in its own item stream, so nothing was measured about ` +
          `the plan half` +
          (rows.length > 0
            ? ` — and yet the record holds ${rows.length} plan row(s), which nothing in the ` +
              `stream evidences`
            : ``) +
          `. Tools it did use: ${view.toolNamesSeen.join(", ") || "(none)"}`,
      },
    ];
  }
  if (rows.length === 0) {
    // A plan gap is the recorder SAYING it could not record — the translator
    // emits exactly that when a successful create's item id is unreadable. So
    // a call with a gap beside it is a named absence, not a loss. Same rule
    // the file side already follows, and it was applied there and not here.
    const planGaps = view.gaps.filter((g) => g.kind === "plan").length;
    if (planGaps < toolCalls) {
      return [
        {
          id: "A5",
          status: "fail",
          because: "a5-lost",
          message:
            `the plan tools fired ${toolCalls} time(s) in this run, no row was recorded, and ` +
            `only ${planGaps} plan gap(s) account for it — our bug`,
        },
      ];
    }
    return [
      {
        id: "A5",
        status: "unmeasured",
        because: "a5-unmeasured",
        message:
          `this run's ${toolCalls} plan tool call(s) are each accounted for by a plan gap, so ` +
          `the recorder said what it could not record rather than losing it`,
      },
    ];
  }

  const findings: Finding[] = [];
  const untitled = rows.filter((r) => r.title === null || r.title.length === 0);
  if (untitled.length > 0) {
    findings.push({
      id: "A5",
      status: "fail",
      because: "a5-untitled",
      message:
        `${untitled.length} of ${rows.length} plan rows in this run carry no wording — the record ` +
        `says an item existed without saying what the run thought it was`,
    });
  }
  if (!rows.some((r) => r.status !== null)) {
    findings.push({
      id: "A5",
      status: "fail",
      because: "a5-no-status",
      message: "no plan row in this run carries a status — the record cannot answer whether any item moved",
    });
  }
  if (findings.length === 0) {
    findings.push({
      id: "A5",
      status: "pass",
      because: "a5-ok",
      message: `${rows.length} plan row(s) from ${toolCalls} plan tool call(s)`,
    });
  }
  return findings;
}

/**
 * A6 — no assertion read an empty set. Each emptiness fails by its own name.
 *
 * Where a set is one the OTHER assertions iterate, its size is taken from that
 * set rather than from a count beside it. A count can drift from its array, and
 * then A6 reports "fine" about a set A1 and A2 never saw.
 *
 * **`toolOutputs` is deliberately NOT here**, and its absence is the point of
 * this paragraph. A6's claim is that no assertion read an empty set — so a
 * count belongs here only if some assertion reads it, and no assertion iterates
 * top-level tool outputs. Activity is scanned over every item of the request,
 * sub-agents included, precisely so a run that delegates its file work is read
 * correctly; requiring a top-level tool output failed exactly that run for
 * "reporting without doing anything" while A1 and A2 could see everything it
 * did. It was the only branch here no guard case ever watched fail, which is
 * what a requirement nothing needs looks like from the outside.
 *
 * Nothing is lost by dropping it. A run that genuinely did nothing has no
 * mutations and no rows, so `fileRows` is zero here and A2 reports both
 * surfaces empty. The count itself stays on the view — the evidence line
 * reports it — because describing a run is not the same as requiring something
 * of it.
 */
function gradeCounts(view: GradeableView): Finding[] {
  const required: Array<[string, number, string]> = [
    ["items", view.counts.items, "this run's item stream is empty — a run that completes with nothing recorded"],
    ["topLevel", view.counts.topLevel, "no item is top-level, so the run's own thread could not be read"],
    ["messages", view.said.length, "no top-level message, so A4 has nothing to place the activity against"],
    ["fileRows", view.did.length, "this run's file record is empty, so A1 and A2 read an empty set"],
  ];
  if (view.messagesWithoutText > 0) {
    return [
      {
        id: "A6",
        status: "fail",
        because: "a6-message-without-text",
        message:
          `${view.messagesWithoutText} top-level message(s) carry no readable text, so the ` +
          `account cannot report what the run said at those points — and counting them would ` +
          `inflate the set A6 reads while lending A4 a position the account is silent at`,
      },
    ];
  }
  const empty = required.filter(([, n]) => n === 0);
  if (empty.length > 0) {
    return empty.map(([name, , why]) => ({
      id: "A6",
      status: "fail" as const,
      because: `a6-empty:${name}`,
      message: `count "${name}" is zero: ${why}`,
    }));
  }
  return [
    {
      id: "A6",
      status: "pass",
      because: "a6-ok",
      message: required.map(([name, n]) => `${name} ${n}`).join(" · "),
    },
  ];
}

/**
 * A7 — every cursor followed, on all three of this run's collection reads.
 *
 * A single-page read under-reads silently, which is the same failure as an
 * empty set: the assertion grades a fragment while reporting on the whole.
 */
function gradePaging(view: GradeableView, collections: string[]): Finding[] {
  const findings: Finding[] = [];
  for (const collection of collections) {
    const report = view.reads[collection];
    if (report === undefined) {
      findings.push({
        id: "A7",
        status: "fail",
        because: "a7-never-read",
        message: `"${collection}" was never read for this run, so its rows informed no assertion`,
      });
      continue;
    }
    if (report.truncated) {
      findings.push({
        id: "A7",
        status: "fail",
        because: "a7-truncated",
        message:
          `"${collection}" still had a nextCursor after ${report.pages} page(s) — the read ` +
          `stopped short and every count derived from it is a fragment`,
      });
    }
  }
  if (findings.length === 0) {
    findings.push({
      id: "A7",
      status: "pass",
      because: "a7-ok",
      message: collections
        .map((c) => `${c}: ${view.reads[c].pages} page(s), ${view.reads[c].rows} row(s)`)
        .join(" · "),
    });
  }
  return findings;
}

/**
 * Every per-run assertion, over ONE run's view.
 *
 * The signature is the guard: nothing here can reach another run's rows, gaps,
 * shell calls or plan, because they are not in scope. That is what closes the
 * pooled-value class rather than another `runId ===` filter.
 */
export function gradeRun(view: GradeableView, expectation: Expectation, collections: string[]): Finding[] {
  return [
    ...gradePaths(view, expectation),
    ...gradeAgreement(view),
    ...gradeOrder(view),
    ...gradeCausality(view),
    ...gradePlan(view),
    ...gradeCounts(view),
    ...gradePaging(view, collections),
  ];
}

/**
 * Grade the account for the one run this check dispatched.
 *
 * `runId` is an ADDRESS, not an answer: the runner knows which run it started
 * and says so, rather than the grader guessing. An account holding a run the
 * caller did not name is a state this check cannot attribute an expectation to,
 * and it fails rather than picking one.
 */
export function grade(
  account: GradeableAccount,
  expectation: Expectation,
  collections: string[],
  runId: string,
): Finding[] {
  if (account.counts.requests === 0) {
    return [
      {
        id: "A0",
        status: "fail",
        because: "a0-no-requests",
        message: "the workstream has no request history at all, so nothing below could be derived",
      },
    ];
  }
  if (account.runs.length !== account.counts.requests) {
    return [
      {
        id: "A0",
        status: "fail",
        because: "a0-request-dropped",
        message:
          `the route returned ${account.counts.requests} request(s) and only ` +
          `${account.runs.length} could be read as a run — a request dropped before it reached ` +
          `any assertion is an absence nothing downstream can see`,
      },
    ];
  }
  const view = account.runs.find((r) => r.runId === runId);
  if (view === undefined) {
    return [
      {
        id: "A0",
        status: "fail",
        because: "a0-run-missing",
        message:
          `the account holds no view for run "${runId}" (it holds ` +
          `${account.runs.map((r) => r.runId).join(", ") || "none"}) — the run this check ` +
          `dispatched is not in the state it read`,
      },
    ];
  }
  return gradeRun(view, expectation, collections);
}

/** The failing findings, which are the goal's failures verbatim. */
export function failuresOf(findings: Finding[]): string[] {
  return findings
    .filter((f) => f.status === "fail")
    .map((f) => `${f.id} (${ASSERTIONS[f.id] ?? "unknown assertion"}): ${f.message}`);
}
