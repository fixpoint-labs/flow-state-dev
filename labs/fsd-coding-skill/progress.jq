# A bounded, stateless view of fsdev run's NDJSON. Keep the raw stream separately.
# Invoke with jq --unbuffered -c -f progress.jq; never slurp the input.
def bounded($limit):
  if type != "string" then ""
  else (if length > $limit then .[0:($limit - 1)] + "…" else . end)
    | gsub("[\r\n\t]"; " ")
  end;

def excerpt:
  if type == "string" then .
  elif type == "object" then
    if (.message | type) == "string" then .message
    elif (.error | type) == "string" then .error
    elif (.error | type) == "object" then .error.message // ""
    elif (.content | type) == "array" then
      [.content[] | select(type == "object") | .text | select(type == "string")][0] // ""
    else "[structured result]" end
  elif type == "array" then
    [.[] | select(type == "object") | .text | select(type == "string")][0] // "[structured result]"
  else "" end;

def tool_name:
  (.toolCall.name // .blockName // "tool") | bounded(80);

def tool_description:
  (.toolCall.arguments // null)
  | (if type == "string" then try fromjson catch null else . end)
  | if type == "object" then (.description // "" | bounded(160)) else "" end;

if .type == "item_added" then
  .item
  | if .type == "block_trace" and (.provenance.parentBlockInstanceId // null) == null then
      {event: "started", name: (.blockName | bounded(80))}
    elif .type == "status" then
      {event: "status", text: (.message | bounded(320))}
    elif .type == "tool_output" and .status == "in_progress" then
      {event: "tool_started", name: tool_name,
       id: (.toolCall.callId | bounded(100)), detail: tool_description}
    else empty end
elif .type == "item_done" then
  .item
  | if .type == "message" and .role == "assistant" then
      {event: "message", text: (. | excerpt | bounded(480))}
    elif .type == "tool_output" then
      (.status == "failed" or .isError == true
       or (if (.output | type) == "object" then .output.isError == true else false end)) as $failed
      | (if $failed then (.error.message // (.output | excerpt)) else "" end) as $detail
      | ({event: "tool_finished", name: tool_name,
          id: (.toolCall.callId | bounded(100)),
          status: (if $failed then "failed" else (.status // "unknown" | bounded(40)) end)}
         + (if $failed then {detail: ($detail | bounded(480))} else {} end)),
        (if $failed and ($detail | test("Claude requested permissions to [^\\r\\n]+, but you haven't granted it yet\\."; "i")) then
           {event: "tool_denied", name: tool_name,
            id: (.toolCall.callId | bounded(100)), detail: ($detail | bounded(480))}
         else empty end)
    elif .type == "error" then
      {event: "error", text: (.message | bounded(480))}
    else empty end
elif .type == "error" then
  {event: "error", text: (.message | bounded(480))}
elif .type == "flow_complete" then
  {event: "finished", durationMs: .durationMs, items: .items}
  + (if (.output | type) == "object" then
       {outcome: (.output.outcome // .output.status // "" | bounded(80)),
        claim: (.output.finalMessage // .output.failureMessage // "" | bounded(640))}
     else {} end)
else empty end
