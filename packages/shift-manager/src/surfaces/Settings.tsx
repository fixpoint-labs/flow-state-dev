/**
 * Settings (`/settings`): the user's own keys for the MCP servers the Lab
 * offers. Each server shows *set* with when, or *not set*; a password field
 * sets or replaces the key, and Clear removes it.
 *
 * Write-only: the page never reads a key back, and the field empties once the
 * Lab has taken it. A key is the user's alone. A coding run on a project that
 * names the server reaches it with the key of the user the run works for.
 */
import { useCallback, useEffect, useState } from "react";
import { EmptyState, SectionFailure } from "../components/ui";
import { useLab } from "../lib/lab-data";
import { readMcpKeys, writeMcpKey, type McpKeysRead, type McpServerKey } from "../lib/mcp-credentials";
import type { Failure } from "../lib/reads";

export function SettingsView() {
  const { connection } = useLab();
  const [read, setRead] = useState<McpKeysRead | undefined>(undefined);
  const reread = useCallback(() => {
    void readMcpKeys(connection).then(setRead);
  }, [connection]);
  useEffect(reread, [reread]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" data-testid="settings">
      <header className="px-4 pt-3">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">SETTINGS</p>
        <h1 className="text-base font-semibold">MCP server keys</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          A coding run on a project that names one of these servers reaches it with the key of the user the run works
          for. Your keys are yours: nobody else's runs use them. Once a key is set, this page never shows it again.
        </p>
      </header>
      <div className="p-4">
        {read === undefined ? (
          <p className="text-sm text-muted-foreground">Reading your keys…</p>
        ) : "none" in read ? (
          <EmptyState title="No MCP servers" testId="settings-none">
            This Lab offers no MCP servers, so there is no key to set.
          </EmptyState>
        ) : "failure" in read ? (
          <SectionFailure what="Your keys" failure={read.failure} onRetry={reread} testId="settings-failure" />
        ) : (
          <ul className="max-w-2xl divide-y border" data-testid="mcp-keys">
            {read.servers.map((server) => (
              <ServerKey key={server.name} server={server} onChanged={reread} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** One server: whether the key is set, a field to set or replace it, and Clear. */
function ServerKey({ server, onChanged }: { server: McpServerKey; onChanged: () => void }) {
  const { connection } = useLab();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<Failure | undefined>(undefined);

  const write = async (value: string | null) => {
    setBusy(true);
    setRefused(undefined);
    const failure = await writeMcpKey(connection, server.name, value);
    setBusy(false);
    if (failure !== undefined) return setRefused(failure);
    setDraft("");
    onChanged();
  };

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5" data-testid="mcp-key" data-server={server.name} data-set={server.setAt !== null}>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-sm font-semibold">{server.name}</span>
        <span className="text-xs text-muted-foreground" data-testid="mcp-key-status">
          {server.setAt === null ? "not set" : `set · ${new Date(server.setAt).toLocaleString()}`}
        </span>
      </div>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (draft !== "") void write(draft);
        }}
      >
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={server.setAt === null ? "Your key" : "A new key, to replace yours"}
          aria-label={`Key for ${server.name}`}
          className="min-w-0 flex-1 border bg-background px-2 py-1 font-mono text-sm"
          data-testid="mcp-key-input"
        />
        <button type="submit" disabled={busy || draft === ""} className="border px-3 py-1 text-sm disabled:opacity-50" data-testid="mcp-key-save">
          {server.setAt === null ? "Set" : "Replace"}
        </button>
        {server.setAt === null ? null : (
          <button type="button" disabled={busy} onClick={() => void write(null)} className="border px-3 py-1 text-sm disabled:opacity-50" data-testid="mcp-key-clear">
            Clear
          </button>
        )}
      </form>
      {refused === undefined ? null : (
        <p className="text-xs text-destructive" role="alert" data-testid="mcp-key-refused">
          {refused.message}
        </p>
      )}
    </li>
  );
}
