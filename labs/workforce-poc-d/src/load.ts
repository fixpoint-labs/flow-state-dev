/**
 * Lab-local tree walk. Not `loadWorkforce()`. Not an L1 export.
 *
 * Today's scanners do not feed yaml/json seats into AgentRegistry or
 * defineFlow — see README gap. This walker exists only so the lab can prove
 * the *factory* half: parsed seats → `defineAgent` + `defineFlow`. A product
 * scan, if one lands, must call those two registries. This file is not that
 * scan.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import type { Agent } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { parse as parseYaml } from "yaml";
import { seatFileSchema, seatToAgent, seatToWorkerFlow, type SeatConfig } from "./factory";

const SEAT_EXTS = new Set([".yaml", ".yml", ".json"]);

/** Paths the atlas names as seat homes. `agents/` is scanned as the same catalog, not a second registry. */
const SEAT_ROOTS = ["teams", "workers", "agents"] as const;

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface LoadedSeats {
  seats: SeatConfig[];
  agents: Agent[];
  flows: FlowInstance[];
  skipped: SkippedFile[];
}

function isSeatHome(rel: string): boolean {
  const top = rel.split(sep)[0];
  return (SEAT_ROOTS as readonly string[]).includes(top ?? "");
}

function walkFiles(root: string, current = root, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(current);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(current, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkFiles(root, full, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!SEAT_EXTS.has(extname(entry))) continue;
    const rel = relative(root, full);
    if (!isSeatHome(rel)) continue;
    out.push(full);
  }
  return out;
}

function parseFile(path: string): unknown {
  const raw = readFileSync(path, "utf8");
  if (extname(path) === ".json") {
    return JSON.parse(raw) as unknown;
  }
  return parseYaml(raw) as unknown;
}

/**
 * Read seat yaml/json under `teams/`, `workers/`, and `agents/` and emit
 * today's Agent + worker flow for each. Files without name+persona are
 * skipped (roster metadata is not a seat).
 */
export function loadSeatTree(root: string): LoadedSeats {
  const seats: SeatConfig[] = [];
  const skipped: SkippedFile[] = [];
  const seen = new Set<string>();

  for (const file of walkFiles(root)) {
    const rel = relative(root, file);
    let raw: unknown;
    try {
      raw = parseFile(file);
    } catch (err) {
      skipped.push({ path: rel, reason: `parse failed: ${(err as Error).message}` });
      continue;
    }
    const parsed = seatFileSchema.safeParse(raw);
    if (!parsed.success) {
      skipped.push({
        path: rel,
        reason: "not a seat (need name + description + persona) — roster metadata stays metadata"
      });
      continue;
    }
    if (seen.has(parsed.data.name)) {
      skipped.push({ path: rel, reason: `duplicate seat name "${parsed.data.name}"` });
      continue;
    }
    seen.add(parsed.data.name);
    seats.push(parsed.data);
  }

  const agents = seats.map(seatToAgent);
  const flows = seats.map(seatToWorkerFlow);
  return { seats, agents, flows, skipped };
}
