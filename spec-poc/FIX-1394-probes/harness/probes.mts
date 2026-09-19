/**
 * The six probes, run against one candidate.
 *
 * Variant-agnostic by construction: this module imports no candidate and every
 * candidate reaches it through {@link Candidate}. A candidate can decide what
 * it authors and how it compiles; it cannot decide what passing means.
 *
 * Each probe returns one cell and an evidence line saying what was OBSERVED —
 * a tool list, a prompt substring, a refusal message — never a restatement of
 * the verdict.
 *
 * P5's fourth enforcement point and P6's regression suite are not run here:
 * they are whole vitest suites, and re-running them per variant measures
 * nothing new (V3, V4). Nothing in this harness spawns vitest — they are two
 * separate commands the README lists and the ratify's Verification table
 * records: `check-conventions.mjs --run-tests` for the four grant-gate suites,
 * and `pnpm --filter @flow-state-dev/workforce test` for the off state.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { CAPABILITY, type Build, type Candidate, type Cell, type Mode } from "./contract.mts";
import { runSeat } from "./real-path.mts";

/** A scratch root per build, so one candidate's tree can never be read as another's. */
export function scratchRoot(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `fix1394-${label}-`));
}

/** Hire a built tree through the real loader and the real factory. */
async function hire(build: Build) {
  const loaded = await readWorkforce(build.root);
  const seats = hireWorkforce(loaded.workers, {
    ...(build.kinds === undefined ? {} : { kinds: build.kinds as never }),
    seatBlocks: build.seatBlocks,
  });
  const by = (id: string): FlowInstance => {
    const seat = seats.find((s) => s.id === id);
    if (seat === undefined) throw new Error(`built tree has no seat "${id}"`);
    return seat;
  };
  return { loaded, seats, by };
}

const cell = (probe: Cell["probe"], verdict: Cell["verdict"], evidence: string): Cell => ({
  probe,
  verdict,
  evidence,
});

/** P1 — the package's instructions reach the holder's prompt, and only the holder's. */
export async function probeP1(build: Build): Promise<Cell> {
  const { by } = await hire(build);
  const holder = await runSeat(by(build.holder), { message: "hello" });
  const bystander = await runSeat(by(build.bystander), { message: "hello" });

  if (holder.error !== undefined) return cell("P1", "fail", `holder's turn errored: ${holder.error}`);

  const reached = holder.promptText.includes(CAPABILITY.instructions);
  const leaked = bystander.promptText.includes(CAPABILITY.instructions);
  // The two shipped layers have to survive. Order is checkable; precedence is
  // not, and `agent-worker-flow.ts` is explicit that it is not claiming one.
  const teamAt = holder.promptText.indexOf("TEAM CHARTER");
  const seatAt = holder.promptText.indexOf("SEAT CHARTER");
  const layersIntact = teamAt >= 0 && seatAt >= 0 && teamAt < seatAt;

  if (!reached)
    return cell("P1", "fail", `holder's prompt does not carry the package's instructions (${build.mechanism.P1 ?? "no mechanism"})`);
  if (leaked)
    return cell("P1", "fail", "the bystander that holds nothing received the package's instructions too");
  if (!layersIntact)
    return cell("P1", "fail", `the shipped team/seat layers did not survive (team@${teamAt}, seat@${seatAt})`);
  return cell("P1", "pass", `holder's prompt carries it, bystander's does not, team layer still precedes seat layer — ${build.mechanism.P1 ?? ""}`);
}

/** P2 — the package's tool is callable by the holder, and the package carried the code. */
export async function probeP2(build: Build): Promise<Cell> {
  const { by } = await hire(build);
  const turn = await runSeat(by(build.holder), {
    message: "log the handover",
    callTool: CAPABILITY.toolName,
  });
  if (turn.error !== undefined) return cell("P2", "fail", `holder's turn errored: ${turn.error}`);
  if (!turn.toolsOffered.includes(CAPABILITY.toolName))
    return cell("P2", "fail", `the model was offered [${turn.toolsOffered.join(", ")}] — the package's tool is not among them (${build.mechanism.P2 ?? "no mechanism"})`);
  if (!turn.toolRan) return cell("P2", "fail", "the tool was offered but the block never executed");
  return cell("P2", "pass", `offered [${turn.toolsOffered.join(", ")}] and the block executed — ${build.mechanism.P2 ?? ""}`);
}

/**
 * P3 — the document.
 *
 * Attached: readable on every turn, with no activation step. Held: absent
 * before activation and present after. Both halves are read off the same
 * observation point, the text the model actually received, because that is
 * where "readable by the seat" is decided.
 */
export async function probeP3(
  attached: Build,
  library: Build | null,
): Promise<Cell> {
  if (attached.document.kind === "none")
    return cell("P3", "fail", `no delivery: ${attached.document.why}`);

  const a = await hire(attached);
  const always = await runSeat(a.by(attached.holder), {
    message: "hello",
    readResource:
      attached.document.kind === "flow-resource" ? attached.document.ref : undefined,
  });
  const readableAttached =
    always.promptText.includes(CAPABILITY.documentBody) ||
    (always.resourceBody ?? "").includes(CAPABILITY.documentBody);

  if (!readableAttached)
    return cell("P3", "fail", `attached, the document never reached the seat (${attached.document.kind}); resource keys were [${always.resourceKeys.join(", ")}]`);

  if (attached.document.kind === "flow-resource" && !attached.document.perSeat)
    return cell("P3", "fail", "attached, the document installs on the KIND, so every sibling seat of that kind receives it whether or not it holds the package");

  // Per-seat is a claim about the bystander, so it is read off the bystander
  // rather than off the candidate's own label for its delivery.
  const sibling = await runSeat(a.by(attached.bystander), { message: "hello" });
  if (sibling.promptText.includes(CAPABILITY.documentBody))
    return cell("P3", "fail", "attached, the document also reached a sibling seat that holds nothing");

  if (library === null) return cell("P3", "fail", "no library mode to check the opt-in half against");

  const l = await hire(library);
  const before = await runSeat(l.by(library.holder), { message: "hello" });
  if (library.activationMessage === null)
    return cell("P3", "fail", "held in a library, the candidate has no activation step");
  const after = await runSeat(l.by(library.holder), { message: library.activationMessage });

  const leakedEarly = before.promptText.includes(CAPABILITY.documentBody);
  const arrived = after.promptText.includes(CAPABILITY.documentBody);
  if (leakedEarly) return cell("P3", "fail", "held in a library, the document was in context before activation");
  if (!arrived) return cell("P3", "fail", `held in a library, the document never arrived on activation (${library.document.kind})`);
  return cell("P3", "pass", `attached it is readable every turn; held it is absent until ${JSON.stringify(library.activationMessage)} — ${attached.mechanism.P3 ?? ""}`);
}

/** P4 — the same authored bytes in both modes. */
export function probeP4(attached: Build, library: Build | null): Cell {
  if (library === null) return cell("P4", "fail", "the candidate authors only one mode");
  const a = Object.keys(attached.packageFiles).sort();
  const l = Object.keys(library.packageFiles).sort();
  if (a.length === 0) return cell("P4", "fail", "the candidate authored no package files in either mode");
  if (a.join("|") !== l.join("|"))
    return cell("P4", "fail", `two authored forms: attached wrote [${a.join(", ")}], library wrote [${l.join(", ")}]`);
  const differing = a.filter((k) => attached.packageFiles[k] !== library.packageFiles[k]);
  if (differing.length > 0)
    return cell("P4", "fail", `same file names, different bytes: ${differing.join(", ")}`);
  return cell("P4", "pass", `${a.length} file(s) byte-identical across both modes: ${a.join(", ")}`);
}

/**
 * P5 — the grant gate, with the package attached.
 *
 * Two seats that hold the package and differ only in their `tools:` line. The
 * one that names the tool may call it; the one that does not may not. That is
 * BR-1 through BR-3 stated as one observation on the tool list the model sees.
 *
 * **The holding is checked before the fence is.** Round 1 ran this on the
 * bystander, a seat nothing was attached to, so its empty tool list said
 * nothing about the gate: a reader that granted the tool to every seat holding
 * the package would still have passed. The first assertion below is what makes
 * the cell unable to go green vacuously — if the subject is not actually
 * carrying the package, P5 fails rather than reporting a fence it never tested.
 */
export async function probeP5(build: Build): Promise<Cell> {
  const { by } = await hire(build);
  // Whichever turn puts the package in context for this candidate: every turn
  // when it is attached, the activation turn when it is held.
  const message = build.activationMessage ?? "log the handover";
  const fenced = await runSeat(by(build.fenced), { message, callTool: CAPABILITY.toolName });
  const holder = await runSeat(by(build.holder), { message, callTool: CAPABILITY.toolName });

  if (fenced.error !== undefined)
    return cell("P5", "fail", `the package-holding seat's turn errored: ${fenced.error}`);
  // EITHER payload, deliberately. Asking for the instructions alone would tie
  // this check to P1's content, and the P1 fixture — which deletes exactly that
  // paragraph — would then go red here too, for a reason that is not about the
  // gate. A seat holding the package has one of the two; a seat holding nothing
  // has neither.
  const holdsPackage =
    fenced.promptText.includes(CAPABILITY.instructions) ||
    fenced.promptText.includes(CAPABILITY.documentBody);
  if (!holdsPackage)
    return cell("P5", "fail", "P5's subject is not actually holding the package, so its tool list says nothing about the gate");
  if (fenced.toolsOffered.length !== 0)
    return cell("P5", "fail", `a seat holding the package whose \`tools:\` names nothing was offered [${fenced.toolsOffered.join(", ")}]`);
  if (fenced.toolRan) return cell("P5", "fail", "a seat that never named the tool executed it");

  const bystander = await runSeat(by(build.bystander), { message, callTool: CAPABILITY.toolName });
  if (bystander.toolsOffered.length !== 0)
    return cell("P5", "fail", `a seat holding nothing was offered [${bystander.toolsOffered.join(", ")}]`);

  // The other half of the pair. A candidate that carries no code has nothing
  // for the gate to hold back, and saying so is the honest cell — the failure
  // is P2's and double-counting it here would make A look wrong twice for one
  // reason. A candidate that DOES carry code has to show the grant working,
  // otherwise "the fenced seat was offered nothing" could just mean the
  // package never installed anything for anybody.
  const carriesCode = Object.keys(build.seatBlocks[build.holder] ?? {}).length > 0;
  if (!carriesCode)
    return cell("P5", "pass", "the package registers no block for any seat, so nothing crossed the gate to be held back (see P2)");
  if (!holder.toolsOffered.includes(CAPABILITY.toolName))
    return cell("P5", "fail", "the sibling that DOES name the tool was not offered it either — the pair differs by more than the grant");
  return cell(
    "P5",
    "pass",
    `two seats hold the package and differ by one line: the one naming the tool is offered [${holder.toolsOffered.join(", ")}], the one naming nothing is offered none`,
  );
}

/**
 * P6 — a tree with no package authored.
 *
 * The off state (BP-035). The TREE is the same in all four columns, which is
 * what V4 says not to re-measure; what differs per candidate is the machinery
 * its format installs on the kind, and that is the thing the off state is
 * actually at risk from. So the tree is built once and the comparison is run
 * per candidate against the same baseline — a deliberate reading of V4, and a
 * cheap one: no vitest suite runs here.
 *
 * The heavy half of V4, the existing workforce suite, still runs once per
 * matrix — as its own command, `pnpm --filter @flow-state-dev/workforce test`,
 * not from anything in this harness.
 *
 * @param kinds the candidate's compiled kind, or `undefined` for the baseline.
 */
export async function probeP6(kinds?: Record<string, unknown>): Promise<Cell> {
  const root = scratchRoot("no-package");
  const seatDir = path.join(root, "teams/support/workers/clerk");
  fs.mkdirSync(path.join(seatDir, "skills/triage"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "teams/support/TEAM.md"),
    "---\ndescription: Support.\n---\n\nTEAM CHARTER: answer customers.\n",
  );
  fs.writeFileSync(
    path.join(seatDir, "WORKER.md"),
    "---\ndescription: Front desk.\n---\n\nSEAT CHARTER: you are the clerk.\n",
  );
  fs.writeFileSync(
    path.join(seatDir, "skills/triage/SKILL.md"),
    "---\nname: triage\ndescription: Triage a ticket.\n---\n\nTRIAGE STEPS: read, classify, route.\n",
  );

  const loaded = await readWorkforce(root);
  if (loaded.errors.length > 0 || loaded.skillErrors.length > 0)
    return cell("P6", "fail", `the shipped tree no longer loads clean: ${loaded.errors.length} slot error(s), ${loaded.skillErrors.length} skill error(s)`);

  const run = async (kinds: Record<string, unknown> | undefined) => {
    const seats = hireWorkforce(
      loaded.workers,
      kinds === undefined ? {} : { kinds: kinds as never },
    );
    return {
      idle: await runSeat(seats[0]!, { message: "hello" }),
      activated: await runSeat(seats[0]!, { message: "/triage" }),
    };
  };

  // The baseline is the SAME tree hired into the built-in kind. Comparing the
  // candidate's kind against it, rather than against a list of things someone
  // remembered to assert, is what makes "unchanged" mean unchanged: a kind that
  // adds a default-on context entry or a control tool moves one of these two
  // strings, whatever it happens to say.
  const base = await run(undefined);
  const baseSane =
    base.idle.error === undefined &&
    base.idle.promptText.includes("TEAM CHARTER") &&
    base.idle.promptText.includes("SEAT CHARTER") &&
    !base.idle.promptText.includes("TRIAGE STEPS") &&
    base.activated.promptText.includes("TRIAGE STEPS") &&
    base.idle.toolsOffered.length === 0;
  if (!baseSane)
    return cell("P6", "fail", `the shipped tree does not behave as main does even before a candidate: error=${base.idle.error ?? "none"}, tools=[${base.idle.toolsOffered.join(", ")}]`);

  if (kinds === undefined)
    return cell("P6", "pass", "a tree with no package authored loads, hires, carries both shipped layers, activates its skill and is offered no tools");

  const withKind = await run(kinds);
  if (withKind.idle.promptText !== base.idle.promptText)
    return cell("P6", "fail", "a tree with no package authored gets a DIFFERENT prompt once the candidate's machinery is installed on the kind");
  if (withKind.idle.toolsOffered.join(",") !== base.idle.toolsOffered.join(","))
    return cell("P6", "fail", `a tree with no package authored is offered [${withKind.idle.toolsOffered.join(", ")}] once the candidate's machinery is installed, where main offers none`);
  if (withKind.activated.promptText !== base.activated.promptText)
    return cell("P6", "fail", "activating an existing skill produces a different prompt once the candidate's machinery is installed");
  return cell("P6", "pass", "a tree with no package authored produces a byte-identical prompt and tool list with the candidate's machinery installed");
}

/** Run every probe against one candidate and return its column. */
export async function runCandidate(candidate: Candidate): Promise<Cell[]> {
  const build = async (mode: Mode): Promise<Build | null> =>
    candidate.build(scratchRoot(`${candidate.id}-${mode}`), mode);

  const attached = await build("attached");
  const library = await build("library");

  if (attached === null) {
    // The don't-collapse control. Every probe that presupposes a package is
    // n/a, and that is a recorded result (BR-16), not a blank.
    return [
      cell("P1", "n/a", "no package: a seat's instructions are its own file's body, written by hand"),
      cell("P2", "n/a", "no package: a tool is a file in `blocks/` plus a name in `tools:`, written by hand"),
      cell("P3", "n/a", "no package: a document is a flow-level resource the app installs on the kind"),
      cell("P4", "n/a", "no package, so nothing attaches in two modes"),
      await probeP5Handwritten(),
      await probeP6(),
    ];
  }

  const cells = [
    await probeP1(attached),
    await probeP2(attached),
    await probeP3(attached, library),
    probeP4(attached, library),
    await probeP5(attached),
    await probeP6(attached.kinds),
  ];
  return cells;
}

/**
 * P5 for the don't-collapse control, which has no package to attach.
 *
 * Still run rather than assumed: "the gate holds when nothing changed" is the
 * baseline every other column is read against, and a baseline nobody measured
 * is the one that quietly rots.
 */
async function probeP5Handwritten(): Promise<Cell> {
  const root = scratchRoot("handwritten");
  for (const [name, fm] of [
    ["granted", "description: Granted.\ntools: [ledger-append]\n"],
    ["fenced", "description: Fenced.\n"],
  ] as const) {
    const dir = path.join(root, "teams/support/workers", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "WORKER.md"), `---\n${fm}---\n\nSEAT CHARTER: ${name}.\n`);
  }
  const { ledgerAppend } = await import("./capability-fixture.mts");
  const loaded = await readWorkforce(root);
  const seats = hireWorkforce(loaded.workers, {
    seatBlocks: {
      "support.granted": { [CAPABILITY.toolName]: ledgerAppend },
      "support.fenced": { [CAPABILITY.toolName]: ledgerAppend },
    },
  });
  const granted = await runSeat(seats.find((s) => s.id === "support.granted")!, {
    message: "go",
    callTool: CAPABILITY.toolName,
  });
  const fenced = await runSeat(seats.find((s) => s.id === "support.fenced")!, {
    message: "go",
    callTool: CAPABILITY.toolName,
  });
  return granted.toolRan && fenced.toolsOffered.length === 0
    ? cell("P5", "pass", "hand-written today: the seat that names the tool calls it, the seat registered the same block and naming nothing gets zero tools")
    : cell("P5", "fail", `hand-written baseline moved: granted ran=${granted.toolRan}, fenced offered=[${fenced.toolsOffered.join(", ")}]`);
}
