import { strict as assert } from "node:assert";
import test from "node:test";
import { formatRunContext, getDailyNotePath, getExecutionWeekFolder, getIsoWeekInfo, getQuarterInfo } from "../src/dates";
import { appendQuickCapture, readOperatorHomeState, updateMarkdownTaskState } from "../src/home-state";
import { buildCliHandoff } from "../src/cli-handoff";
import { buildProjectNote, createNativeProject, normalizeProjectName } from "../src/projects";
import { parseActiveProjectNote, parseBlockers, parseDailyNote, parseWeeklyTodo } from "../src/vault-parsers";
import { buildAdvancedPromptPlaceholder, buildDefaultDailyPrompt, buildStartDaySpec, buildWorkflowSpec, describePrompt, resolveAdvancedPrompt } from "../src/workflows";

test("computes ISO week folders and daily note paths", () => {
  const date = new Date("2026-01-01T12:00:00");

  assert.deepEqual(getIsoWeekInfo(date), {
    isoYear: 2026,
    week: 1,
    label: "2026-W01",
  });
  assert.equal(getExecutionWeekFolder(date), "01_Execution/2026-W01");
  assert.equal(getDailyNotePath(date), "01_Execution/2026-W01/2026-01-01.md");
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

## Capture

- Idea: make CLI advanced-only
`);

  assert.deepEqual(summary.focus, [
    "Ship the native Operator Home",
    "Keep the daily surface simple",
  ]);
  assert.deepEqual(summary.tasks.map((item) => item.text), ["Review UI against real vault"]);
  assert.deepEqual(summary.carriedForward.map((item) => item.text), ["Carry project note edits"]);
  assert.deepEqual(summary.schedule, ["10:00 Design review"]);
  assert.equal(summary.captureCount, 1);
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

  await appendQuickCapture(app as never, "task", "Review interview notes", date);
  const home = await readOperatorHomeState(app as never, date);

  assert.equal(home.daily.exists, true);
  assert.equal(home.daily.captureCount, 1);
  assert.deepEqual(home.activeProjects.map((item) => item.name), ["Customer-Discovery"]);
  assert.deepEqual(home.activeProjects[0].nextActions, ["Interview five users"]);
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

  assert.match(start.prompt, /^\/daily-init 7\n\nOperator run metadata \(do not treat as manual action items\):/);
  assert.match(start.prompt, /Local date: 2026-05-22/);
  assert.match(start.prompt, /Daily pre-flight guard:/);
  assert.match(start.prompt, /Do not rely on CLI hooks being available/);
  assert.match(start.prompt, /Run missing weekly, monthly, and quarterly boundary workflows before writing today's briefing/);
  assert.match(start.prompt, /\/weekly-review 2026-W20/);
  assert.match(start.prompt, /\/ai-weekly-digest 2026-W20/);
  assert.match(start.prompt, /\/quarterly-plan pulse 2026-04/);
  assert.match(start.prompt, /\/quarterly-plan review 2026-Q1/);
  assert.match(start.prompt, /\/quarterly-plan init 2026-Q2/);
  assert.match(start.prompt, /Manual items to consider today:\nreview deck, email Kai/);
  assert.ok(start.prompt.indexOf("Daily pre-flight guard") < start.prompt.indexOf("Manual items to consider today"));
  assert.ok(start.prompt.indexOf("Operator run metadata") < start.prompt.indexOf("Manual items to consider today"));
  assert.equal(start.expectedOpenPath, "01_Execution/2026-W21/2026-05-22.md");
  assert.deepEqual(start.targetNotes, [
    "Daily note: 01_Execution/2026-W21/2026-05-22.md",
    "Execution week: 2026-W21",
    "Planning quarter: 2026-Q2",
  ]);
  assert.equal(start.search, true);
  assert.deepEqual(start.runNotes, [
    "Pre-flight may close last week: /weekly-review 2026-W20, then /ai-weekly-digest 2026-W20.",
    "Pre-flight may close last month: /quarterly-plan pulse 2026-04.",
    "Pre-flight may close/open quarter boundaries: /quarterly-plan review 2026-Q1, then /quarterly-plan init 2026-Q2.",
    "Always opens this week with /weekly-init before writing today's briefing.",
  ]);

  const newYearDay = buildStartDaySpec(6, "", new Date("2026-01-01T09:00:00"));
  assert.match(newYearDay.prompt, /\/weekly-review 2025-W52/);
  assert.match(newYearDay.prompt, /\/ai-weekly-digest 2025-W52/);
  assert.match(newYearDay.prompt, /\/quarterly-plan pulse 2025-12/);
  assert.match(newYearDay.prompt, /\/quarterly-plan review 2025-Q4/);
  assert.match(newYearDay.prompt, /\/quarterly-plan init 2026-Q1/);

  const fractionalDay = buildStartDaySpec(4.5, "", date);
  assert.match(fractionalDay.prompt, /^\/daily-init 4\.5\n\nOperator run metadata/);

  assert.equal(buildWorkflowSpec("weekly-init", "", date).expectedOpenPath, "01_Execution/2026-W21/Weekly Todo.md");
  assert.deepEqual(buildWorkflowSpec("weekly-init", "", date).targetNotes, ["Execution week: 2026-W21"]);
  assert.equal(buildWorkflowSpec("weekly-review", "", date).expectedOpenPath, "01_Execution/2026-W21/Weekly Review.md");
  assert.deepEqual(buildWorkflowSpec("weekly-review", "", date).targetNotes, ["Review week: 2026-W21"]);
  assert.match(buildWorkflowSpec("weekly-review", "", date).prompt, /^\/weekly-review 2026-W21\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("weekly-review", "last", date).expectedOpenPath, "01_Execution/2026-W20/Weekly Review.md");
  assert.deepEqual(buildWorkflowSpec("weekly-review", "last", date).targetNotes, ["Review week: 2026-W20"]);
  assert.equal(buildWorkflowSpec("weekly-review", "2026-W18", date).expectedOpenPath, "01_Execution/2026-W18/Weekly Review.md");
  assert.equal(buildWorkflowSpec("weekly-review", "", new Date("2026-05-25T09:00:00")).expectedOpenPath, "01_Execution/2026-W21/Weekly Review.md");
  assert.match(buildWorkflowSpec("weekly-review", "", new Date("2026-05-25T09:00:00")).prompt, /^\/weekly-review 2026-W21\n\nOperator run metadata/);
  const mondayWeeklyReview = buildWorkflowSpec("weekly-review", "", new Date("2026-05-25T09:00:00"));
  assert.equal(describePrompt(mondayWeeklyReview.prompt, new Date("2026-05-25T10:00:00")).expectedOpenPath, "01_Execution/2026-W21/Weekly Review.md");
  assert.equal(buildWorkflowSpec("annual-vision", "", date).expectedOpenPath, "00_Strategy/2026 Vision.md");
  assert.deepEqual(buildWorkflowSpec("annual-vision", "", date).targetNotes, ["Annual vision target: 2026"]);
  assert.match(buildWorkflowSpec("annual-vision", "", date).prompt, /^\/annual-vision 2026\n\nOperator run metadata/);
  assert.match(buildWorkflowSpec("annual-vision", "review", date).prompt, /^\/annual-vision review 2026\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("annual-vision", "review", date).expectedOpenPath, "00_Strategy/2026 Annual Review.md");
  assert.deepEqual(buildWorkflowSpec("annual-vision", "review", date).targetNotes, ["Annual review target: 2026"]);
  assert.equal(buildWorkflowSpec("annual-vision", "review 2026", date).expectedOpenPath, "00_Strategy/2026 Annual Review.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "init", date).expectedOpenPath, "00_Strategy/2026-Q2/Quarterly Plan.md");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "init", date).targetNotes, ["Quarterly plan target: 2026-Q2"]);
  assert.match(buildWorkflowSpec("quarterly-plan", "init", date).prompt, /^\/quarterly-plan init 2026-Q2\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse", date).expectedOpenPath, "00_Strategy/2026-Q2/Monthly Pulse - 04.md");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "pulse", date).targetNotes, ["Monthly pulse target: 2026-04"]);
  assert.match(buildWorkflowSpec("quarterly-plan", "pulse", date).prompt, /^\/quarterly-plan pulse 2026-04\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 05", date).expectedOpenPath, "00_Strategy/2026-Q2/Monthly Pulse - 05.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 2025-12", new Date("2026-01-01T09:00:00")).expectedOpenPath, "00_Strategy/2025-Q4/Monthly Pulse - 12.md");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "pulse 2025-12", new Date("2026-01-01T09:00:00")).targetNotes, ["Monthly pulse target: 2025-12"]);
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse", new Date("2026-01-01T09:00:00")).expectedOpenPath, "00_Strategy/2025-Q4/Monthly Pulse - 12.md");
  assert.equal(buildWorkflowSpec("quarterly-plan", "review", date).expectedOpenPath, "00_Strategy/2026-Q1/Quarterly Review.md");
  assert.deepEqual(buildWorkflowSpec("quarterly-plan", "review", date).targetNotes, ["Quarterly review target: 2026-Q1"]);
  assert.match(buildWorkflowSpec("quarterly-plan", "review", date).prompt, /^\/quarterly-plan review 2026-Q1\n\nOperator run metadata/);
  const quarterReview = buildWorkflowSpec("quarterly-plan", "review", date);
  assert.equal(describePrompt(quarterReview.prompt, date).expectedOpenPath, "00_Strategy/2026-Q1/Quarterly Review.md");

  const projectSync = buildWorkflowSpec("project-sync", "FM-Copilot", date);
  assert.match(projectSync.prompt, /^\/project-sync FM-Copilot\n\nOperator run metadata/);
  assert.match(describePrompt("/annual-vision review", date).prompt, /^\/annual-vision review\n\nOperator run metadata/);
  assert.match(buildWorkflowSpec("quarterly-plan", "pulse 05", date).prompt, /^\/quarterly-plan pulse 05\n\nOperator run metadata/);
  assert.match(describePrompt("/quarterly-plan init", date).prompt, /^\/quarterly-plan init\n\nOperator run metadata/);
  assert.match(describePrompt("/weekly-review", date).prompt, /^\/weekly-review\n\nOperator run metadata/);
  assert.match(buildWorkflowSpec("ai-weekly-digest", "last", date).prompt, /^\/ai-weekly-digest last\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W21 - AI Weekly Digest.md");
  assert.deepEqual(buildWorkflowSpec("ai-weekly-digest", "", date).targetNotes, ["AI weekly target: 2026-W21"]);
  assert.match(buildWorkflowSpec("ai-weekly-digest", "", date).prompt, /^\/ai-weekly-digest 2026-W21\n\nOperator run metadata/);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "last", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W20 - AI Weekly Digest.md");
  assert.deepEqual(buildWorkflowSpec("ai-weekly-digest", "last", date).targetNotes, ["AI weekly target: 2026-W20"]);
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "2026-W18", date).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W18 - AI Weekly Digest.md");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "", new Date("2026-05-25T09:00:00")).expectedOpenPath, "04_Knowledge/AI-Weekly/2026-W21 - AI Weekly Digest.md");
  assert.match(buildWorkflowSpec("ai-weekly-digest", "", new Date("2026-05-25T09:00:00")).prompt, /^\/ai-weekly-digest 2026-W21\n\nOperator run metadata/);
  assert.match(describePrompt("/ai-weekly-digest", date).prompt, /^\/ai-weekly-digest\n\nOperator run metadata/);

  const eventList = "Fri 2pm Design review\nSat 10am Research sync";
  assert.match(buildWorkflowSpec("add-events", eventList, date).prompt, /^\/add-events\nFri 2pm Design review\nSat 10am Research sync\n\nOperator run metadata/);

  const transcript = "Alice: The launch moved to Friday.\nBob: I will update the brief.";
  assert.match(buildWorkflowSpec("meeting", transcript, date).prompt, /^\/meeting\nAlice: The launch moved to Friday\.\nBob: I will update the brief\.\n\nOperator run metadata/);

  const typedDaily = describePrompt("/daily-init 4.5", date);
  assert.match(typedDaily.prompt, /^\/daily-init 4\.5\n\nOperator run metadata/);
  assert.match(typedDaily.prompt, /Daily pre-flight guard:/);
  assert.ok(typedDaily.runNotes?.some((note) => note.includes("/weekly-review")));

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
});

test("builds CLI handoff for Claude when Claude backend is selected", () => {
  const handoff = buildCliHandoff("/tmp/My Vault", "/annual-vision review", new Date("2026-05-22T09:00:00"), "claude");

  assert.match(handoff, /^cd '\/tmp\/My Vault'\nclaude -p /);
  assert.match(handoff, /'\/annual-vision review/);
  assert.match(handoff, /Operator run metadata/);
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
