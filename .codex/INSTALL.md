# Installing obsidian-operator for Codex CLI

Enable obsidian-operator's 19 skills in Codex CLI via native skill discovery + hook + MCP.

## Prerequisites

- Codex CLI installed
- Git
- Obsidian vault (existing or empty)

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/yuhanwang14/obsidian-operator.git ~/.codex/obsidian-operator
```

### 2. Symlink skills for discovery

```bash
mkdir -p ~/.agents/skills
ln -s ~/.codex/obsidian-operator/skills ~/.agents/skills/obsidian-operator
```

Codex scans `~/.agents/skills/` at startup, parses each SKILL.md frontmatter, and routes by `description`.

### 3. Register the pre-flight hooks

obsidian-operator ships two `UserPromptSubmit` hooks:

- `preflight-enforce.sh` — checks for missing weekly review / monthly pulse / quarterly review when `/daily-init` is invoked.
- `deep-research-enforce.sh` — enforces parallel agent dispatch (Step 4) when `/deep-research` is invoked, preventing silent main-thread research drift.

Without these hooks, both behaviors fall back to text-level enforcement (weaker; see "Known limitation" below).

Add to your `~/.codex/hooks.json` (create if missing — merge with existing hooks if present):

```json
{
  "hooks": {
    "UserPromptSubmit": [{
      "hooks": [
        {
          "type": "command",
          "command": "bash $HOME/.codex/obsidian-operator/hooks/preflight-enforce.sh",
          "timeout": 5000
        },
        {
          "type": "command",
          "command": "bash $HOME/.codex/obsidian-operator/hooks/deep-research-enforce.sh",
          "timeout": 3000
        }
      ]
    }]
  }
}
```

If `~/.codex/hooks.json` already exists with other hooks, merge by adding the inner `hooks` array entries rather than replacing the file.

### 4. Enable multi-agent feature (for `/deep-research`)

`/deep-research` dispatches parallel research agents. Add to `~/.codex/config.toml`:

```toml
[features]
multi_agent = true
```

If you skip this step, `/deep-research` falls back to sequential thread execution (slower).

### 5. Configure Gmail MCP (optional, for `/daily-init` email integration)

Pick one of three Gmail MCP servers and add it to `~/.codex/config.toml`. See `~/.codex/obsidian-operator/skills/using-obsidian-operator/references/codex-mcp.md` for full options. Quick example (Google Workspace MCP):

```toml
[mcp_servers.google_workspace]
command = "uvx"
args = ["google-workspace-mcp"]
```

Without a Gmail MCP, `/daily-init` skips the email section and logs a `### Flags` warning.

### 6. Restart Codex

Quit and relaunch the Codex CLI to pick up the symlinked skills, hook, and config changes.

## Verify

```bash
ls -la ~/.agents/skills/obsidian-operator           # symlink resolves
ls ~/.codex/obsidian-operator/skills | wc -l        # 20 (19 existing + 1 bootstrap)
```

In a fresh Codex session, run:

```
> /vault-init
```

If skills loaded correctly, vault-init activates and walks through vault setup.

## Known limitation: Pre-flight hook fallback

If you skip step 3 (hook registration), two enforcement behaviors fall back to in-skill text instructions:

- `/daily-init` boundary checks (last week's review, last month's pulse, last quarter's review). Empirical regression observed in April 2026 with Claude Code before the hook was introduced (v1.7.9).
- `/deep-research` Step 4 parallel dispatch. Empirical regression observed 2026-05-02 with Codex CLI — agent ran ~10 main-thread web searches without any `spawn_agent` calls and without the documented sequential-fallback notice. Fixed in v1.9.1.

The hooks in step 3 are the harness-level enforcement that prevent these.

## Updating

```bash
cd ~/.codex/obsidian-operator && git pull
```

Skills update instantly through the symlink. Hook script updates the same way.

## Uninstalling

```bash
rm ~/.agents/skills/obsidian-operator
# remove the obsidian-operator entry from ~/.codex/hooks.json
# (optional) remove the [mcp_servers.*] entry from ~/.codex/config.toml
# (optional) rm -rf ~/.codex/obsidian-operator
```
