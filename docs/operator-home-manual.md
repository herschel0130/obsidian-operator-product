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
5. Enter available hours, including half-hour budgets such as `4.5`, optionally add one manual item per line, and click **Start my day**. Review the Preview, then run it.

## Daily Use

- **Today** shows the current daily note's `## Focus`, `### Action Items`, task checkboxes in `## Capture`, `## Schedule`, and current weekly queue.
- Deferred future items under `#### Deferred` stay out of today's **Next actions** until `/daily-init` promotes them back into the main action list.
- Use **Done** or **Carry** on visible daily and weekly tasks for quick checkbox edits. Operator Home writes those changes back to the source Markdown note and intentionally does not turn tasks into a CRM-style task manager.
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
- **Annual vision / Annual review / Quarter plan / Monthly pulse / Quarter review** for the strategic layer from `00_Strategy/`. Annual buttons use the visible **Year** field. A bare `YYYY` works for both buttons; `next` is vision-only, and `last` is review-only. If **Year** is blank, Annual vision targets the current year; Annual review targets the current year in December and the previous year otherwise. Shorthand is resolved only for that run and does not stick in the shared field. Quarterly buttons use the compact **Period** field: enter `YYYY-QX` or `YYYY-MM` for plan/review targets, and `YYYY-QX`, `YYYY-MM`, or `MM` for monthly pulse targets. A quarter value maps to that quarter's final monthly pulse; bare `MM` is resolved to a concrete `YYYY-MM` before Preview, using the previous year if that month would otherwise be in the future.
- **Sync / Deadline plan** for project-level agent work.
- **Prep / Process meeting** for agendas, transcripts, decisions, and actions. Transcript input accepts pasted multi-line text or a local path.
- **Extract ideas / Draft / Deep research** for content and research workflows.
- **AI weekly / GitHub trends / Academic scan** for optional intelligence automations.
- **Add events** for routing calendar and reminder commitments into the weekly system. Paste one event or deadline per line.
- **Agent prompt / CLI command** for raw slash commands or freeform prompts.
- **Copy CLI handoff** copies a runnable Codex or Claude command for the selected backend using the same enhanced prompt and resolved CLI path shown by Setup health, so power users can continue in Terminal without retyping the prompt. If the prompt box is empty, both handoff and Preview default to `/daily-init` with the dashboard's current available-hours setting.

Every agent workflow checks setup before opening Preview, then shows the exact prompt, target notes, expected output note when known, and likely read/write areas before launching Codex or Claude. Built-in workflows include local date, time, timezone, ISO week, and quarter as metadata, not manual tasks, so daily scheduling, weekly planning, annual vision, quarterly planning, and research runs do not depend on hidden agent clock assumptions. **Start my day** keeps the full boundary guard in the prompt, preserves multi-line manual items as separate lines, and includes the concrete target week, month, and quarter for each boundary workflow while telling the agent to run each boundary command only when both its catch-up date condition and missing-artifact condition are true. Weekly, monthly, and quarterly catch-up remains eligible after the first day of the new period, so users do not miss reviews or pulses just because they skipped a day. The Preview keeps this compact on ordinary days, then expands the obvious boundary actions on week/month/quarter starts.

The dashboard header clock refreshes on local minute boundaries. If the app stays open across midnight, Operator refreshes the dashboard so the visible daily note, week, quarter, and shortcut defaults move to the new local date.

The same daily pre-flight guard is added when you type `/daily-init ...` in **Agent prompt / CLI command** and run it from the Preview.

For daily, weekly, AI weekly digest, annual, and quarterly workflows, Operator also predicts the main output note. Fixed weekly, AI weekly, and strategy shortcuts emit explicit target weeks, years, months, and quarters; weekly shortcuts take the visible **Week** field when filled, with `last` resolved only for Weekly review, annual shortcuts resolve the visible **Year** field before Preview, with `next` resolved only for Annual vision and `last` resolved only for Annual review, quarterly shortcuts take the visible **Period** field when filled. **Agent prompt / CLI command** preserves raw slash commands except for target shorthand normalization on predicted weekly, annual, and monthly pulse outputs, so `/weekly-review 2026-W3` runs as `2026-W03`, `/annual-vision review next` remains review-mode and follows review defaults unless an explicit year is supplied, and `/quarterly-plan pulse 2026-Q2` runs as `pulse 2026-06`. If you edit the Preview, the title, expected note, targets, read/write areas, and boundary notes refresh to match the edited prompt. If you leave it open across a clock boundary, Operator keeps that expected note aligned with the `Local date` already embedded in the prompt. If you accidentally clear the Preview prompt, Run keeps the original prompt instead of launching an empty `/` command. The metadata block is not treated as command arguments, so a Monday weekly review still targets the prior week and a quarterly review still targets the prior quarter. After a successful run, it opens that note when present; **Last Run** keeps an **Open expected note** button for quick review. Monthly pulse paths are based on the target month, so January and quarter-boundary runs still open the previous year's Q4 pulse when appropriate.

## Troubleshooting

- If buttons are disabled or an agent action is blocked before Preview, Operator shows the backend-specific missing pieces. Open **Setup health** for the exact fix. Codex mode checks vault setup, Codex CLI, Codex login, and Codex Operator skills. Claude mode checks vault setup, Claude CLI, and Claude Operator skills.
- If `codex --version` works in Terminal but Operator says Codex is missing, refresh the dashboard. Operator searches common Homebrew and nvm locations and runs absolute command paths with the command's own folder added to `PATH`.
- Gmail, Gemini, Calendar, and multi-agent support are optional. Missing optional integrations should not block basic daily workflows.
- If an agent run fails, open **Last Run -> Raw log** and rerun after fixing the setup issue.
- For open-ended debugging or multi-turn work, use Codex CLI or Claude Code directly from the vault.

## Safety

Operator launches Codex with `workspace-write` permissions in the current vault by default. It does not use full-disk or dangerous sandbox bypass settings by default. Native actions write only the specific Markdown files and folders needed for the selected action.
