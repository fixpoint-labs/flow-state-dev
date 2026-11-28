/**
 * `<StorageSizeReadout />`: the header's store-size readout ("DB 42.3 MB"), with the
 * store kind and what was measured in its tooltip.
 *
 * Reads `GET /api/flows/debug/storage` (`client.debug.storage()`) on mount,
 * when the DevTool regains focus, and once a minute while open. Renders
 * nothing when the store can't measure itself (`storage: null`), when the
 * debug gate is closed, or when the read fails: no reading is better than a
 * made-up one, and a header readout is no place for an error.
 */
import { useCallback, useEffect, useState } from "react";
import type { DebugStorageResponse } from "@flow-state-dev/client";
import { useDevTool } from "../../context/devtool-context";
import { useFocusRevalidate } from "../../hooks/use-focus-revalidate";
import { usePoll } from "../../hooks/use-poll";
import { formatBytes } from "../../lib/utils";

/** Gap between reads while the DevTool stays open. A size moves slowly. */
const REFRESH_MS = 60_000;

type Reading = NonNullable<DebugStorageResponse["storage"]>;

export function StorageSizeReadout() {
  const { client } = useDevTool();
  const [reading, setReading] = useState<Reading | null>(null);

  const read = useCallback(async () => {
    try {
      setReading((await client.debug.storage()).storage);
    } catch {
      setReading(null);
    }
  }, [client]);

  useEffect(() => {
    void read();
  }, [read]);
  useFocusRevalidate(() => void read());
  usePoll(true, read, REFRESH_MS);

  if (reading === null) return null;
  const title = [`Store: ${reading.kind}`, reading.location, `${reading.bytes.toLocaleString()} bytes`]
    .filter((line) => line !== undefined)
    .join("\n");
  return (
    <span
      data-testid="storage-size"
      title={title}
      className="shrink-0 whitespace-nowrap font-fs-mono text-[11px] font-medium text-fs-ink3"
    >
      <span className="text-fs-ink4">DB</span> {formatBytes(reading.bytes)}
    </span>
  );
}
