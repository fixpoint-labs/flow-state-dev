/**
 * Proposed readers over this example's disk tree.
 *
 * They walk files. They do not compile to `defineFlow({ schedules, webhooks })`.
 * They do not import a seat folder as a TypeScript module (FIX-1342).
 *
 * `parseFrontmatterYaml` is today's WORKER.md dialect — the same parser hire
 * already uses — applied to TRANSPORT.md, event files, and the special YAML
 * files in a seat folder.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseFrontmatterYaml,
  splitFrontmatter,
} from "@flow-state-dev/orchestration";

export const EXAMPLE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export interface EventKind {
  /** `{transport}.{event-file-stem}` — the id a seat folder may reference. */
  id: string;
  transport: string;
  path: string;
  description?: string;
  header?: string;
  when?: string;
}

export interface TransportRecord {
  id: string;
  path: string;
  source: string;
  provider?: string;
  description?: string;
  events: EventKind[];
}

export interface HookRef {
  event?: string;
  leftover?: string;
  run?: string;
  session?: string;
  reason?: string;
}

export interface SeatWake {
  id: string;
  kind: "worker" | "channel";
  path: string;
  flow?: string;
  description?: string;
  /** Simple frontmatter phrase, e.g. `every 4 hours`. */
  wake?: string;
  /** Special-file clock in the same folder. */
  schedule?: {
    every?: string;
    cron?: string;
    run?: string;
    session?: string;
  };
  hooks: HookRef[];
}

export interface WalkLeftover {
  seat: string;
  ref: string;
  reason: string;
}

export interface WalkResult {
  transports: TransportRecord[];
  catalog: EventKind[];
  seats: SeatWake[];
  leftovers: WalkLeftover[];
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

async function readMarkdown(filePath: string): Promise<{
  declared: Record<string, unknown>;
  body: string;
}> {
  const text = await readFile(filePath, "utf8");
  const { yaml, body } = splitFrontmatter(text);
  return { declared: parseFrontmatterYaml(yaml), body };
}

async function readYamlFile(
  filePath: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const text = await readFile(filePath, "utf8");
    return parseFrontmatterYaml(text);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function listDirs(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function listFiles(dir: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

function hookList(raw: Record<string, unknown> | undefined): HookRef[] {
  const on = raw?.on;
  if (!Array.isArray(on)) return [];
  return on.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const rec = row as Record<string, unknown>;
    return [
      {
        event: asString(rec.event),
        leftover: asString(rec.leftover),
        run: asString(rec.run),
        session: asString(rec.session),
        reason: asString(rec.reason),
      },
    ];
  });
}

export async function readTransportRegistry(
  root: string = EXAMPLE_ROOT,
): Promise<TransportRecord[]> {
  const transportsRoot = path.join(root, "transports");
  const ids = await listDirs(transportsRoot);
  const transports: TransportRecord[] = [];

  for (const id of ids) {
    const folder = path.join(transportsRoot, id);
    const manifestPath = path.join(folder, "TRANSPORT.md");
    let declared: Record<string, unknown> = {};
    try {
      declared = (await readMarkdown(manifestPath)).declared;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    const eventFiles = await listFiles(path.join(folder, "events"), ".md");
    const events: EventKind[] = [];
    for (const fileName of eventFiles) {
      const eventPath = path.join(folder, "events", fileName);
      const { declared: eventDeclared } = await readMarkdown(eventPath);
      const stem = fileName.replace(/\.md$/, "");
      events.push({
        id: `${id}.${stem}`,
        transport: id,
        path: path.relative(root, eventPath),
        description: asString(eventDeclared.description),
        header: asString(eventDeclared.header),
        when: asString(eventDeclared.when),
      });
    }

    transports.push({
      id,
      path: path.relative(root, folder),
      source: asString(declared.source) ?? "unknown",
      provider: asString(declared.provider),
      description: asString(declared.description),
      events,
    });
  }

  return transports;
}

async function readSeatFolder(
  root: string,
  kind: "worker" | "channel",
  id: string,
  folder: string,
  manifestName: string,
): Promise<SeatWake | undefined> {
  const manifestPath = path.join(folder, manifestName);
  let declared: Record<string, unknown>;
  try {
    declared = (await readMarkdown(manifestPath)).declared;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }

  const schedule =
    (await readYamlFile(path.join(folder, "schedule.yaml"))) ??
    (await readYamlFile(path.join(folder, "schedule.json")));
  const hooks = hookList(await readYamlFile(path.join(folder, "hooks.yaml")));

  return {
    id,
    kind,
    path: path.relative(root, folder),
    flow: asString(declared.flow),
    description: asString(declared.description),
    wake: asString(declared.wake),
    schedule: schedule
      ? {
          every: asString(schedule.every),
          cron: asString(schedule.cron),
          run: asString(schedule.run),
          session: asString(schedule.session),
        }
      : undefined,
    hooks,
  };
}

export async function readSeatWakes(
  root: string = EXAMPLE_ROOT,
): Promise<SeatWake[]> {
  const seats: SeatWake[] = [];

  for (const id of await listDirs(path.join(root, "workers"))) {
    const seat = await readSeatFolder(
      root,
      "worker",
      id,
      path.join(root, "workers", id),
      "WORKER.md",
    );
    if (seat) seats.push(seat);
  }

  for (const id of await listDirs(path.join(root, "channels"))) {
    const seat = await readSeatFolder(
      root,
      "channel",
      id,
      path.join(root, "channels", id),
      "CHANNEL.md",
    );
    if (seat) seats.push(seat);
  }

  return seats;
}

export async function walkConvention(
  root: string = EXAMPLE_ROOT,
): Promise<WalkResult> {
  const transports = await readTransportRegistry(root);
  const catalog = transports.flatMap((transport) => transport.events);
  const catalogIds = new Set(catalog.map((event) => event.id));
  const seats = await readSeatWakes(root);
  const leftovers: WalkLeftover[] = [];

  for (const seat of seats) {
    for (const hook of seat.hooks) {
      if (hook.leftover) {
        leftovers.push({
          seat: seat.id,
          ref: hook.leftover,
          reason: hook.reason ?? "marked leftover",
        });
        continue;
      }
      if (hook.event && !catalogIds.has(hook.event)) {
        leftovers.push({
          seat: seat.id,
          ref: hook.event,
          reason: "not in the transport event catalog",
        });
      }
    }
  }

  return { transports, catalog, seats, leftovers };
}

export function formatWalk(result: WalkResult): string {
  const lines: string[] = [];
  lines.push("Event catalog (registered by transports/*/events/)");
  for (const event of result.catalog) {
    lines.push(`  ${event.id}  ← ${event.path}`);
  }
  lines.push("");
  lines.push("Seat wakes (worker/channel folder is the locus)");
  for (const seat of result.seats) {
    const clock = seat.wake
      ? `wake: ${seat.wake}`
      : seat.schedule?.every
        ? `schedule.yaml: every ${seat.schedule.every}`
        : "no clock";
    lines.push(`  ${seat.kind} ${seat.id}  (${clock})`);
    if (seat.schedule?.run) {
      lines.push(`    run ${seat.schedule.run}  session ${seat.schedule.session ?? "?"}`);
    }
    for (const hook of seat.hooks) {
      if (hook.leftover) {
        lines.push(`    leftover ${hook.leftover}`);
        continue;
      }
      const known = result.catalog.some((event) => event.id === hook.event);
      lines.push(
        `    on ${hook.event} → ${hook.run ?? "?"}  session ${hook.session ?? "?"}  ${known ? "catalog" : "UNKNOWN"}`,
      );
    }
  }
  lines.push("");
  lines.push("Leftovers (not a registered transport event)");
  if (result.leftovers.length === 0) {
    lines.push("  (none)");
  } else {
    for (const leftover of result.leftovers) {
      lines.push(`  ${leftover.seat}: ${leftover.ref} — ${leftover.reason}`);
    }
  }
  return lines.join("\n");
}
