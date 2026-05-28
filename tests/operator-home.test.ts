import { strict as assert } from "node:assert";
import test from "node:test";
import { formatRunContext, getDailyNotePath, getExecutionWeekFolder, getIsoWeekInfo, getQuarterInfo } from "../src/dates";
import { appendQuickCapture, readOperatorHomeState } from "../src/home-state";
import { buildProjectNote, createNativeProject, normalizeProjectName } from "../src/projects";
import { parseActiveProjectNote, parseBlockers, parseDailyNote, parseWeeklyTodo } from "../src/vault-parsers";
import { buildStartDaySpec, buildWorkflowSpec, describePrompt } from "../src/workflows";

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

test("builds editable workflow prompt specs", () => {
  const date = new Date("2026-05-22T09:00:00");
  const start = buildStartDaySpec(7, "review deck, email Kai", date);

  assert.match(start.prompt, /^\/daily-init 7\n\nRun context:/);
  assert.match(start.prompt, /Local date: 2026-05-22/);
  assert.match(start.prompt, /Manual items to consider today:\nreview deck, email Kai/);
  assert.equal(start.expectedOpenPath, "01_Execution/2026-W21/2026-05-22.md");
  assert.equal(start.search, true);

  const projectSync = buildWorkflowSpec("project-sync", "FM-Copilot");
  assert.equal(projectSync.prompt, "/project-sync FM-Copilot");

  assert.equal(buildWorkflowSpec("annual-vision", "review 2026").prompt, "/annual-vision review 2026");
  assert.equal(buildWorkflowSpec("quarterly-plan", "pulse 05").prompt, "/quarterly-plan pulse 05");
  assert.equal(buildWorkflowSpec("ai-weekly-digest", "last").prompt, "/ai-weekly-digest last");

  const described = describePrompt("/deep-research AI evals", date);
  assert.equal(described.id, "deep-research");
  assert.equal(described.prompt, "/deep-research AI evals");
  assert.equal(described.search, true);
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
