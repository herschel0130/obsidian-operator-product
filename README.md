# Operator

An AI-native personal operating system built on Obsidian, Codex CLI, and Claude Code.

Operator turns an Obsidian vault into a structured execution engine for daily briefings, projects, meetings, research, planning, and content. This productized build adds a native **Operator Home** that keeps Markdown as the primary interface: today's note, weekly queue, projects, blockers, quick capture, and agent runs are surfaced without forcing users to memorize CLI commands.

This repository is based on [Yuhan Wang's Obsidian Operator](https://github.com/yuhanwang14/Obsidian-Operator) and keeps the original MIT license and skill system intact.

## Product Model

Operator has three interaction layers:

- **Native Obsidian actions** for fixed structure: vault initialization, quick capture, new project scaffolding, and opening key Markdown notes.
- **Agent workflows** for reasoning-heavy work: daily briefings, weekly reviews, project sync, meeting synthesis, content drafting, and deep research.
- **CLI power path** for open-ended work: Codex CLI and Claude Code remain available for multi-turn conversations, ad hoc prompts, and raw slash commands.

For a compact end-user guide, see [Operator Home Manual](docs/operator-home-manual.md). For the current beta release gate, see the [v0.4.0 release notes and smoke checklist](docs/release-v0.4.0.md).

## Start with the Obsidian UI

Use this path if you want the product experience: one-click vault initialization, a Today-first Markdown home, native quick capture, native project creation, and editable agent workflows inside Obsidian.

### 1. Install prerequisites

| Requirement | Required for | Notes |
|-------------|--------------|-------|
| [Obsidian](https://obsidian.md) | Everyone | Desktop app required for Operator Home |
| [Codex CLI](https://developers.openai.com/codex/cli) | Codex backend | Default backend for one-click runs |
| Claude Code | Claude backend | Switch backend in Operator settings |
| Gmail connector or MCP | Optional | Adds email context to `/daily-init` |
| Gemini API key + ffmpeg | Optional | Enables `/meeting` auto-transcription |

For the default Codex backend, log in once:

```bash
codex login
```

### 2. Install Operator Home

For normal users, install the Obsidian UI from the release zip:

1. Download the versioned `operator-control-<version>.zip` from the [latest release](https://github.com/herschel0130/obsidian-operator-product/releases/latest). The unversioned `operator-control.zip` asset is kept for compatibility.
2. Unzip it. You should get an `operator-control/` folder.
3. Move that whole folder into `<your vault>/.obsidian/plugins/`.

```text
<your vault>/.obsidian/plugins/
  operator-control/
```

4. Open Obsidian, enable **Community plugins**, then enable **Operator**.

The Obsidian plugin only installs the dashboard UI. Agent skills are installed separately from **Setup health** or the CLI path below.

For local development from this repository:

```text
npm install
npm run build
npm run install:plugin -- "<your vault>"
```

To create the release-style zip locally:

```bash
npm run package:plugin
```

### 3. Open Operator in Obsidian

Click the Operator dashboard icon in the left ribbon, or run **Operator: Open dashboard** from the command palette.

The dashboard will show:

- **Today** from the current daily note: `## Focus`, `### Action Items`, task checkboxes in `## Capture`, `## Schedule`, and the current weekly queue
- Deferred future items under `#### Deferred` stay out of today's **Next actions** until `/daily-init` promotes them back into the main action list
- **Start my day** as the core concierge: enter available hours, add optional manual items, review the exact prompt and target notes, then run the daily briefing
- Date-sensitive workflows resolve to concrete days, weeks, months, quarters, and years before execution, so Preview and Run stay aligned
- Native **Done** and **Carry** actions for visible daily and weekly tasks, editing the source Markdown checkbox instead of creating a separate task database; Carry moves the task out of today's visible actions until the next briefing promotes it
- Native **Quick Capture** for ideas, tasks, meeting notes, and research questions without leaving Operator Home; pasted multi-line captures become separate Markdown items, and captured task checkboxes appear in today's **Next actions**
- Active projects from `02_Projects/`, plus `## Now` next actions
- Current-week meetings and waiting-on items from `Blockers.md`, with native **Done** actions for resolved blockers and completed meetings
- Native project creation that writes `02_Projects/<Project>/<Project>.md` and `04_Knowledge/<Project>/` directly
- Collapsed advanced workflows for weekly planning/review, strategy, project sync, deadline plans, meetings, custom prompts, CLI handoff, and legacy slash commands such as `/project-init`
- A separate optional modules group for intelligence, academic scans, content workflows, and calendar/event ingestion
- Optional module settings that keep **Start my day** focused by default, while allowing explicit daily orchestration for enabled intelligence, academic, content, or calendar/event modules
- Collapsed setup health for Codex, skills, optional integrations, and vault initialization state
- Backend-specific setup checks before every agent Preview, plus disabled-state help beside **Start my day** and inside **More workflows**, so locked agent actions say whether Codex or Claude is missing CLI, login, skills, or vault setup
- Last-run review with status, summary, raw log, and an expected-note opener for workflow outputs when available

### 4. Run the first five-minute flow

1. Click **Install Codex skills** if the dashboard says Codex skills are missing. Claude users can switch the backend in settings and copy the Claude install commands from **Setup health**.
2. Click **Initialize vault**. This creates the six core folders plus `CLAUDE.md`, `AGENTS.md`, `05_Content/Backlog.md`, and `05_Content/Voice Guide.md` without overwriting existing files.
3. In **Active projects**, click **New** and create a native Markdown project note.
4. Enter your available hours, optionally add one manual item per line, and click **Start my day**. Review the Preview, then run it.

The first background run asks for authorization. Operator launches the selected backend in the current vault with vault-scoped write permissions, never with full-disk or dangerous sandbox bypass settings by default. Fixed structural tasks such as vault initialization, quick capture, and new project scaffolding run through the Obsidian API; reasoning-heavy work such as daily briefings, project sync, meeting synthesis, content drafting, and deep research still runs through editable agent previews.

## Power User CLI Path

You can still use the original skill-based workflow directly.

**Claude Code:**

```bash
/plugin marketplace add https://github.com/herschel0130/obsidian-operator-product
/plugin install obsidian-operator
```

**Codex CLI:**

```bash
codex plugin marketplace add herschel0130/obsidian-operator-product
codex
> /plugin           # enable obsidian-operator if prompted
```

Then from your vault:

```bash
/vault-init
/project-init MyProject
/daily-init 6
```

See [docs/README.codex.md](docs/README.codex.md) for Codex-specific details and upgrade notes.

## Configuration

The Obsidian dashboard writes the common settings into `CLAUDE.md` and `AGENTS.md` during vault initialization:

- Vault owner name
- Apple Calendar name
- Apple Reminders list
- Meeting recordings base path

Optional integrations are visible in the dashboard instead of failing silently:

- Gmail missing: daily briefings continue without email context.
- Gemini missing: `/meeting` still accepts transcript files or pasted text.
- Multi-agent missing: `/deep-research` can still run sequentially.
- Calendar unavailable: Apple Calendar and Reminders workflows are macOS-only.

## Troubleshooting Setup Health

- If `codex --version` works in Terminal but Operator says **Codex CLI missing**, click **Refresh**. Operator checks common Homebrew and nvm locations because macOS GUI apps do not always inherit your shell `PATH`.
- If you set an absolute Codex or Claude executable, Operator runs it with that executable's folder added to `PATH`, which helps npm/nvm shims find their adjacent `node`.
- Codex skills are **ready** only after the `obsidian-operator` plugin is enabled in Codex. A registered marketplace without an enabled plugin appears as **warning**, not ready.
- Claude mode shows Claude CLI and Claude Operator skills first. Missing Codex login should not block Claude workflows.

## Vault Structure

```
00_Strategy/            — annual vision, quarterly plans, monthly pulses
01_Execution/           — daily notes, weekly todos, blockers, reviews
02_Projects/            — per-project folders with meeting plans, transcripts, deadlines
03_Thinking/            — reflections, ideas, mental models
04_Knowledge/           — research, meeting knowledge, deep research, digests
05_Content/             — content backlog, drafts, published, archived, voice guide
```

See [CLAUDE.md](plugins/obsidian-operator/skills/vault-init/assets/CLAUDE.md) for full conventions, frontmatter spec, checkbox states, and AI agent instructions.

## Skills Reference

Operator ships the original skill library, but the product surface is layered. Core skills support the default concierge experience; optional modules stay available without becoming required setup.

### Core

| Skill | Description |
|-------|-------------|
| `vault-init` | Bootstrap the vault structure and agent config. Run this first. |
| `daily-init` | Core concierge flow: build today's briefing from vault, project, weekly, blocker, calendar, Gmail, and manual context when available. |
| `weekly-init` | Create or update the current execution week, Weekly Todo, and Blockers. |
| `weekly-review` | Synthesize the week and prepare next-week focus. |
| `meeting-prep` / `meeting` | Prepare agendas, process transcripts, and route decisions/actions. |
| `project-sync` | Consolidate project knowledge, weekly progress, and strategic signals into the project note. |

### Advanced

| Skill | Description |
|-------|-------------|
| `quarterly-plan` | Plan, review, or pulse the strategy layer with explicit targets. |
| `annual-vision` | Create annual vision notes or annual reviews. |
| `deadline-plan` | Backward-schedule deadline work into weekly and daily execution. |
| `link-enrich` | Audit and improve vault links and maps of content. |
| `project-init` | Legacy agent-guided project creation; Operator Home's native **New project** is the normal path. |
| `deep-research` | Preserved power-user research workflow. It is available from optional/advanced entry points, not required for daily use. |

### Optional Modules

| Module | Skills | When to use |
|--------|--------|-------------|
| Intelligence | `ai-weekly-digest`, `daily-github` | AI landscape and open-source monitoring. |
| Academic | `daily-academic` | arXiv scanning for research-heavy users. |
| Content | `content-extract`, `content-draft` | Creator workflows for turning notes into publishable drafts. |
| Calendar/events | `add-events` | macOS Apple Calendar and Reminders ingestion. |

Optional modules can be run from **More workflows -> Optional modules** or from the CLI. They are not required for **Start my day** to produce a complete daily operating flow.

In Settings, enable an optional module only if you want **Start my day** to orchestrate it automatically. Leaving all optional modules off keeps the daily concierge focused on daily notes, weekly execution, projects, blockers, and strategy boundaries.

## System Notes

The default daily loop is intentionally small at the product layer:

1. Open or create the current daily note.
2. Keep the current week, blockers, and active project context in view.
3. Catch up missing weekly/monthly/quarterly planning artifacts when the relevant boundary has passed.
4. Write a concise daily briefing and schedule draft.
5. Leave optional intelligence, academic, content, and calendar/event modules to explicit user choice.

For exact target-resolution rules, artifact paths, and advanced CLI behavior, see the [Operator Home Manual](docs/operator-home-manual.md).

## Customization

This is an opinionated system — the vault structure, note conventions, and skill behaviors are designed to work together. To customize:

1. **CLAUDE.md** is the configuration layer. Edit folder paths, frontmatter fields, checkbox states, or agent behavior in your vault's `CLAUDE.md`.
2. **Individual skills** — for durable changes, fork this repo and install from your fork. Editing files in `~/.claude/plugins/cache/obsidian-operator/…` (Claude Code) or `~/.codex/obsidian-operator/skills/…` (Codex CLI) works for quick experiments. Claude Code overwrites its cache on plugin update; Codex's clone is yours to maintain via `git pull`.
3. **Vault structure** can be extended — add new folders as needed. Avoid renaming the core 6 folders without updating CLAUDE.md and skill references.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for how to get started.

- [Skill style guide](docs/skill-style-guide.md) — frontmatter, description, and body conventions
- [Repo guide for agents](CLAUDE.md) — rules for agents working on this codebase

## License

[MIT](LICENSE)
