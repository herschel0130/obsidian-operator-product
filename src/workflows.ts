import { addDays, formatRunContext, getDailyNotePath, getExecutionWeekFolder, getIsoWeekInfo, getQuarterInfo } from "./dates";

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

export function buildStartDaySpec(hours: number, manualItems: string, date = new Date()): OperatorWorkflowRunSpec {
  const safeHours = normalizeDailyHours(hours);
  const cleanedManualItems = normalizeInlineArgs(manualItems);
  const context = `Operator run metadata (do not treat as manual action items):\n${formatRunContext(date)}`;
  const preflightGuard = formatDailyPreflightGuard(date);
  const boundaryTargets = getDailyBoundaryTargets(date);
  const dailyNotePath = getDailyNotePath(date);
  const prompt = cleanedManualItems
    ? `/daily-init ${safeHours}\n\n${context}\n\n${preflightGuard}\n\nManual items to consider today:\n${cleanedManualItems}`
    : `/daily-init ${safeHours}\n\n${context}\n\n${preflightGuard}`;

  return {
    id: "start-day",
    label: "Start my day",
    prompt,
    readAreas: [
      "01_Execution/ current and recent daily/weekly notes",
      "02_Projects/ active project notes and deadline plans",
      "00_Strategy/ quarterly and annual planning notes",
      "Gmail, calendar, GitHub, arXiv when configured",
    ],
    writeAreas: [
      "Today's daily note briefing and schedule",
      "Current week Weekly Todo / Blockers sync updates",
      "04_Knowledge/ daily GitHub, academic, and AI notes",
      "05_Content/Backlog.md content ideas",
    ],
    expectedOpenPath: dailyNotePath,
    targetNotes: [
      `Daily note: ${dailyNotePath}`,
      `Execution week: ${getIsoWeekInfo(date).label}`,
      `Planning quarter: ${getQuarterInfo(date).label}`,
    ],
    runNotes: [
      `Pre-flight may close last week: /weekly-review ${boundaryTargets.lastWeek}, then /ai-weekly-digest ${boundaryTargets.lastWeek}.`,
      `Pre-flight may close last month: /quarterly-plan pulse ${boundaryTargets.lastMonth}.`,
      `Pre-flight may close/open quarter boundaries: /quarterly-plan review ${boundaryTargets.lastQuarter}, then /quarterly-plan init ${boundaryTargets.currentQuarter}.`,
      "Always opens this week with /weekly-init before writing today's briefing.",
    ],
    search: true,
  };
}

export function buildDefaultDailyPrompt(hours: number): string {
  return `/daily-init ${normalizeDailyHours(hours)}`;
}

export function buildAdvancedPromptPlaceholder(hours: number): string {
  return `${buildDefaultDailyPrompt(hours)}, /project-init MyProject, or review a note`;
}

export function resolveAdvancedPrompt(prompt: string, availableHours: number): string {
  return prompt.trim() || buildDefaultDailyPrompt(availableHours);
}

export function buildWorkflowSpec(
  id: OperatorWorkflowId,
  args = "",
  date = new Date(),
): OperatorWorkflowRunSpec {
  const cleanedArgs = normalizeWorkflowArgs(id, args);
  switch (id) {
    case "weekly-init":
      return simpleSpec(id, "Plan this week", "/weekly-init", [
        "Recent daily notes, last week Weekly Todo, Blockers, project deadline plans",
      ], ["Current week Weekly Todo and Blockers"], date, `${getExecutionWeekFolder(date)}/Weekly Todo.md`, [
        `Execution week: ${getIsoWeekInfo(date).label}`,
      ]);
    case "weekly-review":
      const weeklyReviewFolder = getWeeklyReviewFolder(cleanedArgs, date);
      return simpleSpec(id, "Review this week", withArgs("/weekly-review", getWeeklyReviewPromptArgs(cleanedArgs, weeklyReviewFolder)), [
        "This week's daily notes, Weekly Todo, Blockers, and active projects",
      ], ["Current week Weekly Review.md"], date, `${weeklyReviewFolder}/Weekly Review.md`, [
        `Review week: ${weeklyReviewFolder.replace("01_Execution/", "")}`,
      ]);
    case "ai-weekly-digest":
      const aiWeeklyTarget = getAiWeeklyDigestTarget(cleanedArgs, date);
      return {
        ...simpleSpec(id, "AI weekly digest", withArgs("/ai-weekly-digest", getAiWeeklyDigestPromptArgs(cleanedArgs, aiWeeklyTarget)), [
          "Recent AI research, GitHub trending notes, RSS and web sources",
        ], ["04_Knowledge/AI-Weekly/ and the current Weekly Review when present"], date, `04_Knowledge/AI-Weekly/${aiWeeklyTarget} - AI Weekly Digest.md`, [
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
      return simpleSpec(id, "Create project", withArgs("/project-init", cleanedArgs), [
        "Existing 02_Projects folders for duplicate checks",
      ], ["New project note and knowledge folder"], date);
    case "project-sync":
      return simpleSpec(id, "Sync project", withArgs("/project-sync", cleanedArgs), [
        "Project note, meeting knowledge, research notes, weekly reviews",
      ], ["Project note synthesis sections"], date);
    case "deadline-plan":
      return simpleSpec(id, "Plan deadline", withArgs("/deadline-plan", cleanedArgs), [
        "Project note, existing deadline plan, calendar/reminder context when available",
      ], ["Project Deadline Plan.md and related reminders"], date);
    case "quarterly-plan":
      return simpleSpec(id, "Quarterly planning", withArgs("/quarterly-plan", getQuarterlyPromptArgs(cleanedArgs, date)), [
        "Annual vision, quarterly plans/reviews, weekly reviews, active projects, horizon items",
      ], ["00_Strategy/YYYY-QX/ planning, review, or monthly pulse notes"], date, getQuarterlyExpectedPath(cleanedArgs, date), [
        getQuarterlyTargetNote(cleanedArgs, date),
      ]);
    case "annual-vision":
      return simpleSpec(id, "Annual vision", withArgs("/annual-vision", getAnnualPromptArgs(cleanedArgs, date)), [
        "Current and prior annual vision/review, quarterly reviews, active projects",
      ], ["00_Strategy/YYYY Vision.md or YYYY Annual Review.md"], date, getAnnualExpectedPath(cleanedArgs, date), [
        getAnnualTargetNote(cleanedArgs, date),
      ]);
    case "add-events":
      return simpleSpec(id, "Add events", withArgs("/add-events", cleanedArgs), [
        "Pasted event descriptions and project context",
      ], ["Apple Calendar/Reminders and project Upcoming Events.md staging notes"], date);
    case "meeting-prep":
      return simpleSpec(id, "Prep meeting", withArgs("/meeting-prep", cleanedArgs), [
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
      return simpleSpec(id, "Draft content", withArgs("/content-draft", cleanedArgs), [
        "05_Content/Backlog.md, Voice Guide.md, selected source notes",
      ], ["05_Content/Drafts/"], date);
    case "deep-research":
      return {
        ...simpleSpec(id, "Deep research", withArgs("/deep-research", cleanedArgs), [
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
    return {
      ...buildWorkflowSpec(command, commandArgs, effectiveDate),
      prompt: appendRunMetadata(trimmed, effectiveDate),
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
  return [
    "Daily pre-flight guard:",
    "Do not rely on CLI hooks being available in this Obsidian-launched run.",
    "Run missing weekly, monthly, and quarterly boundary workflows before writing today's briefing, in the daily-init order: /weekly-review, /ai-weekly-digest, /quarterly-plan pulse, /quarterly-plan review, /quarterly-plan init, then /weekly-init.",
    "Use these concrete targets when a boundary check fires:",
    `- Last week review: /weekly-review ${targets.lastWeek}`,
    `- Last week AI digest: /ai-weekly-digest ${targets.lastWeek}`,
    `- Last month pulse: /quarterly-plan pulse ${targets.lastMonth}`,
    `- Last quarter review: /quarterly-plan review ${targets.lastQuarter}`,
    `- Current quarter plan: /quarterly-plan init ${targets.currentQuarter}`,
    "- Current week setup: /weekly-init",
    "Only continue past a missing boundary artifact if the sub-run fails; record that failure in today's ### Flags.",
  ].join("\n");
}

function getDailyBoundaryTargets(date: Date): {
  lastWeek: string;
  lastMonth: string;
  lastQuarter: string;
  currentQuarter: string;
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
  };
}

function getWeeklyReviewFolder(args: string, date: Date): string {
  const explicit = args.match(/\b(\d{4}-W\d{2})\b/i)?.[1];
  if (explicit) {
    return `01_Execution/${explicit.toUpperCase()}`;
  }
  const target = args.toLowerCase() === "last" || date.getDay() === 1
    ? addDays(date, -7)
    : date;
  return `01_Execution/${getIsoWeekInfo(target).label}`;
}

function getWeeklyReviewPromptArgs(args: string, weeklyReviewFolder: string): string {
  return args || weeklyReviewFolder.replace("01_Execution/", "");
}

function getAiWeeklyDigestTarget(args: string, date: Date): string {
  const explicit = args.match(/\b(\d{4}-W\d{2})\b/i)?.[1];
  if (explicit) {
    return explicit.toUpperCase();
  }
  const target = args.toLowerCase() === "last" || date.getDay() === 1
    ? addDays(date, -7)
    : date;
  return getIsoWeekInfo(target).label;
}

function getAiWeeklyDigestPromptArgs(args: string, target: string): string {
  return args || target;
}

function getAnnualExpectedPath(args: string, date: Date): string {
  const year = Number(args.match(/\b(20\d{2})\b/)?.[1] ?? date.getFullYear());
  const mode = args.toLowerCase().includes("review") ? "Annual Review" : "Vision";
  return `00_Strategy/${year} ${mode}.md`;
}

function getAnnualTargetNote(args: string, date: Date): string {
  const year = Number(args.match(/\b(20\d{2})\b/)?.[1] ?? date.getFullYear());
  const mode = args.toLowerCase().includes("review") ? "Annual review" : "Annual vision";
  return `${mode} target: ${year}`;
}

function getAnnualPromptArgs(args: string, date: Date): string {
  if (args.match(/\b20\d{2}\b/)) {
    return args;
  }
  const year = String(date.getFullYear());
  return args.toLowerCase().includes("review") ? `review ${year}` : year;
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

function getQuarterlyPromptArgs(args: string, date: Date): string {
  const mode = args.split(/\s+/, 1)[0].toLowerCase();
  if (mode === "review" && !parseQuarterArg(args)) {
    return `review ${getPreviousQuarter(date).label}`;
  }
  if (mode === "init" && !parseQuarterArg(args)) {
    return `init ${getQuarterInfo(date).label}`;
  }
  if (mode === "pulse" && !args.match(/\b(20\d{2})-(0?[1-9]|1[0-2])\b/) && !args.match(/\b(0?[1-9]|1[0-2])\b/)) {
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
