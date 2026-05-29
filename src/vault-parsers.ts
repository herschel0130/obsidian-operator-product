import { addDays, formatDateKey, startOfLocalDay } from "./dates";

export interface ActiveProjectSummary {
  name: string;
  notePath: string;
  nextActions: string[];
}

export interface MarkdownActionItem {
  text: string;
  raw: string;
}

export interface DailyNoteSummary {
  exists: boolean;
  focus: string[];
  tasks: MarkdownActionItem[];
  carriedForward: MarkdownActionItem[];
  schedule: string[];
  captureCount: number;
}

export interface WeeklyTodoSummary {
  exists: boolean;
  openTasks: MarkdownActionItem[];
  carriedForward: MarkdownActionItem[];
}

export interface WaitingOnItem {
  text: string;
  raw: string;
}

export type MeetingTiming = "past" | "today" | "tomorrow" | "upcoming" | "unknown";

export interface MeetingItem {
  text: string;
  raw: string;
  dateIso?: string;
  timing: MeetingTiming;
  project?: string;
}

export interface BlockersSummary {
  waitingOn: WaitingOnItem[];
  meetings: MeetingItem[];
}

interface ParsedTaskLine {
  checked: string;
  text: string;
  raw: string;
}

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function parseActiveProjectNote(path: string, markdown: string): ActiveProjectSummary | null {
  const frontmatter = parseFrontmatter(markdown);
  if ((frontmatter.status ?? "").toLowerCase() !== "active") {
    return null;
  }

  const name = frontmatter.project || projectNameFromPath(path);
  const now = extractHeadingSection(markdown, "Now")
    .split("\n")
    .map(cleanOpenProjectNowLine)
    .filter(Boolean)
    .slice(0, 3);

  return {
    name,
    notePath: path,
    nextActions: now.length > 0 ? now : ["No current next action in ## Now."],
  };
}

export function parseBlockers(markdown: string, today = new Date(), projectNames: string[] = []): BlockersSummary {
  const waitingOn = extractHeadingSection(markdown, "Waiting On")
    .split("\n")
    .map(parseTaskLine)
    .filter((item): item is ParsedTaskLine => !!item && item.checked.trim() === "")
    .map((item) => ({
      raw: item.raw,
      text: cleanMarkdownLine(item.text),
    }))
    .filter((item) => item.text.length > 0);

  const meetings = extractHeadingSection(markdown, "Meetings")
    .split("\n")
    .map(parseTaskLine)
    .filter((item): item is ParsedTaskLine => !!item && item.checked.trim() === "")
    .map((item) => {
      const parsedDate = parseMeetingDate(item.text, today);
      return {
        raw: item.raw,
        text: cleanMarkdownLine(item.text),
        dateIso: parsedDate.dateIso,
        timing: parsedDate.timing,
        project: detectProjectName(item.text, projectNames),
      };
    })
    .filter((item) => item.text.length > 0);

  return { waitingOn, meetings };
}

export function parseDailyNote(markdown: string, exists = markdown.trim().length > 0): DailyNoteSummary {
  const focus = extractHeadingSection(markdown, "Focus")
    .split("\n")
    .map(cleanMarkdownLine)
    .filter(Boolean)
    .slice(0, 5);

  const taskLines = [
    extractHeadingSection(markdown, "Tasks"),
    removeNestedHeadingSection(extractHeadingSectionAtAnyLevel(markdown, "Action Items"), "Deferred"),
    extractHeadingSectionAtAnyLevel(markdown, "Next Actions"),
    extractHeadingSection(markdown, "Capture"),
  ].join("\n");
  const parsedTasks = taskLines
    .split("\n")
    .map(parseTaskLine)
    .filter((item): item is ParsedTaskLine => !!item);

  const schedule = [
    extractHeadingSection(markdown, "Schedule"),
    extractHeadingSection(markdown, "Time Blocks"),
    extractHeadingSection(markdown, "Calendar"),
  ]
    .join("\n")
    .split("\n")
    .map(cleanOpenScheduleLine)
    .filter(Boolean)
    .slice(0, 8);

  const captureCount = extractHeadingSection(markdown, "Capture")
    .split("\n")
    .map(cleanMarkdownLine)
    .filter(Boolean).length;

  return {
    exists,
    focus,
    tasks: parsedTasks
      .filter((item) => item.checked.trim() === "")
      .map(taskLineToActionItem)
      .slice(0, 8),
    carriedForward: parsedTasks
      .filter((item) => item.checked.trim() === ">")
      .map(taskLineToActionItem)
      .slice(0, 8),
    schedule,
    captureCount,
  };
}

export function parseWeeklyTodo(markdown: string, exists = markdown.trim().length > 0): WeeklyTodoSummary {
  const parsedTasks = markdown
    .split("\n")
    .map(parseTaskLine)
    .filter((item): item is ParsedTaskLine => !!item);

  return {
    exists,
    openTasks: parsedTasks
      .filter((item) => item.checked.trim() === "")
      .map(taskLineToActionItem)
      .slice(0, 12),
    carriedForward: parsedTasks
      .filter((item) => item.checked.trim() === ">")
      .map(taskLineToActionItem)
      .slice(0, 8),
  };
}

export function extractHeadingSection(markdown: string, heading: string, level = 2): string {
  const lines = markdown.split(/\r?\n/);
  const marker = `${"#".repeat(level)} ${heading}`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === marker);
  if (start === -1) {
    return "";
  }

  const section: string[] = [];
  const headingPattern = /^#{1,6}\s+/;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (headingPattern.test(line.trim())) {
      const nextLevel = line.trim().match(/^#+/)?.[0].length ?? 6;
      if (nextLevel <= level) {
        break;
      }
    }
    section.push(line);
  }

  return section.join("\n").trim();
}

export function extractHeadingSectionAtAnyLevel(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const markerPattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const start = lines.findIndex((line) => markerPattern.test(line.trim()));
  if (start === -1) {
    return "";
  }

  const level = lines[start].trim().match(/^#+/)?.[0].length ?? 2;
  const section: string[] = [];
  const headingPattern = /^#{1,6}\s+/;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (headingPattern.test(line.trim())) {
      const nextLevel = line.trim().match(/^#+/)?.[0].length ?? 6;
      if (nextLevel <= level) {
        break;
      }
    }
    section.push(line);
  }

  return section.join("\n").trim();
}

function removeNestedHeadingSection(markdown: string, heading: string): string {
  const lines = markdown.split(/\r?\n/);
  const markerPattern = new RegExp(`^#{1,6}\\s+${escapeRegExp(heading)}\\s*$`, "i");
  const result: string[] = [];
  let skipLevel: number | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const headingMatch = trimmed.match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      if (skipLevel !== null && level <= skipLevel) {
        skipLevel = null;
      }
      if (markerPattern.test(trimmed)) {
        skipLevel = level;
        continue;
      }
    }

    if (skipLevel === null) {
      result.push(line);
    }
  }

  return result.join("\n").trim();
}

export function cleanMarkdownLine(line: string): string {
  return line
    .replace(/^\s*[-*]\s+\[[^\]]\]\s+/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/^\s*\d+\.\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseFrontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return {};
  }

  const values: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const row = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (row) {
      values[row[1]] = row[2].replace(/^["']|["']$/g, "").trim();
    }
  }
  return values;
}

function projectNameFromPath(path: string): string {
  const parts = path.split("/");
  return parts.length >= 3 ? parts[1] : path.replace(/\.md$/i, "");
}

function parseTaskLine(line: string): ParsedTaskLine | null {
  const match = line.match(/^\s*[-*]\s+\[([^\]])\]\s+(.+)$/);
  if (!match) {
    return null;
  }
  return {
    checked: match[1],
    text: match[2],
    raw: line,
  };
}

function taskLineToActionItem(item: ParsedTaskLine): MarkdownActionItem {
  return {
    raw: item.raw,
    text: cleanMarkdownLine(item.text),
  };
}

function cleanOpenProjectNowLine(line: string): string {
  const task = parseTaskLine(line);
  if (task) {
    return task.checked.trim() === "" ? cleanMarkdownLine(task.text) : "";
  }
  return cleanMarkdownLine(line);
}

function cleanOpenScheduleLine(line: string): string {
  const task = parseTaskLine(line);
  if (task) {
    return task.checked.trim() === "" ? cleanMarkdownLine(task.text) : "";
  }
  return cleanMarkdownLine(line);
}

function parseMeetingDate(text: string, today: Date): { dateIso?: string; timing: MeetingTiming } {
  const candidate = text.match(/\*\*([^*]+)\*\*/)?.[1] ?? text;
  const iso = candidate.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) {
    return classifyMeetingDate(new Date(`${iso[1]}T00:00:00`), today);
  }

  const monthMatch = candidate.match(
    /\b(?:mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)?\.?\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t)?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,\s*(20\d{2}))?/i,
  );
  if (!monthMatch) {
    return { timing: "unknown" };
  }

  const monthName = monthMatch[1].toLowerCase().replace(/\.$/, "");
  const month = MONTHS[monthName];
  if (month === undefined) {
    return { timing: "unknown" };
  }

  const day = Number(monthMatch[2]);
  const explicitYear = monthMatch[3] ? Number(monthMatch[3]) : undefined;
  const year = explicitYear ?? inferMeetingYear(today, month, day);
  return classifyMeetingDate(new Date(year, month, day), today);
}

function inferMeetingYear(today: Date, month: number, day: number): number {
  const currentYearDate = new Date(today.getFullYear(), month, day);
  const todayStart = startOfLocalDay(today);
  const sixMonthsAgo = addDays(todayStart, -183);
  if (currentYearDate < sixMonthsAgo) {
    return today.getFullYear() + 1;
  }
  return today.getFullYear();
}

function classifyMeetingDate(date: Date, today: Date): { dateIso: string; timing: MeetingTiming } {
  const meetingDay = startOfLocalDay(date);
  const todayStart = startOfLocalDay(today);
  const tomorrow = startOfLocalDay(addDays(todayStart, 1));

  let timing: MeetingTiming = "upcoming";
  if (meetingDay < todayStart) {
    timing = "past";
  } else if (meetingDay.getTime() === todayStart.getTime()) {
    timing = "today";
  } else if (meetingDay.getTime() === tomorrow.getTime()) {
    timing = "tomorrow";
  }

  return {
    dateIso: formatDateKey(meetingDay),
    timing,
  };
}

function detectProjectName(text: string, projectNames: string[]): string | undefined {
  const lowerText = text.toLowerCase();
  return projectNames.find((name) => lowerText.includes(name.toLowerCase()));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
