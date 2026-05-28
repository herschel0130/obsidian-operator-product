# Operator Home Manual

Operator Home is the Obsidian-native front door for Obsidian Operator. It keeps Markdown as the workspace, uses native Obsidian actions for fixed structure, and launches Codex or Claude only when a task needs agent reasoning.

## Interaction Model

- **Native actions** are fast, deterministic Obsidian operations: initialize the vault, capture a note, create a project scaffold, or open a key Markdown file.
- **Agent workflows** are one-click prompts with a Preview step: daily briefing, weekly review, project sync, deadline plan, meeting prep/processing, content drafting, and deep research.
- **CLI power path** remains available for multi-turn or open-ended work. Use Codex CLI or Claude Code directly, or use **More workflows -> Agent prompt / CLI command** inside Operator Home.

## Install

1. Install Obsidian desktop.
2. Download `operator-control.zip` from the [latest release](https://github.com/herschel0130/obsidian-operator-product/releases/latest).
3. Unzip it and move the resulting folder into your vault:

```text
<your vault>/.obsidian/plugins/
  operator-control/
    manifest.json
    main.js
    styles.css
```

4. In Obsidian, enable **Community plugins**, then enable **Operator**.

The zip installs only the Obsidian dashboard. Agent workflows need Codex CLI or Claude Code skills as a separate setup step.

### Codex Backend

Install and log in to Codex CLI:

```bash
codex login
```

Then open Operator Home and click **Install Codex skills** in **Setup health**. If Setup health says the marketplace is installed but skills are not ready, open Codex and enable `obsidian-operator` from `/plugin`.

### Claude Backend

Install Claude Code, switch Operator's backend setting to **Claude**, then copy the install commands from **Setup health**:

```text
/plugin marketplace add https://github.com/herschel0130/obsidian-operator-product
/plugin install obsidian-operator
```

### Local Development Install

If you cloned this repo instead of using a release zip:

```bash
npm install
npm run build
npm run install:plugin -- "<your vault>"
```

## First Run

1. Open **Operator** from the left ribbon or command palette.
2. If setup is incomplete, use **Setup health** to install skills for your selected backend.
3. Click **Initialize vault** to create the Operator folder structure and agent config files.
4. Click **New** under Active projects, then create your first project note.
5. Enter available hours and click **Start my day**. Review the Preview, then run it.

## Daily Use

- **Today** shows the current daily note's `## Focus`, `### Action Items`, `## Schedule`, and current weekly queue.
- Edit task state in the Markdown note itself. Operator Home intentionally does not turn tasks into a CRM-style task manager.
- **Quick Capture** appends ideas, tasks, meeting notes, or research questions to today's note without launching an agent.
- **Active projects** shows active project notes from `02_Projects/` and each note's `## Now` section.
- **Meetings** and **Waiting on** come from the current week's `Blockers.md`.
- **Last Run** shows the latest agent run summary and raw log when you need to debug.

## Projects

Use **New project** for the normal path. It creates:

```text
02_Projects/<Project>/<Project>.md
04_Knowledge/<Project>/
```

The project note includes frontmatter, a one-line description, `## Now`, `## Risks`, `## Knowledge Base`, and `## Weekly Progress`.

Use **Run /project-init** only when you want the legacy agent-guided project setup. This keeps the original skill available without making the daily UI depend on CLI interaction.

## Agent Workflows

Open **More workflows** for less frequent or reasoning-heavy work:

- **Weekly setup / Weekly review** for execution planning and synthesis.
- **Annual vision / Quarter plan / Monthly pulse / Quarter review** for the strategic layer from `00_Strategy/`.
- **Sync / Deadline plan** for project-level agent work.
- **Prep / Process meeting** for agendas, transcripts, decisions, and actions.
- **Extract ideas / Draft / Deep research** for content and research workflows.
- **AI weekly / GitHub trends / Academic scan** for optional intelligence automations.
- **Add events** for routing calendar and reminder commitments into the weekly system.
- **Agent prompt / CLI command** for raw slash commands or freeform prompts.
- **Copy CLI handoff** copies the vault `cd` command plus the prompt so power users can continue in Codex CLI without the Obsidian UI getting in the way.

Every agent workflow opens a Preview showing the exact prompt and likely read/write areas before launching Codex or Claude. **Start my day** includes local date, time, timezone, ISO week, and quarter in the prompt so schedule generation does not depend on hidden agent clock assumptions.

## Troubleshooting

- If buttons are disabled, open **Setup health**. Codex mode checks vault setup, Codex CLI, Codex login, and Codex Operator skills. Claude mode checks vault setup, Claude CLI, and Claude Operator skills.
- If `codex --version` works in Terminal but Operator says Codex is missing, refresh the dashboard. Operator searches common Homebrew and nvm locations and runs absolute command paths with the command's own folder added to `PATH`.
- Gmail, Gemini, Calendar, and multi-agent support are optional. Missing optional integrations should not block basic daily workflows.
- If an agent run fails, open **Last Run -> Raw log** and rerun after fixing the setup issue.
- For open-ended debugging or multi-turn work, use Codex CLI or Claude Code directly from the vault.

## Safety

Operator launches Codex with `workspace-write` permissions in the current vault by default. It does not use full-disk or dangerous sandbox bypass settings by default. Native actions write only the specific Markdown files and folders needed for the selected action.
