# obsidian-operator on Codex CLI

How obsidian-operator's 19 skills work on OpenAI Codex CLI. For install, see the [Quick Start](../README.md#quick-start) in the main README.

## How discovery works

Obsidian Operator ships as a Codex plugin (v2.0.0+). After `codex plugin marketplace add yuhanwang14/obsidian-operator` and enabling via `/plugin` inside the Codex TUI, Codex routes by each SKILL.md's `description` frontmatter:

- `/daily-init 6` → matches `daily-init` description's slash trigger
- "start my day" → matches `daily-init` description's natural-language phrase
- "scan arxiv today" → matches `daily-academic` description's natural-language phrase

Slash commands are not enforced — they're just one of several trigger patterns each skill description lists.

## Per-skill status on Codex CLI

| Skill | Status | Notes |
|---|---|---|
| `vault-init` | ✅ full | Resolves assets via plugin cache cascade |
| `daily-init` | ✅ full | Hook + Gmail connector both required for full functionality (graceful degradation if missing) |
| `weekly-init`, `weekly-review` | ✅ full | No platform-specific deps |
| `daily-github`, `daily-academic`, `ai-weekly-digest` | ✅ full | `WebSearch` / `WebFetch` are native on Codex |
| `quarterly-plan`, `annual-vision` | ✅ full | osascript runs on macOS regardless of platform |
| `meeting`, `meeting-prep` | ✅ full | Bash transcription script, osascript |
| `project-init`, `project-sync`, `deadline-plan` | ✅ full | No platform-specific deps |
| `add-events` | ✅ full | osascript |
| `deep-research` | ⚠️ requires `multi_agent` feature flag | Falls back to sequential if not enabled |
| `content-extract` | ⚠️ requires Gmail connector for newsletter step | Skips silently if missing, continues with vault sources |
| `content-draft`, `link-enrich` | ✅ full | No platform-specific deps |
| `using-obsidian-operator` | ✅ full | Reference container only |

## Optional configuration

Two optional platform integrations:

- **Gmail connector** (for `/daily-init` email section and `/content-extract` newsletter step): Codex ships an official Gmail connector — enable `gmail@openai-curated` in Codex's plugin manager. No third-party MCP needed.
- **`/deep-research` parallel agents**: Add `[features] multi_agent = true` to `~/.codex/config.toml`. If missing, the `deep-research-enforce.sh` hook emits a one-line notice at runtime and falls back to sequential thread execution.

## Cross-platform tool mapping

Skills are written in Claude Code vocabulary. Codex CLI's agent maps automatically for most cases (file ops, shell, web search). For dispatch primitives (`deep-research`'s parallel agents) see:

- `plugins/obsidian-operator/skills/using-obsidian-operator/references/codex-tools.md`

## Why Codex App is not supported

Codex App runs agents in `$CODEX_HOME/worktrees/...` with a Seatbelt sandbox: no `git checkout -b`, no `git push`, no network on macOS, no user-configurable hooks. obsidian-operator's daily-vault-edit use case requires:

- A persistent vault (not a per-task worktree)
- Network for Gmail OAuth + arXiv / GitHub fetches
- The `UserPromptSubmit` hook for boundary-cascade enforcement

None of these survive in the App's sandbox. If you absolutely need vault automation in App, run only read-only skills (`/link-enrich scan`, `/weekly-review`) from a vault repo — but this is not a supported configuration.

## Maintaining vault `CLAUDE.md` and `AGENTS.md`

`vault-init` Step 4 copies both files into your vault root. They start with identical content. **If you customize `CLAUDE.md`** (e.g. updating the Customization table), copy the same edit into `AGENTS.md` to keep them in sync. Drift between the two means Claude Code and Codex CLI agents will see different vault config.

A future `vault-init --check` mode could detect drift; not implemented yet.

## Troubleshooting

### Skills not appearing

Check that the plugin is installed and enabled:

```bash
grep -A1 'obsidian-operator' ~/.codex/config.toml
# Expected: [plugins."obsidian-operator@..."] enabled = true
```

If missing, run `codex plugin marketplace add yuhanwang14/obsidian-operator`, then `codex` and `/plugin` to enable.

### Hook not firing on `/daily-init`

```bash
# Resolve plugin cache path (varies by version):
PLUGIN_DIR=$(ls -d ~/.codex/plugins/cache/obsidian-operator/obsidian-operator/*/plugins/obsidian-operator 2>/dev/null | sort -V | tail -1)
echo '{"hook_event_name":"UserPromptSubmit","prompt":"/daily-init"}' \
  | bash "$PLUGIN_DIR/hooks/preflight-enforce.sh"
```

Should output JSON containing `hookSpecificOutput.additionalContext` if any boundary artifact is missing in your vault.

### `/deep-research` running sequentially

Verify `~/.codex/config.toml` contains:
```toml
[features]
multi_agent = true
```
Restart Codex after editing.

## Upgrading from v1.9.x manual install

If you previously followed `.codex/INSTALL.md` (clone + symlink + manual hook registration), clean up before adopting v2.0.0:

```bash
rm ~/.agents/skills/obsidian-operator                         # stale skill discovery symlink
# remove the old obsidian-operator entry from ~/.codex/hooks.json (manual)
# (optional) rm -rf ~/.codex/obsidian-operator                 # old clone path
```

Then install via the new flow:

```bash
codex plugin marketplace add yuhanwang14/obsidian-operator
codex
> /plugin           # toggle obsidian-operator on in the plugin manager
```
