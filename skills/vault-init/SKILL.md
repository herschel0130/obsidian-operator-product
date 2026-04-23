---
name: vault-init
description: "One-shot setup of an Obsidian vault for the Operator system. TRIGGER when the user has just installed the obsidian-operator plugin and needs to initialize a fresh vault, is asking how to 'set up my vault', 'initialize the vault', 'get started with Operator', 'bootstrap the folder structure', wants to copy the template folders, or asks what to do after installing the plugin. Also triggers on /vault-init, /setup, /init-vault, 'onboard me', 'first-time setup', or any message where the user is staring at an empty vault and doesn't know where to start. Creates the 00_Strategy/01_Execution/02_Projects/03_Thinking/04_Knowledge/05_Content folder structure, copies CLAUDE.md into the vault root, walks the user through the CLAUDE.md Customization table (vault owner name, Apple Calendar name, Reminders list, meeting paths), and optionally sets up ~/.secrets + the transcription script. NOT for creating a single project (use /project-init), initializing a day (/daily-init), or initializing a week (/weekly-init). This is the very first thing a new user runs."
version: 1.0.0
author: Yuhan Wang
license: MIT
tags: [obsidian, setup, onboarding, initialization, vault]
---

Walk the user from "just installed the plugin" to "vault is ready for /daily-init" in one conversation. The README currently spells this out as a wall of shell commands; this skill replaces that with a guided, interactive flow that actually runs the commands for them.

**CLI fallback:** If any `obsidian` CLI command fails, silently use the equivalent file tool. Do not surface CLI errors to the user — they might not have Obsidian running yet, which is fine during setup.

## What this skill replaces

The Quick Start + Configuration sections of the README (`cp -r vault-template/*`, `cp CLAUDE.md`, editing the Customization table, writing `~/.secrets`, installing the transcription script). Everything a first-time user has to do before `/daily-init` works.

## Step 1 — Locate the vault and the plugin

1. **Vault directory.** The vault is the current working directory by default. Confirm with the user in one line: "I'll set up the vault at `<cwd>`. Is that right? (yes / path)". Accept any sane path — absolute, `~/...`, or relative.

2. **Plugin directory.** The `vault-template/` folder and the canonical `CLAUDE.md` ship with the plugin. Resolve the plugin root in this order:
   - `$CLAUDE_PLUGIN_ROOT` if the env var is set.
   - `~/.claude/plugins/cache/obsidian-operator/*/` — if there's a single match, use it; if multiple, pick the highest semver.
   - `~/.claude/plugins/marketplaces/obsidian-operator/` — fallback for manual installs.
   - As a last resort, ask the user: "Where did you clone or install obsidian-operator?"

   Verify the resolved path contains both `vault-template/` and `CLAUDE.md`. If not, stop and ask the user to check their install.

## Step 2 — Sanity-check the vault

Before touching anything, check what's already in the vault:

- If all six core folders (`00_Strategy`, `01_Execution`, `02_Projects`, `03_Thinking`, `04_Knowledge`, `05_Content`) already exist AND `CLAUDE.md` is present in the vault root → the vault is already set up. Skip to Step 5 (customization review) and tell the user: "Looks like this vault is already initialized. I'll just walk through the customization to make sure your settings are current."
- If some folders exist and some don't → proceed to Step 3 in **merge mode** (create missing, leave existing alone, never overwrite).
- If none of the folders exist → clean install, proceed to Step 3 normally.

**Never overwrite** a file that already exists in the vault without explicit confirmation from the user. This includes `CLAUDE.md`, `Voice Guide.md`, `Backlog.md`, or anything in the core folders.

## Step 3 — Copy the vault template

Copy the plugin's `vault-template/*` into the vault. Use `cp -rn` (no-clobber) so any pre-existing files in the vault survive:

```bash
cp -rn "<plugin_root>/vault-template/." "<vault_path>/"
```

The template provides:
- Six core folders with `.gitkeep` placeholders
- `05_Content/Backlog.md` — empty content queue
- `05_Content/Voice Guide.md` — voice profile template
- `05_Content/Drafts/` and `05_Content/Published/` subdirs

After copy, list what was actually created vs. skipped. Briefly, e.g.:

```
Created:  00_Strategy/, 01_Execution/, 02_Projects/, 03_Thinking/, 04_Knowledge/
Created:  05_Content/Backlog.md, 05_Content/Voice Guide.md
Skipped:  05_Content/ (already existed)
```

## Step 4 — Install CLAUDE.md

Copy the plugin's `CLAUDE.md` into the vault root.

- If `<vault>/CLAUDE.md` does **not** exist → copy it as-is.
- If it **does** exist → do **not** overwrite. Instead, show the user a one-line diff summary (e.g. "Your CLAUDE.md differs from the bundled one — likely because you've already customized it. Keeping yours.") and move on.

The installed `CLAUDE.md` is the configuration layer for every other skill — it's where folder paths, vault owner name, and calendar names live.

## Step 5 — Walk through the Customization table

This is the most valuable part of the skill. The README tells users to "edit the Customization table in CLAUDE.md" but they never do, so half the skills misbehave silently. Do it now, interactively, in one prompt.

Ask the user for these values, all in a single message, with sensible defaults pre-filled:

| Setting | Default | Used by |
|---------|---------|---------|
| Vault owner name (first name) | the git user's first name if detectable | `/meeting`, `/daily-init`, `/meeting-prep` |
| Apple Calendar name | `Operator` | `/deadline-plan`, `/quarterly-plan`, `/add-events` |
| Apple Reminders list | `Operator` | `/deadline-plan`, `/quarterly-plan`, `/add-events` |
| Meeting recordings base | `~/Work/<Project>/Meetings/` | `/meeting` |

Present them as: "Here are the four settings in CLAUDE.md that the skills read. I've pre-filled sensible defaults — reply with changes or 'ok' to accept:"

Once the user responds, update the Customization table in `<vault>/CLAUDE.md` with Edit (not Write — preserve everything else in the file). The table rows look like:

```markdown
| Vault owner name | `Yuhan` | `/meeting`, `/daily-init` |
| Apple Calendar name | `Operator` | `/deadline-plan`, `/quarterly-plan` |
```

Replace the backticked value in each row. Do not touch the other columns. If the user's CLAUDE.md is heavily modified and the table rows don't match, say so and skip rather than guess.

## Step 6 — Optional: secrets + transcription script

Ask once, briefly: "Want me to set up `/meeting` auto-transcription? It needs a Gemini API key and a shell script. Reply 'yes' / 'skip' / 'later'."

If **yes**:
1. Check whether `~/.secrets` exists.
   - If yes, read it and check for `GEMINI_API_KEY`. If present, say so and move on.
   - If no or missing, prompt: "Paste your Gemini API key (from https://aistudio.google.com/apikey), or 'skip' to do this later."
2. If the user pastes a key, append (or create) `~/.secrets` with:
   ```bash
   export GEMINI_API_KEY="<key>"
   ```
   Use append mode — never overwrite an existing `~/.secrets`.
3. Copy the transcription script:
   ```bash
   mkdir -p ~/bin
   cp "<plugin_root>/skills/meeting/scripts/gemini-transcribe.sh" ~/bin/
   chmod +x ~/bin/gemini-transcribe.sh
   ```
   If the script isn't in the plugin (older versions), skip silently and tell the user where to find it in the repo.
4. Remind the user: "Make sure `~/bin` is on your PATH."

If **skip** or **later**: note in the final summary that `/meeting` still works with Modes 2 & 3 (transcript file or pasted text), and move on.

## Step 7 — Optional: mention Gmail MCP + Apple Calendar

Don't configure these — they're handled outside Claude Code. Just surface them in the final summary so the user knows they exist:

- **Gmail MCP** (for `/daily-init` email section): "Connect Google in Claude Code settings → MCP integrations if you want email in your daily briefing."
- **Apple Calendar / Reminders** (macOS only): "`/deadline-plan` and `/add-events` will use the calendar/list names you just set. No OS setup needed."

## Step 8 — Final summary

Print one compact block the user can screenshot or pin:

```
Vault ready at: <vault_path>

Created:
  - 6 core folders (00_Strategy → 05_Content)
  - 05_Content/Backlog.md, 05_Content/Voice Guide.md
  - CLAUDE.md (vault config)

Customized:
  - Vault owner: <name>
  - Apple Calendar: <calendar>
  - Apple Reminders: <list>
  - Meeting recordings: <path>

Optional (status):
  - Gemini transcription: <installed | skipped>
  - Gmail MCP: configure in Claude Code settings
  - Apple Calendar: ready (macOS)

Next steps:
  /project-init <name>   # scaffold your first project
  /daily-init <hours>    # generate today's briefing
```

End there. No celebratory preamble, no recap of what the README already said.

## Idempotency

This skill is safe to run more than once:
- Existing folders are left alone.
- Existing files are never overwritten — only missing ones are added.
- The Customization table in CLAUDE.md is updated in place; running again just lets the user refresh values.
- `~/.secrets` is append-only; duplicate `GEMINI_API_KEY` lines are consolidated (keep the first, comment out later ones).

## Language

Match the user's language for the confirmation prompts and final summary. File contents (CLAUDE.md, frontmatter) stay in English.
