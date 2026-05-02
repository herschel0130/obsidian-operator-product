#!/bin/bash
# obsidian-operator/hooks/deep-research-enforce.sh
# Hook event: UserPromptSubmit (auto-registered via hooks/hooks.json on plugin install)
#
# When the user invokes /deep-research (or natural-language equivalents), this script
# injects a <system-reminder>-tagged additionalContext that forces the agent to follow
# Step 4 of the deep-research skill (parallel agent dispatch) instead of silently
# running web searches on the main thread.
#
# Regression history: 2026-05-02. Codex CLI invoked /deep-research via natural-language
# trigger, announced it would follow the skill, then ran ~10 main-thread web searches
# without any spawn_agent calls and without emitting the documented sequential-fallback
# notice. Same class of silent-skip drift previously seen with /daily-init pre-flight.
# Fixed in v1.9.1 with this hook (harness-level enforcement) + Step 4 STOP gate in
# skills/deep-research/SKILL.md (in-skill belt-and-suspenders).

set -uo pipefail

# Read hook input from stdin (Claude Code / Codex CLI pass JSON)
input="$(cat 2>/dev/null || echo '{}')"

# Extract event name + user message (defensive — exit clean on any parse failure)
event=$(printf '%s' "$input" | jq -r '.hook_event_name // empty' 2>/dev/null || echo "")
user_msg=$(printf '%s' "$input" | jq -r '.prompt // .user_input // .user_message // empty' 2>/dev/null || echo "")

# Only act on UserPromptSubmit
[ "$event" = "UserPromptSubmit" ] || exit 0

# Filter: only fire on /deep-research or close natural-language equivalents.
# Mirror the trigger phrases in the skill's frontmatter description.
if ! printf '%s' "$user_msg" | grep -qiE '/deep-research|deep[ -]research|deep dive|comprehensive research|multi-angle research|research brief'; then
  exit 0
fi

# Build the system-reminder
reminder=$(cat <<'EOF'
<system-reminder>
DEEP-RESEARCH STEP 4 ENFORCEMENT (obsidian-operator hooks/deep-research-enforce.sh, plugin v1.9.1+)

You are about to run /deep-research. Step 4 (parallel agent dispatch) is MANDATORY and CANNOT be silently skipped.

Required behavior:
1. Decompose the brief into 3-5 parallel research threads.
2. Dispatch ALL threads in a SINGLE message:
   - Claude Code: multiple `Agent` tool calls in one message, model: "opus" each.
   - Codex CLI: `spawn_agent(agent_type="worker", message=...)` for each thread, then `wait` to collect, then `close_agent` per agent.

Codex CLI fallback (only if `spawn_agent` errors because `[features] multi_agent = true` is missing in `~/.codex/config.toml`):
- Emit this exact one-line notice BEFORE the sequential research begins:
  "Running threads sequentially — enable [features] multi_agent = true in ~/.codex/config.toml for parallel."
- Then run the threads sequentially in the parent agent.

VIOLATIONS (do not do these):
- Running WebSearch / WebFetch yourself on the main thread instead of dispatching agents.
- Skipping the fallback notice when running sequentially.
- "Saving tokens" by collapsing 3-5 threads into one main-thread research pass.

Skip Step 4 ONLY if the user explicitly says "no parallel agents", "do it yourself", or similar.
</system-reminder>
EOF
)

# Emit JSON via jq (handles escaping cleanly)
jq -n --arg ctx "$reminder" '{
  hookSpecificOutput: {
    hookEventName: "UserPromptSubmit",
    additionalContext: $ctx
  }
}'

exit 0
