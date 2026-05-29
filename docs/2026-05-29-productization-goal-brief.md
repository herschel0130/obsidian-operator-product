# Operator Productization Goal Brief

> Purpose: use this document as the source brief for future goal-mode development on the `codex/may28` PR and the next productization branch.
>
> Current product risk: Operator started as a powerful personal Obsidian operating system. The product version should preserve that power while making the default experience feel like a calm, Obsidian-native AI concierge, not a hard-coded copy of one user's automation bundle.

## Executive Summary

The current PR is directionally right: it fixes real onboarding friction, makes backend health aware of Codex vs Claude, preserves CLI power, and makes workflow previews more deterministic. The main issue is not that the work is wrong; the issue is that the product surface has grown faster than the product positioning.

The product should not present every historical personal workflow as a default feature. Daily GitHub trends, arXiv scans, AI weekly digests, content drafting, and calendar event ingestion are useful for some users, but they should be optional modules. The core product should be:

- Obsidian-native daily planning and Markdown operations.
- Simple vault/project setup without CLI concepts.
- A strong **Start my day** concierge that coordinates daily, weekly, project, and strategy context.
- Agent workflows when reasoning, synthesis, or orchestration is needed.
- Preview-first execution so users know what will be read, written, and opened.
- A preserved CLI escape hatch for power users.

Implementation status after the current cleanup pass:

- README and manual now separate product-facing guidance from advanced target-resolution details.
- Today copy no longer exposes internal scheduling terminology.
- More workflows keeps core workflows visible first and places intelligence/content/calendar workflows behind **Optional modules**.
- Claude skill readiness no longer treats a marketplace-only or stale config mention as ready.
- `daily-init` and its hook keep weekly/monthly/quarterly concierge checks, while GitHub/arXiv/AI weekly/content modules are explicit opt-in.
- Setup health optional integrations now use neutral optional visual state instead of missing/warning styling.
- Shipped skill/hook wording no longer includes internal regression anecdotes or hard-edged maintainer-only phrasing.
- Release packaging keeps `operator-control.zip` and also creates a versioned zip asset.

The next development goal should focus on true optional-module settings and clean-vault smoke testing rather than repeating the Phase 0 cleanup.

## Findings Addressed In Current Cleanup

These findings were the concrete merge-readiness issues from the PR review. They are kept here as historical context and regression checks.

### Finding 1: README is overloaded

`README.md:77-90`, especially line 81, exposes implementation details such as date snapshots, boundary cascade, weekly/annual/quarterly parsing, and preview edge cases in the first-use product explanation.

Status: addressed. The README dashboard overview now describes Preview and date resolution at product level, and detailed target behavior lives in the manual.

Why it matters:

- It reintroduces cognitive load immediately after the install path was simplified.
- It makes the product feel like a scheduling engine rather than an Obsidian plugin.
- It hides the main promise under internal mechanics.

Recommended fix:

- Replace the detailed bullet with 2-3 user-facing bullets:
  - "Preview shows the exact prompt, target notes, and expected output before running."
  - "Date-sensitive workflows resolve to concrete weeks, months, quarters, and years before execution."
  - "Advanced details live in the manual."
- Move parsing and midnight/boundary details to an advanced manual section.

### Finding 2: Today screen exposes internal terminology

`src/main.ts:676-679` says: "Start my day also runs the boundary cascade..."

Status: addressed. Today now says that Start my day keeps weekly, monthly, and quarterly planning current when needed.

Why it matters:

- "Boundary cascade" is an implementation phrase.
- New users do not yet know what weekly review/setup, monthly pulse, or quarterly plan mean.
- The Today surface should stay calm and daily-first.

Recommended fix:

- Replace with friendlier copy:
  - "Start my day can keep weekly, monthly, and quarterly planning up to date when needed."
- Or move the explanation into Preview where the exact run context matters.

### Finding 3: More workflows is becoming a workflow console

`src/main.ts:801-930` contains weekly, strategy, project, meeting, content/research, intelligence, calendar/events, and raw agent prompt cards.

Status: addressed for merge-readiness. More workflows remains collapsed, and optional intelligence/content/calendar workflows are nested under **Optional modules**.

Why it matters:

- It is acceptable because it is collapsed.
- It becomes a problem if promoted to the main screen or described as a primary product promise.
- It mixes core workflows with optional intelligence/content/calendar automations.

Recommended fix:

- Keep **More workflows** collapsed by default.
- Split visible workflow groups by product tier:
  - Core: weekly planning/review, project sync, meeting prep/process.
  - Advanced: strategy, deadline planning, raw agent prompt.
  - Optional modules: intelligence, academic, GitHub, content, calendar/events.

### Finding 4: Claude skill readiness may false-positive

`src/status.ts:263-267` returns `ready` when a Claude config file merely contains `obsidian-operator`.

Status: addressed. Claude detection now returns `ready` only for an explicitly enabled plugin record; marketplace/cache/string-only detections return `warning`.

Why it matters:

- If a marketplace entry or stale config contains that string before actual plugin install/enablement, the dashboard may unlock Claude workflows too early.
- This is exactly the kind of setup-health trust issue the PR is trying to fix.

Recommended fix:

- Verify against a real Claude Code install.
- Prefer detecting an installed plugin directory or a known enabled plugin record.
- If exact detection is not possible, return `warning` instead of `ready` and use copy that says "detected, verify in Claude Code".

## Product Positioning

### Recommended positioning

Operator should be positioned as:

> An AI-native personal operating system for Obsidian: a Markdown-first home and concierge that turns repeatable operating workflows into simple native actions, and launches Codex or Claude when planning, synthesis, or orchestration is needed.

This is stronger than positioning it as:

- A replacement for the terminal.
- A full AI automation suite.
- A task manager.
- An AI research/news/content product.
- A personal workflow bundle copied from one user's vault.

### Product promise

For a new user:

1. Install the plugin without cloning or building.
2. Initialize a clean, understandable vault structure.
3. Create a project and capture notes without leaving Obsidian.
4. Start the day with a previewed agent run.
5. Keep advanced workflows available, but not visually dominant.

For a power user:

1. Keep raw slash commands and CLI handoff.
2. Preserve legacy skills.
3. Allow optional modules to be enabled deliberately.
4. Make exact prompts, target notes, and paths inspectable before execution.

## Current Drift Risks

### Risk 1: Personal workflow bundle becomes the product

The original system has strong personal assumptions:

- Daily GitHub trending.
- Daily arXiv scanning.
- AI weekly landscape digest.
- Content backlog and draft engine.
- Apple Calendar and Reminders routing.
- `Yuhan` and personal path examples in vault runtime config.

These are valuable in the original personal system, but they are not universal. If they remain default or prominent, the product looks overfit to the original maintainer.

### Risk 2: Start my day stops feeling like a configurable concierge

The strongest core action is **Start my day**. It should be powerful. It should feel like:

> A trusted AI concierge that builds today's note, checks the current week, understands active projects, catches missed planning boundaries, and prepares the user to act.

The risk is not that **Start my day** is too capable. The risk is that it silently inherits non-universal personal modules and starts to feel like:

> Run a full operating-system pipeline that may fetch GitHub trends, scan arXiv, mine content ideas, update quarterly strategy, and generate multiple knowledge artifacts.

Recommended product boundary:

- Keep daily note creation, weekly setup/review catch-up, project context, blockers, manual items, and strategy boundary checks in the concierge core.
- Treat GitHub trends, arXiv scans, AI weekly digests, content extraction, and other interest-specific feeds as opt-in modules.
- When optional modules are enabled, **Start my day** may orchestrate them. When they are not enabled, the user should still get a complete and useful daily operating flow.

### Risk 3: Release zip is a beta install path, not a mature product install

The zip is a necessary improvement over "clone, build, copy three files", but it still feels unusual to many Obsidian users.

Short-term:

- Keep the zip because it solves the immediate friction.
- Name it clearly and document exactly what to do.

Medium-term:

- Add a cleaner beta install path, such as a versioned release asset with screenshots and a one-page install guide.
- Consider a community-plugin or beta-plugin distribution path after product surface stabilizes.
- Keep `npm run install:plugin` explicitly framed as developer-only.

## Proposed Product Tiers

Do not remove historical skills immediately. Instead, tier them and change what the UI/docs expose by default.

### Tier 0: Core Default

These should be visible in the normal product path.

| Area | Keep Default? | Notes |
| --- | --- | --- |
| `vault-init` | Yes | Must become generic and remove personal defaults. |
| `daily-init` | Yes | Core concierge. Keep it powerful, previewed, and modular. |
| Native quick capture | Yes | Strong Obsidian-native value. |
| Native project creation | Yes | Better than CLI for fixed scaffolding. |
| Native task Done/Carry | Yes, carefully | Keep Markdown-only; do not become a full task app. |
| `weekly-init` | Yes | Mechanical planning layer, useful default. |
| `weekly-review` | Yes | Strong synthesis use case. |
| `meeting-prep` / `meeting` | Probably yes | Useful vault-native synthesis. Should not assume one recording/transcription setup. |
| `project-sync` | Yes | Strong vault-native synthesis. |

### Tier 1: Advanced But Product-Relevant

These should exist, but not dominate onboarding.

| Area | Default Surface | Notes |
| --- | --- | --- |
| `annual-vision` | Advanced drawer | Useful but not daily. |
| `quarterly-plan` | Advanced drawer | Useful for users who adopt strategy structure. |
| `deadline-plan` | Advanced drawer | Good project feature, but not first-run. |
| `link-enrich` | Maintenance / command only | Useful for graph hygiene, not daily UI. |
| Raw Agent prompt / CLI handoff | Advanced drawer | Essential power path. |
| Legacy `/project-init` | Hidden or advanced | Native project creation should be the normal path. |

### Tier 2: Optional Modules

These should be off by default and described as optional add-ons.

| Module | Skills | Product Treatment |
| --- | --- | --- |
| Intelligence | `daily-github`, `daily-academic`, `ai-weekly-digest` | Optional module. Do not run as a post-briefing module unless enabled. |
| Academic | `daily-academic` | Optional submodule for researchers. |
| Open-source monitoring | `daily-github` | Optional submodule for developers/founders. |
| Content engine | `content-extract`, `content-draft` | Optional creator workflow. Do not imply every user needs it. |
| Calendar/events | `add-events` | Optional macOS integration. Must not block daily workflows. |

### Deferred Topic: Deep Research

Do not make a product decision about `deep-research` in the next cleanup goal. Preserve the current capability for power users, avoid making it a first-screen default, and schedule a separate review only after the daily/optional-module product boundary is settled.

## Recommended Default Daily Path

### Default behavior

`Start my day` should:

1. Use local date/time metadata.
2. Resolve the current daily note and week.
3. Ensure current weekly execution files exist.
4. Read active projects, today's note, current weekly todo, blockers, and optional calendar/Gmail if configured.
5. Write or update today's daily note.
6. Show expected output in Last Run.

### Boundary behavior

Boundary catch-up is part of the concierge promise, but it should be explicit in Preview:

- Weekly review/setup: default on appropriate boundary when missing.
- Monthly pulse and quarterly plan/review: core when the user adopts the strategy layer, and clearly listed before execution.
- AI weekly digest: optional module only.

### Optional module behavior

Do not attach these as invisible default side effects for every user:

- `daily-github`
- `daily-academic`
- `content-extract`
- `ai-weekly-digest`, unless the Intelligence module is enabled.

If the user enables a module, the Preview should clearly show:

- Which optional module will run.
- Why it is eligible.
- Which files it may create.

This keeps **Start my day** strong without making the original maintainer's interests feel like mandatory product behavior.

## UX Information Architecture

### First screen

Keep first screen focused on:

- Today.
- Quick Capture.
- Active Projects.
- Meetings / Waiting On.
- Last Run.
- Setup health only when setup is incomplete, or collapsed otherwise.

Avoid first-screen exposure of:

- GitHub trends.
- arXiv scans.
- Content engine.
- Deep research.
- Calendar event ingestion.
- Internal scheduling terminology.

### More workflows

Recommended grouping:

1. **Plan**
   - Weekly setup
   - Weekly review
   - Strategy review
   - Deadline plan

2. **Projects & Meetings**
   - Project sync
   - Meeting prep
   - Process meeting

3. **Optional Modules**
   - Intelligence
   - Content
   - Calendar/events

4. **Power User**
   - Agent prompt
   - Copy CLI handoff
   - Legacy slash commands

### Setup health

Setup health should answer:

- Can I run the selected backend?
- What is blocking the selected backend?
- Which optional modules are unavailable, without making them feel scary?

It should not make optional integrations look required.

## Documentation Strategy

### README

README should be a product landing/readme, not a full architecture spec.

Recommended sections:

1. What Operator is.
2. Install for normal users.
3. First five-minute flow.
4. Core daily/project workflow.
5. Optional modules.
6. Developer install.
7. Troubleshooting.

Move these out of the README or collapse them:

- Full pipeline diagrams.
- Detailed dependency graph.
- Long list of every skill.
- Boundary cascade internals.
- Exact parser behavior for weekly/annual/quarterly inputs.

### Manual

The manual can be detailed, but should be layered:

1. Daily use.
2. Projects.
3. Agent workflows.
4. Optional modules.
5. Advanced target resolution.
6. Troubleshooting.

The current manual has good content, but `docs/operator-home-manual.md:89-109` is too dense. Split it into short sections and move parsing edge cases into an "Advanced target resolution" appendix.

### Runtime vault config

The vault template config should be productized:

- Replace personal owner defaults with placeholders.
- Avoid `Yuhan` as a default value.
- Avoid assuming one meeting recording path.
- Mark GitHub/Academic/AI-Weekly/Content folders as optional module folders.
- Leave `deep-research` behavior unchanged until a separate research-workflow review happens.

## Release And Install Strategy

### Immediate release path

Keep:

- `operator-control.zip`
- Individual release files
- `npm run install:plugin -- "<vault>"`

But clarify:

- Zip is for normal users.
- Installer script is for local developers.
- Agent skills are separate from the Obsidian dashboard.
- Optional modules are separate from core readiness.

### Improve the release artifact

Recommended changes:

- Rename release asset to include the plugin id and version, for example `operator-control-0.3.1.zip`.
- Keep the folder inside the zip as `operator-control/`.
- Release notes should include exactly three install steps and one troubleshooting note.
- README should not require users to understand `manifest.json`, `main.js`, or `styles.css` unless they are debugging.

### Medium-term install path

Once product surface is stable:

- Evaluate Obsidian community plugin distribution or beta-plugin distribution.
- Keep the release zip as fallback.
- Keep developer install script for local testing only.

## Skill Library Audit

### Keep and polish

- `vault-init`
- `daily-init`
- `weekly-init`
- `weekly-review`
- `project-sync`
- `meeting-prep`
- `meeting`
- `deadline-plan`
- `quarterly-plan`
- `annual-vision`
- `link-enrich`

### Hide from default UI but preserve

- `project-init`
- `using-obsidian-operator`
- raw custom prompts

### Make optional modules

- `daily-github`
- `daily-academic`
- `ai-weekly-digest`
- `content-extract`
- `content-draft`
- `add-events`

### Deferred review

- `deep-research`

Do not change `deep-research` during the next productization pass. Leave current access intact, do not add new first-screen placement, and revisit it later in a separate research-workflow review with its own success criteria.

## Implementation Direction For Future Goal Mode

### Phase 0: Merge-readiness cleanup for current PR

Goal: make the existing PR feel simpler without removing major functionality.

Status: implemented in the current cleanup pass. Keep the task list below as a regression checklist.

Tasks:

1. Compress README first-run and dashboard bullets.
2. Replace "boundary cascade" Today copy with user-facing language.
3. Move workflow parsing details into manual advanced section.
4. Keep More workflows collapsed.
5. Validate Claude skills readiness detection against real Claude Code state.
6. Run `npm run test`, `npm run check`, and package smoke.

Acceptance criteria:

- README no longer explains parser internals in the dashboard overview.
- Today screen does not expose internal terminology.
- Optional integrations still appear as optional, not blockers.
- Tests pass.

### Phase 1: Introduce product tiers in the UI

Goal: make default UI show core workflows first and optional modules only when deliberately enabled.

Status: partially implemented. The UI now has an **Optional modules** group, but there are not yet persisted user settings for enabling modules inside **Start my day**.

Likely files:

- `src/main.ts`
- `src/workflows.ts`
- `src/status.ts`
- `src/settings` or existing settings module if present
- `tests/operator-home.test.ts`
- `tests/status.test.ts`

Implementation shape:

- Add a workflow catalog in TypeScript, not skill frontmatter.
- Each workflow gets:
  - `tier`: `core | advanced | optional | labs | legacy`
  - `module`: `daily | projects | meetings | strategy | intelligence | content | calendar | research`
  - `defaultVisible`: boolean
  - `requires`: backend/integration hints
- Render optional module groups only when enabled or when the user expands "Optional modules".
- Do not add extra fields to `SKILL.md` frontmatter; repo rules allow only `name` and `description`.

Acceptance criteria:

- A new user sees core daily/project/meeting workflows without seeing GitHub/arXiv/content modules as defaults.
- Power users can still reach every legacy slash command.
- Tests cover hidden vs visible optional modules.

### Phase 2: Make `daily-init` modular, not smaller

Goal: preserve **Start my day** as the core concierge while making non-core personal modules explicit opt-in.

Status: partially implemented. Default auto-runs for intelligence/content modules were removed from `daily-init` and the preflight hook; persisted module settings remain future work.

Tasks:

1. Audit `daily-init` skill instructions and hooks to separate core concierge steps from optional module steps.
2. Keep the core concierge strong:
   - local date/time context
   - daily note creation/update
   - weekly setup/review catch-up when needed
   - project, blocker, manual-item, calendar, and Gmail context when configured
   - strategy boundary checks when the strategy layer exists
3. Gate optional post-briefing modules behind explicit enablement:
   - `daily-github`
   - `daily-academic`
   - `content-extract`
   - `ai-weekly-digest`
4. Add optional module flags or prompt context that explicitly says which modules are enabled.
5. Update tests that assert preview run notes and write areas.

Acceptance criteria:

- Start my day remains the primary daily orchestration flow.
- With no optional modules enabled, Start my day still produces a complete daily/weekly/project operating flow.
- Missing GitHub/arXiv/content integrations never look like setup failures.
- Preview separates core concierge actions from optional module actions.
- When an optional module is enabled, Start my day may orchestrate it deliberately.

### Phase 3: Productize vault template

Goal: remove original-owner assumptions.

Tasks:

1. Replace personal defaults in runtime `CLAUDE.md` / `AGENTS.md`.
2. Mark optional folders as optional.
3. Ensure `/vault-init` asks for or leaves placeholders for:
   - owner name
   - calendar/reminders names
   - meeting recording path
   - transcription preference
   - enabled modules
4. Update README/manual to avoid implying every folder is required.

Acceptance criteria:

- Clean vault setup does not mention the original maintainer as default owner.
- New users can skip optional modules without confusing empty folders.
- Agent runtime instructions match the product tiering.

### Phase 4: Skill audit and deprecation policy

Goal: make the skill library maintainable as a product.

Tasks:

1. Add a documented status for each skill:
   - Core
   - Advanced
   - Optional
   - Labs
   - Legacy
2. Update README skill table to show only Core and Advanced by default.
3. Move optional/labs skills into a separate docs section.
4. Mark `deep-research` as deferred for a separate research-workflow review rather than deciding its fate here.
5. Update UI labels so optional skills are not presented as essential product workflows.

Acceptance criteria:

- Product docs no longer read like a dump of all 20 historical skills.
- Optional skills remain discoverable.
- No existing skill is deleted without an explicit migration decision.

### Phase 5: Release polish

Goal: make install feel normal for non-developers.

Status: partially implemented. Packaging now creates a versioned zip alongside the compatibility zip; release notes and distribution strategy remain future work.

Tasks:

1. Version release zip names.
2. Add a short install page or release note template.
3. Keep developer install docs separate.
4. Add manual smoke checklist for clean vault install.
5. Consider future community/beta plugin distribution once the product surface stabilizes.

Acceptance criteria:

- Normal user install path never mentions `npm`, repo root, or copying unknown build artifacts.
- Developer install path remains clear.
- Release artifacts are easy to identify by version.

## Non-Goals

Do not do these during the next cleanup pass:

- Do not delete skills outright.
- Do not build a full task manager.
- Do not add a database.
- Do not add telemetry.
- Do not make optional integrations block daily workflows.
- Do not add new skill frontmatter fields.
- Do not make the README a complete architecture document.

## Suggested Next Goal Prompt

Use this prompt for the next goal-mode session:

```text
Goal: Continue from docs/2026-05-29-productization-goal-brief.md after the Phase 0 cleanup. Add persisted optional-module settings for Intelligence, Academic, Content, and Calendar/events; use those settings to decide whether Start my day may orchestrate optional modules; keep the core daily/weekly/project/strategy concierge flow strong. Preserve raw CLI access to every skill. Add tests for default-off modules and enabled-module preview behavior. Run npm run test and npm run check.
```

Do not revisit `deep-research` in that goal unless the user explicitly asks for a separate research-workflow review.
