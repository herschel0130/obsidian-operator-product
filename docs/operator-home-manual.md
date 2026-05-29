# Operator Home Manual

Operator Home is the Obsidian-native front door for Obsidian Operator. It keeps Markdown as the workspace, uses native Obsidian actions for fixed structure, and launches Codex or Claude only when a task needs agent reasoning.

## Interaction Model

- **Native actions** are fast, deterministic Obsidian operations: initialize the vault, capture a note, create a project scaffold, or open a key Markdown file.
- **Agent workflows** are one-click prompts with a Preview step: daily briefing, weekly review, project sync, deadline plan, meeting prep/processing, content drafting, and deep research.
- **CLI power path** remains available for multi-turn or open-ended work. Use Codex CLI or Claude Code directly, or use **More workflows -> Agent prompt / CLI command** inside Operator Home.

## Install

1. Install Obsidian desktop.
2. Download the versioned `operator-control-<version>.zip` from the [latest release](https://github.com/herschel0130/obsidian-operator-product/releases/latest). The unversioned `operator-control.zip` asset is kept for compatibility.
3. Unzip it and move the resulting `operator-control/` folder into your vault's plugins folder:

```text
<your vault>/.obsidian/plugins/
  operator-control/
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
5. Enter available hours, including half-hour budgets such as `4.5`, optionally add one manual item per line, and click **Start my day**. Review the Preview, then run it.

## Daily Use

- **Today** shows the current daily note's `## Focus`, `### Action Items`, task checkboxes in `## Capture`, `## Schedule`, and current weekly queue.
- Deferred future items under `#### Deferred` stay out of today's **Next actions** until `/daily-init` promotes them back into the main action list.
- Use **Done** or **Carry** on visible daily and weekly tasks for quick checkbox edits. Operator Home writes those changes back to the source Markdown note and intentionally does not turn tasks into a CRM-style task manager. Carry removes the item from today's visible action list; the next briefing decides how to promote it.
- **Quick Capture** appends ideas, tasks, meeting notes, or research questions to today's note without launching an agent. Paste multiple lines to create multiple Markdown capture items at once; captured task checkboxes appear in today's **Next actions**.
- **Active projects** shows active project notes from `02_Projects/` and each note's `## Now` section.
- **Meetings** and **Waiting on** come from the current week's `Blockers.md`; use **Done** to mark resolved blockers or completed meetings in the source Markdown.
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

- **Weekly setup / Weekly review** for execution planning and synthesis. Leave **Week** empty for the dashboard default, enter `YYYY-WX` or `YYYY-WXX` to target a specific week. `last` is review-only; Weekly setup treats it as blank and stays on the current ISO week.
- **Annual vision / Annual review / Quarter plan / Monthly pulse / Quarter review** for the strategic layer from `00_Strategy/`.
- **Sync / Deadline plan** for project-level agent work.
- **Prep / Process meeting** for agendas, transcripts, decisions, and actions. Transcript input accepts pasted multi-line text or a local path.
- **Agent prompt / CLI command** for raw slash commands or freeform prompts.
- **Copy CLI handoff** copies a runnable Codex or Claude command for the selected backend using the same enhanced prompt and resolved CLI path shown by Setup health, so power users can continue in Terminal without retyping the prompt. If the prompt box is empty, both handoff and Preview default to `/daily-init` with the dashboard's current available-hours setting.

Open **Optional modules** inside **More workflows** for personal-interest workflows:

- **Intelligence** runs AI weekly, GitHub trends, or academic scans when those feeds are useful to you.
- **Content** extracts ideas, drafts from a topic or backlog item, or launches the preserved deep-research workflow.
- **Calendar / events** routes pasted commitments into the weekly system. Paste one event or deadline per line.

Optional modules are off for **Start my day** by default. In Settings, enable only the modules you want the daily concierge to orchestrate; the Preview will list the enabled modules before you run. The buttons inside **Optional modules** and raw CLI slash commands remain available even when the daily setting is off.

Every agent workflow checks setup before opening Preview, then shows the exact prompt, target notes, expected output note when known, and likely read/write areas before launching Codex or Claude. Built-in workflows include local date, time, timezone, ISO week, and quarter as metadata, not manual tasks, so daily scheduling, weekly planning, annual vision, and quarterly planning do not depend on hidden agent clock assumptions.

**Start my day** is the core concierge. It preserves multi-line manual items, keeps weekly/monthly/quarterly planning current when needed, and lists concrete target notes before execution. Optional intelligence, academic, content, and calendar/event modules do not run as invisible side effects; run them deliberately from **Optional modules**, enable them in Settings for daily orchestration, or ask for them in the prompt.

The dashboard header clock refreshes on local minute boundaries. If the app stays open across midnight, Operator refreshes the dashboard so the visible daily note, week, quarter, and shortcut defaults move to the new local date.

The same daily pre-flight guard is added when you type `/daily-init ...` in **Agent prompt / CLI command** and run it from the Preview.

## Advanced target resolution

For daily, weekly, AI weekly digest, annual, and quarterly workflows, Operator predicts the main output note. Weekly shortcuts take the visible **Week** field when filled; `last` is resolved only for Weekly review. Annual shortcuts resolve the visible **Year** field before Preview; `next` is vision-only and `last` is review-only. Quarterly shortcuts take the visible **Period** field when filled; `YYYY-QX`, `YYYY-MM`, and bare `MM` values are resolved before Preview.

**Agent prompt / CLI command** preserves freeform prompts, but normalizes predicted weekly and strategy slash commands so the prompt you run contains the same concrete target shown in Preview. If you edit the Preview, the title, expected note, targets, read/write areas, and boundary notes refresh to match the edited prompt. If you leave it open across a clock boundary, Operator keeps that expected note aligned with the `Local date` already embedded in the prompt. If you accidentally clear the Preview prompt, Run keeps the original prompt instead of launching an empty `/` command. After a successful run, **Last Run** keeps an **Open expected note** button when a target path is known.

## Troubleshooting

- If buttons are disabled or an agent action is blocked before Preview, Operator shows the backend-specific missing pieces. Open **Setup health** for the exact fix. Codex mode checks vault setup, Codex CLI, Codex login, and Codex Operator skills. Claude mode checks vault setup, Claude CLI, and Claude Operator skills.
- If `codex --version` works in Terminal but Operator says Codex is missing, refresh the dashboard. Operator searches common Homebrew and nvm locations and runs absolute command paths with the command's own folder added to `PATH`.
- Gmail, Gemini, Calendar, and multi-agent support are optional. Missing optional integrations should not block basic daily workflows.
- If an agent run fails, open **Last Run -> Raw log** and rerun after fixing the setup issue.
- For open-ended debugging or multi-turn work, use Codex CLI or Claude Code directly from the vault.

## Safety

Operator launches the selected backend with vault-scoped write permissions in the current vault by default. It does not use full-disk or dangerous sandbox bypass settings by default. Native actions write only the specific Markdown files and folders needed for the selected action.
