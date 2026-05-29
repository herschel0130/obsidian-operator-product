# Operator v0.4.0 Release Notes

This release is the first productized Operator Home beta. It keeps Obsidian Markdown as the workspace, adds a native Today dashboard, and keeps Codex or Claude as the reasoning backend for previewed agent workflows.

## User Install

1. Download `operator-control-0.4.0.zip` from the GitHub release.
2. Unzip it and move the resulting `operator-control/` folder into `<your vault>/.obsidian/plugins/`.
3. Enable **Operator** in Obsidian Community plugins, then use **Setup health** to install Codex or Claude skills.

Troubleshooting note: if the CLI works in Terminal but Setup health says it is missing, refresh the dashboard and, if needed, set the executable path in settings. macOS GUI apps may not inherit the same PATH as a shell.

## Product Notes

- **Start my day** remains the core concierge for daily notes, weekly execution, active projects, blockers, manual items, and weekly/monthly/quarterly planning catch-up.
- Intelligence, academic, content, and calendar/event workflows are optional modules. They stay available from **More workflows -> Optional modules** and only join **Start my day** when enabled in settings or requested in the prompt.
- Codex and Claude setup health are backend-aware. Codex login does not block Claude mode.
- The release includes both `operator-control-0.4.0.zip` and the compatibility `operator-control.zip`.

## Clean-vault smoke checklist

Use a clean local vault before merging the release PR:

- Build and verify locally with `npm run test`, `npm run check`, and `npm run package:plugin`.
- Unzip `dist/operator-control-0.4.0.zip` into a clean vault's `.obsidian/plugins/` folder.
- Enable **Operator** in Obsidian and open the dashboard.
- Confirm the first screen is calm: **Today**, **Quick Capture**, **Current Work**, collapsed **More workflows**, collapsed **Setup health**, and **Last Run** only when present.
- Confirm **Start my day** is disabled only for selected-backend blockers, not for optional Gmail/Gemini/Calendar/Multi-agent status.
- Initialize the vault, create a native project, and confirm the project note appears under **Current Work**.
- Confirm Start my day unlocks with the selected backend after vault setup, CLI, login where required, and Operator skills are ready.
- Switch to Claude mode and confirm Claude CLI and Claude Operator skills appear first, while Codex login is optional.
- Expand **More workflows** and confirm GitHub, arXiv, AI weekly, content, and calendar/event workflows are inside **Optional modules**, not first-screen defaults.
