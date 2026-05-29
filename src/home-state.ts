import type { App, TFile } from "obsidian";
import { getDailyNotePath, getExecutionWeekFolder } from "./dates";
import {
  type ActiveProjectSummary,
  type BlockersSummary,
  type DailyNoteSummary,
  type MeetingItem,
  type WeeklyTodoSummary,
  parseActiveProjectNote,
  parseBlockers,
  parseDailyNote,
  parseWeeklyTodo,
} from "./vault-parsers";

export interface OperatorHomeState {
  weekFolder: string;
  dailyNotePath: string;
  weeklyTodoPath: string;
  blockersPath: string;
  blockersExists: boolean;
  daily: DailyNoteSummary;
  weeklyTodo: WeeklyTodoSummary;
  activeProjects: ActiveProjectSummary[];
  blockers: BlockersSummary;
}

export async function readOperatorHomeState(app: App, date = new Date()): Promise<OperatorHomeState> {
  const activeProjects = await readActiveProjects(app);
  const weekFolder = getExecutionWeekFolder(date);
  const dailyNotePath = getDailyNotePath(date);
  const weeklyTodoPath = `${weekFolder}/Weekly Todo.md`;
  const blockersPath = `${weekFolder}/Blockers.md`;
  const dailyFile = app.vault.getAbstractFileByPath(dailyNotePath);
  const weeklyTodoFile = app.vault.getAbstractFileByPath(weeklyTodoPath);
  const blockersFile = app.vault.getAbstractFileByPath(blockersPath);
  const dailyMarkdown = isVaultFile(dailyFile) ? await app.vault.read(dailyFile) : "";
  const weeklyTodoMarkdown = isVaultFile(weeklyTodoFile) ? await app.vault.read(weeklyTodoFile) : "";
  const blockersMarkdown = isVaultFile(blockersFile) ? await app.vault.read(blockersFile) : "";
  const blockers = parseBlockers(blockersMarkdown, date, activeProjects.map((project) => project.name));

  return {
    weekFolder,
    dailyNotePath,
    weeklyTodoPath,
    blockersPath,
    blockersExists: isVaultFile(blockersFile),
    daily: parseDailyNote(dailyMarkdown, isVaultFile(dailyFile)),
    weeklyTodo: parseWeeklyTodo(weeklyTodoMarkdown, isVaultFile(weeklyTodoFile)),
    activeProjects,
    blockers: {
      waitingOn: blockers.waitingOn,
      meetings: sortMeetingsForToday(blockers.meetings),
    },
  };
}

export async function appendQuickCapture(
  app: App,
  kind: "idea" | "task" | "meeting" | "research",
  text: string,
  date = new Date(),
): Promise<string> {
  const captureItems = normalizeCaptureItems(text);
  if (captureItems.length === 0) {
    throw new Error("Capture text is empty.");
  }

  const dailyPath = getDailyNotePath(date);
  await ensureFolderPath(app, getExecutionWeekFolder(date));
  const file = await ensureDailyNote(app, dailyPath, date);
  const line = captureItems.map((item) => formatCaptureLine(kind, item)).join("\n");

  await app.vault.process(file, (current) => insertUnderCapture(current, line));
  return dailyPath;
}

export async function updateMarkdownTaskState(
  app: App,
  path: string,
  rawLine: string,
  marker: " " | "x" | ">",
): Promise<void> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!isVaultFile(file)) {
    throw new Error(`${path} is not a note.`);
  }

  const updatedLine = rawLine.replace(/^(\s*[-*]\s+\[)[^\]](\]\s+)/, `$1${marker}$2`);
  if (updatedLine === rawLine) {
    throw new Error("Selected line is not a Markdown task.");
  }

  await app.vault.process(file, (current) => {
    const occurrences = current.split(rawLine).length - 1;
    if (occurrences === 0) {
      throw new Error("Selected task was not found in the source note.");
    }
    if (occurrences > 1) {
      throw new Error("Selected task appears more than once in the source note. Open the note to edit the exact item.");
    }
    return current.replace(rawLine, updatedLine);
  });
}

async function readActiveProjects(app: App): Promise<ActiveProjectSummary[]> {
  const projectFiles = app.vault
    .getMarkdownFiles()
    .filter((file) => /^02_Projects\/[^/]+\/[^/]+\.md$/i.test(file.path));

  const projects: ActiveProjectSummary[] = [];
  for (const file of projectFiles) {
    const parsed = parseActiveProjectNote(file.path, await app.vault.read(file));
    if (parsed) {
      projects.push(parsed);
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function ensureDailyNote(app: App, path: string, date: Date): Promise<TFile> {
  const existing = app.vault.getAbstractFileByPath(path);
  if (isVaultFile(existing)) {
    return existing;
  }
  if (existing) {
    throw new Error(`${path} exists but is not a note.`);
  }

  return app.vault.create(path, `# ${path.split("/").pop()?.replace(/\.md$/, "") ?? date.toDateString()}\n\n## Capture\n`);
}

async function ensureFolderPath(app: App, folderPath: string): Promise<void> {
  const segments = normalizeVaultPath(folderPath).split("/");
  let current = "";
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    if (!app.vault.getAbstractFileByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
}

function isVaultFile(value: unknown): value is TFile {
  return !!value && typeof value === "object" && "extension" in value;
}

function insertUnderCapture(markdown: string, line: string): string {
  if (!/^## Capture\s*$/m.test(markdown)) {
    const suffix = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${suffix}\n## Capture\n${line}\n`;
  }

  return markdown.replace(/(^## Capture\s*$)/m, `$1\n${line}`);
}

function normalizeCaptureItems(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatCaptureLine(kind: "idea" | "task" | "meeting" | "research", text: string): string {
  switch (kind) {
    case "task":
      return `- [ ] ${text}`;
    case "meeting":
      return `- Meeting note: ${text}`;
    case "research":
      return `- Research question: ${text}`;
    case "idea":
    default:
      return `- Idea: ${text}`;
  }
}

function sortMeetingsForToday(meetings: MeetingItem[]): MeetingItem[] {
  const rank: Record<MeetingItem["timing"], number> = {
    today: 0,
    tomorrow: 1,
    upcoming: 2,
    unknown: 3,
    past: 4,
  };

  return [...meetings].sort((a, b) => {
    const rankDelta = rank[a.timing] - rank[b.timing];
    if (rankDelta !== 0) {
      return rankDelta;
    }
    return (a.dateIso ?? "9999-99-99").localeCompare(b.dateIso ?? "9999-99-99");
  });
}
