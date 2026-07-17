/**
 * Sidebar settings sheet. The userId editor is only rendered when the panel
 * owns userId (`userIdControl === "internal"`); embedded hosts pass
 * `userIdControl="host"` so identity stays at the host level.
 */
import { useState } from "react";
import { Settings, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { useDevTool } from "../../context/devtool-context";

export function SettingsSheet() {
  const { config, setConfig, userIdControl } = useDevTool();
  const [open, setOpen] = useState(false);
  const [userId, setUserId] = useState(config.userId);
  const [bearerToken, setBearerToken] = useState(config.bearerToken ?? "");

  const handleSave = () => {
    // Preserve both fields — saving only userId would drop a config-injected token.
    setConfig({ userId, bearerToken: bearerToken.trim() ? bearerToken.trim() : undefined });
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        className="flex w-full items-center gap-2 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800/60 rounded"
        onClick={() => setOpen(true)}
      >
        <Settings className="h-3.5 w-3.5" />
        <span>Settings</span>
      </button>
    );
  }

  const showUserIdField = userIdControl === "internal";

  return (
    <div className="rounded-md border border-slate-800 bg-slate-900 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">Settings</span>
        <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => setOpen(false)}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      {showUserIdField ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="settings-user" className="text-[10px]">User ID</Label>
            <Input
              id="settings-user"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="settings-bearer" className="text-[10px]">Bearer token</Label>
            <Input
              id="settings-bearer"
              type="password"
              value={bearerToken}
              placeholder="for bearer-gated flows"
              onChange={(e) => setBearerToken(e.target.value)}
              className="h-7 text-xs"
            />
          </div>
          <Button size="sm" className="h-7 w-full text-xs" onClick={handleSave}>
            Save
          </Button>
        </>
      ) : (
        <p className="text-[10px] text-slate-500">
          User ID is owned by the host application.
        </p>
      )}
    </div>
  );
}
