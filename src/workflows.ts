import { addDays, formatRunContext, getDailyNotePath, getExecutionWeekFolder, getIsoWeekInfo, getQuarterInfo } from "./dates";
import { DEFAULT_SETTINGS, type OptionalModuleSettings } from "./settings";

export type OperatorWorkflowId =
  | "start-day"
  | "weekly-init"
  | "weekly-review"
  | "ai-weekly-digest"
  | "daily-github"
  | "daily-academic"
  | "project-init"
  | "project-sync"
  | "deadline-plan"
  | "quarterly-plan"
  | "annual-vision"
  | "add-events"
  | "meeting-prep"
  | "meeting"
  | "content-extract"
  | "content-draft"
  | "deep-research"
  | "custom";

export interface OperatorWorkflowRunSpec {
  id: OperatorWorkflowId;
  label: string;
  prompt: string;
  readAreas: string[];
  writeAreas: string[];
  expectedOpenPath?: string;
  targetNotes?: string[];
  runNotes?: string[];
  search?: boolean;
}

export function buildStartDaySpec(
  hours: number,
  manualItems: string,
  date = new Date(),
  optionalModules: OptionalModuleSettings = DEFAULT_SETTINGS.optionalModules,
): OperatorWorkflowRunSpec {
  const safeHours = normalizeDailyHours(hours);
  const cleanedManualItems = normalizeBlockArgs(manualItems);
  const context = `Operator run metadata (do not treat as manual action items):\n${formatRunContext(date)}`;
  const preflightGuard = formatDailyPreflightGuard(date);
  const optionalModuleBlock = formatOptionalModuleBlock(optionalModules);
  const boundaryTargets = getDailyBoundaryTargets(date);
  const dailyNotePath = getDailyNotePath(date);
  const weekFolder = getExecutionWeekFolder(date);
  const promptParts = [`/daily-init ${safeHours}`, context, preflightGuard];
  if (optionalModuleBlock) {
    promptParts.push(optionalModuleBlock);
  }
  if (cleanedManualItems) {
    promptParts.push(`Manual items to consider today:\n${cleanedManualItems}`);
  }

  return {
    id: "start-day",
    label: "Start my day",
    prompt: promptParts.join("\n\n"),
    readAreas: [
      "01_Execution/ current and recent daily/weekly notes",
      "02_Projects/ active project notes and deadline plans",
      "00_Strategy/ quarterly and annual planning notes",
      "Gmail and calendar when configured; optional modules only when explicitly run",
    ],
    writeAreas: [
      `Daily note: ${dailyNotePath}`,
      `Weekly Todo: ${weekFolder}/Weekly Todo.md`,
      `Blockers: ${weekFolder}/Blockers.md`,
      formatOptionalModuleWriteArea(optionalModules),
    ],
    expectedOpenPath: dailyNotePath,
    targetNotes: [
      `Daily note: ${dailyNotePath}`,
      `Execution week: ${getIsoWeekInfo(date).label}`,
      `Planning quarter: ${getQuarterInfo(date).label}`,
    ],
    runNotes: getDailyPreviewRunNotes(date, boundaryTargets),
    search: true,
  };
}

function formatOptionalModuleBlock(optionalModules: OptionalModuleSettings): string {
  const lines = getEnabledOptionalModuleLines(optionalModules);
  if (lines.length === 0) {
    return "";
  }

  return [
    "Enabled optional modules for this daily run:",
    ...lines,
    "If an optional module is not listed here, do not run it unless the user explicitly asks in the current prompt.",
  ].join("\n");
}

function getEnabledOptionalModuleLines(optionalModules: OptionalModuleSettings): string[] {
  const lines: string[] = [];
  if (optionalModules.intelligence) {
    lines.push("- Intelligence: run /ai-weekly-digest on eligible weekly boundaries and /daily-github after the core briefing.");
  }
  if (optionalModules.academic) {
    lines.push("- Academic: run /daily-academic after the core briefing.");
  }
  if (optionalModules.content) {
    lines.push("- Content: run /content-extract after enabled intelligence/academic modules finish, or after the core briefing if no source module ran.");
  }
  if (optionalModules.calendarEvents) {
    lines.push("- Calendar/events: run /add-events only when manual items include event or deadline text to ingest.");
  }
  return lines;
}

function formatOptionalModuleWriteArea(optionalModules: OptionalModuleSettings): string {
  const labels: string[] = [];
  if (optionalModules.intelligence) {
    labels.push("Intelligence");
  }
  if (optionalModules.academic) {
    labels.push("Academic");
  }
  if (optionalModules.content) {
    labels.push("Content");
  }
  if (optionalModules.calendarEvents) {
    labels.push("Calendar/events");
  }
  return labels.length > 0
    ? `Enabled optional modules: ${labels.join(", ")}`
    : "Optional module outputs only when explicitly enabled or run from More workflows";
}

export function buildDefaultDailyPrompt(hours: number): string {
  return `/daily-init ${normalizeDailyHours(hours)}`;
}

export function buildAdvancedPromptPlaceholder(hours: number): string {
  return `${buildDefaultDailyPrompt(hours)}, /project-init MyProject, or review a note`;
}

export function buildWeeklyPeriodPlaceholder(date = new Date()): string {
  return `${getIsoWeekInfo(date).label}; review accepts last`;
}

export function buildStrategyPeriodPlaceholder(date = new Date()): string {
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const blankPulseMonth = `${previousMonth.getFullYear()}-${String(previousMonth.getMonth() + 1).padStart(2, "0")}`;
  return `${getQuarterInfo(date).label}, ${month}; blank pulse = ${blankPulseMonth}`;
}

export function resolveAdvancedPrompt(prompt: string, availableHours: number): string {
  return prompt.trim() || buildDefaultDailyPrompt(availableHours);
}

export function resolveAvailableHoursInput(value: string, fallbackHours: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return normalizeDailyHours(fallbackHours);
  }
  return normalizeDailyHours(parsed);
}

export function resolveAnnualYearInput(mode: "vision" | "review", value: string, date = new Date()): string {
  const year = value.match(/\b(20\d{2})\b/)?.[1];
  if (year) {
    return year;
  }
  if (mode === "vision" && /\bnext\b/i.test(value)) {
    return String(date.getFullYear() + 1);
  }
  if (mode === "review" && /\blast\b/i.test(value)) {
    return String(date.getFullYear() - 1);
  }
  if (mode === "review") {
    return String(date.getMonth() === 11 ? date.getFullYear() : date.getFullYear() - 1);
  }
  return String(date.getFullYear());
}

export function resolveAnnualShortcutInput(
  mode: "vision" | "review",
  value: string,
  date = new Date(),
): { year: string; nextInputValue: string } {
  const year = resolveAnnualYearInput(mode, value, date);
  const explicitYear = value.match(/\b(20\d{2})\b/)?.[1] ?? "";
  return {
    year,
    nextInputValue: explicitYear,
  };
}

export function resolveWeeklyPeriodInput(mode: "init" | "review", value: string, date = new Date()): string {
  const week = parseExplicitIsoWeek(value);
  if (week) {
    return week;
  }

  if (mode === "review" && /\blast\b/i.test(value)) {
    return getIsoWeekInfo(addDays(date, -7)).label;
  }

  return "";
}

export function resolveQuarterlyPeriodInput(mode: "init" | "review" | "pulse", value: string, date = new Date()): string {
  const quarter = value.match(/\b(20\d{2})-Q([1-4])\b/i);
  if (mode === "pulse" && quarter) {
    return `${mode} ${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}`;
  }
  if (mode !== "pulse" && quarter) {
    return `${mode} ${quarter[1]}-Q${quarter[2]}`;
  }

  const month = value.match(/\b(20\d{2})-(0?[1-9]|1[0-2])\b/);
  if (mode === "pulse" && month) {
    return `${mode} ${month[1]}-${month[2].padStart(2, "0")}`;
  }
  if (mode !== "pulse" && month) {
    const monthQuarter = getQuarterInfo(new Date(Number(month[1]), Number(month[2]) - 1, 1));
    return `${mode} ${monthQuarter.label}`;
  }

  const monthOnly = value.match(/^\s*(0?[1-9]|1[0-2])\s*$/);
  if (mode === "pulse" && monthOnly) {
    const month = Number(monthOnly[1]);
    const year = month > date.getMonth() + 1 ? date.getFullYear() - 1 : date.getFullYear();
    return `${mode} ${year}-${String(month).padStart(2, "0")}`;
  }

  return mode;
}

export function buildWorkflowSpec(
  id: OperatorWorkflowId,
  args = "",
  date = new Date(),
): OperatorWorkflowRunSpec {
  const cleanedArgs = normalizeWorkflowArgs(id, args);
  switch (id) {
    case "weekly-init":
      const weeklyInitTarget = getWeeklyInitTarget(cleanedArgs, date);
      const weeklyInitFolder = `01_Execution/${weeklyInitTarget}`;
      return simpleSpec(id, `Plan ${weeklyInitTarget}`, withArgs("/weekly-init", weeklyInitTarget), [
        "Recent daily notes, last week Weekly Todo, Blockers, project deadline plans",
      ], [
        `Weekly Todo: ${weeklyInitFolder}/Weekly Todo.md`,
        `Blockers: ${weeklyInitFolder}/Blockers.md`,
      ], date, `${weeklyInitFolder}/Weekly Todo.md`, [
        `Execution week: ${weeklyInitTarget}`,
      ]);
    case "weekly-review":
      const weeklyReviewFolder = getWeeklyReviewFolder(cleanedArgs, date);
      const weeklyReviewLabel = weeklyReviewFolder.replace("01_Execution/", "");
      return simpleSpec(id, `Review ${weeklyReviewLabel}`, withArgs("/weekly-review", getWeeklyReviewPromptArgs(cleanedArgs, weeklyReviewFolder)), [
        "Target week's daily notes, Weekly Todo, Blockers, and active projects",
      ], [`Weekly Review: ${weeklyReviewFolder}/Weekly Review.md`], date, `${weeklyReviewFolder}/Weekly Review.md`, [
        `Review week: ${weeklyReviewLabel}`,
      ]);
    case "ai-weekly-digest":
      const aiWeeklyTarget = getAiWeeklyDigestTarget(cleanedArgs, date);
      const aiWeeklyDigestPath = `04_Knowledge/AI-Weekly/${aiWeeklyTarget} - AI Weekly Digest.md`;
      return {
        ...simpleSpec(id, `AI weekly ${aiWeeklyTarget}`, withArgs("/ai-weekly-digest", getAiWeeklyDigestPromptArgs(cleanedArgs, aiWeeklyTarget)), [
          "Recent AI research, GitHub trending notes, RSS and web sources",
        ], [
          `AI weekly digest: ${aiWeeklyDigestPath}`,
          `Weekly Review block when present: 01_Execution/${aiWeeklyTarget}/Weekly Review.md`,
        ], date, aiWeeklyDigestPath, [
          `AI weekly target: ${aiWeeklyTarget}`,
        ]),
        search: true,
      };
    case "daily-github":
      return {
        ...simpleSpec(id, "GitHub trends", withArgs("/daily-github", cleanedArgs), [
          "GitHub trending sources and today's daily note",
        ], ["04_Knowledge/GitHub/ and today's daily note summary"], date),
        search: true,
      };
    case "daily-academic":
      return {
        ...simpleSpec(id, "Academic scan", withArgs("/daily-academic", cleanedArgs), [
          "arXiv and paper sources for the configured research areas",
        ], ["04_Knowledge/Academic/ and today's daily note summary"], date),
        search: true,
      };
    case "project-init":
      return simpleSpec(id, withTargetLabel("Create", cleanedArgs, "Create project"), withArgs("/project-init", cleanedArgs), [
        "Existing 02_Projects folders for duplicate checks",
      ], ["New project note and knowledge folder"], date);
    case "project-sync":
      return simpleSpec(id, withTargetLabel("Sync", cleanedArgs, "Sync project"), withArgs("/project-sync", cleanedArgs), [
        "Project note, meeting knowledge, research notes, weekly reviews",
      ], ["Project note synthesis sections"], date);
    case "deadline-plan":
      return simpleSpec(id, withTargetLabel("Plan deadline", cleanedArgs, "Plan deadline"), withArgs("/deadline-plan", cleanedArgs), [
        "Project note, existing deadline plan, calendar/reminder context when available",
      ], ["Project Deadline Plan.md and related reminders"], date);
    case "quarterly-plan":
      const quarterlyExpectedPath = getQuarterlyExpectedPath(cleanedArgs, date);
      return simpleSpec(id, getQuarterlyWorkflowLabel(cleanedArgs, date), withArgs("/quarterly-plan", getQuarterlyPromptArgs(cleanedArgs, date)), [
        "Annual vision, quarterly plans/reviews, weekly reviews, active projects, horizon items",
      ], [formatQuarterlyWriteTarget(cleanedArgs, quarterlyExpectedPath)], date, quarterlyExpectedPath, [
        getQuarterlyTargetNote(cleanedArgs, date),
      ]);
    case "annual-vision":
      const annualExpectedPath = getAnnualExpectedPath(cleanedArgs, date);
      return simpleSpec(id, getAnnualWorkflowLabel(cleanedArgs, date), withArgs("/annual-vision", getAnnualPromptArgs(cleanedArgs, date)), [
        "Current and prior annual vision/review, quarterly reviews, active projects",
      ], [formatAnnualWriteTarget(cleanedArgs, annualExpectedPath)], date, annualExpectedPath, [
        getAnnualTargetNote(cleanedArgs, date),
      ]);
    case "add-events":
      return simpleSpec(id, "Add events", withArgs("/add-events", cleanedArgs), [
        "Pasted event descriptions and project context",
      ], ["Apple Calendar/Reminders and project Upcoming Events.md staging notes"], date);
    case "meeting-prep":
      return simpleSpec(id, withTargetLabel("Prep meeting", cleanedArgs, "Prep meeting"), withArgs("/meeting-prep", cleanedArgs), [
        "Project note, current Blockers, Weekly Todo, recent daily notes, deadline plans",
      ], ["Project Meeting Plan note"], date);
    case "meeting":
      return simpleSpec(id, "Process meeting", withArgs("/meeting", cleanedArgs), [
        "Provided transcript, recording, or meeting directory plus project context",
      ], ["Meeting transcript note, meeting knowledge note, routed actions"], date);
    case "content-extract":
      return simpleSpec(id, "Extract content ideas", "/content-extract", [
        "Recent daily notes, thinking notes, newsletter email when configured",
      ], ["05_Content/Backlog.md"], date);
    case "content-draft":
      return simpleSpec(id, withTargetLabel("Draft", cleanedArgs, "Draft content"), withArgs("/content-draft", cleanedArgs), [
        "05_Content/Backlog.md, Voice Guide.md, selected source notes",
      ], ["05_Content/Drafts/"], date);
    case "deep-research":
      return {
        ...simpleSpec(id, withTargetLabel("Deep research", cleanedArgs, "Deep research"), withArgs("/deep-research", cleanedArgs), [
          "Vault project context and web sources",
        ], ["04_Knowledge/<Project>/Research/ or general knowledge note"], date),
        search: true,
      };
    case "start-day":
      return buildStartDaySpec(Number(cleanedArgs) || 6, "", date);
    case "custom":
      return describePrompt(cleanedArgs || "/", date);
  }
}

export function describePrompt(prompt: string, date = new Date()): OperatorWorkflowRunSpec {
  const trimmed = prompt.trim();
  const effectiveDate = extractRunMetadataDate(trimmed) ?? date;
  if (trimmed.startsWith("/daily-init")) {
    return {
      ...buildStartDaySpec(extractDailyHours(trimmed), "", effectiveDate),
      prompt: appendDailyPreflightGuard(appendRunMetadata(trimmed, effectiveDate), effectiveDate),
    };
  }

  const command = trimmed.split(/\s+/, 1)[0].replace(/^\//, "") as OperatorWorkflowId;
  const known = new Set<OperatorWorkflowId>([
    "weekly-init",
    "weekly-review",
    "ai-weekly-digest",
    "daily-github",
    "daily-academic",
    "project-init",
    "project-sync",
    "deadline-plan",
    "quarterly-plan",
    "annual-vision",
    "add-events",
    "meeting-prep",
    "meeting",
    "content-extract",
    "content-draft",
    "deep-research",
  ]);

  if (known.has(command)) {
    const commandArgs = stripRunMetadata(trimmed.slice(command.length + 1).trim());
    const runnablePrompt = normalizeKnownPromptForRun(command, trimmed, commandArgs, effectiveDate);
    return {
      ...buildWorkflowSpec(command, commandArgs, effectiveDate),
      prompt: appendRunMetadata(runnablePrompt, effectiveDate),
    };
  }

  return {
    id: "custom",
    label: "Custom Operator prompt",
    prompt: trimmed || "/",
    readAreas: ["Whatever the prompt asks the agent to inspect"],
    writeAreas: ["Whatever the prompt asks the agent to change inside this vault"],
  };
}

export function resolveEditedPreviewSpec(
  original: OperatorWorkflowRunSpec,
  editedPrompt: string,
  date = new Date(),
): OperatorWorkflowRunSpec {
  if (!editedPrompt.trim()) {
    return original;
  }
  return describePrompt(editedPrompt, date);
}

function simpleSpec(
  id: OperatorWorkflowId,
  label: string,
  prompt: string,
  readAreas: string[],
  writeAreas: string[],
  date = new Date(),
  expectedOpenPath?: string,
  targetNotes?: string[],
): OperatorWorkflowRunSpec {
  return { id, label, prompt: appendRunMetadata(prompt, date), readAreas, writeAreas, expectedOpenPath, targetNotes };
}

function withArgs(command: string, args: string): string {
  if (!args) {
    return command;
  }
  return args.includes("\n") ? `${command}\n${args}` : `${command} ${args}`;
}

function normalizeInlineArgs(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function withTargetLabel(prefix: string, target: string, fallback: string): string {
  return target ? `${prefix} ${target}` : fallback;
}

function normalizeWorkflowArgs(id: OperatorWorkflowId, value: string): string {
  if (id === "add-events" || id === "meeting") {
    return normalizeBlockArgs(value);
  }
  return normalizeInlineArgs(value);
}

function normalizeBlockArgs(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function extractDailyHours(prompt: string): number {
  const match = prompt.match(/^\/daily-init\s+(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 6;
}

function appendRunMetadata(prompt: string, date: Date): string {
  if (prompt.includes("Operator run metadata")) {
    return prompt;
  }
  return `${prompt}\n\nOperator run metadata (do not treat as manual action items):\n${formatRunContext(date)}`;
}

function stripRunMetadata(value: string): string {
  const index = value.search(/(^|\n\s*\n)Operator run metadata\b/);
  return index >= 0 ? value.slice(0, index).trim() : value.trim();
}

function extractRunMetadataDate(prompt: string): Date | null {
  const match = prompt.match(/^Local date:\s*(\d{4})-(\d{2})-(\d{2})$/m);
  if (!match) {
    return null;
  }

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
}

function appendDailyPreflightGuard(prompt: string, date = new Date()): string {
  if (prompt.includes("Daily pre-flight guard:")) {
    return prompt;
  }
  return `${prompt}\n\n${formatDailyPreflightGuard(date)}`;
}

function formatDailyPreflightGuard(date = new Date()): string {
  const targets = getDailyBoundaryTargets(date);
  const artifacts = getDailyBoundaryArtifacts(date, targets);
  return [
    "Daily pre-flight guard:",
    "Do not rely on CLI hooks being available in this Obsidian-launched run.",
    "Evaluate these boundary conditions before writing today's briefing, and run a boundary command only when both its date condition and missing-artifact condition are true.",
    "- Weekly close date condition: current ISO week is after the target week, so catch-up runs later in the week are eligible.",
    "- Monthly pulse date condition: current month is after the target month, so catch-up runs after the first day are eligible.",
    "- Quarter review/plan date condition: current quarter is after the review target and the current quarter has begun, so catch-up runs after the first day are eligible.",
    "Do not run a future-period boundary command even if its artifact is missing.",
    `Execution order for eligible missing artifacts: /weekly-review ${targets.lastWeek}, /quarterly-plan pulse ${targets.lastMonth}, /quarterly-plan review ${targets.lastQuarter}, /quarterly-plan init ${targets.currentQuarter}, then always run /weekly-init ${targets.currentWeek}.`,
    "Use these concrete targets when a boundary check is date-eligible and its artifact is missing:",
    `- Last week review: /weekly-review ${targets.lastWeek}`,
    `- Last month pulse: /quarterly-plan pulse ${targets.lastMonth}`,
    `- Last quarter review: /quarterly-plan review ${targets.lastQuarter}`,
    `- Current quarter plan: /quarterly-plan init ${targets.currentQuarter}`,
    `- Current week setup: /weekly-init ${targets.currentWeek}`,
    "Check exact artifacts before deciding a boundary run is missing:",
    `- Weekly review artifact: ${artifacts.weeklyReview}`,
    `- Monthly pulse artifact: ${artifacts.monthlyPulse}`,
    `- Quarterly review artifact: ${artifacts.quarterlyReview}`,
    `- Quarterly plan artifact: ${artifacts.quarterlyPlan}`,
    "Only continue past a missing boundary artifact if the sub-run fails; record that failure in today's ### Flags.",
  ].join("\n");
}

function getDailyBoundaryTargets(date: Date): {
  lastWeek: string;
  lastMonth: string;
  lastQuarter: string;
  currentQuarter: string;
  currentWeek: string;
} {
  const lastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return {
    lastWeek: getIsoWeekInfo(addDays(date, -7)).label,
    lastMonth: [
      lastMonth.getFullYear(),
      String(lastMonth.getMonth() + 1).padStart(2, "0"),
    ].join("-"),
    lastQuarter: getPreviousQuarter(date).label,
    currentQuarter: getQuarterInfo(date).label,
    currentWeek: getIsoWeekInfo(date).label,
  };
}

function getDailyBoundaryArtifacts(
  date: Date,
  targets = getDailyBoundaryTargets(date),
): {
  weeklyReview: string;
  monthlyPulse: string;
  quarterlyReview: string;
  quarterlyPlan: string;
} {
  const lastMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const lastMonthQuarter = getQuarterInfo(lastMonth).label;
  const lastMonthNumber = String(lastMonth.getMonth() + 1).padStart(2, "0");
  return {
    weeklyReview: `01_Execution/${targets.lastWeek}/Weekly Review.md`,
    monthlyPulse: `00_Strategy/${lastMonthQuarter}/Monthly Pulse - ${lastMonthNumber}.md`,
    quarterlyReview: `00_Strategy/${targets.lastQuarter}/Quarterly Review.md`,
    quarterlyPlan: `00_Strategy/${targets.currentQuarter}/Quarterly Plan.md`,
  };
}

function getDailyPreviewRunNotes(
  date: Date,
  targets: {
    lastWeek: string;
    lastMonth: string;
    lastQuarter: string;
    currentQuarter: string;
    currentWeek: string;
  },
): string[] {
  const notes: string[] = [];
  const weeklyBoundaryDay = date.getDay() === 1;
  const monthlyBoundaryDay = date.getDate() === 1;
  const quarterlyBoundaryDay = monthlyBoundaryDay && [0, 3, 6, 9].includes(date.getMonth());
  notes.push("Pre-flight may catch up missing prior-period artifacts after a week, month, or quarter boundary has passed.");
  notes.push(`Pre-flight target checks: /weekly-review ${targets.lastWeek}, /quarterly-plan pulse ${targets.lastMonth}, /quarterly-plan review ${targets.lastQuarter}, /quarterly-plan init ${targets.currentQuarter}.`);
  if (weeklyBoundaryDay) {
    notes.push(`Pre-flight may close last week: /weekly-review ${targets.lastWeek}.`);
  }
  if (monthlyBoundaryDay) {
    notes.push(`Pre-flight may close last month: /quarterly-plan pulse ${targets.lastMonth}.`);
  }
  if (quarterlyBoundaryDay) {
    notes.push(`Pre-flight may close/open quarter boundaries: /quarterly-plan review ${targets.lastQuarter}, then /quarterly-plan init ${targets.currentQuarter}.`);
  }
  notes.push(`Always opens target week with /weekly-init ${targets.currentWeek} before writing today's briefing.`);
  return notes;
}

function getWeeklyReviewFolder(args: string, date: Date): string {
  const explicit = parseExplicitIsoWeek(args);
  if (explicit) {
    return `01_Execution/${explicit}`;
  }
  const target = isLastWeekShorthand(args) || date.getDay() === 1
    ? addDays(date, -7)
    : date;
  return `01_Execution/${getIsoWeekInfo(target).label}`;
}

function getWeeklyInitTarget(args: string, date: Date): string {
  const explicit = parseExplicitIsoWeek(args);
  return explicit ?? getIsoWeekInfo(date).label;
}

function getWeeklyReviewPromptArgs(args: string, weeklyReviewFolder: string): string {
  const explicit = parseExplicitIsoWeek(args);
  if (explicit) {
    return explicit;
  }
  if (isLastWeekShorthand(args)) {
    return weeklyReviewFolder.replace("01_Execution/", "");
  }
  return args || weeklyReviewFolder.replace("01_Execution/", "");
}

function getAiWeeklyDigestTarget(args: string, date: Date): string {
  const explicit = parseExplicitIsoWeek(args);
  if (explicit) {
    return explicit;
  }
  const target = isLastWeekShorthand(args) || date.getDay() === 1
    ? addDays(date, -7)
    : date;
  return getIsoWeekInfo(target).label;
}

function getAiWeeklyDigestPromptArgs(args: string, target: string): string {
  const trimmed = args.trim();
  if (!trimmed || isLastWeekShorthand(trimmed) || parseExplicitIsoWeek(trimmed)) {
    return target;
  }
  return args;
}

function normalizeKnownPromptForRun(command: OperatorWorkflowId, prompt: string, commandArgs: string, date: Date): string {
  if (command === "weekly-review") {
    const reviewFolder = getWeeklyReviewFolder(commandArgs, date);
    const normalizedArgs = getWeeklyReviewPromptArgs(commandArgs, reviewFolder);
    return normalizedArgs === commandArgs ? prompt : withArgs(`/${command}`, normalizedArgs);
  }

  if (command === "ai-weekly-digest") {
    const target = getAiWeeklyDigestTarget(commandArgs, date);
    const normalizedArgs = getAiWeeklyDigestPromptArgs(commandArgs, target);
    return normalizedArgs === commandArgs ? prompt : withArgs(`/${command}`, normalizedArgs);
  }

  if (command === "weekly-init") {
    const normalizedArgs = getWeeklyInitPromptArgs(commandArgs, date);
    return normalizedArgs === commandArgs ? prompt : withArgs(`/${command}`, normalizedArgs);
  }

  if (command === "annual-vision") {
    const normalizedArgs = normalizeAnnualTargetArgs(commandArgs, date);
    return normalizedArgs === commandArgs ? prompt : withArgs(`/${command}`, normalizedArgs);
  }

  if (command !== "quarterly-plan") {
    return prompt;
  }

  const normalizedArgs = getQuarterlyPromptArgs(commandArgs, date);
  return normalizedArgs === commandArgs ? prompt : withArgs(`/${command}`, normalizedArgs);
}

function normalizeIsoWeekReferences(value: string): string {
  return value.replace(/\b(20\d{2})-W(0?[1-9]|[1-4]\d|5[0-3])\b/gi, (_match, year: string, week: string) => {
    return `${year}-W${week.padStart(2, "0")}`;
  });
}

function isLastWeekShorthand(value: string): boolean {
  return /^\s*last(?:\s+week)?\s*$/i.test(value);
}

function getWeeklyInitPromptArgs(args: string, date: Date): string {
  const explicit = parseExplicitIsoWeek(args);
  if (explicit) {
    return explicit;
  }
  if (!args.trim()) {
    return getIsoWeekInfo(date).label;
  }
  return normalizeIsoWeekReferences(args);
}

function normalizeAnnualTargetArgs(args: string, date: Date): string {
  if (/\b20\d{2}\b/.test(args)) {
    return args;
  }

  return getAnnualPromptArgs(args, date);
}

function parseExplicitIsoWeek(value: string): string | null {
  const week = value.match(/\b(20\d{2})-W(0?[1-9]|[1-4]\d|5[0-3])\b/i);
  return week ? `${week[1]}-W${week[2].padStart(2, "0")}` : null;
}

function getAnnualExpectedPath(args: string, date: Date): string {
  const mode = args.toLowerCase().includes("review") ? "Annual Review" : "Vision";
  const year = resolveAnnualYearInput(mode === "Annual Review" ? "review" : "vision", args, date);
  return `00_Strategy/${year} ${mode}.md`;
}

function formatAnnualWriteTarget(args: string, path: string): string {
  const label = args.toLowerCase().includes("review") ? "Annual review" : "Annual vision";
  return `${label}: ${path}`;
}

function getAnnualTargetNote(args: string, date: Date): string {
  const mode = args.toLowerCase().includes("review") ? "Annual review" : "Annual vision";
  const year = resolveAnnualYearInput(mode === "Annual review" ? "review" : "vision", args, date);
  return `${mode} target: ${year}`;
}

function getAnnualWorkflowLabel(args: string, date: Date): string {
  const mode = args.toLowerCase().includes("review") ? "Annual review" : "Annual vision";
  const year = resolveAnnualYearInput(mode === "Annual review" ? "review" : "vision", args, date);
  return `${mode} ${year}`;
}

function getAnnualPromptArgs(args: string, date: Date): string {
  if (args.match(/\b20\d{2}\b/)) {
    return args;
  }
  const mode = args.toLowerCase().includes("review") ? "review" : "vision";
  const year = resolveAnnualYearInput(mode, args, date);
  return mode === "review" ? `review ${year}` : year;
}

function getQuarterlyExpectedPath(args: string, date: Date): string {
  const mode = args.split(/\s+/, 1)[0].toLowerCase();
  if (mode === "review") {
    const quarter = parseQuarterArg(args) ?? getPreviousQuarter(date);
    return `00_Strategy/${quarter.label}/Quarterly Review.md`;
  }
  if (mode === "pulse") {
    const target = parsePulseMonth(args, date);
    const quarter = getQuarterInfo(new Date(target.year, target.month - 1, 1));
    return `00_Strategy/${quarter.label}/Monthly Pulse - ${String(target.month).padStart(2, "0")}.md`;
  }
  const quarter = parseQuarterArg(args) ?? getQuarterInfo(date);
  return `00_Strategy/${quarter.label}/Quarterly Plan.md`;
}

function formatQuarterlyWriteTarget(args: string, path: string): string {
  const mode = args.split(/\s+/, 1)[0].toLowerCase();
  if (mode === "review") {
    return `Quarterly review: ${path}`;
  }
  if (mode === "pulse") {
    return `Monthly pulse: ${path}`;
  }
  return `Quarterly plan: ${path}`;
}

function getQuarterlyTargetNote(args: string, date: Date): string {
  const mode = args.split(/\s+/, 1)[0].toLowerCase();
  if (mode === "review") {
    const quarter = parseQuarterArg(args) ?? getPreviousQuarter(date);
    return `Quarterly review target: ${quarter.label}`;
  }
  if (mode === "pulse") {
    const target = parsePulseMonth(args, date);
    return `Monthly pulse target: ${target.year}-${String(target.month).padStart(2, "0")}`;
  }
  const quarter = parseQuarterArg(args) ?? getQuarterInfo(date);
  return `Quarterly plan target: ${quarter.label}`;
}

function getQuarterlyWorkflowLabel(args: string, date: Date): string {
  const mode = args.split(/\s+/, 1)[0].toLowerCase();
  if (mode === "review") {
    const quarter = parseQuarterArg(args) ?? getPreviousQuarter(date);
    return `Quarter review ${quarter.label}`;
  }
  if (mode === "pulse") {
    const target = parsePulseMonth(args, date);
    return `Monthly pulse ${target.year}-${String(target.month).padStart(2, "0")}`;
  }
  const quarter = parseQuarterArg(args) ?? getQuarterInfo(date);
  return `Quarter plan ${quarter.label}`;
}

function getQuarterlyPromptArgs(args: string, date: Date): string {
  const mode = args.split(/\s+/, 1)[0].toLowerCase();
  if (mode === "review" && !parseQuarterArg(args)) {
    return `review ${getPreviousQuarter(date).label}`;
  }
  if (mode === "init" && !parseQuarterArg(args)) {
    return `init ${getQuarterInfo(date).label}`;
  }
  if (mode === "pulse" && parseQuarterArg(args)) {
    const target = parsePulseMonth(args, date);
    return `pulse ${target.year}-${String(target.month).padStart(2, "0")}`;
  }
  if (mode === "pulse" && !args.match(/\b(20\d{2})-(0?[1-9]|1[0-2])\b/)) {
    const target = parsePulseMonth(args, date);
    return `pulse ${target.year}-${String(target.month).padStart(2, "0")}`;
  }
  return args;
}

function parseQuarterArg(args: string): { year: number; quarter: number; label: string } | null {
  const match = args.match(/\b(20\d{2})-Q([1-4])\b/i);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const quarter = Number(match[2]);
  return { year, quarter, label: `${year}-Q${quarter}` };
}

function parsePulseMonth(args: string, date: Date): { year: number; month: number } {
  const quarter = parseQuarterArg(args);
  if (quarter) {
    return { year: quarter.year, month: quarter.quarter * 3 };
  }

  const explicit = args.match(/\b(20\d{2})-(0?[1-9]|1[0-2])\b/);
  if (explicit) {
    return { year: Number(explicit[1]), month: Number(explicit[2]) };
  }

  const monthOnly = args.match(/\b(0?[1-9]|1[0-2])\b/);
  if (monthOnly) {
    const month = Number(monthOnly[1]);
    const year = month > date.getMonth() + 1 ? date.getFullYear() - 1 : date.getFullYear();
    return { year, month };
  }

  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return { year: previousMonth.getFullYear(), month: previousMonth.getMonth() + 1 };
}

function getPreviousQuarter(date: Date): { year: number; quarter: number; label: string } {
  const current = getQuarterInfo(date);
  const year = current.quarter === 1 ? current.year - 1 : current.year;
  const quarter = current.quarter === 1 ? 4 : current.quarter - 1;
  return { year, quarter, label: `${year}-Q${quarter}` };
}

export function normalizeDailyHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) {
    return 6;
  }
  return Number(Math.max(1, Math.min(16, hours)).toFixed(2));
}
