import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import test from "node:test";
import { formatDashboardRunContext, formatRunContext, getDailyNotePath, getExecutionWeekFolder, getIsoWeekInfo, getLocalMinuteKey, getNextLocalMinuteDelayMs, getQuarterInfo, hasLocalDateChanged, hasLocalMinuteChanged } from "../src/dates";
import { appendQuickCapture, readOperatorHomeState, updateMarkdownTaskState } from "../src/home-state";
import { startAlignedMinuteRefresh } from "../src/clock-refresh";
import { buildCliHandoff } from "../src/cli-handoff";
import { buildProjectNote, createNativeProject, normalizeProjectName } from "../src/projects";
import { formatExpectedNoteStatus, formatRunCompletionNotice } from "../src/run-notices";
import { buildTodayScheduleLines } from "../src/today-surface";
import { parseActiveProjectNote, parseBlockers, parseDailyNote, parseWeeklyTodo } from "../src/vault-parsers";
import { buildAdvancedPromptPlaceholder, buildDefaultDailyPrompt, buildStartDaySpec, buildWorkflowSpec, describePrompt, resolveAdvancedPrompt, resolveAnnualShortcutInput, resolveAnnualYearInput, resolveAvailableHoursInput, resolveEditedPreviewSpec, resolveQuarterlyPeriodInput, resolveWeeklyPeriodInput } from "../src/workflows";

test("computes ISO week folders and daily note paths", () => {
  const date = new Date("2026-01-01T12:00:00");

  assert.deepEqual(getIsoWeekInfo(date), {
    isoYear: 2026,
    week: 1,
    label: "2026-W01",
  });
  assert.equal(getExecutionWeekFolder(date), "01_Execution/2026-W01");
  assert.equal(getDailyNotePath(date), "01_Execution/2026-W01/2026-01-01.md");
  assert.equal(hasLocalDateChanged("2026-05-22", new Date("2026-05-22T23:59:00")), false);
  assert.equal(hasLocalDateChanged("2026-05-22", new Date("2026-05-23T00:01:00")), true);
  assert.equal(getLocalMinuteKey(new Date("2026-05-22T09:15:30")), "2026-05-22T09:15");
  assert.equal(hasLocalMinuteChanged("2026-05-22T09:15", new Date("2026-05-22T09:15:59")), false);
  assert.equal(hasLocalMinuteChanged("2026-05-22T09:15", new Date("2026-05-22T09:16:00")), true);
  assert.equal(getNextLocalMinuteDelayMs(new Date("2026-05-22T09:15:00.000")), 60000);
  assert.equal(getNextLocalMinuteDelayMs(new Date("2026-05-22T09:15:45.250")), 14750);
});

test("clock refresh reschedules from the actual wake time", () => {
  let now = new Date("2026-05-22T09:15:45.250");
  let nextId = 1;
  const timers = new Map<number, () => void>();
  const delays: number[] = [];
  const cleared: number[] = [];
  let ticks = 0;

  const stop = startAlignedMinuteRefresh(() => {
    ticks += 1;
  }, {
    now: () => now,
    setTimeout: (callback, delay) => {
      const id = nextId++;
      timers.set(id, callback);
      delays.push(delay);
      return id;
    },
    clearTimeout: (id) => {
      cleared.push(id);
      timers.delete(id);
    },
  });

  assert.deepEqual(delays, [14750]);

  now = new Date("2026-05-22T09:16:04.100");
  timers.get(1)?.();

  assert.equal(ticks, 1);
  assert.deepEqual(delays, [14750, 55900]);

  stop();

  assert.deepEqual(cleared, [2]);
});

test("formats run completion notices with expected-note status", () => {
  assert.equal(
    formatRunCompletionNotice("success", "01_Execution/2026-W21/2026-05-22.md", true),
    "Operator run finished. Opened 01_Execution/2026-W21/2026-05-22.md.",
  );
  assert.equal(
    formatRunCompletionNotice("success", "01_Execution/2026-W21/2026-05-22.md", false),
    "Operator run finished. Expected note not found yet: 01_Execution/2026-W21/2026-05-22.md.",
  );
  assert.equal(formatRunCompletionNotice("failed"), "Operator run failed.");
  assert.equal(
    formatExpectedNoteStatus("01_Execution/2026-W21/2026-05-22.md", false, "success"),
    "Expected note missing: 01_Execution/2026-W21/2026-05-22.md",
  );
  assert.equal(
    formatExpectedNoteStatus("01_Execution/2026-W21/2026-05-22.md", true, "running"),
    "Expected note ready: 01_Execution/2026-W21/2026-05-22.md",
  );
  assert.equal(
    formatExpectedNoteStatus("01_Execution/2026-W21/2026-05-22.md", false, "running"),
    "Expected note pending: 01_Execution/2026-W21/2026-05-22.md",
  );
});

test("formats run context for agent prompts with local clock and planning period", () => {
  const date = new Date("2026-05-22T09:15:00");

  assert.deepEqual(getQuarterInfo(date), {
    year: 2026,
    quarter: 2,
    label: "2026-Q2",
  });
  assert.match(formatRunContext(date), /Local date: 2026-05-22/);
  assert.match(formatRunContext(date), /ISO week: 2026-W21/);
  assert.match(formatRunContext(date), /Quarter: 2026-Q2/);
  assert.match(formatDashboardRunContext(date), /^2026-05-22 09:15 .+ · 2026-W21 · 2026-Q2$/);
});

test("quarterly-plan skill documents explicit UI targets", () => {
  const skill = readFileSync("plugins/obsidian-operator/skills/quarterly-plan/SKILL.md", "utf8");

  assert.match(skill, /pulse \[YYYY-QX\|YYYY-MM\|MM\]/);
  assert.match(skill, /If it includes `pulse YYYY-QX`, target that quarter's final month/);
  assert.match(skill, /Pulse Mode[\s\S]*If the prompt includes `pulse YYYY-MM`/);
  assert.match(skill, /Init Mode[\s\S]*If the prompt includes `init YYYY-QX`/);
  assert.match(skill, /Review Mode[\s\S]*If the prompt includes `review YYYY-QX`/);
  assert.match(skill, /Auto-triggered by `\/daily-init` after a new quarter begins/);
  assert.doesNotMatch(skill, /first Monday of quarter/);
  assert.doesNotMatch(skill, /first Monday of new quarter/);
});

test("annual-vision skill documents explicit UI targets", () => {
  const skill = readFileSync("plugins/obsidian-operator/skills/annual-vision/SKILL.md", "utf8");

  assert.match(skill, /If the prompt includes `review`, use Review Mode/);
  assert.match(skill, /If the prompt includes `20\d{2}`, use that as the target year/);
  assert.match(skill, /In Review Mode without an explicit year, target the current year in December and the previous year otherwise/);
});

test("daily-init skill documents catch-up boundary triggers", () => {
  const skill = readFileSync("plugins/obsidian-operator/skills/daily-init/SKILL.md", "utf8");

  assert.match(skill, /catch-up runs later in the week are eligible/);
  assert.match(skill, /catch-up runs after the first day are eligible/);
  assert.doesNotMatch(skill, /different ISO week[\s\S]*most recent daily note/);
});

test("parses active project notes from frontmatter and ## Now", () => {
  const project = parseActiveProjectNote(
    "02_Projects/FM-Copilot/FM-Copilot.md",
    `---
type: project
status: active
project: FM-Copilot
---

# FM-Copilot

## Now

- [ ] Ship Operator Home
- [x] Completed launch checklist
- [-] Dropped old direction
- Validate against a real vault

## Risks

- Scope creep
`,
  );

  assert.deepEqual(project, {
    name: "FM-Copilot",
    notePath: "02_Projects/FM-Copilot/FM-Copilot.md",
    nextActions: ["Ship Operator Home", "Validate against a real vault"],
  });

  assert.equal(parseActiveProjectNote("02_Projects/Paused/Paused.md", "---\nstatus: paused\n---\n",), null);
});

test("parses waiting-on items and meeting timing from Blockers", () => {
  const summary = parseBlockers(
    `# Blockers

## Waiting On

- [ ] Alice: Send launch notes - [[FM-Copilot]]
- [x] Bob: Delivered transcript

## Meetings

- [ ] **Fri May 22, 2 PM** FM-Copilot sync
  - Review launch notes
- [ ] **Sat May 23, 10 AM** Research review
- [-] **Sun May 24, 9 AM** Cancelled call
`,
    new Date("2026-05-22T09:00:00"),
    ["FM-Copilot"],
  );

  assert.deepEqual(summary.waitingOn.map((item) => item.text), [
    "Alice: Send launch notes - FM-Copilot",
  ]);
  assert.equal(summary.meetings.length, 2);
  assert.equal(summary.meetings[0].timing, "today");
  assert.equal(summary.meetings[0].dateIso, "2026-05-22");
  assert.equal(summary.meetings[0].project, "FM-Copilot");
  assert.equal(summary.meetings[1].timing, "tomorrow");
});

test("combines daily schedule lines with today's blocker meetings", () => {
  const blockers = parseBlockers(
    `# Blockers

## Meetings

- [ ] **Fri May 22, 2 PM** FM-Copilot sync
- [ ] **Fri May 22, 4 PM** Design review
- [ ] **Sat May 23, 10 AM** Research review
`,
    new Date("2026-05-22T09:00:00"),
    ["FM-Copilot"],
  );

  assert.deepEqual(buildTodayScheduleLines(["10:00 Design review"], blockers.meetings), [
    "10:00 Design review",
    "2026-05-22 - Fri May 22, 2 PM FM-Copilot sync",
  ]);
});

test("parses today note focus, actions, schedule, and capture count", () => {
  const summary = parseDailyNote(`# 2026-05-22

## Focus

- Ship the native Operator Home
- Keep the daily surface simple

## Briefing

### Action Items

- [ ] Review UI against real vault
- [>] Carry project note edits
- [x] Done item

## Schedule

- 10:00 Design review
- [ ] 11:00 Ship check
- [x] 12:00 Completed sync
- [-] 13:00 Cancelled hold

## Capture

- Idea: make CLI advanced-only
`);

  assert.deepEqual(summary.focus, [
    "Ship the native Operator Home",
    "Keep the daily surface simple",
  ]);
  assert.deepEqual(summary.tasks.map((item) => item.text), ["Review UI against real vault"]);
  assert.deepEqual(summary.carriedForward.map((item) => item.text), ["Carry project note edits"]);
  assert.deepEqual(summary.schedule, ["10:00 Design review", "11:00 Ship check"]);
  assert.equal(summary.captureCount, 1);
});

test("does not surface deferred future daily items as today's next actions", () => {
  const summary = parseDailyNote(`# 2026-05-22

## Briefing

### Action Items

- [ ] Review UI against real vault
- [>] Carry project note edits

#### Deferred

- [>] Submit tax paperwork -> 2026-06-01
- [>] Book dentist -> next Friday
`);

  assert.deepEqual(summary.tasks.map((item) => item.text), ["Review UI against real vault"]);
  assert.deepEqual(summary.carriedForward.map((item) => item.text), ["Carry project note edits"]);
});

test("surfaces captured task checkboxes as today's next actions", () => {
  const summary = parseDailyNote(`# 2026-05-22

## Capture

- Idea: Keep CLI available for advanced prompts
- [ ] Reply to Alice about the timeline
- [>] Carry captured budget review
- Meeting note: Standup was moved to 2pm
`);

  assert.deepEqual(summary.tasks.map((item) => item.text), ["Reply to Alice about the timeline"]);
  assert.deepEqual(summary.carriedForward.map((item) => item.text), ["Carry captured budget review"]);
  assert.equal(summary.captureCount, 4);
});

test("parses weekly todo open work separately from completed work", () => {
  const summary = parseWeeklyTodo(`# Weekly Todo

- [ ] Native project creation
- [>] Carry dashboard polish
- [x] Old complete task
`);

  assert.deepEqual(summary.openTasks.map((item) => item.text), ["Native project creation"]);
  assert.deepEqual(summary.carriedForward.map((item) => item.text), ["Carry dashboard polish"]);
});

test("builds native project notes with normalized paths and placeholders", () => {
  const date = new Date("2026-05-22T09:00:00");
  assert.equal(normalizeProjectName("Customer Discovery / MVP"), "Customer-Discovery-MVP");

  const note = buildProjectNote("Customer-Discovery-MVP", {
    name: "Customer Discovery / MVP",
    category: "startup",
    description: "A lightweight validation sprint.",
    now: "Interview five users\nDraft landing page",
    risks: "",
  }, date);

  assert.match(note, /status: active/);
  assert.match(note, /date: 2026-05-22/);
  assert.match(note, /project: Customer-Discovery-MVP/);
  assert.match(note, /- Interview five users/);
  assert.match(note, /- \(none identified yet\)/);
});

test("native project creation and quick capture update the markdown home state", async () => {
  const app = createFakeApp();
  const date = new Date("2026-05-22T09:00:00");

  const project = await createNativeProject(app as never, {
    name: "Customer Discovery",
    category: "startup",
    description: "A lightweight validation sprint.",
    now: "Interview five users",
    risks: "",
  }, date);
  assert.equal(project.notePath, "02_Projects/Customer-Discovery/Customer-Discovery.md");

  await appendQuickCapture(app as never, "task", "Review interview notes\nSend follow-up", date);
  const home = await readOperatorHomeState(app as never, date);
  const dailyFile = app.vault.getAbstractFileByPath("01_Execution/2026-W21/2026-05-22.md");
  const dailyMarkdown = await app.vault.read(dailyFile as { path: string });

  assert.equal(home.daily.exists, true);
  assert.equal(home.blockersExists, false);
  assert.equal(home.daily.captureCount, 2);
  assert.match(dailyMarkdown, /- \[ \] Review interview notes\n- \[ \] Send follow-up/);
  assert.deepEqual(home.activeProjects.map((item) => item.name), ["Customer-Discovery"]);
  assert.deepEqual(home.activeProjects[0].nextActions, ["Interview five users"]);
});

test("reads blocker note existence for disabled open affordances", async () => {
  const app = createFakeApp();
  const date = new Date("2026-05-22T09:00:00");

  assert.equal((await readOperatorHomeState(app as never, date)).blockersExists, false);

  await app.vault.create("01_Execution/2026-W21/Blockers.md", "# Blockers\n");

  assert.equal((await readOperatorHomeState(app as never, date)).blockersExists, true);
});

test("updates markdown task state in the source note", async () => {
  const app = createFakeApp();
  await app.vault.create("01_Execution/2026-W21/Weekly Todo.md", [
    "# Weekly Todo",
    "",
    "- [ ] Ship UX review",
    "- [>] Carry research",
  ].join("\n"));

  await updateMarkdownTaskState(app as never, "01_Execution/2026-W21/Weekly Todo.md", "- [ ] Ship UX review", "x");
  await updateMarkdownTaskState(app as never, "01_Execution/2026-W21/Weekly Todo.md", "- [>] Carry research", " ");

  const file = app.vault.getAbstractFileByPath("01_Execution/2026-W21/Weekly Todo.md");
  const markdown = await app.vault.read(file as { path: string });

  assert.match(markdown, /- \[x\] Ship UX review/);
  assert.match(markdown, /- \[ \] Carry research/);
});

test("updates blocker waiting-on and meeting checkbox state", async () => {
  const app = createFakeApp();
  await app.vault.create("01_Execution/2026-W21/Blockers.md", [
    "# Blockers",
    "",
    "## Waiting On",
    "",
    "- [ ] Alice: Send launch notes",
    "",
    "## Meetings",
    "",
    "- [ ] **Fri May 22, 2 PM** FM-Copilot sync",
  ].join("\n"));

  const file = app.vault.getAbstractFileByPath("01_Execution/2026-W21/Blockers.md");
  const blockers = parseBlockers(await app.vault.read(file as { path: string }), new Date("2026-05-22T09:00:00"), ["FM-Copilot"]);

  await updateMarkdownTaskState(app as never, "01_Execution/2026-W21/Blockers.md", blockers.waitingOn[0].raw, "x");
  await updateMarkdownTaskState(app as never, "01_Execution/2026-W21/Blockers.md", blockers.meetings[0].raw, "x");

  const markdown = await app.vault.read(file as { path: string });
  assert.match(markdown, /- \[x\] Alice: Send launch notes/);
  assert.match(markdown, /- \[x\] \*\*Fri May 22, 2 PM\*\* FM-Copilot sync/);
});

test("dashboard wires blocker rows to native done actions", () => {
  const source = readFileSync("src/main.ts", "utf8");

  assert.match(source, /updateTaskFromUi\(home\.blockersPath, meeting, "x"\)/);
  assert.match(source, /updateTaskFromUi\(home\.blockersPath, item, "x"\)/);
  assert.match(source, /"Open blockers"[\s\S]*!home\.blockersExists/);
});

test("today next actions exclude carried-forward daily items", () => {
  const source = readFileSync("src/main.ts", "utf8");

  assert.match(source, /const actions = home\.daily\.tasks\.slice\(0, 8\)/);
  assert.doesNotMatch(source, /\.\.\.home\.daily\.carriedForward/);
});

test("current work agent shortcuts use workflow disabled state", () => {
  const source = readFileSync("src/main.ts", "utf8");

  assert.match(source, /this\.renderHomePanels\(root, status, home\)/);
  assert.match(source, /private renderHomePanels\(root: HTMLElement, status: OperatorEnvironmentStatus, home: OperatorHomeState\)/);
  assert.match(source, /const canRun = this\.canRun\(status\)/);
  assert.match(source, /const lockHelp = canRun[\s\S]*formatWorkflowUnavailableHelp\(status, this\.plugin\.settings\.backend, "Current Work", !!this\.plugin\.activeRun\)/);
  assert.match(source, /"Sync"[\s\S]*!canRun, lockHelp/);
  assert.match(source, /"Prep"[\s\S]*!canRun, lockHelp/);
});

test("preview copy uses the same resolved prompt as run", () => {
  const source = readFileSync("src/main.ts", "utf8");

  assert.match(source, /const getResolvedPreview = \(\) => resolveEditedPreviewSpec\(this\.spec, promptInput\.value\)/);
  assert.match(source, /copyTextToClipboard\(getResolvedPreview\(\)\.prompt, "Prompt copied\."\)/);
  assert.match(source, /this\.resolve\(getResolvedPreview\(\)\)/);
  assert.doesNotMatch(source, /copyTextToClipboard\(promptInput\.value, "Prompt copied\."\)/);
});

test("does not update ambiguous duplicate markdown task lines", async () => {
  const app = createFakeApp();
  await app.vault.create("01_Execution/2026-W21/Weekly Todo.md", [
    "# Weekly Todo",
    "",
    "- [ ] Follow up",
    "- [ ] Follow up",
  ].join("\n"));

  await assert.rejects(
    updateMarkdownTaskState(app as never, "01_Execution/2026-W21/Weekly Todo.md", "- [ ] Follow up", "x"),
    /appears more than once/,
  );

  const file = app.vault.getAbstractFileByPath("01_Execution/2026-W21/Weekly Todo.md");
  const markdown = await app.vault.read(file as { path: string });
  assert.equal((markdown.match(/- \[x\] Follow up/g) ?? []).length, 0);
  assert.equal((markdown.match(/- \[ \] Follow up/g) ?? []).length, 2);
});

test("builds editable workflow prompt specs", () => {
  const date = new Date("2026-05-22T09:00:00");
  const start = buildStartDaySpec(7, "review deck, email Kai", date);

  assert.equal(buildDefaultDailyPrompt(4.5), "/daily-init 4.5");
  assert.equal(buildDefaultDailyPrompt(Number.NaN), "/daily-init 6");
  assert.equal(buildAdvancedPromptPlaceholder(4.5), "/daily-init 4.5, /project-init MyProject, or review a note");
  assert.equal(resolveAdvancedPrompt("", 4.5), "/daily-init 4.5");
  assert.equal(resolveAdvancedPrompt("  /weekly-review  ", 4.5), "/weekly-review");
  assert.equal(resolveAvailableHoursInput("4.5", 6), 4.5);
  assert.equal(resolveAvailableHoursInput("20", 6), 16);
  assert.equal(resolveAvailableHoursInput("0", 7), 7);
  assert.equal(resolveAvailableHoursInput("abc", 7), 7);
  assert.equal(resolveWeeklyPeriodInput("init", "2026-W3", date), "2026-W03");
  assert.equal(resolveWeeklyPeriodInput("review", "review 2025-w52"), "2025-W52");
  assert.equal(resolveWeeklyPeriodInput("review", "last week", date), "2026-W20");
  assert.equal(resolveWeeklyPeriodInput("init", "last", date), "");
  assert.equal(resolveWeeklyPeriodInput("review", "later"), "");
  assert.equal(resolveAnnualYearInput("vision", "2025", date), "2025");
  assert.equal(resolveAnnualYearInput("review", "review 2025", date), "2025");
  assert.equal(resolveAnnualYearInput("vision", "2027 planning", date), "2027");
  assert.equal(resolveAnnualYearInput("vision", "", date), "2026");
  assert.equal(resolveAnnualYearInput("review", "", date), "2025");
  assert.equal(resolveAnnualYearInput("review", "", new Date("2026-12-15T09:00:00")), "2026");
  assert.equal(resolveAnnualYearInput("vision", "next year", date), "2027");
  assert.equal(resolveAnnualYearInput("vision", "last year", date), "2026");
  assert.equal(resolveAnnualYearInput("review", "last year", date), "2025");
  assert.equal(resolveAnnualYearInput("review", "next year", date), "2025");
  assert.deepEqual(resolveAnnualShortcutInput("vision", "", date), { year: "2026", nextInputValue: "" });
  assert.deepEqual(resolveAnnualShortcutInput("review", "", date), { year: "2025", nextInputValue: "" });
  assert.deepEqual(resolveAnnualShortcutInput("vision", "next", date), { year: "2027", nextInputValue: "" });
  assert.deepEqual(resolveAnnualShortcutInput("vision", "last", date), { year: "2026", nextInputValue: "" });
  assert.deepEqual(resolveAnnualShortcutInput("review", "next", date), { year: "2025", nextInputValue: "" });
  assert.deepEqual(resolveAnnualShortcutInput("review", "2024", date), { year: "2024", nextInputValue: "2024" });
  assert.equal(resolveQuarterlyPeriodInput("init", "2026-Q3"), "init 2026-Q3");
  assert.equal(resolveQuarterlyPeriodInput("review", "review 2025-q4"), "review 2025-Q4");
  assert.equal(resolveQuarterlyPeriodInput("pulse", "2026-04"), "pulse 2026-04");
  assert.equal(resolveQuarterlyPeriodInput("pulse", "2026-Q2"), "pulse 2026-06");
  assert.equal(resolveQuarterlyPeriodInput("pulse", "05", date), "pulse 2026-05");
  assert.equal(resolveQuarterlyPeriodInput("pulse", "12", new Date("2026-01-15T09:00:00")), "pulse 2025-12");
  assert.equal(resolveQuarterlyPeriodInput("init", "2026-04"), "init 2026-Q2");
  assert.equal(resolveQuarterlyPeriodInput("review", "2026-12"), "review 2026-Q4");
  assert.equal(resolveQuarterlyPeriodInput("review", ""), "review");

  assert.match(start.prompt, /^\/daily-init 7\n\nOperator run metadata \(do not treat as manual action items\):/);
  assert.match(start.prompt, /Local date: 2026-05-22/);
  assert.match(start.prompt, /Daily pre-flight guard:/);
  assert.match(start.prompt, /Do not rely on CLI hooks being available/);
  assert.match(
    start.prompt,
    /Evaluate these boundary conditions before writing today's briefing, and run a boundary command only when both its date condition and missing-artifact condition are true\./,
  );
  assert.match(start.prompt, /Weekly close\/digest date condition: current ISO week is after the target week, so catch-up runs later in the week are eligible/);
  assert.match(start.prompt, /Monthly pulse date condition: current month is after the target month, so catch-up runs after the first day are eligible/);
  assert.match(start.prompt, /Quarter review\/plan date condition: current quarter is after the review target and the current quarter has begun, so catch-up runs after the first day are eligible/);
  assert.match(start.prompt, /Execution order for eligible missing artifacts: \/weekly-review 2026-W20, \/ai-weekly-digest 2026-W20, \/quarterly-plan pulse 2026-04, \/quarterly-plan review 2026-Q1, \/quarterly-plan init 2026-Q2, then always run \/weekly-init 2026-W21\./);
  assert.match(start.prompt, /Check exact artifacts before deciding a boundary run is missing:/);
  assert.match(start.prompt, /Weekly review artifact: 01_Execution\/2026-W20\/Weekly Review\.md/);
  assert.match(start.prompt, /AI weekly artifact: 04_Knowledge\/AI-Weekly\/2026-W20 - AI Weekly Digest\.md/);
  assert.match(start.prompt, /Monthly pulse artifact: 00_Strategy\/2026-Q2\/Monthly Pulse - 04\.md/);
  assert.match(start.prompt, /Quarterly review artifact: 00_Strategy\/2026-Q1\/Quarterly Review\.md/);
  assert.match(start.prompt, /Quarterly plan artifact: 00_Strategy\/2026-Q2\/Quarterly Plan\.md/);
  assert.doesNotMatch(start.prompt, /Run missing weekly, monthly, and quarterly boundary workflows/);
  assert.match(start.prompt, /\/weekly-review 2026-W20/);
  assert.match(start.prompt, /\/ai-weekly-digest 2026-W20/);
  assert.match(start.prompt, /\/quarterly-plan pulse 2026-04/);
  assert.match(start.prompt, /\/quarterly-plan review 2026-Q1/);
  assert.match(start.prompt, /\/quarterly-plan init 2026-Q2/);
  assert.match(start.prompt, /Current week setup: \/weekly-init 2026-W21/);
  assert.match(start.prompt, /Manual items to consider today:\nreview deck, email Kai/);
  assert.ok(start.prompt.indexOf("Daily pre-flight guard") < start.prompt.indexOf("Manual items to consider today"));
  assert.ok(start.prompt.indexOf("Operator run metadata") < start.prompt.indexOf("Manual items to consider today"));
  const multilineManualStart = buildStartDaySpec(6, "review deck\nemail Kai\n  prep demo  ", date);
  assert.match(multilineManualStart.prompt, /Manual items to consider today:\nreview deck\nemail Kai\n  prep demo/);
  assert.equal(start.expectedOpenPath, "01_Execution/2026-W21/2026-05-22.md");
  assert.deepEqual(start.targetNotes, [
    "Daily note: 01_Execution/2026-W21/2026-05-22.md",
    "Execution week: 2026-W21",
    "Planning quarter: 2026-Q2",
  ]);
  assert.equal(start.search, true);
  assert.deepEqual(start.runNotes, [
    "Pre-flight may catch up missing prior-period artifacts after a week, month, or quarter boundary has passed.",
    "Pre-flight target checks: /weekly-review 2026-W20, /ai-weekly-digest 2026-W20, /quarterly-plan pulse 2026-04, /quarterly-plan review 2026-Q1, /quarterly-plan init 2026-Q2.",
    "Always opens target week with /weekly-init 2026-W21 before writing today's briefing.",
  ]);

  const mondayStart = buildStartDaySpec(6, "", new Date("2026-05-25T09:00:00"));
  assert.deepEqual(mondayStart.runNotes, [
    "Pre-flight may catch up missing prior-period artifacts after a week, month, or quarter boundary has passed.",
    "Pre-flight target checks: /weekly-review 2026-W21, /ai-weekly-digest 2026-W21, /quarterly-plan pulse 2026-04, /quarterly-plan review 2026-Q1, /quarterly-plan init 2026-Q2.",
    "Pre-flight may close last week: /weekly-review 2026-W21, then /ai-weekly-digest 2026-W21.",
    "Always opens target week with /weekly-init 2026-W22 before writing today's briefing.",
  ]);

  const newYearDay = buildStartDaySpec(6, "", new Date("2026-01-01T09:00:00"));
  assert.match(newYearDay.prompt, /\/weekly-review 2025-W52/);
  assert.match(newYearDay.prompt, /\/ai-weekly-digest 2025-W52/);
  assert.match(newYearDay.prompt, /\/quarterly-plan pulse 2025-12/);
  assert.match(newYearDay.prompt, /\/quarterly-plan review 2025-Q4/);
  assert.match(newYearDay.prompt, /\/quarterly-plan init 2026-Q1/);
  assert.deepEqual(newYearDay.runNotes, [
    "Pre-flight may catch up missing prior-period artifacts after a week, month, or quarter boundary has passed.",
    "Pre-flight target checks: /weekly-review 2025-W52, /ai-weekly-digest 2025-W52, /quarterly-plan pulse 2025-12, /quarterly-plan review 2025-Q4, /quarterly-plan init 2026-Q1.",
    "Pre-flight may close last month: /quarterly-plan pulse 2025-12.",
    "Pre-flight may close/open quarter boundaries: /quarterly-plan review 2025-Q4, then /quarterly-plan init 2026-Q1.",
    "Always opens target week with /weekly-init 2026-W01 before writing today's briefing.",
  ]);

  const fractionalDay = buildStartDaySpec(4.5, "", date);
  assert.match(fractionalDay.prompt, /^\/daily-init 4\.5\n\nOperator run metadata/);

  assert.equal(buildWorkflowSpec("weekly-init", "", date).expectedOpenPath, "01_Execution/2026-W21/Weekly Todo.md");
  assert.equal(buildWorkflowSpec("weekly-init", "", date).label, "Plan 2026-W21");
  assert.deepEqual(buildWorkflowSpec("weekly-init", "", date).targetNotes, ["Execution week: 2026-W21"]);
  assert.match(buildWorkflowSpec("weekly-init", "", date).prompt, /^\/weekly-init 2026-W21\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("weekly-init", resolveWeeklyPeriodInput("init", "last", date), date).expectedOpenPath, "01_Execution/2026-W21/Weekly Todo.md");
  assert.match(buildWorkflowSpec("weekly-init", resolveWeeklyPeriodInput("init", "last", date), date).prompt, /^\/weekly-init 2026-W21\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("weekly-init", "2026-W18", date).expectedOpenPath, "01_Execution/2026-W18/Weekly Todo.md");
  assert.equal(buildWorkflowSpec("weekly-init", "2026-W18", date).label, "Plan 2026-W18");
  assert.deepEqual(buildWorkflowSpec("weekly-init", "2026-W18", date).targetNotes, ["Execution week: 2026-W18"]);
  assert.match(buildWorkflowSpec("weekly-init", "2026-W18", date).prompt, /^\/weekly-init 2026-W18\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("weekly-init", "2026-W3", date).expectedOpenPath, "01_Execution/2026-W03/Weekly Todo.md");
  assert.equal(buildWorkflowSpec("weekly-init", "2026-W3", date).label, "Plan 2026-W03");
  assert.equal(buildWorkflowSpec("weekly-review", "", date).expectedOpenPath, "01_Execution/2026-W21/Weekly Review.md");
  assert.equal(buildWorkflowSpec("weekly-review", "", date).label, "Review 2026-W21");
  assert.deepEqual(buildWorkflowSpec("weekly-review", "", date).targetNotes, ["Review week: 2026-W21"]);
  assert.match(buildWorkflowSpec("weekly-review", "", date).prompt, /^\/weekly-review 2026-W21\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("weekly-review", "last", date).expectedOpenPath, "01_Execution/2026-W20/Weekly Review.md");
  assert.equal(buildWorkflowSpec("weekly-review", "last", date).label, "Review 2026-W20");
  assert.deepEqual(buildWorkflowSpec("weekly-review", "last", date).readAreas, ["Target week's daily notes, Weekly Todo, Blockers, and active projects"]);
  assert.deepEqual(buildWorkflowSpec("weekly-review", "last", date).targetNotes, ["Review week: 2026-W20"]);
  assert.equal(buildWorkflowSpec("weekly-review", "2026-W18", date).expectedOpenPath, "01_Execution/2026-W18/Weekly Review.md");
  assert.equal(describePrompt("/weekly-review 2026-W3", date).expectedOpenPath, "01_Execution/2026-W03/Weekly Review.md");
  assert.match(describePrompt("/weekly-review 2026-W3", date).prompt, /^\/weekly-review 2026-W03\n\nOperator run metadata/);
  assert.equal(describePrompt("/weekly-review last week", date).expectedOpenPath, "01_Execution/2026-W20/Weekly Review.md");
  assert.match(describePrompt("/weekly-review last week", date).prompt, /^\/weekly-review 2026-W20\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("weekly-review", "", new Date("2026-05-25T09:00:00")).expectedOpenPath, "01_Execution/2026-W21/Weekly Review.md");
  assert.match(buildWorkflowSpec("weekly-review", "", new Date("2026-05-25T09:00:00")).prompt, /^\/weekly-review 2026-W21\n\nOperator run metadata/);
  const mondayWeeklyReview = buildWorkflowSpec("weekly-review", "", new Date("2026-05-25T09:00:00"));
  assert.equal(mondayWeeklyReview.label, "Review 2026-W21");
  assert.equal(describePrompt(mondayWeeklyReview.prompt, new Date("2026-05-25T10:00:00")).expectedOpenPath, "01_Execution/2026-W21/Weekly Review.md");
  assert.equal(buildWorkflowSpec("annual-vision", "", date).expectedOpenPath, "00_Strategy/2026 Vision.md");
  assert.equal(buildWorkflowSpec("annual-vision", "", date).label, "Annual vision 2026");
  assert.deepEqual(buildWorkflowSpec("annual-vision", "", date).writeAreas, ["00_Strategy/2026 Vision.md"]);
  assert.deepEqual(buildWorkflowSpec("annual-vision", "", date).targetNotes, ["Annual vision target: 2026"]);
  assert.match(buildWorkflowSpec("annual-vision", "", date).prompt, /^\/annual-vision 2026\n\nOperator run metadata/);
  assert.match(buildWorkflowSpec("annual-vision", "review", date).prompt, /^\/annual-vision review 2025\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("annual-vision", "review", date).expectedOpenPath, "00_Strategy/2025 Annual Review.md");
  assert.equal(buildWorkflowSpec("annual-vision", "review", date).label, "Annual review 2025");
  assert.deepEqual(buildWorkflowSpec("annual-vision", "review", date).writeAreas, ["00_Strategy/2025 Annual Review.md"]);
  assert.deepEqual(buildWorkflowSpec("annual-vision", "review", date).targetNotes, ["Annual review target: 2025"]);
  assert.equal(buildWorkflowSpec("annual-vision", "review 2026", date).expectedOpenPath, "00_Strategy/2026 Annual Review.md");
  assert.equal(describePrompt("/annual-vision next", date).expectedOpenPath, "00_Strategy/2027 Vision.md");
  assert.match(describePrompt("/annual-vision next", date).prompt, /^\/annual-vision 2027\n\nOperator run metadata/);
  assert.equal(describePrompt("/annual-vision review next", date).expectedOpenPath, "00_Strategy/2025 Annual Review.md");
  assert.match(describePrompt("/annual-vision review next", date).prompt, /^\/annual-vision review 2025\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("quarterly-plan", "init", date).expectedOpenPath, "00_Strategy/2026-Q2/Quarterly Plan.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "init", date).label, "Quarter plan 2026-Q2");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "init", date).writeAreas, ["00_Strategy/2026-Q2/Quarterly Plan.md"]);
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "init", date).targetNotes, ["Quarterly plan target: 2026-Q2"]);
  assert.match(buildWorkflowSpec("quarterly-plan", "init", date).prompt, /^\/quarterly-plan init 2026-Q2\n\nOperator run metadata/);
  assert.match(
    buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("init", "2026-07", date), date).prompt,
    /^\/quarterly-plan init 2026-Q3\n\nOperator run metadata/,
  );
  assert.match(
    buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("review", "2026-12", date), date).prompt,
    /^\/quarterly-plan review 2026-Q4\n\nOperator run metadata/,
  );
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse", date).expectedOpenPath, "00_Strategy/2026-Q2/Monthly Pulse - 04.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse", date).label, "Monthly pulse 2026-04");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "pulse", date).writeAreas, ["00_Strategy/2026-Q2/Monthly Pulse - 04.md"]);
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "pulse", date).targetNotes, ["Monthly pulse target: 2026-04"]);
  assert.match(buildWorkflowSpec("quarterly-plan", "pulse", date).prompt, /^\/quarterly-plan pulse 2026-04\n\nOperator run metadata/);
  assert.match(
    buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("pulse", "05", date), date).prompt,
    /^\/quarterly-plan pulse 2026-05\n\nOperator run metadata/,
  );
  assert.match(
    buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("pulse", "2026-Q2", date), date).prompt,
    /^\/quarterly-plan pulse 2026-06\n\nOperator run metadata/,
  );
  assert.equal(
    buildWorkflowSpec("quarterly-plan", resolveQuarterlyPeriodInput("pulse", "2026-Q2", date), date).expectedOpenPath,
    "00_Strategy/2026-Q2/Monthly Pulse - 06.md",
  );
  assert.equal(
    describePrompt("/quarterly-plan pulse 2026-Q2", date).expectedOpenPath,
    "00_Strategy/2026-Q2/Monthly Pulse - 06.md",
  );
  assert.match(describePrompt("/quarterly-plan pulse 2026-Q2", date).prompt, /^\/quarterly-plan pulse 2026-06\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 05", date).expectedOpenPath, "00_Strategy/2026-Q2/Monthly Pulse - 05.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 05", date).label, "Monthly pulse 2026-05");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 2025-12", new Date("2026-01-01T09:00:00")).expectedOpenPath, "00_Strategy/2025-Q4/Monthly Pulse - 12.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 2025-12", new Date("2026-01-01T09:00:00")).label, "Monthly pulse 2025-12");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "pulse 2025-12", new Date("2026-01-01T09:00:00")).targetNotes, ["Monthly pulse target: 2025-12"]);
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse", new Date("2026-01-01T09:00:00")).expectedOpenPath, "00_Strategy/2025-Q4/Monthly Pulse - 12.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse", new Date("2026-01-01T09:00:00")).label, "Monthly pulse 2025-12");
  assert.equal(buildWorkflowSpec("quarterly-plan", "review", date).expectedOpenPath, "00_Strategy/2026-Q1/Quarterly Review.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "review", date).label, "Quarter review 2026-Q1");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "review", date).writeAreas, ["00_Strategy/2026-Q1/Quarterly Review.md"]);
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "review", date).targetNotes, ["Quarterly review target: 2026-Q1"]);
  assert.match(buildWorkflowSpec("quarterly-plan", "review", date).prompt, /^\/quarterly-plan review 2026-Q1\n\nOperator run metadata/);
  const quarterReview = buildWorkflowSpec("quarterly-plan", "review", date);
  assert.equal(describePrompt(quarterReview.prompt, date).expectedOpenPath, "00_Strategy/2026-Q1/Quarterly Review.md");

  const projectSync = buildWorkflowSpec("project-sync", "FM-Copilot", date);
  assert.equal(buildWorkflowSpec("project-init", "FM-Copilot", date).label, "Create FM-Copilot");
  assert.equal(projectSync.label, "Sync FM-Copilot");
  assert.equal(buildWorkflowSpec("deadline-plan", "FM-Copilot", date).label, "Plan deadline FM-Copilot");
  assert.match(projectSync.prompt, /^\/project-sync FM-Copilot\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("meeting-prep", "FM-Copilot 2026-05-29", date).label, "Prep meeting FM-Copilot 2026-05-29");
  assert.equal(buildWorkflowSpec("content-draft", "pricing launch notes", date).label, "Draft pricing launch notes");
  assert.equal(buildWorkflowSpec("content-draft", "", date).label, "Draft content");
  assert.equal(buildWorkflowSpec("deep-research", "operator onboarding UX", date).label, "Deep research operator onboarding UX");
  assert.match(describePrompt("/annual-vision review", date).prompt, /^\/annual-vision review\n\nOperator run metadata/);
  assert.match(buildWorkflowSpec("quarterly-plan", "pulse 05", date).prompt, /^\/quarterly-plan pulse 05\n\nOperator run metadata/);
  assert.match(describePrompt("/quarterly-plan init", date).prompt, /^\/quarterly-plan init\n\nOperator run metadata/);
  assert.match(describePrompt("/weekly-review", date).prompt, /^\/weekly-review\n\nOperator run metadata/);
  assert.match(buildWorkflowSpec("ai-weekly-digest", "last", date).prompt, /^\/ai-weekly-digest 2026-W20\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W21 - AI Weekly Digest.md");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "", date).label, "AI weekly 2026-W21");
  assert.deepEqual(buildWorkflowSpec("ai-weekly-digest", "", date).targetNotes, ["AI weekly target: 2026-W21"]);
  assert.match(buildWorkflowSpec("ai-weekly-digest", "", date).prompt, /^\/ai-weekly-digest 2026-W21\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "last", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W20 - AI Weekly Digest.md");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "last", date).label, "AI weekly 2026-W20");
  assert.deepEqual(buildWorkflowSpec("ai-weekly-digest", "last", date).writeAreas, ["04_Knowledge/AI-Weekly/ and the target week's Weekly Review when present"]);
  assert.deepEqual(buildWorkflowSpec("ai-weekly-digest", "last", date).targetNotes, ["AI weekly target: 2026-W20"]);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "2026-W18", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W18 - AI Weekly Digest.md");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "2026-W3", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W03 - AI Weekly Digest.md");
  assert.match(describePrompt("/ai-weekly-digest 2026-W3", date).prompt, /^\/ai-weekly-digest 2026-W03\n\nOperator run metadata/);
  assert.equal(describePrompt("/ai-weekly-digest last week", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W20 - AI Weekly Digest.md");
  assert.match(describePrompt("/ai-weekly-digest last week", date).prompt, /^\/ai-weekly-digest 2026-W20\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "2026-W18", date).label, "AI weekly 2026-W18");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "", new Date("2026-05-25T09:00:00")).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W21 - AI Weekly Digest.md");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "", new Date("2026-05-25T09:00:00")).label, "AI weekly 2026-W21");
  assert.match(buildWorkflowSpec("ai-weekly-digest", "", new Date("2026-05-25T09:00:00")).prompt, /^\/ai-weekly-digest 2026-W21\n\nOperator run metadata/);
  assert.match(describePrompt("/ai-weekly-digest", date).prompt, /^\/ai-weekly-digest\n\nOperator run metadata/);
  assert.match(describePrompt("/ai-weekly-digest last", date).prompt, /^\/ai-weekly-digest last\n\nOperator run metadata/);
  assert.equal(describePrompt("/ai-weekly-digest last", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W20 - AI Weekly Digest.md");

  const eventList = "Fri 2pm Design review\nSat 10am Research sync";
  assert.match(buildWorkflowSpec("add-events", eventList, date).prompt, /^\/add-events\nFri 2pm Design review\nSat 10am Research sync\n\nOperator run metadata/);

  const transcript = "Alice: The launch moved to Friday.\nBob: I will update the brief.";
  assert.match(buildWorkflowSpec("meeting", transcript, date).prompt, /^\/meeting\nAlice: The launch moved to Friday\.\nBob: I will update the brief\.\n\nOperator run metadata/);

  const typedDaily = describePrompt("/daily-init 4.5", date);
  assert.match(typedDaily.prompt, /^\/daily-init 4\.5\n\nOperator run metadata/);
  assert.match(typedDaily.prompt, /Daily pre-flight guard:/);
  assert.match(typedDaily.prompt, /\/weekly-review 2026-W20/);
  assert.deepEqual(typedDaily.runNotes, [
    "Pre-flight may catch up missing prior-period artifacts after a week, month, or quarter boundary has passed.",
    "Pre-flight target checks: /weekly-review 2026-W20, /ai-weekly-digest 2026-W20, /quarterly-plan pulse 2026-04, /quarterly-plan review 2026-Q1, /quarterly-plan init 2026-Q2.",
    "Always opens target week with /weekly-init 2026-W21 before writing today's briefing.",
  ]);

  const delayedDaily = describePrompt(typedDaily.prompt, new Date("2026-05-23T00:15:00"));
  assert.match(delayedDaily.prompt, /Local date: 2026-05-22/);
  assert.equal(delayedDaily.expectedOpenPath, "01_Execution/2026-W21/2026-05-22.md");
  assert.deepEqual(delayedDaily.targetNotes, [
    "Daily note: 01_Execution/2026-W21/2026-05-22.md",
    "Execution week: 2026-W21",
    "Planning quarter: 2026-Q2",
  ]);

  const typedEvents = describePrompt(`/add-events\n${eventList}`, date);
  assert.match(typedEvents.prompt, /^\/add-events\nFri 2pm Design review\nSat 10am Research sync\n\nOperator run metadata/);

  const typedWeeklyReview = describePrompt("/weekly-review", date);
  assert.match(typedWeeklyReview.prompt, /^\/weekly-review\n\nOperator run metadata/);
  assert.equal(describePrompt("/weekly-init 2026-W18", date).expectedOpenPath, "01_Execution/2026-W18/Weekly Todo.md");
  assert.match(describePrompt("/weekly-init 2026-W3", date).prompt, /^\/weekly-init 2026-W03\n\nOperator run metadata/);

  const editedWeeklyReview = resolveEditedPreviewSpec(buildWorkflowSpec("weekly-review", "", date), "/weekly-review 2026-W18", date);
  assert.equal(editedWeeklyReview.label, "Review 2026-W18");
  assert.equal(editedWeeklyReview.expectedOpenPath, "01_Execution/2026-W18/Weekly Review.md");
  const originalWeeklyReview = buildWorkflowSpec("weekly-review", "", date);
  const blankEditedWeeklyReview = resolveEditedPreviewSpec(originalWeeklyReview, "   ", date);
  assert.equal(blankEditedWeeklyReview.prompt, originalWeeklyReview.prompt);
  assert.equal(blankEditedWeeklyReview.expectedOpenPath, originalWeeklyReview.expectedOpenPath);

  const described = describePrompt("/deep-research AI evals", date);
  assert.equal(described.id, "deep-research");
  assert.match(described.prompt, /^\/deep-research AI evals\n\nOperator run metadata/);
  assert.equal(described.search, true);

  const custom = describePrompt("review the current note", date);
  assert.equal(custom.prompt, "review the current note");
});

test("builds CLI handoff as a runnable codex exec command with the enhanced daily prompt", () => {
  const handoff = buildCliHandoff("/tmp/My Vault", "/daily-init 4.5", new Date("2026-05-22T09:00:00"));

  assert.match(handoff, /^cd '\/tmp\/My Vault'\ncodex exec --cd '\/tmp\/My Vault' --skip-git-repo-check --sandbox workspace-write --ask-for-approval on-request --search /);
  assert.match(handoff, /'\/daily-init 4\.5/);
  assert.match(handoff, /Daily pre-flight guard:/);
  assert.match(handoff, /Local date: 2026-05-22/);

  const resolvedHandoff = buildCliHandoff("/tmp/My Vault", "/daily-init 4.5", new Date("2026-05-22T09:00:00"), "codex", {
    codexPath: "/Users/herschel/.nvm/versions/node/v24.14.0/bin/codex",
  });
  assert.match(resolvedHandoff, /^cd '\/tmp\/My Vault'\n'\/Users\/herschel\/\.nvm\/versions\/node\/v24\.14\.0\/bin\/codex' exec /);
});

test("builds CLI handoff for Claude when Claude backend is selected", () => {
  const handoff = buildCliHandoff("/tmp/My Vault", "/annual-vision review", new Date("2026-05-22T09:00:00"), "claude");

  assert.match(handoff, /^cd '\/tmp\/My Vault'\nclaude -p /);
  assert.match(handoff, /'\/annual-vision review/);
  assert.match(handoff, /Operator run metadata/);

  const resolvedHandoff = buildCliHandoff("/tmp/My Vault", "/annual-vision review", new Date("2026-05-22T09:00:00"), "claude", {
    claudePath: "/opt/homebrew/bin/claude",
  });
  assert.match(resolvedHandoff, /^cd '\/tmp\/My Vault'\n'\/opt\/homebrew\/bin\/claude' -p /);
});

function createFakeApp(): {
  vault: {
    getMarkdownFiles: () => Array<{ path: string; extension: string }>;
    getAbstractFileByPath: (path: string) => { path: string; extension?: string } | null;
    read: (file: { path: string }) => Promise<string>;
    create: (path: string, content: string) => Promise<{ path: string; extension: string }>;
    createFolder: (path: string) => Promise<void>;
    process: (file: { path: string }, update: (current: string) => string) => Promise<void>;
  };
} {
  const files = new Map<string, string>();
  const folders = new Set<string>();

  return {
    vault: {
      getMarkdownFiles: () => [...files.keys()]
        .filter((path) => path.endsWith(".md"))
        .map((path) => ({ path, extension: "md" })),
      getAbstractFileByPath: (path: string) => {
        if (files.has(path)) {
          return { path, extension: path.split(".").pop() ?? "" };
        }
        if (folders.has(path)) {
          return { path };
        }
        return null;
      },
      read: async (file: { path: string }) => files.get(file.path) ?? "",
      create: async (path: string, content: string) => {
        files.set(path, content);
        return { path, extension: path.split(".").pop() ?? "" };
      },
      createFolder: async (path: string) => {
        folders.add(path);
      },
      process: async (file: { path: string }, update: (current: string) => string) => {
        files.set(file.path, update(files.get(file.path) ?? ""));
      },
    },
  };
}
