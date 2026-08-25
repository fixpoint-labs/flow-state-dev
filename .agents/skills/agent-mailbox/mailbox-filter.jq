# Selects the mailbox comments that should wake this session, and drops the rest.
#
# Input:  the GitHub issue-comments array for one handle PR.
# Args:   $me        — this session's `from:` handle (e.g. "fsd-claude")
#         $mysession — this session's `session:` label (e.g. "b")
#         $since     — high-water comment id; anything at or below it was already seen
# Output: the qualifying messages, header parsed out.
#
# A comment is dropped unless it is mail addressed to us: bots and headerless
# comments are not mail, our own posts echo back to us, and a `to:` naming someone
# else is a message we are only a bystander to. Everything dropped here is a wake
# that never happens.
#
# Header fields are read by splitting the header block into lines and anchoring each
# one at string start. Do NOT rewrite these as multiline `^...$` regexes: jq's
# Oniguruma build does not anchor `^`/`$` at line boundaries, so those match only the
# very first field and every later one reads as absent.

# The lines before the first blank line. Leading blank lines are tolerated; a `to:`
# quoted in the message body is not, which is the point of bounding it.
def hdrblock:
  (.body // "") | gsub("\r"; "") | sub("^\\s*\n"; "")
  | split("\n\n")[0] | split("\n") | map(sub("\\s+$"; ""));

def field($n):
  [hdrblock[] | select(test("^[ \t]*" + $n + "[ \t]*:"; "i"))]
  | if length > 0
    then (.[0] | sub("^[ \t]*" + $n + "[ \t]*:[ \t]*"; ""; "i") | ascii_downcase | sub("\\s+$"; ""))
    else null end;

def strip_header:
  (.body // "") | gsub("\r"; "") | sub("^\\s*\n"; "") | split("\n\n")
  | (if length > 1 then (.[1:] | join("\n\n")) else "" end)
  | gsub("\\s+"; " ") | sub("^ "; "")
  # Mark the cut rather than hiding it: the emitted line is a notification, and a
  # silently-truncated `decision` or handoff would be acted on as if complete.
  | if length > 240 then .[0:240] + " […]" else . end;

map(
  select((.id // 0) > ($since | tonumber))
  | select(((.user.login // "") | endswith("[bot]")) | not)
  | select((hdrblock[0] // "") | test("^[ \t]*from[ \t]*:"; "i"))
  | { id: .id,
      from: field("from"), session: field("session"),
      to: field("to"), kind: field("kind"),
      text: strip_header }
  | select(.from != null)
  # our own post, echoed back — `from:` alone is not enough, a peer session shares it
  | select(.from != $me or .session != $mysession)
  # addressed to someone else; no `to:` is a broadcast and always qualifies
  | select(.to == null or .to == $me)
)
