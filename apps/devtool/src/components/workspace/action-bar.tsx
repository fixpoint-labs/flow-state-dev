import { useState, useCallback, useEffect } from "react";
import { Send, Loader2, Bug } from "lucide-react";
import type { ActionInputSchema } from "@flow-state-dev/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebug } from "@/context/debug-context";
import { readLastAction, writeLastAction } from "@/config";
import { SchemaForm } from "./schema-form";

type ActionBarProps = {
  flowKind: string | null;
  sessionId: string | null;
  availableActions: string[];
  actionSchemas?: Record<string, ActionInputSchema>;
  onSendAction: (action: string, input: unknown) => Promise<void>;
  isSending: boolean;
};

function getDefaults(schema: ActionInputSchema | undefined): Record<string, unknown> {
  if (!schema || schema.type !== "object") return {};
  const defaults: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    if (field.default !== undefined) {
      defaults[key] = field.default;
    } else if (field.type === "enum" && field.enumValues?.length) {
      defaults[key] = field.enumValues[0];
    }
  }
  return defaults;
}

function isRenderable(schema: ActionInputSchema | undefined): boolean {
  return schema !== undefined && schema.type === "object" && Object.keys(schema.fields).length > 0;
}

function buildInputFromForm(
  schema: ActionInputSchema,
  values: Record<string, unknown>
): unknown {
  if (schema.type !== "object") return values;
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema.fields)) {
    const val = values[key];
    // Omit undefined optional fields
    if (val === undefined || val === "") {
      if (!field.required && field.default === undefined) continue;
      // Include empty string for required string fields (server will validate)
      if (field.type === "string" && val === "") {
        result[key] = val;
        continue;
      }
      if (field.default !== undefined) continue; // let server apply default
      continue;
    }
    result[key] = val;
  }
  return result;
}

export function ActionBar({
  flowKind,
  sessionId,
  availableActions,
  actionSchemas,
  onSendAction,
  isSending
}: ActionBarProps) {
  const { isDebugMode, toggleDebugMode } = useDebug();

  const [selectedAction, setSelectedAction] = useState<string>("");
  const [jsonInput, setJsonInput] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [formValues, setFormValues] = useState<Record<string, unknown>>({});
  const [inputMode, setInputMode] = useState<"form" | "json">("json");

  // Sync selectedAction when availableActions arrive or flow changes
  useEffect(() => {
    if (availableActions.length === 0) {
      setSelectedAction("");
      return;
    }
    const persisted = flowKind ? readLastAction(flowKind) : null;
    const target = persisted && availableActions.includes(persisted)
      ? persisted
      : availableActions[0];
    setSelectedAction(target);
  }, [availableActions, flowKind]);

  // Derive current schema reactively
  const currentSchema = actionSchemas?.[selectedAction];
  const hasForm = isRenderable(currentSchema);

  // Reset form values and mode when action+schema pair changes
  useEffect(() => {
    if (!selectedAction) return;
    const schema = actionSchemas?.[selectedAction];
    const renderable = isRenderable(schema);
    const defaults = getDefaults(schema);
    setFormValues(defaults);
    setInputMode(renderable ? "form" : "json");
    setJsonInput(renderable ? JSON.stringify(defaults, null, 2) : "{}");
  }, [selectedAction, actionSchemas]);

  // Sync form ↔ JSON when toggling modes
  const handleModeChange = useCallback((mode: string) => {
    if (mode === "json" && inputMode === "form") {
      const input = buildInputFromForm(currentSchema!, formValues);
      setJsonInput(JSON.stringify(input, null, 2));
    } else if (mode === "form" && inputMode === "json") {
      try {
        const parsed = JSON.parse(jsonInput);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          setFormValues({ ...getDefaults(currentSchema), ...parsed });
        }
      } catch {
        // Keep existing form values on parse failure
      }
    }
    setInputMode(mode as "form" | "json");
  }, [inputMode, formValues, jsonInput, currentSchema]);

  const handleActionChange = (action: string) => {
    setSelectedAction(action);
    if (flowKind) writeLastAction(flowKind, action);
  };

  const handleSend = useCallback(async () => {
    if (!selectedAction || !flowKind || !sessionId) return;
    try {
      let input: unknown;
      if (inputMode === "json") {
        input = JSON.parse(jsonInput);
      } else {
        input = buildInputFromForm(currentSchema!, formValues);
      }
      setJsonError(null);
      await onSendAction(selectedAction, input);
    } catch (err) {
      if (err instanceof SyntaxError) {
        setJsonError(err.message);
      }
    }
  }, [selectedAction, flowKind, sessionId, inputMode, jsonInput, formValues, currentSchema, onSendAction]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !isSending) {
      e.preventDefault();
      void handleSend();
    }
  };

  const disabled = !flowKind || !sessionId || isSending;

  return (
    <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/40 p-2">
      {/* Row 1: Action selector + Form/JSON toggle + Send + Debug */}
      <div className="flex items-center gap-2">
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

        {hasForm && (
          <Tabs value={inputMode} onValueChange={handleModeChange} className="flex-none">
            <TabsList className="h-7">
              <TabsTrigger value="form" className="px-2 text-xs h-6">Form</TabsTrigger>
              <TabsTrigger value="json" className="px-2 text-xs h-6">JSON</TabsTrigger>
            </TabsList>
          </Tabs>
        )}

        <div className="flex-1" />

        <Button
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-3"
          onClick={handleSend}
          disabled={disabled}
          aria-label="Send action"
        >
          {isSending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          <span className="text-xs">Send Action</span>
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

      {/* Row 2: Input area */}
      {inputMode === "json" ? (
        <div className="relative">
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
      ) : currentSchema ? (
        <SchemaForm
          schema={currentSchema}
          values={formValues}
          onChange={setFormValues}
          disabled={disabled}
          onSubmit={handleSend}
        />
      ) : null}
    </div>
  );
}
