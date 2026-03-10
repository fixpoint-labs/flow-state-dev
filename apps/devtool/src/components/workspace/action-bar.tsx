import { useState, useCallback } from "react";
import { Send, Loader2, Bug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDevTool } from "@/context/devtool-context";
import { useDebug } from "@/context/debug-context";
import { readLastAction, writeLastAction } from "@/config";

type ActionBarProps = {
  flowKind: string | null;
  sessionId: string | null;
  availableActions: string[];
  onSendAction: (action: string, input: unknown) => Promise<void>;
  isSending: boolean;
};

export function ActionBar({ flowKind, sessionId, availableActions, onSendAction, isSending }: ActionBarProps) {
  const { isDebugMode, toggleDebugMode } = useDebug();
  const [selectedAction, setSelectedAction] = useState<string>(() => {
    if (!flowKind) return availableActions[0] ?? "";
    return readLastAction(flowKind) ?? availableActions[0] ?? "";
  });
  const [jsonInput, setJsonInput] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);

  const handleActionChange = (action: string) => {
    setSelectedAction(action);
    if (flowKind) writeLastAction(flowKind, action);
  };

  const handleSend = useCallback(async () => {
    if (!selectedAction || !flowKind || !sessionId) return;
    try {
      const parsed = JSON.parse(jsonInput);
      setJsonError(null);
      await onSendAction(selectedAction, parsed);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setJsonError(err.message);
      }
    }
  }, [selectedAction, flowKind, sessionId, jsonInput, onSendAction]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      void handleSend();
    }
  };

  const disabled = !flowKind || !sessionId || isSending;

  return (
    <div className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-900/40 p-2">
      <select
        className="h-8 rounded border border-slate-800 bg-slate-950 px-2 text-xs text-slate-300 outline-none"
        value={selectedAction}
        onChange={(e) => handleActionChange(e.target.value)}
        disabled={disabled}
      >
        {availableActions.length === 0 && <option value="">No actions</option>}
        {availableActions.map((a) => (
          <option key={a} value={a}>{a}</option>
        ))}
      </select>

      <div className="relative flex-1">
        <Input
          className={`h-8 font-mono text-xs ${jsonError ? "border-red-500" : ""}`}
          value={jsonInput}
          onChange={(e) => { setJsonInput(e.target.value); setJsonError(null); }}
          onKeyDown={handleKeyDown}
          placeholder='{"key": "value"}'
          disabled={disabled}
        />
        {jsonError && (
          <div className="absolute left-0 top-full mt-1 rounded bg-red-950 border border-red-800 px-2 py-1 text-[10px] text-red-400 z-20">
            {jsonError}
          </div>
        )}
      </div>

      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8"
        onClick={handleSend}
        disabled={disabled}
        aria-label="Send action"
      >
        {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
      </Button>

      <Button
        size="icon"
        variant={isDebugMode ? "default" : "ghost"}
        className="h-8 w-8"
        onClick={toggleDebugMode}
        title="Debug Mode"
      >
        <Bug className="h-4 w-4" />
      </Button>
    </div>
  );
}
