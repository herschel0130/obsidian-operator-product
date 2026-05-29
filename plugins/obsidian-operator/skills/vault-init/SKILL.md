---
name: vault-init
description: "TRIGGER for /vault-init, /onboard, /setup, 'first-time setup', 'set up my vault', or any new user staring at an empty vault. One-shot scaffold of the Operator vault structure (00–05 folders) plus CLAUDE.md customization walk-through. NOT for /project-init, /daily-init, or /weekly-init."
---

Walk the user from "just installed the plugin" to "vault is ready for /daily-init" in one conversation. The README currently spells this out as a wall of shell commands; this skill replaces that with a guided, interactive flow that actually runs the commands for them.

**CLI fallback:** If any `obsidian` CLI command fails, silently use the equivalent file tool. Do not surface CLI errors to the user — they might not have Obsidian running yet, which is fine during setup.

## What this skill replaces

The Quick Start + Configuration sections of the README (`cp -r vault-template/*`, `cp CLAUDE.md`, editing the Customization table, writing `~/.secrets`, installing the transcription script). Everything a first-time user has to do before `/daily-init` works.

## Step 1 — Locate the vault and the skill's assets

1. **Vault directory.** The vault is the current working directory by default. Confirm with the user in one line: "I'll set up the vault at `<cwd>`. Is that right? (yes / path)". Accept any sane path — absolute, `~/...`, or relative.

2. **Skill assets directory.** Everything this skill copies — `vault-template/` and `CLAUDE.md` — is bundled inside the skill itself at `assets/`. Resolve the assets path in this order:

   ```bash
   # 1. env var set by the harness when a plugin skill runs
   #    (Claude Code sets $CLAUDE_PLUGIN_ROOT to .../plugins/obsidian-operator/)
   [ -n "$CLAUDE_PLUGIN_ROOT" ] && echo "$CLAUDE_PLUGIN_ROOT/skills/vault-init/assets"

   # 2. Claude Code plugin cache (versioned install path; nested plugin payload)
   ls -d ~/.claude/plugins/cache/obsidian-operator/obsidian-operator/*/plugins/obsidian-operator/skills/vault-init/assets 2>/dev/null \
     | sort -V | tail -1

   # 3. Claude Code marketplace checkout (flat, no version dir)
   [ -d ~/.claude/plugins/marketplaces/obsidian-operator/plugins/obsidian-operator/skills/vault-init/assets ] \
     && echo ~/.claude/plugins/marketplaces/obsidian-operator/plugins/obsidian-operator/skills/vault-init/assets

   # 4. Codex CLI plugin cache (mirror of openai-curated layout, hash-based)
   ls -d ~/.codex/plugins/cache/obsidian-operator/obsidian-operator/*/plugins/obsidian-operator/skills/vault-init/assets 2>/dev/null \
     | sort -V | tail -1
   ```

   Use the first path that exists **and** contains both `vault-template/` and `CLAUDE.md`. If none do, ask the user: "I can't find the vault-init assets. Did you install via `/plugin install obsidian-operator` (Claude Code) or `codex plugin marketplace add herschel0130/obsidian-operator-product` (Codex CLI)? (Paste the repo path and I'll look inside `plugins/obsidian-operator/skills/vault-init/assets/`.)"

   If the user gives a local repo path, append `plugins/obsidian-operator/skills/vault-init/assets` and verify the two files are there before proceeding.

## Step 2 — Sanity-check the vault

Before touching anything, check what's already in the vault:

- If all six core folders (`00_Strategy`, `01_Execution`, `02_Projects`, `03_Thinking`, `04_Knowledge`, `05_Content`) already exist AND `CLAUDE.md` is present in the vault root → the vault is already set up. Skip to Step 5 (customization review) and tell the user: "Looks like this vault is already initialized. I'll just walk through the customization to make sure your settings are current."
- If some folders exist and some don't → proceed to Step 3 in **merge mode** (create missing, leave existing alone, never overwrite).
- If none of the folders exist → clean install, proceed to Step 3 normally.

**Never overwrite** a file that already exists in the vault without explicit confirmation from the user. This includes `CLAUDE.md`, `Voice Guide.md`, `Backlog.md`, or anything in the core folders.

## Step 3 — Copy the vault template

Copy the plugin's `vault-template/` contents into the vault. Use `cp -rn` (no-clobber) so any pre-existing files in the vault survive. The trailing `/.` on the source and `/` on the destination are important — they copy the *contents* of `vault-template/`, not the directory itself:

```bash
cp -rn "<assets>/vault-template/." "<vault_path>/"
```

The template provides:
- Six core folders (`00_Strategy`, `01_Execution`, `02_Projects`, `03_Thinking`, `04_Knowledge`, `05_Content`)
- `04_Knowledge/GitHub/`, `04_Knowledge/Academic/`, `04_Knowledge/AI-Weekly/` — optional module destinations for `/daily-github`, `/daily-academic`, `/ai-weekly-digest`
- `05_Content/Backlog.md` — optional content queue
- `05_Content/Voice Guide.md` — optional content voice profile template
- `05_Content/Drafts/`, `05_Content/Published/`, and `05_Content/Archived/` optional content subdirs

After copy, list what was actually created vs. skipped. Briefly, e.g.:

```
Created:  00_Strategy/, 01_Execution/, 02_Projects/, 03_Thinking/, 04_Knowledge/
Created:  05_Content/Backlog.md, 05_Content/Voice Guide.md
Skipped:  05_Content/ (already existed)
```

## Step 4 — Install CLAUDE.md

Copy the plugin's `CLAUDE.md` into the vault root using no-clobber, then write the same content to `AGENTS.md` (Codex reads `AGENTS.md` natively):

```bash
cp -n "<assets>/CLAUDE.md" "<vault_path>/CLAUDE.md"
cp -n "<assets>/CLAUDE.md" "<vault_path>/AGENTS.md"
```

- If the vault didn't have `CLAUDE.md` / `AGENTS.md`, they get installed (identical content).
- If the vault already has either, `cp -n` leaves it alone. Mention this briefly to the user: "Existing CLAUDE.md / AGENTS.md preserved — I'll still update the Customization table in Step 5."

The vault gets two identical files: `CLAUDE.md` (read by Claude Code) and `AGENTS.md` (read by Codex CLI). If the user later customizes one, they should sync the change into the other — drift means agents on different platforms see different vault config (see `docs/README.codex.md` for the drift warning).

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
| Vault owner name | `You` | `/meeting`, `/daily-init` |
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
3. Copy the transcription script. It's in the sibling `meeting` skill, so compute its path by stripping `/vault-init/assets` off `<assets>` and replacing with `/meeting/scripts/`:
   ```bash
   SCRIPT_SRC="${ASSETS%/vault-init/assets}/meeting/scripts/gemini-transcribe.sh"
   mkdir -p ~/bin
   cp "$SCRIPT_SRC" ~/bin/
   chmod +x ~/bin/gemini-transcribe.sh
   ```
   If the script isn't present (older plugin versions), skip silently and tell the user where to find it in the repo.
4. Remind the user: "Make sure `~/bin` is on your PATH."

If **skip** or **later**: note in the final summary that `/meeting` still works with Modes 2 & 3 (transcript file or pasted text), and move on.

## Step 7 — Platform-specific reminders

Detect platform via env signal: if `$CODEX_HOME` is set → Codex CLI, otherwise → Claude Code. (Do not use `~/.codex/` directory existence as a signal — that resolves true on any machine where Codex was ever installed, even from a Claude Code session.)

Surface (do **not** auto-configure) the platform-relevant items in the final summary.

If Claude Code:
- **Gmail** (for `/daily-init` email section): "Connect Google in Claude Code settings → MCP integrations." Skip if you don't need email — `/daily-init` will silently degrade.

If Codex CLI:
- **Gmail** (for `/daily-init` email section): "Codex ships an official Gmail connector — enable `gmail@openai-curated` in Codex's plugin manager." Skip if you don't need email.
- **`/deep-research` parallel agents**: "Add `[features] multi_agent = true` to `~/.codex/config.toml` to enable parallel agent dispatch. Otherwise `/deep-research` falls back to sequential thread execution (slower, still functional)."

Both platforms:
- **Apple Calendar / Reminders** (macOS only): "`/deadline-plan` and `/add-events` will use the calendar/list names you just set. No OS setup needed."

vault-init never writes `~/.codex/config.toml` itself. If `multi_agent` is missing, the `deep-research-enforce.sh` hook will emit a one-line fallback notice at `/deep-research` invocation time.

## Step 8 — Day-1 onboarding chain

The vault is scaffolded but empty, and today is the user's day 1. `/daily-init`'s boundary automation was designed for transitions between existing states (new week, new month, new quarter), not a cold start — so we run the setup layers explicitly instead of hoping downstream boundary logic catches everything.

Present four items in a single prompt:

```
Your vault is ready but empty. Want me to run any of these now? Reply with numbers, 'all', or 'skip':

  1. Projects         (/project-init, loops)    — scaffold one or more projects
  2. Annual vision    (/annual-vision)          — this year's north star + goals
  3. Quarterly plan   (/quarterly-plan init)    — this quarter's execution plan
  4. Today's briefing (/daily-init, asks for hours) — kick off your first day
```

**Execution rules:**

- Run selections in order **1 → 2 → 3 → 4** regardless of reply order. Reason: `/quarterly-plan init` reads the annual vision if present; `/daily-init` reads active projects + the quarterly plan.

- **Item 1 loops.** Ask "Project name?", invoke `/project-init <name>`, wait for completion, then ask "Another project? (name / done)". Keep going until the user replies 'done' or blank. First-time users typically have 2–4 trackable things.

- **Items 2, 3, 4 run once each.** Invoke the skill by name, wait for completion, let each drive its own prompts. Don't try to pre-fill args.

- Invocation pattern matches the cross-skill pattern in `skills/daily-init/SKILL.md` Pre-Flight Check (steps 1–1e).

- If an invoked skill fails, log a one-line warning (e.g. "⚠️ /quarterly-plan init failed — run manually") and continue with the next item. Don't abort onboarding.

**Reply parsing:**

- `skip` at the top → jump straight to Step 9 with all four rendered as skipped. Do NOT auto-run `/weekly-init` either — the user said skip.
- `all` → run 1 (looping) then 2, 3, 4 in order.
- A list like `1, 3` → run only those, in order 1 → 3.

**Auto-complete this week's scaffold:**

`/weekly-init` is purely mechanical (no user prompts anywhere — just carries items from last week, parses daily notes, injects deadline tasks, populates Blockers from calendar). Putting it in the menu would offer the user a choice where there's nothing to choose. So:

- If item 4 (`/daily-init`) ran → skip this step. `/daily-init`'s Step 2 already runs `/weekly-init`.
- If item 4 was skipped but anything else ran → silently invoke `/weekly-init` here so this week's execution layer is ready when the user eventually runs `/daily-init`. Record it for Step 9 as "Weekly setup: YYYY-WXX ready (auto)".
- If the user chose `skip` at the top (nothing ran) → do NOT auto-run `/weekly-init`. Respect the skip.

Track across this step: which items ran, project names created, year/quarter set, whether weekly-init was auto-run. Step 9 reports this.

## Step 9 — Final summary

Print one compact block the user can screenshot or pin. Use `✓` for items that actually ran in Step 8 and `→` followed by the command for items the user skipped — this way the summary doubles as a cheat-sheet for what's still left to do.

Template (fill in based on what Step 8 tracked):

```
Vault ready at: <vault_path>

Created:
  - 6 core folders (00_Strategy → 05_Content)
  - optional module folders and content templates
  - CLAUDE.md (vault config)

Customized:
  - Vault owner: <name>
  - Apple Calendar: <calendar>
  - Apple Reminders: <list>
  - Meeting recordings: <path>

Optional (status):
  - Gemini transcription: <installed | skipped>
  - Gmail MCP: <configured | configure in Claude Code settings or ~/.codex/config.toml>
  - Apple Calendar: ready (macOS)

Day-1 onboarding:
  <status line 1>   — projects
  <status line 2>   — annual vision
  <status line 3>   — quarterly plan
  <status line 4>   — weekly setup
  <status line 5>   — today's briefing
```

Each status line follows this pattern:

| Item | If it ran | If skipped |
|------|-----------|------------|
| Projects | `✓ Projects created: Alpha, Beta` | `→ /project-init <name>` |
| Annual vision | `✓ Annual vision: 2026 set` | `→ /annual-vision` |
| Quarterly plan | `✓ Quarterly plan: 2026-Q2 set` | `→ /quarterly-plan init` |
| Weekly setup | `✓ Weekly setup: 2026-W17 ready` (note `(auto)` if auto-run, nothing if via /daily-init) | `→ /weekly-init` |
| Today's briefing | `✓ Today's briefing generated` | `→ /daily-init <hours>` |

End there. No celebratory preamble, no recap of what the README already said.

## Idempotency

This skill is safe to run more than once:
- Existing folders are left alone.
- Existing files are never overwritten — only missing ones are added.
- The Customization table in CLAUDE.md is updated in place; running again just lets the user refresh values.
- `~/.secrets` is append-only; duplicate `GEMINI_API_KEY` lines are consolidated (keep the first, comment out later ones).

## Language

Match the user's language for the confirmation prompts and final summary. File contents (CLAUDE.md, frontmatter) stay in English.
